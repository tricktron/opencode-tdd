import type { Plugin } from '@opencode-ai/plugin'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { classify } from './classifier'
import { loadConfig, type TDDConfig } from './config'
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

const getLlmClient = (client: unknown): LlmClient | null => {
  const llmClient = client as LlmClient | undefined
  if (!llmClient || typeof llmClient.chat !== 'function') {
    return null
  }

  return llmClient
}

export const TDDPlugin: Plugin = async ({ client, directory }) => {
  return {
    'tool.execute.before': async (input, output) => {
      if (!['edit', 'write'].includes(input.tool)) {
        return
      }

      const filePath = output.args.filePath as string
      console.log(`[TDD] Intercepted ${input.tool}: ${filePath}`)

      const projectRoot = directory ?? process.cwd()
      const configResult = await loadConfig(projectRoot)
      if (configResult.kind === 'missing') {
        return
      }

      const testOutput = await getTestOutput(projectRoot, configResult.config)
      if (testOutput.includes('FAIL')) {
        return
      }

      const fileType = classify(filePath, configResult.config.testFilePatterns)
      if (fileType === 'test') {
        return
      }

      const llmClient = getLlmClient(client)
      if (!llmClient) {
        return
      }

      const result = await verifyEdit(
        llmClient,
        configResult.config.verifierModel,
        filePath,
        testOutput,
      )
      if (!result.allowed) {
        throw new Error(`TDD: ${result.reason}`)
      }
    },
  }
}
