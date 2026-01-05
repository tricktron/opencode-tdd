import type { Plugin } from '@opencode-ai/plugin'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import picomatch from 'picomatch'
import { loadConfig, type TDDConfig } from './config'
import { createLogger, type Logger } from './logger'
import { verifyEdit, type LlmClient } from './verifier'

const getTestOutput = async (projectRoot: string, config: TDDConfig) => {
  const testOutputPath = join(projectRoot, config.testOutputFile)
  const testOutputStat = await stat(testOutputPath).catch(() => null)
  if (!testOutputStat) {
    throw new Error('TDD: Run tests first')
  }

  const ageSeconds = (Date.now() - testOutputStat.mtimeMs) / 1000
  if (ageSeconds > config.maxTestOutputAge) {
    throw new Error('TDD: Re-run tests')
  }

  return readFile(testOutputPath, 'utf8')
}

const getTestOutputWithLogging = async (
  projectRoot: string,
  config: TDDConfig,
  logger: Logger,
) => {
  try {
    return await getTestOutput(projectRoot, config)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logger.error(message.replace('TDD: ', ''))
    throw err
  }
}

const getLlmClient = (client: unknown): LlmClient | null => {
  const llmClient = client as LlmClient | undefined
  if (!llmClient || typeof llmClient.chat !== 'function') {
    return null
  }

  return llmClient
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

const countFailingTests = (testOutput: string): number => {
  const failPatterns = [/\bFAIL\b/gi, /✗/g, /\bfailed\b/gi, /\bfailing\b/gi]
  const matches = failPatterns.flatMap(
    (pattern) => testOutput.match(pattern) ?? [],
  )
  return matches.length
}

type TDDContext = {
  filePath: string
  editContent: string
  config: TDDConfig
  testOutput: string
  logger: Logger
  llmClient: LlmClient | null
}

const enforceOneFailingTestRule = async (ctx: TDDContext): Promise<void> => {
  const failCount = countFailingTests(ctx.testOutput)

  if (failCount > 1) {
    await ctx.logger.warn(
      `Blocked: Fix existing failing test first - ${ctx.filePath}`,
    )
    throw new Error('TDD: Fix existing failing test first')
  }

  if (failCount === 1) {
    await ctx.logger.info(`Allowed edit (RED): ${ctx.filePath}`)
    return
  }

  // failCount === 0: LLM classifies as test or impl edit
  await verifyWithLlm(ctx)
}

const verifyWithLlm = async (ctx: TDDContext): Promise<void> => {
  if (!ctx.llmClient) {
    await ctx.logger.info(`Allowed edit (no LLM): ${ctx.filePath}`)
    return
  }

  const result = await verifyEdit({
    client: ctx.llmClient,
    model: ctx.config.verifierModel,
    filePath: ctx.filePath,
    editContent: ctx.editContent,
    testOutput: ctx.testOutput,
  })

  if (!result.allowed) {
    await ctx.logger.warn(`Blocked: ${result.reason} - ${ctx.filePath}`)
    throw new Error(`TDD: ${result.reason}`)
  }

  await ctx.logger.info(`Allowed edit (verified): ${ctx.filePath}`)
}

export const TDDPlugin: Plugin = async ({ client, directory }) => {
  const projectRoot = directory ?? process.cwd()
  const logger = createLogger(projectRoot)

  return {
    'tool.execute.before': async (input, output) => {
      if (!['edit', 'write'].includes(input.tool)) {
        return
      }

      const filePath = output.args.filePath as string
      console.log(`[TDD] Intercepted ${input.tool}: ${filePath}`)

      const configResult = await loadConfig(projectRoot)
      if (configResult.kind === 'missing') {
        return
      }

      if (!isEnforced(filePath, configResult.config.enforcePatterns)) {
        return
      }

      const testOutput = await getTestOutputWithLogging(
        projectRoot,
        configResult.config,
        logger,
      )

      const editContent = getEditContent(input.tool, output.args)

      await enforceOneFailingTestRule({
        filePath,
        editContent,
        config: configResult.config,
        testOutput,
        logger,
        llmClient: getLlmClient(client),
      })
    },
  }
}
