import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TDDPlugin } from '../src/index'

describe('Edge Cases', () => {
  test('given special characters in file path, handles correctly', async () => {
    const { hook } = await setupRedPhase('FAIL test output', {
      editType: 'impl',
      acceptanceFailingTests: 0,
      unitFailingTests: 1,
      decision: 'allow',
      reason: 'Implementing for red test',
    })

    // Paths with spaces and parentheses
    return expect(
      callHook(hook, 'edit', 'src/my file (copy).ts'),
    ).resolves.toBeUndefined()
  })
})

describe('Edit Content Passed to LLM', () => {
  const setupContentCapture = async () => {
    type PromptOpts = Parameters<
      import('../src/verifier').SdkClient['session']['prompt']
    >[0]
    let receivedPrompt = ''
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)
    const client = {
      session: {
        create: async () => ({ data: { id: 'test-session-id' } }),
        prompt: async (opts: PromptOpts) => {
          receivedPrompt = opts.body.parts[0].text
          return {
            data: {
              parts: [
                {
                  type: 'text' as const,
                  text: 'ALLOW',
                },
              ],
            },
          }
        },
        delete: async () => ({}),
      },
      app: { log: async () => ({}) },
    }
    const hook = await getHook(projectRoot, client)
    return { hook, getReceivedPrompt: () => receivedPrompt }
  }

  test('given edit tool call, passes newString content to LLM', async () => {
    const { hook, getReceivedPrompt } = await setupContentCapture()

    await callHook(hook, 'edit', 'src/example.ts', {
      newString: 'new code here',
    })

    expect(getReceivedPrompt()).toContain('new code here')
  })

  test('given write tool call, passes content to LLM', async () => {
    const { hook, getReceivedPrompt } = await setupContentCapture()

    await callHook(hook, 'write', 'src/example.ts', {
      content: 'full file content',
    })

    expect(getReceivedPrompt()).toContain('full file content')
  })
})

describe('LLM-Based Edit Classification', () => {
  test('given test file and 0 failing tests, calls LLM for classification', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    let llmCalled = false
    const mockClient = mockSdkClientWithSession('PASS all tests', {
      chat: async () => {
        llmCalled = true
        return 'ALLOW'
      },
    })

    const hook = await getHook(projectRoot, mockClient)

    await callHook(hook, 'edit', 'test/example.test.ts')

    // LLM must be called even for test files - no hardcoded isTestFile()
    expect(llmCalled).toBe(true)
  })

  test('given 0 failing tests and LLM classifies as impl edit with block, blocks', async () => {
    const { hook } = await setupGreenPhase({
      editType: 'impl',
      decision: 'block',
      reason: 'Write a failing test',
    })

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Write a failing test',
    )
  })

  test('given 0 failing tests and LLM classifies as impl edit with allow, allows', async () => {
    const { hook } = await setupGreenPhase({
      editType: 'impl',
      decision: 'allow',
      reason: 'Valid refactor',
    })

    return expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })
})

describe('OneFailingTestRule', () => {
  test('given 2+ failing tests, blocks edit with message', async () => {
    const { hook } = await setupRedPhase('FAIL test one\nFAIL test two', {
      editType: 'impl',
      acceptanceFailingTests: 0,
      unitFailingTests: 2,
      decision: 'block',
      reason: 'Fix existing failing test first',
    })

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Fix existing failing test first',
    )
  })

  test('given 1 failing test, allows edit on impl file', async () => {
    const { hook } = await setupRedPhase('FAIL test one\nPASS test two', {
      editType: 'impl',
      acceptanceFailingTests: 0,
      unitFailingTests: 1,
      decision: 'allow',
      reason: 'Implementing for red test',
    })

    return expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })

  test('given 1 failing test, allows edit on test file', async () => {
    const { hook } = await setupRedPhase('FAIL test one\nPASS test two', {
      editType: 'test',
      testScope: 'unit',
      acceptanceFailingTests: 0,
      unitFailingTests: 1,
      decision: 'allow',
      reason: 'Modifying test',
    })

    return expect(
      callHook(hook, 'edit', 'test/example.test.ts'),
    ).resolves.toBeUndefined()
  })

  test('given 0 failing tests and impl file, verifies with LLM', async () => {
    const { hook } = await setupGreenPhase({
      decision: 'block',
      reason: 'Write a failing test',
    })

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Write a failing test',
    )
  })

  test('given 0 failing tests and spec file, calls LLM for classification', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      ...baseConfig,
      enforcePatterns: ['src/**', 'spec/**'],
    })

    // LLM classifies as test edit
    const hook = await getHook(
      projectRoot,
      mockSdkClientWithSession(
        'PASS test output',
        mockLlmResponse({ editType: 'test', decision: 'allow' }),
      ),
    )

    return expect(
      callHook(hook, 'edit', 'spec/example.spec.ts'),
    ).resolves.toBeUndefined()
  })
})

describe('EnforcePatterns', () => {
  test('given file outside enforcePatterns, allows edit without TDD checks', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      ...baseConfig,
      enforcePatterns: ['src/**'],
    })
    // No session messages - would fail if TDD checks ran

    const hook = await getHook(projectRoot)

    return expect(
      callHook(hook, 'edit', 'docs/readme.md'),
    ).resolves.toBeUndefined()
  })

  test('given file matching enforcePatterns and tests failing, allows edit', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      ...baseConfig,
      enforcePatterns: ['src/**'],
    })

    const hook = await getHook(
      projectRoot,
      mockSdkClientWithSession(
        'FAIL test output',
        mockLlmResponse({
          editType: 'impl',
          acceptanceFailingTests: 0,
          unitFailingTests: 1,
          decision: 'allow',
          reason: 'Implementing for red test',
        }),
      ),
    )

    return expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })

  test('given file matching enforcePatterns and tests passing, verifies with LLM', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      ...baseConfig,
      enforcePatterns: ['src/**'],
    })

    const hook = await getHook(
      projectRoot,
      mockSdkClientWithSession(
        'PASS test output',
        mockLlmResponse({ decision: 'block', reason: 'Write a failing test' }),
      ),
    )

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Write a failing test',
    )
  })

  test('given test file matching enforcePatterns and tests passing, calls LLM for classification', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      ...baseConfig,
      enforcePatterns: ['src/**', 'test/**'],
    })

    // LLM classifies test file edit as test edit
    const hook = await getHook(
      projectRoot,
      mockSdkClientWithSession(
        'PASS test output',
        mockLlmResponse({ editType: 'test', decision: 'allow' }),
      ),
    )

    return expect(
      callHook(hook, 'edit', 'test/example.test.ts'),
    ).resolves.toBeUndefined()
  })
})

describe('TDDPlugin', () => {
  test('exports a plugin function', () => {
    expect(typeof TDDPlugin).toBe('function')
  })

  test('allows when config is missing', async () => {
    const projectRoot = await createProjectRoot()
    const hook = await getHook(projectRoot)

    return expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })

  test('blocks when config has invalid JSON', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfigRaw(projectRoot, '{')

    const hook = await getHook(projectRoot)

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Invalid config JSON',
    )
  })

  test('blocks when required config field is missing', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      enforcePatterns: ['src/**'],
      // Missing verifierModel
    })

    const hook = await getHook(projectRoot)

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Missing config field: verifierModel',
    )
  })

  test('blocks when enforcePatterns is not an array of strings', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      ...baseConfig,
      enforcePatterns: 'not-an-array',
    })

    const hook = await getHook(projectRoot)

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: enforcePatterns must be an array of strings',
    )
  })

  test('allows edit when tests are failing', async () => {
    const { hook } = await setupRedPhase('FAIL test output', {
      editType: 'impl',
      acceptanceFailingTests: 0,
      unitFailingTests: 1,
      decision: 'allow',
      reason: 'Implementing for red test',
    })

    return expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })

  test('blocks when verifier session fails to create', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const mockClient = {
      session: {
        create: async () => ({ error: 'Failed to create session' }),
      },
    }
    const hook = await getHook(projectRoot, mockClient)

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'Failed to create verification session',
    )
  })

  test('blocks when verifier returns block decision', async () => {
    const { hook } = await setupGreenPhase({
      decision: 'block',
      reason: 'Write a failing test first',
    })

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD violation: Write a failing test first',
    )
  })

  test('skips verification for non-edit tools', async () => {
    const projectRoot = await createProjectRoot()
    const hook = await getHook(projectRoot)

    return expect(
      callHook(hook, 'bash', '', { command: 'echo ok' }),
    ).resolves.toBeUndefined()
  })
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

const writeConfigRaw = async (projectRoot: string, content: string) => {
  const configPath = join(projectRoot, '.opencode', 'tdd.json')
  await mkdir(join(projectRoot, '.opencode'), { recursive: true })
  await writeFile(configPath, content)
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
    {
      tool,
      sessionID: 'test-session-id',
      callID: 'test-call-id',
    } as Parameters<NonNullable<typeof hook>>[0],
    { args: { filePath, ...args } } as Parameters<NonNullable<typeof hook>>[1],
  )

const mockLlmResponse = (response: {
  decision: string
  reason?: string
  [key: string]: unknown
}) => ({
  chat: async () => {
    if (response.decision === 'allow') {
      return 'ALLOW'
    }
    return `BLOCK: ${response.reason ?? 'Write a failing test first'}`
  },
})

const mockSdkClientWithSession = (
  testOutput: string,
  llmClient?: ReturnType<typeof mockLlmResponse>,
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

const setupRedPhase = async (
  testOutput = 'FAIL test output',
  llmResponse?: { decision: string; reason?: string; [key: string]: unknown },
) => {
  const projectRoot = await createProjectRoot()
  await writeConfig(projectRoot, baseConfig)
  const hook = await getHook(
    projectRoot,
    mockSdkClientWithSession(
      testOutput,
      llmResponse ? mockLlmResponse(llmResponse) : undefined,
    ),
  )
  return { projectRoot, hook }
}

const setupGreenPhase = async (llmResponse: {
  decision: string
  reason?: string
  [key: string]: unknown
}) => {
  const projectRoot = await createProjectRoot()
  await writeConfig(projectRoot, baseConfig)
  const hook = await getHook(
    projectRoot,
    mockSdkClientWithSession('PASS all tests', mockLlmResponse(llmResponse)),
  )
  return { projectRoot, hook }
}

describe('Auditor', () => {
  test('given audit entry, when recorded, then writes valid JSONL', async () => {
    const projectRoot = await createProjectRoot()
    const { createAuditor } = await import('../src/auditor')
    const auditor = createAuditor(projectRoot)

    await auditor.record({
      timestamp: '2024-01-15T10:00:00.000Z',
      filePath: 'src/example.ts',
      prompt: 'test prompt',
      response: 'test response',
      decision: 'allow',
      reason: 'test reason',
    })

    const auditPath = join(projectRoot, '.opencode', 'tdd', 'audit.jsonl')
    const auditContent = await readFile(auditPath, 'utf8')
    const entry = JSON.parse(auditContent.trim())

    expect(entry).toEqual({
      timestamp: '2024-01-15T10:00:00.000Z',
      filePath: 'src/example.ts',
      prompt: 'test prompt',
      response: 'test response',
      decision: 'allow',
      reason: 'test reason',
    })
  })

  test('given multiple entries, when recorded, then appends to file', async () => {
    const projectRoot = await createProjectRoot()
    const { createAuditor } = await import('../src/auditor')
    const auditor = createAuditor(projectRoot)

    await auditor.record({
      timestamp: '2024-01-15T10:00:00.000Z',
      filePath: 'src/first.ts',
      prompt: 'first',
      response: 'first',
      decision: 'allow',
      reason: 'first',
    })
    await auditor.record({
      timestamp: '2024-01-15T10:01:00.000Z',
      filePath: 'src/second.ts',
      prompt: 'second',
      response: 'second',
      decision: 'block',
      reason: 'second',
    })

    const auditPath = join(projectRoot, '.opencode', 'tdd', 'audit.jsonl')
    const auditContent = await readFile(auditPath, 'utf8')
    const lines = auditContent.trim().split('\n')

    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0])
    const second = JSON.parse(lines[1])

    expect(first.filePath).toBe('src/first.ts')
    expect(second.filePath).toBe('src/second.ts')
  })

  test('given missing audit directory, when first entry recorded, then creates directory and file', async () => {
    const projectRoot = await createProjectRoot()
    const { createAuditor } = await import('../src/auditor')
    const auditor = createAuditor(projectRoot)

    await auditor.record({
      timestamp: '2024-01-15T10:00:00.000Z',
      filePath: 'src/example.ts',
      prompt: 'test',
      response: 'test',
      decision: 'allow',
      reason: 'test',
    })

    const auditPath = join(projectRoot, '.opencode', 'tdd', 'audit.jsonl')
    const auditContent = await readFile(auditPath, 'utf8')
    expect(auditContent).toBeTruthy()
  })
})

describe('Non-Blocking Error Handling', () => {
  test('given session cleanup fails, verification still completes successfully', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const mockSdkClient = {
      session: {
        messages: async () => ({
          data: [
            {
              info: { id: 'msg-1', role: 'assistant' as const },
              parts: [
                {
                  type: 'tool' as const,
                  tool: 'bash',
                  state: {
                    status: 'completed' as const,
                    output: 'PASS all tests',
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
                text: 'ALLOW',
              },
            ],
          },
        }),
        delete: async () => {
          throw new Error('Network timeout')
        },
      },
      app: { log: async () => ({}) },
    }

    const hook = await getHook(projectRoot, mockSdkClient)

    // Should not throw despite session cleanup failure
    await callHook(hook, 'edit', 'src/example.ts')
  })
})

describe('Outside-In TDD Enforcement', () => {
  describe('Acceptance Test Rules', () => {
    test('given 0 red acceptance tests, when adding acceptance test, then allows', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'test',
        testScope: 'acceptance',
        acceptanceFailingTests: 0,
        unitFailingTests: 0,
        decision: 'allow',
        reason: 'Starting outer acceptance test',
      })

      return expect(
        callHook(hook, 'edit', 'test/acceptance/checkout.test.ts'),
      ).resolves.toBeUndefined()
    })

    test('given 1 red acceptance test, when adding another acceptance test, then blocks', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'test',
        testScope: 'acceptance',
        acceptanceFailingTests: 1,
        unitFailingTests: 0,
        decision: 'block',
        reason: 'Finish current feature first',
      })

      return expect(
        callHook(hook, 'edit', 'test/acceptance/new-feature.test.ts'),
      ).rejects.toThrow('TDD violation: Finish current feature first')
    })

    test('given 1 red acceptance test, when modifying that test, then allows', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'test',
        testScope: 'acceptance',
        acceptanceFailingTests: 1,
        unitFailingTests: 0,
        decision: 'allow',
        reason: 'Refining acceptance test',
      })

      return expect(
        callHook(hook, 'edit', 'test/acceptance/checkout.test.ts'),
      ).resolves.toBeUndefined()
    })
  })

  describe('Unit Test Rules', () => {
    test('given 0 red unit tests, when adding unit test, then allows', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'test',
        testScope: 'unit',
        acceptanceFailingTests: 1,
        unitFailingTests: 0,
        decision: 'allow',
        reason: 'Starting unit test',
      })

      return expect(
        callHook(hook, 'edit', 'test/unit/validator.test.ts'),
      ).resolves.toBeUndefined()
    })

    test('given 1 red unit test, when adding another unit test, then blocks', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'test',
        testScope: 'unit',
        acceptanceFailingTests: 0,
        unitFailingTests: 1,
        decision: 'block',
        reason: 'Fix failing test first',
      })

      return expect(
        callHook(hook, 'edit', 'test/unit/parser.test.ts'),
      ).rejects.toThrow('TDD violation: Fix failing test first')
    })
  })

  describe('Implementation Rules', () => {
    test('given 0 red unit tests and 0 red acceptance, when adding impl, then blocks', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'impl',
        testScope: undefined,
        acceptanceFailingTests: 0,
        unitFailingTests: 0,
        decision: 'block',
        reason: 'Write a failing test first',
      })

      return expect(callHook(hook, 'edit', 'src/validator.ts')).rejects.toThrow(
        'TDD violation: Write a failing test first',
      )
    })

    test('given 1 red unit test, when adding impl, then allows', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'impl',
        testScope: undefined,
        acceptanceFailingTests: 0,
        unitFailingTests: 1,
        decision: 'allow',
        reason: 'Implementing for red test',
      })

      return expect(
        callHook(hook, 'edit', 'src/validator.ts'),
      ).resolves.toBeUndefined()
    })

    test('given 1 red acceptance and 0 red unit, when adding impl, then blocks', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'impl',
        testScope: undefined,
        acceptanceFailingTests: 1,
        unitFailingTests: 0,
        decision: 'block',
        reason: 'Write a failing test first',
      })

      return expect(callHook(hook, 'edit', 'src/checkout.ts')).rejects.toThrow(
        'TDD violation: Write a failing test first',
      )
    })
  })

  describe('Refactoring Rules', () => {
    test('given all unit tests green, when refactoring, then allows', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'refactor',
        testScope: undefined,
        acceptanceFailingTests: 1,
        unitFailingTests: 0,
        decision: 'allow',
        reason: 'Safe refactoring',
      })

      return expect(
        callHook(hook, 'edit', 'src/validator.ts'),
      ).resolves.toBeUndefined()
    })
  })

  describe('Multiple Failing Tests Detection', () => {
    test('given 2+ acceptance tests failing, then blocks', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'test',
        testScope: 'acceptance',
        acceptanceFailingTests: 2,
        unitFailingTests: 0,
        decision: 'block',
        reason: 'Fix failing tests first',
      })

      return expect(
        callHook(hook, 'edit', 'test/acceptance/checkout.test.ts'),
      ).rejects.toThrow('TDD violation: Fix failing tests first')
    })

    test('given 2+ unit tests failing, then blocks', async () => {
      const { hook } = await setupGreenPhase({
        editType: 'test',
        testScope: 'unit',
        acceptanceFailingTests: 0,
        unitFailingTests: 2,
        decision: 'block',
        reason: 'Fix failing tests first',
      })

      return expect(
        callHook(hook, 'edit', 'test/unit/validator.test.ts'),
      ).rejects.toThrow('TDD violation: Fix failing tests first')
    })
  })
})

describe('Test Hierarchy Simplification', () => {
  test('given verifier response with unitFailingTests, when all tests run, then all tests pass', async () => {
    const { hook } = await setupRedPhase('FAIL test output', {
      editType: 'impl',
      testScope: 'unit',
      acceptanceFailingTests: 0,
      unitFailingTests: 1,
      decision: 'allow',
      reason: 'Implementing for red test',
    })

    await expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })
})

describe('Verification Audit', () => {
  test('given GREEN phase verification, when LLM is called, then audit entry is written', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const hook = await getHook(
      projectRoot,
      mockSdkClientWithSession(
        'PASS all tests',
        mockLlmResponse({ editType: 'impl', decision: 'allow' }),
      ),
    )

    await callHook(hook, 'edit', 'src/example.ts')

    const auditPath = join(projectRoot, '.opencode', 'tdd', 'audit.jsonl')
    const auditContent = await readFile(auditPath, 'utf8')
    const entry = JSON.parse(auditContent.trim())

    expect(entry).toMatchObject({
      filePath: 'src/example.ts',
      decision: 'allow',
    })
    expect(entry.timestamp).toBeDefined()
    expect(entry.prompt).toBeDefined()
    expect(entry.response).toBeDefined()
  })

  test('given RED phase (1 failing test), when edit is allowed, then audit entry is written', async () => {
    const { projectRoot, hook } = await setupRedPhase(
      'FAIL test one\nPASS test two',
      {
        editType: 'impl',
        acceptanceFailingTests: 0,
        unitFailingTests: 1,
        decision: 'allow',
        reason: 'Implementing for red test',
      },
    )

    await callHook(hook, 'edit', 'src/example.ts')

    const auditPath = join(projectRoot, '.opencode', 'tdd', 'audit.jsonl')
    const auditContent = await readFile(auditPath, 'utf8')
    const entry = JSON.parse(auditContent.trim())
    expect(entry.decision).toBe('allow')
  })

  test('given audit entry, when I read the file, then I see all required fields', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const hook = await getHook(
      projectRoot,
      mockSdkClientWithSession(
        'PASS all tests',
        mockLlmResponse({
          editType: 'impl',
          decision: 'block',
          reason: 'test reason',
        }),
      ),
    )

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow()

    const auditPath = join(projectRoot, '.opencode', 'tdd', 'audit.jsonl')
    const auditContent = await readFile(auditPath, 'utf8')
    const entry = JSON.parse(auditContent.trim())

    expect(entry.timestamp).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/,
    )
    expect(entry.filePath).toBe('src/example.ts')
    expect(entry.prompt).toContain('src/example.ts')
    expect(entry.response).toContain('BLOCK')
    expect(entry.decision).toBe('block')
    expect(entry.reason).toContain('test reason')
    expect(entry.reason).toContain('Test output:')
    expect(entry.reason).toContain('PASS all tests')
  })

  test('given multiple verifications, when I read the audit file, then entries are appended', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const hook = await getHook(
      projectRoot,
      mockSdkClientWithSession(
        'PASS all tests',
        mockLlmResponse({ editType: 'impl', decision: 'allow' }),
      ),
    )

    await callHook(hook, 'edit', 'src/first.ts')
    await callHook(hook, 'edit', 'src/second.ts')

    const auditPath = join(projectRoot, '.opencode', 'tdd', 'audit.jsonl')
    const auditContent = await readFile(auditPath, 'utf8')
    const lines = auditContent.trim().split('\n')

    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0])
    const second = JSON.parse(lines[1])

    expect(first.filePath).toBe('src/first.ts')
    expect(second.filePath).toBe('src/second.ts')
  })
})
