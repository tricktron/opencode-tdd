import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TDDPlugin } from '../src/index'

// Slice: 14-session-based-test-output
// Given session contains bash outputs, when edit is attempted,
// then verifier receives bash outputs from session history (not file)

describe('Session-Based Test Output', () => {
  // Acceptance Test
  test('given session contains completed bash output, when edit attempted, then verifier receives bash output and makes decision', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      verifierModel: 'test-model',
      enforcePatterns: ['src/**'],
    })

    let receivedTestOutput: string | undefined
    const mockSdkClient = createMockSdkClient({
      sessionMessages: [
        {
          info: { id: 'msg1', role: 'user' as const },
          parts: [
            {
              id: 'part1',
              type: 'tool' as const,
              tool: 'bash',
              state: {
                status: 'completed' as const,
                output: 'FAIL: test_foo\nPASS: test_bar',
                title: 'Run tests',
                input: {},
                metadata: {},
                time: { start: 0, end: 1 },
              },
            } as const,
          ],
        },
      ],
      llmResponse: 'ALLOW',
      captureTestOutput: (output) => {
        receivedTestOutput = output
      },
    })

    const hook = await getHook(projectRoot, mockSdkClient)

    await callHook(hook, 'edit', 'src/example.ts')

    expect(receivedTestOutput).toContain('FAIL: test_foo')
    expect(receivedTestOutput).toContain('PASS: test_bar')
  })

  test('given session has no bash output, when edit attempted, then blocks with error', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      verifierModel: 'test-model',
      enforcePatterns: ['src/**'],
    })

    const mockSdkClient = createMockSdkClient({
      sessionMessages: [
        {
          info: { id: 'msg1', role: 'user' as const },
          parts: [
            {
              id: 'part1',
              type: 'text' as const,
              text: 'some text',
            } as const,
          ],
        },
      ],
      llmResponse: 'ALLOW',
    })

    const hook = await getHook(projectRoot, mockSdkClient)

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'No bash command output found in session. Run tests first.',
    )
  })

  test('given session query fails, when edit attempted, then error is thrown', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      verifierModel: 'test-model',
      enforcePatterns: ['src/**'],
    })

    const mockSdkClient = createMockSdkClient({
      sessionMessagesError: new Error('Network error'),
      llmResponse: 'ALLOW',
    })

    const hook = await getHook(projectRoot, mockSdkClient)

    await expect(callHook(hook, 'edit', 'src/example.ts')).rejects.toThrow(
      'Failed to read session history',
    )
  })

  test('given session contains 7 completed bash outputs, when edit attempted, then verifier receives last 5', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      verifierModel: 'test-model',
      enforcePatterns: ['src/**'],
    })

    const bashOutputs = Array.from({ length: 7 }, (_, i) => ({
      info: { id: `msg${i}`, role: 'user' as const },
      parts: [
        {
          id: `part${i}`,
          type: 'tool' as const,
          tool: 'bash',
          state: {
            status: 'completed' as const,
            output: `output ${i + 1}`,
            title: 'test',
            input: {},
            metadata: {},
            time: { start: 0, end: 1 },
          },
        } as const,
      ],
    }))

    let receivedTestOutput: string | undefined
    const mockSdkClient = createMockSdkClient({
      sessionMessages: bashOutputs,
      llmResponse: 'ALLOW',
      captureTestOutput: (output) => {
        receivedTestOutput = output
      },
    })

    const hook = await getHook(projectRoot, mockSdkClient)

    await callHook(hook, 'edit', 'src/example.ts')

    // Should include outputs 3-7 (last 5)
    expect(receivedTestOutput).toContain('output 3')
    expect(receivedTestOutput).toContain('output 4')
    expect(receivedTestOutput).toContain('output 5')
    expect(receivedTestOutput).toContain('output 6')
    expect(receivedTestOutput).toContain('output 7')
    expect(receivedTestOutput).not.toContain('output 1')
    expect(receivedTestOutput).not.toContain('output 2')
  })

  test('given session contains pending and completed bash outputs, when edit attempted, then only completed outputs passed to verifier', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      verifierModel: 'test-model',
      enforcePatterns: ['src/**'],
    })

    let receivedTestOutput: string | undefined
    const mockSdkClient = createMockSdkClient({
      sessionMessages: [
        {
          info: { id: 'msg1', role: 'user' as const },
          parts: [
            {
              id: 'part1',
              type: 'tool' as const,
              tool: 'bash',
              state: {
                status: 'pending' as const,
              },
            } as const,
          ],
        },
        {
          info: { id: 'msg2', role: 'user' as const },
          parts: [
            {
              id: 'part2',
              type: 'tool' as const,
              tool: 'bash',
              state: {
                status: 'completed' as const,
                output: 'PASS: test_completed',
                title: 'test',
                input: {},
                metadata: {},
                time: { start: 0, end: 1 },
              },
            } as const,
          ],
        },
      ],
      llmResponse: 'ALLOW',
      captureTestOutput: (output) => {
        receivedTestOutput = output
      },
    })

    const hook = await getHook(projectRoot, mockSdkClient)

    await callHook(hook, 'edit', 'src/example.ts')

    expect(receivedTestOutput).toContain('PASS: test_completed')
    expect(receivedTestOutput).not.toContain('pending')
  })

  test('given config without testOutputFile, when config loaded, then loads successfully', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot, {
      verifierModel: 'test-model',
      enforcePatterns: ['src/**'],
    })

    const mockSdkClient = createMockSdkClient({
      sessionMessages: [
        {
          info: { id: 'msg1', role: 'user' as const },
          parts: [
            {
              id: 'part1',
              type: 'tool' as const,
              tool: 'bash',
              state: {
                status: 'completed' as const,
                output: 'PASS: test',
                title: 'test',
                input: {},
                metadata: {},
                time: { start: 0, end: 1 },
              },
            } as const,
          ],
        },
      ],
      llmResponse: 'ALLOW',
    })

    const hook = await getHook(projectRoot, mockSdkClient)

    // Should not throw
    await callHook(hook, 'edit', 'src/example.ts')
  })
})

// Test helpers
const createProjectRoot = async () => {
  return mkdtemp(join(tmpdir(), 'opencode-tdd-'))
}

const writeConfig = async (projectRoot: string, config: unknown) => {
  const configPath = join(projectRoot, '.opencode', 'tdd.json')
  await mkdir(join(projectRoot, '.opencode'), { recursive: true })
  await writeFile(configPath, JSON.stringify(config))
}

type ToolPart = {
  id: string
  type: 'tool'
  tool: string
  state:
    | { status: 'pending' }
    | {
        status: 'completed'
        output: string
        title: string
        input: Record<string, unknown>
        metadata: Record<string, unknown>
        time: { start: number; end: number }
      }
}

type SessionMessage = {
  info: { id: string; role: 'user' | 'assistant' }
  parts: Array<{ id: string; type: 'text'; text: string } | ToolPart>
}

const createMockSdkClient = (opts: {
  sessionMessages?: SessionMessage[]
  sessionMessagesError?: Error
  llmResponse: string
  captureTestOutput?: (output: string) => void
}) => ({
  session: {
    create: async () => ({ data: { id: 'child-session' } }),
    prompt: async (_: unknown) => {
      return {
        data: {
          parts: [{ type: 'text', text: opts.llmResponse }],
        },
      }
    },
    delete: async () => ({}),
    messages: async () => {
      if (opts.sessionMessagesError) {
        throw opts.sessionMessagesError
      }
      return { data: opts.sessionMessages ?? [] }
    },
  },
  chat: async (_model: string, messages: Array<{ content: string }>) => {
    // Capture test output from the prompt
    const userContent = messages[1]?.content
    if (userContent && opts.captureTestOutput) {
      const testOutputMatch = userContent.match(/Test Output:\n([\s\S]*?)$/)
      if (testOutputMatch) {
        opts.captureTestOutput(testOutputMatch[1])
      }
    }
    return opts.llmResponse
  },
})

const getHook = async (projectRoot: string, client: unknown) => {
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
