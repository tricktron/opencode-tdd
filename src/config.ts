import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type TDDConfig = {
  verifierModel: string
  enforcePatterns: string[]
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
  if (value === undefined || value === null) {
    throw new Error(`TDD: Missing config field: ${field}`)
  }
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

  const verifierModel = requireString(config.verifierModel, 'verifierModel')
  const enforcePatterns = requireStringArray(
    config.enforcePatterns,
    'enforcePatterns',
  )

  return {
    kind: 'loaded',
    config: {
      verifierModel,
      enforcePatterns,
    },
  }
}
