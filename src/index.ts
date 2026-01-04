import type { Plugin } from '@opencode-ai/plugin'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { classify } from './classifier'
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

      const testOutput = await getTestOutputWithLogging(
        projectRoot,
        configResult.config,
        logger,
      )

      if (testOutput.includes('FAIL')) {
        await logger.info(`Allowed edit (RED): ${filePath}`)
        return
      }

      const fileType = classify(filePath, configResult.config.testFilePatterns)
      if (fileType === 'test') {
        await logger.info(`Allowed test edit: ${filePath}`)
        return
      }

      const llmClient = getLlmClient(client)
      if (!llmClient) {
        await logger.info(`Allowed edit (no LLM): ${filePath}`)
        return
      }

      const result = await verifyEdit(
        llmClient,
        configResult.config.verifierModel,
        filePath,
        testOutput,
      )
      if (!result.allowed) {
        await logger.warn(`Blocked: ${result.reason} - ${filePath}`)
        throw new Error(`TDD: ${result.reason}`)
      }

      await logger.info(`Allowed edit (verified): ${filePath}`)
    },
  }
}
