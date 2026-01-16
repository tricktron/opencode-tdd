import type { Plugin } from '@opencode-ai/plugin'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import picomatch from 'picomatch'
import { createAuditor, type Auditor } from './auditor'
import { loadConfig, type TDDConfig } from './config'
import { formatError, safeLog, type AppLogger } from './logger'
import { verifyEdit, type LlmClient } from './verifier'

const getTestOutput = async (projectRoot: string, config: TDDConfig) => {
  const testOutputPath = join(projectRoot, config.testOutputFile)
  const testOutputStat = await stat(testOutputPath).catch(() => null)
  if (!testOutputStat) {
    throw new Error(
      'TDD violation: Run tests first before editing implementation.',
    )
  }

  const ageSeconds = (Date.now() - testOutputStat.mtimeMs) / 1000
  if (ageSeconds > config.maxTestOutputAge) {
    throw new Error(
      'TDD violation: Test output is stale. Re-run tests before editing.',
    )
  }

  return readFile(testOutputPath, 'utf8')
}

type SdkClient = {
  session: {
    create: (opts: {
      body: { title: string; parent?: string }
    }) => Promise<{ data?: { id: string }; error?: unknown }>
    prompt: (opts: {
      path: { id: string }
      body: {
        model: { providerID: string; modelID: string }
        parts: Array<{ type: string; text: string }>
      }
    }) => Promise<{
      data?: { parts?: Array<{ type: string; text?: string }> }
      error?: unknown
    }>
    delete: (opts: { path: { id: string } }) => Promise<unknown>
  }
  app: AppLogger
}

const createSdkAdapter = (
  sdkClient: SdkClient,
  parentSessionId: string,
): LlmClient => ({
  chat: async (
    model: string,
    messages: Array<{ role: string; content: string }>,
  ) => {
    const systemMsg = messages.find((m) => m.role === 'system')?.content ?? ''
    const userMsg = messages.find((m) => m.role === 'user')?.content ?? ''
    const combinedPrompt = `${systemMsg}\n\n${userMsg}`
    const [providerId, modelId] = model.split('/')

    const sessionResult = await sdkClient.session.create({
      body: { title: 'TDD Verifier', parent: parentSessionId },
    })

    if (sessionResult.error || !sessionResult.data?.id) {
      throw new Error('Failed to create verification session')
    }

    const childId = sessionResult.data.id

    try {
      const promptResult = await sdkClient.session.prompt({
        path: { id: childId },
        body: {
          model: { providerID: providerId, modelID: modelId },
          parts: [{ type: 'text', text: combinedPrompt }],
        },
      })

      if (promptResult.error) {
        throw new Error('Verification prompt failed')
      }

      const textPart = promptResult.data?.parts?.find((p) => p.type === 'text')
      const response = textPart?.text ?? ''

      if (!response) {
        throw new Error('No LLM response text received')
      }

      return response
    } finally {
      await sdkClient.session
        .delete({ path: { id: childId } })
        .catch((error) => {
          safeLog(
            sdkClient.app,
            'debug',
            'Failed to clean up verification session',
            {
              sessionId: childId,
              error: formatError(error),
            },
          )
        })
    }
  },
})

// Resolves LlmClient from the Plugin's `client` parameter.
// The Plugin interface from @opencode-ai/plugin doesn't allow custom parameters,
// so unit tests inject a mock LlmClient (with `chat` method) via the same `client` param.
// Duck-typing detects mock vs real SDK client at runtime - pragmatic given the constraint.
const resolveLlmClient = (client: unknown, sessionId: string): LlmClient => {
  const mockClient = client as LlmClient | undefined
  if (mockClient && typeof mockClient.chat === 'function') {
    return mockClient
  }
  return createSdkAdapter(client as SdkClient, sessionId)
}

const isEnforced = (
  filePath: string,
  enforcePatterns: string[] | undefined,
): boolean => {
  if (!enforcePatterns) {
    return false
  }
  return picomatch(enforcePatterns)(filePath)
}

const getEditContent = (
  tool: string,
  args: Record<string, unknown>,
): string => {
  if (tool === 'write') {
    return (args.content as string) ?? ''
  }
  return (args.newString as string) ?? ''
}

type TDDContext = {
  filePath: string
  editContent: string
  config: TDDConfig
  testOutput: string
  llmClient: LlmClient
  auditor: Auditor
}

const verifyWithLlm = async (ctx: TDDContext): Promise<void> => {
  try {
    await verifyEdit({
      client: ctx.llmClient,
      model: ctx.config.verifierModel,
      filePath: ctx.filePath,
      editContent: ctx.editContent,
      testOutput: ctx.testOutput,
      auditor: ctx.auditor,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`TDD violation: ${message}`)
  }
}

const loadConfigWithLogging = async (
  projectRoot: string,
  logger: AppLogger | undefined,
) => {
  try {
    return await loadConfig(projectRoot)
  } catch (error) {
    safeLog(logger, 'error', 'Config parse failed', {
      configPath: join(projectRoot, '.opencode', 'tdd.json'),
      error: formatError(error),
    })
    throw error
  }
}

export const TDDPlugin: Plugin = async ({ client, directory }) => {
  const projectRoot = directory ?? process.cwd()
  const auditor = createAuditor(projectRoot)
  const sdkClient = client as SdkClient | undefined
  const logger = sdkClient?.app

  return {
    'tool.execute.before': async (input, output) => {
      if (!['edit', 'write'].includes(input.tool)) {
        return
      }

      const filePath = output.args.filePath as string

      const configResult = await loadConfigWithLogging(projectRoot, logger)
      if (configResult.kind === 'missing') {
        return
      }

      if (!isEnforced(filePath, configResult.config.enforcePatterns)) {
        return
      }

      const testOutput = await getTestOutput(projectRoot, configResult.config)

      const editContent = getEditContent(input.tool, output.args)

      await verifyWithLlm({
        filePath,
        editContent,
        config: configResult.config,
        testOutput,
        llmClient: resolveLlmClient(client, input.sessionID),
        auditor,
      })
    },
  }
}
