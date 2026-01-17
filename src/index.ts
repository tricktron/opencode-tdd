import type { Plugin } from '@opencode-ai/plugin'
import { join } from 'node:path'
import picomatch from 'picomatch'
import { createAuditor, type Auditor } from './auditor'
import { loadConfig, type TDDConfig } from './config'
import { formatError, safeLog, type AppLogger } from './logger'
import { verifyEditWithTestRunner } from './verifier'

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
        tools?: { [key: string]: boolean }
      }
    }) => Promise<{
      data?: { parts?: Array<{ type: string; text?: string }> }
      error?: unknown
    }>
    delete: (opts: { path: { id: string } }) => Promise<unknown>
    messages: (opts: { path: { id: string } }) => Promise<{
      data?: Array<{
        info: { id: string; role: string }
        parts: Array<{ type: string }>
      }>
      error?: unknown
    }>
  }
  app: AppLogger
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
  sdkClient: SdkClient
  sessionId: string
  projectRoot: string
  auditor: Auditor
}

const verifyWithLlm = async (ctx: TDDContext): Promise<void> => {
  try {
    await verifyEditWithTestRunner({
      sdkClient: ctx.sdkClient,
      parentSessionId: ctx.sessionId,
      model: ctx.config.verifierModel,
      filePath: ctx.filePath,
      editContent: ctx.editContent,
      projectRoot: ctx.projectRoot,
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

      if (!sdkClient) {
        throw new Error('TDD violation: SDK client required for verification')
      }

      const editContent = getEditContent(input.tool, output.args)

      await verifyWithLlm({
        filePath,
        editContent,
        config: configResult.config,
        sdkClient,
        sessionId: input.sessionID,
        projectRoot,
        auditor,
      })
    },
  }
}
