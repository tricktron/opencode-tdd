import { beforeAll, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const repoRoot = process.cwd()
const fixtureRoot = join(repoRoot, 'test', 'e2e', 'fixture')
const generatedDirs = ['.opencode/plugin', '.opencode/tdd', '.git'] as const

const run = async (command: string[], cwd: string) => {
  const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  await proc.exited
}

const waitForLogEntry = async (
  logPath: string,
  pattern: string,
  timeout: number,
): Promise<string> => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const content = await readFile(logPath, 'utf8').catch(() => '')
    if (content.includes(pattern)) return content
    await Bun.sleep(500)
  }
  return readFile(logPath, 'utf8').catch(() => '')
}

describe('Smoke test', () => {
  beforeAll(async () => {
    for (const dir of generatedDirs) {
      await rm(join(fixtureRoot, dir), { recursive: true, force: true })
    }
    await run(['bun', 'run', 'build'], repoRoot)
    await mkdir(join(fixtureRoot, '.opencode/plugin'), { recursive: true })
    await mkdir(join(fixtureRoot, '.git'), { recursive: true })
    await copyFile(
      join(repoRoot, 'dist', 'index.js'),
      join(fixtureRoot, '.opencode/plugin/index.js'),
    )
  })

  test('blocks edit when test output is missing', async () => {
    const logPath = join(fixtureRoot, '.opencode/tdd/tdd.log')

    // Start opencode - it won't exit on its own after plugin error
    const proc = Bun.spawn(['opencode', 'run', 'Add a comment to src/foo.ts'], {
      cwd: fixtureRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    // Wait for plugin to block edit and log the error
    const log = await waitForLogEntry(logPath, 'Run tests first', 60000)

    // Kill opencode since it won't exit on its own
    proc.kill()

    expect(log).toContain('Run tests first')
  }, 90000)
})
