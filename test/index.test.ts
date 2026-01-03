import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TDDPlugin } from '../src/index'

describe('TDDPlugin', () => {
  test('exports a plugin function', () => {
    expect(typeof TDDPlugin).toBe('function')
  })

  test('allows when config is missing', async () => {
    const projectRoot = await createProjectRoot()
    const hook = await getHook(projectRoot)

    return expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).resolves.toBeUndefined()
  })

  test('blocks when config has invalid JSON', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfigRaw(projectRoot, '{')

    const hook = await getHook(projectRoot)

    return expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).rejects.toThrow('TDD: Invalid config JSON')
  })

  test('blocks when required config field is missing', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      testOutputFile: '.opencode/tdd/test-output.txt',
      testFilePatterns: ['*.test.ts'],
      verifierModel: 'test-model',
    })

    const hook = await getHook(projectRoot)

    return expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).rejects.toThrow('TDD: Missing config field: testCommand')
  })

  test('blocks when testFilePatterns is not an array', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      ...baseConfig,
      testFilePatterns: 'not-an-array',
    })

    const hook = await getHook(projectRoot)

    return expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).rejects.toThrow('TDD: testFilePatterns must be an array of strings')
  })

  test('allows edit when tests are failing', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)
    await writeTestOutput(projectRoot, 'FAIL sample test output')

    const hook = await getHook(projectRoot)

    return expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).resolves.toBeUndefined()
  })

  test('blocks when test output is missing', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const hook = await getHook(projectRoot)

    return expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).rejects.toThrow('TDD: Run tests first')
  })

  test('blocks when test output is stale', async () => {
    const projectRoot = await createProjectRoot()
    const testOutputPath = await writeTestOutput(
      projectRoot,
      'PASS sample test output',
    )
    const staleTime = new Date(Date.now() - 2 * 1000)
    await utimes(testOutputPath, staleTime, staleTime)

    await writeConfig(projectRoot, {
      ...baseConfig,
      maxTestOutputAge: 1,
    })

    const hook = await getHook(projectRoot)

    return expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).rejects.toThrow('TDD: Re-run tests')
  })

  test('uses default maxTestOutputAge when stale', async () => {
    const projectRoot = await createProjectRoot()
    const testOutputPath = await writeTestOutput(
      projectRoot,
      'PASS sample test output',
    )
    const staleTime = new Date(Date.now() - 301 * 1000)
    await utimes(testOutputPath, staleTime, staleTime)

    await writeConfig(projectRoot, baseConfig)

    const hook = await getHook(projectRoot)

    return expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).rejects.toThrow('TDD: Re-run tests')
  })

  test('uses default maxTestOutputAge when fresh', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)
    await writeTestOutput(projectRoot, 'PASS sample test output')

    const hook = await getHook(projectRoot)

    return expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).resolves.toBeUndefined()
  })

  test('blocks when verifier returns block decision', async () => {
    const projectRoot = await createProjectRoot()
    await writeTestOutput(projectRoot, 'PASS sample test output')
    await writeConfig(projectRoot, baseConfig)

    const mockClient = {
      chat: async () =>
        JSON.stringify({
          decision: 'block',
          reason: 'Write a failing test first',
        }),
    }

    const hook = await getHook(projectRoot, mockClient)

    return expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).rejects.toThrow('TDD: Write a failing test first')
  })

  test('skips verification for non-edit tools', async () => {
    const projectRoot = await createProjectRoot()
    const hook = await getHook(projectRoot)

    return expect(
      hook(
        { tool: 'bash' } as Parameters<typeof hook>[0],
        { args: { command: 'echo ok' } } as Parameters<typeof hook>[1],
      ),
    ).resolves.toBeUndefined()
  })
})

const baseConfig = {
  testCommand: 'bun test',
  testOutputFile: '.opencode/tdd/test-output.txt',
  testFilePatterns: ['*.test.ts'],
  verifierModel: 'test-model',
}

const createProjectRoot = async () => {
  return mkdtemp(join(tmpdir(), 'opencode-tdd-'))
}

const writeConfig = async (projectRoot: string, config: unknown) => {
  const configPath = join(projectRoot, '.opencode', 'tdd.json')
  await mkdir(join(projectRoot, '.opencode'), { recursive: true })
  await writeFile(configPath, JSON.stringify(config))
}

const writeConfigRaw = async (projectRoot: string, content: string) => {
  const configPath = join(projectRoot, '.opencode', 'tdd.json')
  await mkdir(join(projectRoot, '.opencode'), { recursive: true })
  await writeFile(configPath, content)
}

const writeTestOutput = async (projectRoot: string, content: string) => {
  const tddDir = join(projectRoot, '.opencode', 'tdd')
  await mkdir(tddDir, { recursive: true })
  const testOutputPath = join(tddDir, 'test-output.txt')
  await writeFile(testOutputPath, content)
  return testOutputPath
}

const getHook = async (projectRoot: string, client?: unknown) => {
  const hooks = await TDDPlugin({
    directory: projectRoot,
    client,
  } as unknown as Parameters<typeof TDDPlugin>[0])
  const hook = hooks['tool.execute.before']
  expect(hook).toBeDefined()
  if (!hook) {
    throw new Error('Missing tool.execute.before hook')
  }

  return hook
}
