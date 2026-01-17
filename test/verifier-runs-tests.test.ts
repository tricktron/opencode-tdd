import { describe, expect, it } from 'bun:test'
import { createMockSdkClient } from './helpers'

// Slice: 21-verifier-runs-tests
// Given valid/invalid test states, when verifier runs tests directly,
// then it makes ALLOW/BLOCK decisions based on fresh test output

describe('Verifier Runs Tests', () => {
  // Acceptance Test 1: Block when all tests pass (no red test)
  it('blocks edit when all tests pass', async () => {
    const mockClient = createMockSdkClient({
      promptResponse: 'BLOCK: No red test - write test first',
    })

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await expect(
      verifyEditWithTestRunner({
        sdkClient: mockClient,
        parentSessionId: 'parent-1',
        model: 'opencode/test',
        filePath: 'src/foo.ts',
        editContent: 'export const foo = 42',
        projectRoot: '/test',
      }),
    ).rejects.toThrow('No red test - write test first')
  })

  // Acceptance Test 2: Allow when 1 red test exists
  it('allows edit when 1 red test exists', async () => {
    const mockClient = createMockSdkClient()

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    // Should not throw
    await verifyEditWithTestRunner({
      sdkClient: mockClient,
      parentSessionId: 'parent-2',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
    })
  })

  // Acceptance Test 3: Block on timeout
  it('blocks edit when verification times out', async () => {
    let sessionDeleted = false
    const mockClient = createMockSdkClient({
      deleteCallback: () => {
        sessionDeleted = true
      },
    })

    // Override prompt to hang forever
    mockClient.session.prompt = async () => {
      await new Promise(() => {})
      return { data: { parts: [] } }
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await expect(
      verifyEditWithTestRunner({
        sdkClient: mockClient,
        parentSessionId: 'parent-3',
        model: 'opencode/test',
        filePath: 'src/foo.ts',
        editContent: 'export const foo = 42',
        projectRoot: '/test',
        timeoutMs: 100, // Short timeout for test
      }),
    ).rejects.toThrow('Verification timed out. Please try edit again.')

    expect(sessionDeleted).toBe(true)
  })

  // Unit Test 4: Audit includes test execution details
  it('records test command and output in audit', async () => {
    type AuditEntry = import('../src/auditor').AuditEntry
    let auditEntry: AuditEntry | null = null
    const mockAuditor = {
      record: async (entry: AuditEntry) => {
        auditEntry = entry
      },
    }

    const mockClient = createMockSdkClient({ testOutput: '1 test failed' })

    // Override messages to include command
    mockClient.session.messages = async () => ({
      data: [
        {
          info: { id: 'msg-1', role: 'assistant' },
          parts: [
            {
              type: 'tool',
              tool: 'bash',
              input: { command: 'npm test -- foo.test.ts' },
              state: {
                status: 'completed',
                output: '1 test failed',
              },
            },
          ],
        },
      ],
    })

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient,
      parentSessionId: 'parent-4',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
      auditor: mockAuditor,
    })

    expect(auditEntry).toBeTruthy()
    expect(auditEntry!.decision).toBe('allow')
    expect(auditEntry!.testCommand).toBe('npm test -- foo.test.ts')
    expect(auditEntry!.testOutput).toBe('1 test failed')
  })

  // Unit Test 5: Child session cleanup
  it('cleans up child session after verification', async () => {
    let deletedSessionId = ''
    const mockClient = createMockSdkClient({
      deleteCallback: (id) => {
        deletedSessionId = id
      },
    })

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient,
      parentSessionId: 'parent-5',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
    })

    expect(deletedSessionId).toBe('mock-session-id')
  })

  // Slice: 22-e2e-verifier-runs-tests
  // Unit Test 6: Verifier requests bash tool access in child session
  it('passes tools: { bash: true } to child session prompt', async () => {
    type PromptOpts = Parameters<
      import('../src/verifier').SdkClient['session']['prompt']
    >[0]
    let promptOptions: PromptOpts | null = null
    const mockClient = createMockSdkClient()

    // Override prompt to capture options
    mockClient.session.prompt = async (opts) => {
      promptOptions = opts
      return {
        data: {
          parts: [{ type: 'text', text: 'ALLOW' }],
        },
      }
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient,
      parentSessionId: 'parent-6',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
    })

    expect(promptOptions).toBeTruthy()
    expect(promptOptions!.body.tools).toEqual({ bash: true })
  })

  // Unit Test: extractTestDetails returns null when no bash tool execution found
  it('extractTestDetails returns null when no bash execution found', async () => {
    const { extractTestDetails } = await import('../src/verifier')

    const mockClient = createMockSdkClient({ testOutput: '' })
    mockClient.session.messages = async () => ({
      data: [
        {
          info: { id: 'msg-1', role: 'assistant' },
          parts: [{ type: 'text', text: 'Some response' }],
        },
      ],
    })

    const result = await extractTestDetails(mockClient, 'session-1')
    expect(result).toBeNull()
  })

  // Unit Test: extractTestDetails extracts command and output from bash execution
  it('extractTestDetails extracts command and output from bash execution', async () => {
    const { extractTestDetails } = await import('../src/verifier')

    const mockClient = createMockSdkClient({ testOutput: 'All tests passed' })
    mockClient.session.messages = async () => ({
      data: [
        {
          info: { id: 'msg-1', role: 'assistant' },
          parts: [
            {
              type: 'tool',
              tool: 'bash',
              input: { command: 'npm test' },
              state: {
                status: 'completed',
                output: 'All tests passed',
              },
            },
          ],
        },
      ],
    })

    const result = await extractTestDetails(mockClient, 'session-2')
    expect(result).toEqual({ command: 'npm test', output: 'All tests passed' })
  })

  // Unit Test: extractTestDetails returns null when messages method not available
  it('extractTestDetails returns null when messages method not available', async () => {
    const { extractTestDetails } = await import('../src/verifier')

    const mockClient = createMockSdkClient()
    // Remove messages method to simulate client without it
    delete mockClient.session.messages

    const result = await extractTestDetails(mockClient, 'session-3')
    expect(result).toBeNull()
  })

  // Unit Test: extractTestDetails runs for block errors
  it('calls extractTestDetails to include test output in block errors', async () => {
    let messagesCalled = false
    const mockClient = createMockSdkClient()

    // Override messages to track if it's called
    mockClient.session.messages = async () => {
      messagesCalled = true
      return { data: [] }
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient,
      parentSessionId: 'parent-no-auditor',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
      // No auditor provided
    })

    expect(messagesCalled).toBe(true)
  })

  // Unit Test: extractTestDetails runs with auditor
  it('calls extractTestDetails and includes test details in audit when auditor is provided', async () => {
    type AuditEntry = import('../src/auditor').AuditEntry
    let auditEntry: AuditEntry | null = null
    const mockAuditor = {
      record: async (entry: AuditEntry) => {
        auditEntry = entry
      },
    }

    const mockClient = createMockSdkClient({ testOutput: 'Tests passed' })

    // Override messages to include command
    mockClient.session.messages = async () => ({
      data: [
        {
          info: { id: 'msg-1', role: 'assistant' },
          parts: [
            {
              type: 'tool',
              tool: 'bash',
              input: { command: 'bun test foo.test.ts' },
              state: {
                status: 'completed',
                output: 'Tests passed',
              },
            },
          ],
        },
      ],
    })

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient,
      parentSessionId: 'parent-with-auditor',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
      auditor: mockAuditor,
    })

    expect(auditEntry).toBeTruthy()
    expect(auditEntry!.testCommand).toBe('bun test foo.test.ts')
    expect(auditEntry!.testOutput).toBe('Tests passed')
  })

  // Unit Test: SdkClient type accepts optional messages method (no as any casts)
  it('accepts SdkClient with optional messages method', async () => {
    const { extractTestDetails } = await import('../src/verifier')

    // This test ensures the type system accepts messages as optional
    const mockClientWithMessages = createMockSdkClient({ testOutput: 'pass' })
    mockClientWithMessages.session.messages = async () => ({
      data: [
        {
          info: { id: 'msg-1', role: 'assistant' },
          parts: [
            {
              type: 'tool',
              tool: 'bash',
              input: { command: 'npm test' },
              state: { status: 'completed', output: 'pass' },
            },
          ],
        },
      ],
    })

    const mockClientWithoutMessages = createMockSdkClient()
    delete mockClientWithoutMessages.session.messages

    // Both should work without type errors
    const result1 = await extractTestDetails(
      mockClientWithMessages,
      'session-1',
    )
    const result2 = await extractTestDetails(
      mockClientWithoutMessages,
      'session-2',
    )

    expect(result1).toEqual({ command: 'npm test', output: 'pass' })
    expect(result2).toBeNull()
  })
})
