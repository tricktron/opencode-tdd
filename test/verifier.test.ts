import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TDDPlugin } from '../src/index'
import { parseResponse } from '../src/verifier'

// Slice: 27-include-test-output-in-block
// Given a block decision with test output
// When the error is thrown
// Then the error message contains both the reason AND truncated test output

const createProjectRoot = async () => {
  return mkdtemp(join(tmpdir(), 'opencode-tdd-'))
}

const writeConfig = async (projectRoot: string) => {
  const configPath = join(projectRoot, '.opencode', 'tdd.json')
  await mkdir(join(projectRoot, '.opencode'), { recursive: true })
  await writeFile(
    configPath,
    JSON.stringify({
      enforcePatterns: ['src/**'],
      verifierModel: 'test-model',
    }),
  )
}

const mockSdkClientWithTestOutput = (testOutput: string, decision: string) => {
  return {
    session: {
      messages: async () => ({
        data: [
          {
            info: { id: 'msg-1', role: 'assistant' },
            parts: [
              {
                type: 'tool',
                tool: 'bash',
                input: { command: 'bun test' },
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
          parts: [{ type: 'text', text: decision }],
        },
      }),
      delete: async () => ({}),
    },
    app: { log: async () => ({}) },
  }
}

const getHook = async (projectRoot: string, client: unknown) => {
  const hooks = await TDDPlugin({
    directory: projectRoot,
    client,
  } as Parameters<typeof TDDPlugin>[0])
  const hook = hooks['tool.execute.before']
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
    { tool, sessionID: 'parent-session' } as Parameters<
      NonNullable<typeof hook>
    >[0],
    { args: { filePath, ...args } } as Parameters<NonNullable<typeof hook>>[1],
  )

describe('parseResponse with test output', () => {
  test('returns reason with test output when BLOCK decision', () => {
    const testOutput = '  873 passing\n  0 failing'
    const result = parseResponse(
      'BLOCK: Write a failing test first',
      testOutput,
    )

    expect(result.decision).toBe('block')
    expect(result.reason).toContain('Write a failing test first')
    expect(result.reason).toContain('Test output:')
    expect(result.reason).toContain('873 passing')
  })

  test('strips ANSI codes from test output', () => {
    const testOutputWithAnsi =
      '\u001b[32m  873 passing\u001b[0m\n\u001b[31m  0 failing\u001b[0m'
    const result = parseResponse(
      'BLOCK: Write a failing test first',
      testOutputWithAnsi,
    )

    expect(result.reason).not.toContain('\u001b[32m')
    expect(result.reason).not.toContain('\u001b[0m')
    expect(result.reason).toContain('873 passing')
  })

  test('truncates test output to 50 lines by default', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
    const testOutput = lines.join('\n')
    const result = parseResponse(
      'BLOCK: Write a failing test first',
      testOutput,
    )

    const outputSection = result.reason.split('Test output:\n')[1]
    const outputLines = outputSection.split('\n')

    expect(outputLines.length).toBeLessThanOrEqual(51) // 50 lines + possible truncation message
    expect(result.reason).toContain('Line 1')
    expect(result.reason).toContain('Line 50')
    expect(result.reason).not.toContain('Line 51')
  })

  test('respects custom line limit', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
    const testOutput = lines.join('\n')
    const result = parseResponse(
      'BLOCK: Write a failing test first',
      testOutput,
      20,
    )

    const outputSection = result.reason.split('Test output:\n')[1]
    const outputLines = outputSection.split('\n')

    expect(outputLines.length).toBeLessThanOrEqual(21) // 20 lines + possible truncation message
    expect(result.reason).toContain('Line 1')
    expect(result.reason).toContain('Line 20')
    expect(result.reason).not.toContain('Line 21')
  })
})

describe('Include Test Output in Block Errors', () => {
  test('includes test output in block error message', async () => {
    const projectRoot = await createProjectRoot()
    await writeConfig(projectRoot)

    const testOutput = `
  ✓ test 1 passing
  ✓ test 2 passing

  873 passing
  0 failing
`

    const mockClient = mockSdkClientWithTestOutput(
      testOutput,
      'BLOCK: Write a failing test first',
    )

    const hook = await getHook(projectRoot, mockClient)

    const error = await callHook(hook, 'edit', 'src/example.ts', {
      newString: 'new code',
    }).catch((e) => e)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('Write a failing test first')
    expect(error.message).toContain('Test output:')
    expect(error.message).toContain('873 passing')
    expect(error.message).toContain('0 failing')
  })

  test('respects testOutputLines from config', async () => {
    const projectRoot = await createProjectRoot()
    const configPath = join(projectRoot, '.opencode', 'tdd.json')
    await mkdir(join(projectRoot, '.opencode'), { recursive: true })
    await writeFile(
      configPath,
      JSON.stringify({
        enforcePatterns: ['src/**'],
        verifierModel: 'test-model',
        testOutputLines: 5,
      }),
    )

    const lines = Array.from({ length: 100 }, (_, i) => `Test line ${i + 1}`)
    const testOutput = lines.join('\n')

    const mockClient = mockSdkClientWithTestOutput(
      testOutput,
      'BLOCK: Write a failing test first',
    )

    const hook = await getHook(projectRoot, mockClient)

    const error = await callHook(hook, 'edit', 'src/example.ts', {
      newString: 'new code',
    }).catch((e) => e)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('Test line 1')
    expect(error.message).toContain('Test line 5')
    expect(error.message).not.toContain('Test line 6')
    expect(error.message).toContain('output truncated')
  })
})
