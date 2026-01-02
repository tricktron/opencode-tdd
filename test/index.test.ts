import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TDDPlugin } from '../src/index'

describe('TDDPlugin', () => {
  test('exports a plugin function', () => {
    expect(typeof TDDPlugin).toBe('function')
  })

  test('allows edit when tests are failing', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'opencode-tdd-'))
    const tddDir = join(projectRoot, '.opencode', 'tdd')
    await mkdir(tddDir, { recursive: true })
    const testOutputPath = join(tddDir, 'test-output.txt')
    await writeFile(testOutputPath, 'FAIL sample test output')

    const hooks = await TDDPlugin({ directory: projectRoot } as Parameters<
      typeof TDDPlugin
    >[0])
    const hook = hooks['tool.execute.before']
    expect(hook).toBeDefined()
    if (!hook) {
      throw new Error('Missing tool.execute.before hook')
    }

    expect(
      hook(
        { tool: 'edit' } as Parameters<typeof hook>[0],
        { args: { filePath: 'src/example.ts' } } as Parameters<typeof hook>[1],
      ),
    ).resolves.toBeUndefined()
  })
})
