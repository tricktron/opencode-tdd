import { describe, test, expect } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config'

// Slice: 28-configurable-test-output-limit
// Given a tdd.json with "testOutputLines": 20
// When a block error includes test output
// Then only the first 20 lines are included
// Default: 50 lines when not configured

describe('Configurable Test Output Limit', () => {
  test('respects testOutputLines configuration', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'opencode-tdd-'))
    const configPath = join(projectRoot, '.opencode', 'tdd.json')
    await mkdir(join(projectRoot, '.opencode'), { recursive: true })
    await writeFile(
      configPath,
      JSON.stringify({
        verifierModel: 'test/model',
        enforcePatterns: ['src/**'],
        testOutputLines: 20,
      }),
    )

    const result = await loadConfig(projectRoot)

    expect(result.kind).toBe('loaded')
    if (result.kind === 'loaded') {
      expect(result.config.testOutputLines).toBe(20)
    }
  })

  test('defaults to undefined when not configured', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'opencode-tdd-'))
    const configPath = join(projectRoot, '.opencode', 'tdd.json')
    await mkdir(join(projectRoot, '.opencode'), { recursive: true })
    await writeFile(
      configPath,
      JSON.stringify({
        verifierModel: 'test/model',
        enforcePatterns: ['src/**'],
      }),
    )

    const result = await loadConfig(projectRoot)

    expect(result.kind).toBe('loaded')
    if (result.kind === 'loaded') {
      expect(result.config.testOutputLines).toBeUndefined()
    }
  })

  test('rejects non-positive integer', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'opencode-tdd-'))
    const configPath = join(projectRoot, '.opencode', 'tdd.json')
    await mkdir(join(projectRoot, '.opencode'), { recursive: true })
    await writeFile(
      configPath,
      JSON.stringify({
        verifierModel: 'test/model',
        enforcePatterns: ['src/**'],
        testOutputLines: -5,
      }),
    )

    await expect(loadConfig(projectRoot)).rejects.toThrow(
      'testOutputLines must be a positive integer',
    )
  })
})
