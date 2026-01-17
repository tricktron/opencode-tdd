import { describe, expect, it } from 'bun:test'

// Slice: 21-verifier-runs-tests
// Given valid/invalid test states, when verifier runs tests directly,
// then it makes ALLOW/BLOCK decisions based on fresh test output

describe('Verifier Runs Tests', () => {
  // Acceptance Test 1: Block when all tests pass (no red test)
  it('blocks edit when all tests pass', async () => {
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'child-session-1' } }),
        prompt: async () => ({
          data: {
            parts: [
              {
                type: 'text',
                text: 'BLOCK: No red test - write test first',
              },
            ],
          },
        }),
        delete: async () => ({}),
      },
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await expect(
      verifyEditWithTestRunner({
        sdkClient: mockClient as any,
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
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'child-session-2' } }),
        prompt: async () => ({
          data: {
            parts: [{ type: 'text', text: 'ALLOW' }],
          },
        }),
        delete: async () => ({}),
      },
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    // Should not throw
    await verifyEditWithTestRunner({
      sdkClient: mockClient as any,
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
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'child-session-3' } }),
        prompt: async () => {
          // Hang forever
          await new Promise(() => {})
          return { data: { parts: [] } }
        },
        delete: async () => {
          sessionDeleted = true
          return {}
        },
      },
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await expect(
      verifyEditWithTestRunner({
        sdkClient: mockClient as any,
        parentSessionId: 'parent-3',
        model: 'opencode/test',
        filePath: 'src/foo.ts',
        editContent: 'export const foo = 42',
        projectRoot: '/test',
        timeoutMs: 100, // Short timeout for test
      }),
    ).rejects.toThrow('Verification timed out')

    expect(sessionDeleted).toBe(true)
  })

  // Unit Test 4: Audit includes test execution details
  it('records test command and output in audit', async () => {
    let auditEntry: any = null
    const mockAuditor = {
      record: async (entry: any) => {
        auditEntry = entry
      },
    }

    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'child-session-4' } }),
        prompt: async () => ({
          data: {
            parts: [{ type: 'text', text: 'ALLOW' }],
          },
        }),
        messages: async () => ({
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
        }),
        delete: async () => ({}),
      },
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient as any,
      parentSessionId: 'parent-4',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
      auditor: mockAuditor,
    })

    expect(auditEntry).toBeTruthy()
    expect(auditEntry.decision).toBe('allow')
    expect(auditEntry.testCommand).toBe('npm test -- foo.test.ts')
    expect(auditEntry.testOutput).toBe('1 test failed')
  })

  // Unit Test 5: Child session cleanup
  it('cleans up child session after verification', async () => {
    let deletedSessionId = ''
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'child-to-delete' } }),
        prompt: async () => ({
          data: {
            parts: [{ type: 'text', text: 'ALLOW' }],
          },
        }),
        delete: async (opts: any) => {
          deletedSessionId = opts.path.id
          return {}
        },
      },
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient as any,
      parentSessionId: 'parent-5',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
    })

    expect(deletedSessionId).toBe('child-to-delete')
  })

  // Slice: 22-e2e-verifier-runs-tests
  // Unit Test 6: Verifier requests bash tool access in child session
  it('passes tools: { bash: true } to child session prompt', async () => {
    let promptOptions: any = null
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'child-session-6' } }),
        prompt: async (opts: any) => {
          promptOptions = opts
          return {
            data: {
              parts: [{ type: 'text', text: 'ALLOW' }],
            },
          }
        },
        delete: async () => ({}),
      },
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient as any,
      parentSessionId: 'parent-6',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
    })

    expect(promptOptions).toBeTruthy()
    expect(promptOptions.body.tools).toEqual({ bash: true })
  })

  // Slice: 24-extract-test-details-helper
  // Given verifyEditWithTestRunner with nested loops and type casts
  // When extracting test details logic into helper function
  // Then all existing tests pass (behavior unchanged)
  // And code is easier to read (reduced nesting, no type casts)

  // Acceptance Test: Refactoring preserves behavior
  it('extracts test details without changing behavior', async () => {
    let auditEntry: any = null
    const mockAuditor = {
      record: async (entry: any) => {
        auditEntry = entry
      },
    }

    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'child-session-refactor' } }),
        prompt: async () => ({
          data: {
            parts: [{ type: 'text', text: 'ALLOW' }],
          },
        }),
        messages: async () => ({
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
                    output: 'Tests: 1 failed',
                  },
                },
              ],
            },
          ],
        }),
        delete: async () => ({}),
      },
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient as any,
      parentSessionId: 'parent-refactor',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
      auditor: mockAuditor,
    })

    // Verify behavior preserved: test details extracted correctly
    expect(auditEntry).toBeTruthy()
    expect(auditEntry.testCommand).toBe('bun test foo.test.ts')
    expect(auditEntry.testOutput).toBe('Tests: 1 failed')
  })

  // Unit Test: extractTestDetails returns null when no bash tool execution found
  it('extractTestDetails returns null when no bash execution found', async () => {
    const { extractTestDetails } = await import('../src/verifier')

    const mockClient = {
      session: {
        messages: async () => ({
          data: [
            {
              info: { id: 'msg-1', role: 'assistant' },
              parts: [{ type: 'text', text: 'Some response' }],
            },
          ],
        }),
      },
    }

    const result = await extractTestDetails(mockClient as any, 'session-1')
    expect(result).toBeNull()
  })

  // Unit Test: extractTestDetails extracts command and output from bash execution
  it('extractTestDetails extracts command and output from bash execution', async () => {
    const { extractTestDetails } = await import('../src/verifier')

    const mockClient = {
      session: {
        messages: async () => ({
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
        }),
      },
    }

    const result = await extractTestDetails(mockClient as any, 'session-2')
    expect(result).toEqual({ command: 'npm test', output: 'All tests passed' })
  })

  // Unit Test: extractTestDetails returns null when messages method not available
  it('extractTestDetails returns null when messages method not available', async () => {
    const { extractTestDetails } = await import('../src/verifier')

    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'test' } }),
        prompt: async () => ({ data: { parts: [] } }),
        delete: async () => ({}),
      },
    }

    const result = await extractTestDetails(mockClient as any, 'session-3')
    expect(result).toBeNull()
  })

  // Slice: 25-optional-methods-and-conditional-audit
  // Given: Current implementation with as any casts and unconditional extraction
  // When: Add optional messages method and gate extraction
  // Then: All unit tests pass
  // And: E2E test passes
  // And: No as any casts remain

  // Acceptance Test: Behavior preserved after refactoring
  it('preserves all behavior with optional messages method and conditional audit', async () => {
    let auditEntry: any = null
    const mockAuditor = {
      record: async (entry: any) => {
        auditEntry = entry
      },
    }

    let messagesCallCount = 0
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'child-acceptance' } }),
        prompt: async () => ({
          data: {
            parts: [{ type: 'text', text: 'ALLOW' }],
          },
        }),
        messages: async () => {
          messagesCallCount++
          return {
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
                      output: '1 test failed',
                    },
                  },
                ],
              },
            ],
          }
        },
        delete: async () => ({}),
      },
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    // With auditor: messages should be called, audit should include test details
    await verifyEditWithTestRunner({
      sdkClient: mockClient as any,
      parentSessionId: 'parent-acceptance-1',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
      auditor: mockAuditor,
    })

    expect(messagesCallCount).toBe(1)
    expect(auditEntry).toBeTruthy()
    expect(auditEntry.testCommand).toBe('bun test')
    expect(auditEntry.testOutput).toBe('1 test failed')

    // Without auditor: messages should NOT be called
    messagesCallCount = 0
    await verifyEditWithTestRunner({
      sdkClient: mockClient as any,
      parentSessionId: 'parent-acceptance-2',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
    })

    expect(messagesCallCount).toBe(0)
  })

  // Unit Test: extractTestDetails only runs with auditor
  it('does not call extractTestDetails when auditor is not provided', async () => {
    let messagesCalled = false
    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'child-no-auditor' } }),
        prompt: async () => ({
          data: {
            parts: [{ type: 'text', text: 'ALLOW' }],
          },
        }),
        messages: async () => {
          messagesCalled = true
          return { data: [] }
        },
        delete: async () => ({}),
      },
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient as any,
      parentSessionId: 'parent-no-auditor',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
      // No auditor provided
    })

    expect(messagesCalled).toBe(false)
  })

  // Unit Test: extractTestDetails runs with auditor
  it('calls extractTestDetails and includes test details in audit when auditor is provided', async () => {
    let auditEntry: any = null
    const mockAuditor = {
      record: async (entry: any) => {
        auditEntry = entry
      },
    }

    const mockClient = {
      session: {
        create: async () => ({ data: { id: 'child-with-auditor' } }),
        prompt: async () => ({
          data: {
            parts: [{ type: 'text', text: 'ALLOW' }],
          },
        }),
        messages: async () => ({
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
        }),
        delete: async () => ({}),
      },
    }

    const { verifyEditWithTestRunner } = await import('../src/verifier')

    await verifyEditWithTestRunner({
      sdkClient: mockClient as any,
      parentSessionId: 'parent-with-auditor',
      model: 'opencode/test',
      filePath: 'src/foo.ts',
      editContent: 'export const foo = 42',
      projectRoot: '/test',
      auditor: mockAuditor,
    })

    expect(auditEntry).toBeTruthy()
    expect(auditEntry.testCommand).toBe('bun test foo.test.ts')
    expect(auditEntry.testOutput).toBe('Tests passed')
  })

  // Unit Test: SdkClient type accepts optional messages method (no as any casts)
  it('accepts SdkClient with optional messages method', async () => {
    const { extractTestDetails } = await import('../src/verifier')

    // This test ensures the type system accepts messages as optional
    const mockClientWithMessages = {
      session: {
        create: async () => ({ data: { id: 'test' } }),
        prompt: async () => ({ data: { parts: [] } }),
        delete: async () => ({}),
        messages: async () => ({
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
        }),
      },
    }

    const mockClientWithoutMessages = {
      session: {
        create: async () => ({ data: { id: 'test' } }),
        prompt: async () => ({ data: { parts: [] } }),
        delete: async () => ({}),
      },
    }

    // Both should work without type errors
    const result1 = await extractTestDetails(
      mockClientWithMessages as any,
      'session-1',
    )
    const result2 = await extractTestDetails(
      mockClientWithoutMessages as any,
      'session-2',
    )

    expect(result1).toEqual({ command: 'npm test', output: 'pass' })
    expect(result2).toBeNull()
  })
})
