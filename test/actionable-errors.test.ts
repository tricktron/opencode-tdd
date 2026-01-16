import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TDDPlugin } from '../src/index'
import { verifyEdit } from '../src/verifier'

// Slice: 12-actionable-error-messages
// Given TDD violations occur, when errors are thrown, then error messages are actionable for driving LLM

const mockClient = (response: string | (() => never)) => ({
  chat: async () => {
    if (typeof response === 'function') response()
    return response as string
  },
})

const verifyOpts = (client: ReturnType<typeof mockClient>) => ({
  client,
  model: 'model',
  filePath: 'file.ts',
  editContent: 'content',
  testOutput: 'output',
})

const baseConfig = {
  testOutputFile: '.opencode/tdd/test-output.txt',
  enforcePatterns: ['src/**', 'test/**'],
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

type Hook = Awaited<ReturnType<typeof TDDPlugin>>['tool.execute.before']

const callHook = (
  hook: Hook,
  tool: string,
  filePath: string,
  args?: Record<string, unknown>,
) =>
  hook!(
    { tool } as Parameters<NonNullable<typeof hook>>[0],
    { args: { filePath, ...args } } as Parameters<NonNullable<typeof hook>>[1],
  )

describe('Actionable Error Messages', () => {
  test('given missing test output, when edit attempted, then error uses "TDD violation:" prefix and actionable instruction', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const hook = await getHook(projectRoot)

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Run tests first before editing implementation.',
    )
  })

  test('given stale test output, when edit attempted, then error uses "TDD violation:" prefix and actionable instruction', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)
    const testOutputPath = await writeTestOutput(
      projectRoot,
      'PASS test output',
    )

    // Make it stale (301 seconds old, default maxAge is 300)
    const staleTime = new Date(Date.now() - 301 * 1000)
    const { utimes } = await import('node:fs/promises')
    await utimes(testOutputPath, staleTime, staleTime)

    const hook = await getHook(projectRoot)

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Test output is stale. Re-run tests before editing.',
    )
  })

  test('given LLM blocks edit, when thrown, then error uses "TDD violation:" prefix', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)
    await writeTestOutput(projectRoot, 'PASS test output')

    const mockClient = {
      chat: async () => 'BLOCK: Write a failing test first',
    }

    const hook = await getHook(projectRoot, mockClient)

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Write a failing test first',
    )
  })

  test('given verifier returns invalid response, when parsed, then defaults to actionable block reason', async () => {
    await expect(
      verifyEdit(verifyOpts(mockClient('invalid response text'))),
    ).rejects.toThrow('Write a failing test first, then retry this edit.')
  })

  test('given verifier returns BLOCK without reason, when parsed, then defaults to actionable block reason', async () => {
    await expect(verifyEdit(verifyOpts(mockClient('BLOCK:')))).rejects.toThrow(
      'Write a failing test first, then retry this edit.',
    )
  })

  test('given verifier parse error through hook, when thrown, then includes "TDD violation:" prefix', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)
    await writeTestOutput(projectRoot, 'PASS test output')

    const mockClient = {
      chat: async () => 'invalid response text',
    }

    const hook = await getHook(projectRoot, mockClient)

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Write a failing test first, then retry this edit.',
    )
  })

  test('given verifier returns BLOCK with custom reason, when thrown, then includes actionable instruction', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)
    await writeTestOutput(projectRoot, 'PASS test output')

    const mockClient = {
      chat: async () => 'BLOCK: Fix existing failing test first',
    }

    const hook = await getHook(projectRoot, mockClient)

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Fix existing failing test first',
    )
  })
})
