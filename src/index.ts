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

const countFailingTests = (testOutput: string): number => {
  const failPatterns = [/\bFAIL\b/gi, /✗/g, /\bfailed\b/gi, /\bfailing\b/gi]
  const matches = failPatterns.flatMap(
    (pattern) => testOutput.match(pattern) ?? [],
  )
  return matches.length
}

const isTestFile = (filePath: string): boolean => {
  return /\.(test|spec)\.[jt]sx?$/.test(filePath) || filePath.includes('/test/')
}

type TDDContext = {
  filePath: string
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

  // failCount === 0: test files can always be edited (write next test)
  if (isTestFile(ctx.filePath)) {
    await ctx.logger.info(`Allowed edit (test file): ${ctx.filePath}`)
    return
  }

  await verifyWithLlm(ctx)
}

const verifyWithLlm = async (ctx: TDDContext): Promise<void> => {
  if (!ctx.llmClient) {
    await ctx.logger.info(`Allowed edit (no LLM): ${ctx.filePath}`)
    return
  }

  const result = await verifyEdit(
    ctx.llmClient,
    ctx.config.verifierModel,
    ctx.filePath,
    ctx.testOutput,
  )

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

      await enforceOneFailingTestRule({
        filePath,
        config: configResult.config,
        testOutput,
        logger,
        llmClient: getLlmClient(client),
      })
    },
  }
}
