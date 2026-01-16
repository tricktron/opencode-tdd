import type { Plugin } from '@opencode-ai/plugin'
import { join } from 'node:path'
import picomatch from 'picomatch'
import { createAuditor, type Auditor } from './auditor'
import { loadConfig, type TDDConfig } from './config'
import { formatError, safeLog, type AppLogger } from './logger'
import { verifyEdit, type LlmClient } from './verifier'

const getTestOutputFromSession = async (
  sdkClient: SdkClient,
  sessionId: string,
): Promise<string> => {
  let messagesResponse
  try {
    messagesResponse = await sdkClient.session.messages({
      path: { id: sessionId },
    })
  } catch (error) {
    throw new Error('Failed to read session history')
  }

  if (messagesResponse.error || !messagesResponse.data) {
    throw new Error('Failed to read session history')
  }

  const messages = messagesResponse.data

  // Extract completed bash tool outputs
  const bashOutputs: string[] = []
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (
        part.type === 'tool' &&
        (part as { tool?: string }).tool === 'bash' &&
        (part as { state?: { status?: string } }).state?.status === 'completed'
      ) {
        const output = (part as { state: { output?: string } }).state.output
        if (output) {
          bashOutputs.push(output)
        }
      }
    }
  }

  if (bashOutputs.length === 0) {
    throw new Error('No bash command output found in session. Run tests first.')
  }

  // Take last 5 outputs
  const last5 = bashOutputs.slice(-5)
  return last5.join('\n\n')
}

const getTestOutput = async (
  sdkClient: SdkClient | undefined,
  sessionId: string,
): Promise<string> => {
  if (!sdkClient) {
    throw new Error('SDK client required for session-based test output')
  }
  return getTestOutputFromSession(sdkClient, sessionId)
}

type ToolPart = {
  type: 'tool'
  tool?: string
  state?: {
    status?: string
    output?: string
  }
}

type Part = { type: string } | ToolPart

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
    messages: (opts: { path: { id: string } }) => Promise<{
      data?: Array<{
        info: { id: string; role: string }
        parts: Part[]
      }>
      error?: unknown
    }>
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

      const testOutput = await getTestOutput(sdkClient, input.sessionID)

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
