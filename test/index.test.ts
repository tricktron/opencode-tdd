import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TDDPlugin } from '../src/index'
import { verifyEdit } from '../src/verifier'
import { createLogger } from '../src/logger'

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

describe('Verifier', () => {
  const verifierTests = [
    {
      name: 'given LLM API failure, blocks with helpful error message',
      response: () => {
        throw new Error('Network error')
      },
      expected: {
        allowed: false,
        reason: 'Verification failed: Network error',
      },
    },
    {
      name: 'given invalid JSON response, blocks with Invalid verifier response',
      response: 'not valid json',
      expected: {
        allowed: false,
        reason:
          'Invalid verifier response: Invalid verifier response (not valid json)',
      },
    },
    {
      name: 'given JSON wrapped in markdown code block, extracts and parses correctly',
      response: '```json\n{"decision": "allow"}\n```',
      expected: { allowed: true },
    },
    {
      name: 'given missing decision field, treats as block',
      response: JSON.stringify({ reason: 'some reason' }),
      expected: { allowed: false, reason: 'some reason' },
    },
    {
      name: 'given invalid decision value like maybe, treats as block',
      response: JSON.stringify({ decision: 'maybe', reason: 'not sure' }),
      expected: { allowed: false, reason: 'not sure' },
    },
    {
      name: 'given missing reason field when blocking, uses default reason',
      response: JSON.stringify({ decision: 'block' }),
      expected: { allowed: false, reason: 'Write a failing test first' },
    },
    {
      name: 'given editType test, allows edit regardless of decision',
      response: JSON.stringify({
        editType: 'test',
        decision: 'block',
        reason: 'ignored',
      }),
      expected: { allowed: true },
    },
    {
      name: 'given editType impl and decision allow, allows edit',
      response: JSON.stringify({ editType: 'impl', decision: 'allow' }),
      expected: { allowed: true },
    },
    {
      name: 'given editType impl and decision block, blocks with reason',
      response: JSON.stringify({
        editType: 'impl',
        decision: 'block',
        reason: 'Write test first',
      }),
      expected: { allowed: false, reason: 'Write test first' },
    },
  ] as const

  for (const tc of verifierTests) {
    test(tc.name, async () => {
      const result = await verifyEdit(verifyOpts(mockClient(tc.response)))
      expect(result).toEqual(tc.expected)
    })
  }
})

describe('Logger', () => {
  test('given allowed edit, logs INFO with file path', async () => {
    const projectRoot = await createProjectRoot()
    const logger = createLogger(projectRoot)

    await logger.info('Allowed edit: src/example.ts')

    const logPath = join(projectRoot, '.opencode', 'tdd', 'tdd.log')
    const logContent = await readFile(logPath, 'utf8')
    expect(logContent).toContain('[INFO] Allowed edit: src/example.ts')
  })

  test('given blocked edit, logs WARN with reason', async () => {
    const projectRoot = await createProjectRoot()
    const logger = createLogger(projectRoot)

    await logger.warn('Blocked: Write a failing test first')

    const logPath = join(projectRoot, '.opencode', 'tdd', 'tdd.log')
    const logContent = await readFile(logPath, 'utf8')
    expect(logContent).toContain('[WARN] Blocked: Write a failing test first')
  })

  test('given test output error, logs ERROR with details', async () => {
    const projectRoot = await createProjectRoot()
    const logger = createLogger(projectRoot)

    await logger.error('Test output missing')

    const logPath = join(projectRoot, '.opencode', 'tdd', 'tdd.log')
    const logContent = await readFile(logPath, 'utf8')
    expect(logContent).toContain('[ERROR] Test output missing')
  })

  test('given any log entry, includes ISO timestamp', async () => {
    const projectRoot = await createProjectRoot()
    const logger = createLogger(projectRoot)

    await logger.info('test message')

    const logPath = join(projectRoot, '.opencode', 'tdd', 'tdd.log')
    const logContent = await readFile(logPath, 'utf8')
    // ISO timestamp format: 2024-01-15T10:30:00.000Z
    expect(logContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\]/)
  })

  test('given existing log file, appends instead of overwriting', async () => {
    const projectRoot = await createProjectRoot()
    const logDir = join(projectRoot, '.opencode', 'tdd')
    await mkdir(logDir, { recursive: true })
    const logPath = join(logDir, 'tdd.log')
    await writeFile(logPath, 'existing content\n')

    const logger = createLogger(projectRoot)
    await logger.info('new message')

    const logContent = await readFile(logPath, 'utf8')
    expect(logContent).toContain('existing content')
    expect(logContent).toContain('[INFO] new message')
  })
})

describe('Edge Cases', () => {
  test('given test output age at boundary, treats maxAge as fresh and maxAge+1 as stale', async () => {
    const maxAge = 10
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, { ...baseConfig, maxTestOutputAge: maxAge })

    // At maxAge boundary (fresh) - slightly under to account for execution time
    const testOutputPath = await writeTestOutput(
      projectRoot,
      'FAIL test output',
    )
    const atBoundary = new Date(Date.now() - (maxAge - 0.5) * 1000)
    await utimes(testOutputPath, atBoundary, atBoundary)
    const hook = await getHook(projectRoot)

    await expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()

    // Just past maxAge (stale)
    const pastBoundary = new Date(Date.now() - (maxAge + 1) * 1000)
    await utimes(testOutputPath, pastBoundary, pastBoundary)

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Re-run tests',
    )
  })

  test('given empty test output file, proceeds with empty string', async () => {
    const projectRoot = await createProjectRoot()
    await writeTestOutput(projectRoot, '')
    await writeConfig(projectRoot, baseConfig)
    // Empty test output = 0 FAILs = GREEN phase, needs LLM verification
    const hook = await getHook(
      projectRoot,
      mockLlmResponse({ editType: 'test', decision: 'allow' }),
    )

    return expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })

  test('given special characters in file path, handles correctly', async () => {
    const projectRoot = await createProjectRoot()
    await writeTestOutput(projectRoot, 'FAIL test output')
    await writeConfig(projectRoot, baseConfig)
    const hook = await getHook(projectRoot)

    // Paths with spaces and parentheses
    return expect(
      callHook(hook, 'edit', 'src/my file (copy).ts'),
    ).resolves.toBeUndefined()
  })
})

describe('Edit Content Passed to LLM', () => {
  const setupContentCapture = async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)
    await writeTestOutput(projectRoot, 'PASS all tests')

    let receivedContent: string | undefined
    const client = {
      chat: async (_model: string, messages: Array<{ content: string }>) => {
        receivedContent = messages[1].content
        return JSON.stringify({ editType: 'test', decision: 'allow' })
      },
    }
    const hook = await getHook(projectRoot, client)
    return { hook, getReceivedContent: () => receivedContent }
  }

  test('given edit tool call, passes newString content to LLM', async () => {
    const { hook, getReceivedContent } = await setupContentCapture()

    await callHook(hook, 'edit', 'src/example.ts', {
      newString: 'new code here',
    })

    expect(getReceivedContent()).toContain('new code here')
  })

  test('given write tool call, passes content to LLM', async () => {
    const { hook, getReceivedContent } = await setupContentCapture()

    await callHook(hook, 'write', 'src/example.ts', {
      content: 'full file content',
    })

    expect(getReceivedContent()).toContain('full file content')
  })
})

describe('LLM-Based Edit Classification', () => {
  test('given test file and 0 failing tests, calls LLM for classification', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)
    await writeTestOutput(projectRoot, 'PASS all tests')

    let llmCalled = false
    const mockClient = {
      chat: async () => {
        llmCalled = true
        return JSON.stringify({ editType: 'test', decision: 'allow' })
      },
    }

    const hook = await getHook(projectRoot, mockClient)

    await callHook(hook, 'edit', 'test/example.test.ts')

    // LLM must be called even for test files - no hardcoded isTestFile()
    expect(llmCalled).toBe(true)
  })

  test('given 0 failing tests and LLM classifies as test edit, allows without checking decision', async () => {
    const { hook } = await setupGreenPhase({
      editType: 'test',
      decision: 'block',
      reason: 'ignored',
    })

    // Even a .ts impl file should be allowed if LLM says it's a test edit
    return expect(callHook(hook, 'edit', 'src/lib.rs')).resolves.toBeUndefined()
  })

  test('given 0 failing tests and LLM classifies as impl edit with block, blocks', async () => {
    const { hook } = await setupGreenPhase({
      editType: 'impl',
      decision: 'block',
      reason: 'Write a failing test',
    })

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Write a failing test',
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
    const { hook } = await setupRedPhase('FAIL test one\nFAIL test two')

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Fix existing failing test first',
    )
  })

  test('given 1 failing test, allows edit on impl file', async () => {
    const { hook } = await setupRedPhase('FAIL test one\nPASS test two')

    return expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })

  test('given 1 failing test, allows edit on test file', async () => {
    const { hook } = await setupRedPhase('FAIL test one\nPASS test two')

    return expect(
      callHook(hook, 'edit', 'test/example.test.ts'),
    ).resolves.toBeUndefined()
  })

  test('given 0 failing tests and test file, calls LLM for classification', async () => {
    // LLM classifies as test edit - allows regardless of decision
    const { hook } = await setupGreenPhase({
      editType: 'test',
      decision: 'block',
      reason: 'ignored',
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
      'TDD: Write a failing test',
    )
  })

  test('given 0 failing tests and spec file, calls LLM for classification', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      ...baseConfig,
      enforcePatterns: ['src/**', 'spec/**'],
    })
    await writeTestOutput(projectRoot, 'PASS test output')

    // LLM classifies as test edit
    const hook = await getHook(
      projectRoot,
      mockLlmResponse({ editType: 'test', decision: 'allow' }),
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
    // No test output file - would fail if TDD checks ran

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
    await writeTestOutput(projectRoot, 'FAIL test output')

    const hook = await getHook(projectRoot)

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
    await writeTestOutput(projectRoot, 'PASS test output')

    const hook = await getHook(
      projectRoot,
      mockLlmResponse({ decision: 'block', reason: 'Write a failing test' }),
    )

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Write a failing test',
    )
  })

  test('given missing enforcePatterns, allows edit without TDD checks', async () => {
    const projectRoot = await createProjectRoot()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { enforcePatterns: _, ...configWithoutEnforce } = baseConfig
    await writeConfig(projectRoot, configWithoutEnforce)
    // No test output - would fail if TDD checks ran

    const hook = await getHook(projectRoot)

    return expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })

  test('given test file matching enforcePatterns and tests passing, calls LLM for classification', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      ...baseConfig,
      enforcePatterns: ['src/**', 'test/**'],
    })
    await writeTestOutput(projectRoot, 'PASS test output')

    // LLM classifies test file edit as test edit
    const hook = await getHook(
      projectRoot,
      mockLlmResponse({ editType: 'test', decision: 'allow' }),
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

  test('logs INFO when edit is allowed', async () => {
    const { projectRoot, hook } = await setupRedPhase()
    await callHook(hook, 'edit', 'src/example.ts')

    const logContent = await readLog(projectRoot)
    expect(logContent).toContain('[INFO]')
    expect(logContent).toContain('src/example.ts')
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
      verifierModel: 'test-model',
    })

    const hook = await getHook(projectRoot)

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Missing config field: testOutputFile',
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
    const { hook } = await setupRedPhase()

    return expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })

  test('blocks when test output is missing', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const hook = await getHook(projectRoot)

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Run tests first',
    )
  })

  test('logs ERROR when test output is missing', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)

    const hook = await getHook(projectRoot)

    try {
      await callHook(hook, 'edit', 'src/example.ts')
    } catch {
      // Expected to throw
    }

    const logContent = await readLog(projectRoot)
    expect(logContent).toContain('[ERROR]')
    expect(logContent).toContain('Run tests first')
  })

  test('blocks when test output is stale', async () => {
    const { hook } = await setupStaleTestOutput(2, 1)

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Re-run tests',
    )
  })

  test('logs ERROR when test output is stale', async () => {
    const { projectRoot, hook } = await setupStaleTestOutput(2, 1)

    try {
      await callHook(hook, 'edit', 'src/example.ts')
    } catch {
      // Expected to throw
    }

    const logContent = await readLog(projectRoot)
    expect(logContent).toContain('[ERROR]')
    expect(logContent).toContain('Re-run tests')
  })

  test('uses default maxTestOutputAge when stale', async () => {
    const { hook } = await setupStaleTestOutput(301)

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Re-run tests',
    )
  })

  test('uses default maxTestOutputAge when fresh', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, baseConfig)
    await writeTestOutput(projectRoot, 'PASS sample test output')
    // PASS output = GREEN phase, needs LLM verification
    const hook = await getHook(
      projectRoot,
      mockLlmResponse({ editType: 'test', decision: 'allow' }),
    )

    return expect(
      callHook(hook, 'edit', 'src/example.ts'),
    ).resolves.toBeUndefined()
  })

  test('blocks when verifier returns block decision', async () => {
    const { hook } = await setupGreenPhase({
      decision: 'block',
      reason: 'Write a failing test first',
    })

    return expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'TDD: Write a failing test first',
    )
  })

  test('logs WARN when edit is blocked', async () => {
    const { projectRoot, hook } = await setupGreenPhase({
      decision: 'block',
      reason: 'Write a failing test first',
    })

    try {
      await callHook(hook, 'edit', 'src/example.ts')
    } catch {
      // Expected to throw
    }

    const logContent = await readLog(projectRoot)
    expect(logContent).toContain('[WARN]')
    expect(logContent).toContain('Write a failing test first')
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

const readLog = async (projectRoot: string) => {
  const logPath = join(projectRoot, '.opencode', 'tdd', 'tdd.log')
  return readFile(logPath, 'utf8')
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

const mockLlmResponse = (response: object) => ({
  chat: async () => JSON.stringify(response),
})

const setupRedPhase = async (testOutput = 'FAIL test output') => {
  const projectRoot = await createProjectRoot()
  await writeConfig(projectRoot, baseConfig)
  await writeTestOutput(projectRoot, testOutput)
  const hook = await getHook(projectRoot)
  return { projectRoot, hook }
}

const setupGreenPhase = async (llmResponse: object) => {
  const projectRoot = await createProjectRoot()
  await writeConfig(projectRoot, baseConfig)
  await writeTestOutput(projectRoot, 'PASS all tests')
  const hook = await getHook(projectRoot, mockLlmResponse(llmResponse))
  return { projectRoot, hook }
}

const setupStaleTestOutput = async (ageSeconds: number, maxAge?: number) => {
  const projectRoot = await createProjectRoot()
  const testOutputPath = await writeTestOutput(
    projectRoot,
    'PASS sample test output',
  )
  const staleTime = new Date(Date.now() - ageSeconds * 1000)
  await utimes(testOutputPath, staleTime, staleTime)
  await writeConfig(
    projectRoot,
    maxAge ? { ...baseConfig, maxTestOutputAge: maxAge } : baseConfig,
  )
  const hook = await getHook(projectRoot)
  return { projectRoot, hook }
}
