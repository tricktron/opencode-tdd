import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type TDDConfig = {
  testOutputFile: string
  enforcePatterns?: string[]
  verifierModel: string
  maxTestOutputAge: number
}

export type ConfigLoadResult =
  | { kind: 'missing' }
  | { kind: 'loaded'; config: TDDConfig }

const requireString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`TDD: Missing config field: ${field}`)
  }

  return value
}

const requireStringArray = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`TDD: ${field} must be an array of strings`)
  }

  return value
}

export const loadConfig = async (
  projectRoot: string,
): Promise<ConfigLoadResult> => {
  const configPath = join(projectRoot, '.opencode', 'tdd.json')
  const configRaw = await readFile(configPath, 'utf8').catch(() => null)
  if (!configRaw) {
    return { kind: 'missing' }
  }

  let config: Record<string, unknown>
  try {
    config = JSON.parse(configRaw) as Record<string, unknown>
  } catch {
    throw new Error('TDD: Invalid config JSON')
  }

  const testOutputFile = requireString(config.testOutputFile, 'testOutputFile')
  let enforcePatterns: string[] | undefined
  if (config.enforcePatterns !== undefined) {
    enforcePatterns = requireStringArray(
      config.enforcePatterns,
      'enforcePatterns',
    )
  }
  const verifierModel = requireString(config.verifierModel, 'verifierModel')
  const maxTestOutputAge =
    typeof config.maxTestOutputAge === 'number' ? config.maxTestOutputAge : 300

  return {
    kind: 'loaded',
    config: {
      testOutputFile,
      enforcePatterns,
      verifierModel,
      maxTestOutputAge,
    },
  }
}
