import { describe, expect, it } from 'bun:test'
import { $ } from 'bun'

// Slice: 26-export-sdk-client-type
// Given all as any casts removed, when run npx eslint src test, then 0 errors

describe('ESLint: No as any Casts', () => {
  it('passes ESLint with 0 errors after removing all as any casts', async () => {
    const result = await $`npx eslint src test`.nothrow()
    expect(result.exitCode).toBe(0)
  })
})
