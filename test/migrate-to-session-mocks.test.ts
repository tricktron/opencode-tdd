import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Slice: 16-migrate-tests-to-session-mocks
// Given all tests migrated to session-based mocks, when inspecting test file,
// then no file-based helpers or obsolete tests exist

describe('Session-Based Mock Migration', () => {
  // Acceptance Test
  test('given migration complete, when inspecting index.test.ts, then file-based helpers are removed', async () => {
    const testFilePath = join(__dirname, 'index.test.ts')
    const content = await readFile(testFilePath, 'utf-8')

    // File-based helpers should not exist
    expect(content).not.toContain('const writeTestOutput =')
    expect(content).not.toContain('function writeTestOutput')

    // Obsolete file-based tests should be deleted
    expect(content).not.toContain('Test output file does not exist')
    expect(content).not.toContain('Test output is stale')
    expect(content).not.toContain('test output file is empty')

    // All remaining tests should use session mocks
    const writeTestOutputMatches = content.match(/await writeTestOutput\(/g)
    expect(writeTestOutputMatches).toBeNull() // No usage of writeTestOutput
  })
})
