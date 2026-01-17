import { expect, test } from 'bun:test'
import { foo } from '../src/foo'

test('foo should be 2', () => {
  expect(foo).toBe(2) // Fails: foo is currently 1
})
