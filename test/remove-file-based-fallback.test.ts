// Slice: 15-remove-file-based-fallback
// Goal: Session history is now the only source of test output
// Config requires both verifierModel and enforcePatterns

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TDDPlugin } from '../src/index'

const testRoot = join(process.cwd(), 'test', 'tmp', 'remove-fallback-test')

beforeEach(async () => {
  await mkdir(testRoot, { recursive: true })
  await mkdir(join(testRoot, '.opencode'), { recursive: true })
})

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true })
})

describe('Remove File-Based Fallback', () => {
  test('edit uses session history only (no testOutputFile in config)', async () => {
    // Arrange: Config without testOutputFile, session with bash output
    await writeFile(
      join(testRoot, '.opencode/tdd.json'),
      JSON.stringify({
        verifierModel: 'opencode/test-model',
        enforcePatterns: ['src/**/*.ts'],
      }),
    )

    const mockBashOutput = 'PASS src/example.test.ts'
    const mockClient = {
      chat: async () => 'ALLOW: Test exists and is failing as expected',
    }

    const mockSdkClient = {
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
                    output: mockBashOutput,
                  },
                },
              ],
            },
          ],
        }),
      },
    }

    const plugin = await TDDPlugin({
      client: mockSdkClient,
      directory: testRoot,
    })

    const input = {
      tool: 'edit',
      sessionID: 'test-session-id',
      callID: 'test-call-id',
    }
    const output = {
      args: {
        filePath: join(testRoot, 'src/example.ts'),
        oldString: 'const x = 1',
        newString: 'const x = 2',
      },
    }

    // Act & Assert: Should use bash output from session, not fail
    await plugin['tool.execute.before'](input, output)
    // If we get here without error, test passes
  })

  test('config with both verifierModel and enforcePatterns is valid', async () => {
    // Arrange
    await writeFile(
      join(testRoot, '.opencode/tdd.json'),
      JSON.stringify({
        verifierModel: 'opencode/test-model',
        enforcePatterns: ['src/**/*.ts'],
      }),
    )

    const mockClient = {
      chat: async () => 'ALLOW: Test exists',
    }

    const mockSdkClient = {
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
                    output: 'PASS test',
                  },
                },
              ],
            },
          ],
        }),
      },
    }

    // Act
    const plugin = await TDDPlugin({
      client: mockSdkClient,
      directory: testRoot,
    })

    // Assert: Should not throw
    expect(plugin).toBeDefined()
  })

  test('config missing enforcePatterns is rejected', async () => {
    // Arrange
    await writeFile(
      join(testRoot, '.opencode/tdd.json'),
      JSON.stringify({
        verifierModel: 'opencode/test-model',
      }),
    )

    const mockSdkClient = {
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
                    output: 'PASS test',
                  },
                },
              ],
            },
          ],
        }),
      },
    }

    const plugin = await TDDPlugin({
      client: mockSdkClient,
      directory: testRoot,
    })

    const input = {
      tool: 'edit',
      sessionID: 'test-session-id',
      callID: 'test-call-id',
    }
    const output = {
      args: {
        filePath: join(testRoot, 'src/example.ts'),
        oldString: 'const x = 1',
        newString: 'const x = 2',
      },
    }

    // Act & Assert
    await expect(plugin['tool.execute.before'](input, output)).rejects.toThrow(
      'Missing config field: enforcePatterns',
    )
  })

  test('config missing verifierModel is rejected', async () => {
    // Arrange
    await writeFile(
      join(testRoot, '.opencode/tdd.json'),
      JSON.stringify({
        enforcePatterns: ['src/**/*.ts'],
      }),
    )

    const mockSdkClient = {
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
                    output: 'PASS test',
                  },
                },
              ],
            },
          ],
        }),
      },
    }

    const plugin = await TDDPlugin({
      client: mockSdkClient,
      directory: testRoot,
    })

    const input = {
      tool: 'edit',
      sessionID: 'test-session-id',
      callID: 'test-call-id',
    }
    const output = {
      args: {
        filePath: join(testRoot, 'src/example.ts'),
        oldString: 'const x = 1',
        newString: 'const x = 2',
      },
    }

    // Act & Assert
    await expect(plugin['tool.execute.before'](input, output)).rejects.toThrow(
      'Missing config field: verifierModel',
    )
  })
})
