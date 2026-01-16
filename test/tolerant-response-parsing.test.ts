import { describe, expect, test } from 'bun:test'
import { verifyEdit } from '../src/verifier'

// Slice: 13-tolerant-response-parsing
// Given LLM returns verbose responses, when parsed, then extract actual BLOCK/ALLOW decisions and preserve reasons

const mockClient = (response: string) => ({
  chat: async () => response,
})

const verifyOpts = (client: ReturnType<typeof mockClient>) => ({
  client,
  model: 'model',
  filePath: 'file.ts',
  editContent: 'content',
  testOutput: 'output',
})

describe('Tolerant Response Parsing', () => {
  test('extracts BLOCK reason from verbose response with reasoning before decision', async () => {
    const client = mockClient(
      'Let me analyze this edit...\nThe code adds implementation without a failing test.\nBLOCK: Cannot add implementation while 0 unit tests are failing.',
    )

    await expect(verifyEdit(verifyOpts(client))).rejects.toThrow(
      'Cannot add implementation while 0 unit tests are failing.',
    )
  })

  test('extracts BLOCK reason from markdown bold wrapped decision', async () => {
    const client = mockClient('**BLOCK: Write a failing test first.**')

    await expect(verifyEdit(verifyOpts(client))).rejects.toThrow(
      'Write a failing test first.',
    )
  })

  test('extracts BLOCK reason from markdown bold on prefix only', async () => {
    const client = mockClient(
      '**BLOCK:** Cannot add unit test while "CRD Completion should fail" is red.',
    )

    await expect(verifyEdit(verifyOpts(client))).rejects.toThrow(
      'Cannot add unit test while "CRD Completion should fail" is red.',
    )
  })

  test('extracts ALLOW from verbose response with reasoning before decision', async () => {
    const client = mockClient(
      'This edit refactors existing code without changing behavior.\nALLOW',
    )

    await expect(verifyEdit(verifyOpts(client))).resolves.toBeUndefined()
  })

  test('preserves existing exact format BLOCK: reason', async () => {
    const client = mockClient('BLOCK: Write a failing test first')

    await expect(verifyEdit(verifyOpts(client))).rejects.toThrow(
      'Write a failing test first',
    )
  })

  test('preserves existing exact format ALLOW', async () => {
    const client = mockClient('ALLOW')

    await expect(verifyEdit(verifyOpts(client))).resolves.toBeUndefined()
  })

  test('falls through to default for invalid response', async () => {
    const client = mockClient('This is an invalid response with no decision')

    await expect(verifyEdit(verifyOpts(client))).rejects.toThrow(
      'Verification failed. Please retry this edit.',
    )
  })

  test('defaults to actionable reason when BLOCK has empty reason', async () => {
    const client = mockClient('BLOCK:')

    await expect(verifyEdit(verifyOpts(client))).rejects.toThrow(
      'Verification failed. Please retry this edit.',
    )
  })
})
