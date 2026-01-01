import { describe, expect, test } from 'bun:test'
import { TDDPlugin } from '../src/index'

describe('TDDPlugin', () => {
  test('exports a plugin function', () => {
    expect(typeof TDDPlugin).toBe('function')
  })

  test('plugin returns hook object', async () => {
    const hooks = await TDDPlugin({} as Parameters<typeof TDDPlugin>[0])
    expect(hooks['tool.execute.before']).toBeDefined()
  })
})
