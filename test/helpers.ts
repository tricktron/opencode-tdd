import type { SdkClient } from '../src/verifier'

type MockConfig = {
  testOutput?: string
  promptResponse?: string
  createError?: string
  deleteCallback?: (id: string) => void
  messagesCallback?: () => void
}

export const createMockSdkClient = (config: MockConfig = {}): SdkClient => ({
  session: {
    create: async () =>
      config.createError
        ? { error: config.createError }
        : { data: { id: 'mock-session-id' } },
    prompt: async () => ({
      data: {
        parts: [{ type: 'text', text: config.promptResponse ?? 'ALLOW' }],
      },
    }),
    delete: async (opts) => {
      config.deleteCallback?.(opts.path.id)
      return {}
    },
    messages: config.testOutput
      ? async () => ({
          data: [
            {
              info: { id: 'msg-1', role: 'assistant' },
              parts: [
                {
                  type: 'tool',
                  tool: 'bash',
                  input: { command: 'npm test' },
                  state: { status: 'completed', output: config.testOutput },
                },
              ],
            },
          ],
        })
      : undefined,
  },
})
