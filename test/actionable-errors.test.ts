import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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

const mockSdkClientWithSession = (
  testOutput: string,
  llmClient?: ReturnType<typeof mockClient>,
) => {
  const combined = {
    session: {
      messages: async () => ({
        data: [
          {
            info: { id: 'msg-1', role: 'assistant' },
            parts: [
              {
                type: 'tool',
                tool: 'bash',
                state: {
                  status: 'completed',
                  output: testOutput,
                },
              },
            ],
          },
        ],
      }),
      create: async () => ({ data: { id: 'test-session-id' } }),
      prompt: async () => ({
        data: {
          parts: [
            {
              type: 'text',
              text: llmClient ? await llmClient.chat() : 'ALLOW',
            },
          ],
        },
      }),
      delete: async () => ({}),
    },
    app: { log: async () => ({}) },
  }

  // If llmClient is provided, also include it directly for duck-typing
  if (llmClient) {
    return Object.assign(combined, llmClient)
  }

  return combined
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
  // Slice: 21-verifier-runs-tests
  // Given SDK session creation fails, when edit attempted, then error details are preserved
  test('given session creation fails with details, when edit attempted, then error includes specific details', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const mockSdkClient = {
      session: {
        create: async () => {
          throw new Error('Network timeout')
        },
      },
    }

    const hook = await getHook(projectRoot, mockSdkClient)

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Network timeout',
    )
  })

  test('given session create returns error, when edit attempted, then error uses actionable message', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const mockSdkClient = {
      session: {
        create: async () => ({
          error: 'Session limit reached',
        }),
      },
    }

    const hook = await getHook(projectRoot, mockSdkClient)

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'Failed to create verification session',
    )
  })

  test('given LLM blocks edit, when thrown, then error uses "TDD violation:" prefix', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const mockClient = {
      chat: async () => 'BLOCK: Write a failing test first',
    }

    const hook = await getHook(
      projectRoot,
      mockSdkClientWithSession('PASS test output', mockClient),
    )

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Write a failing test first',
    )
  })

  test('given verifier returns invalid response, when parsed, then defaults to actionable block reason', async () => {
    await expect(
      verifyEdit(verifyOpts(mockClient('invalid response text'))),
    ).rejects.toThrow('Verification failed. Please retry this edit.')
  })

  test('given verifier returns BLOCK without reason, when parsed, then defaults to actionable block reason', async () => {
    await expect(verifyEdit(verifyOpts(mockClient('BLOCK:')))).rejects.toThrow(
      'Verification failed. Please retry this edit.',
    )
  })

  test('given verifier parse error through hook, when thrown, then includes "TDD violation:" prefix', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const mockClient = {
      chat: async () => 'invalid response text',
    }

    const hook = await getHook(
      projectRoot,
      mockSdkClientWithSession('PASS test output', mockClient),
    )

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Verification failed. Please retry this edit.',
    )
  })

  test('given verifier returns BLOCK with custom reason, when thrown, then includes actionable instruction', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const mockClient = {
      chat: async () => 'BLOCK: Fix existing failing test first',
    }

    const hook = await getHook(
      projectRoot,
      mockSdkClientWithSession('PASS test output', mockClient),
    )

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Fix existing failing test first',
    )
  })
})
