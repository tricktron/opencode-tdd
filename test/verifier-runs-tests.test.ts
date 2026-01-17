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
})
