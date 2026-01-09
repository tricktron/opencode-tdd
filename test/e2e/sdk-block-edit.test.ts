import { beforeAll, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createOpencode } from '@opencode-ai/sdk'

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

const setupFixture = async () => {
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
}

describe('SDK E2E', () => {
  beforeAll(setupFixture)

  test('blocks edit when test output is missing', async () => {
    const logPath = join(fixtureRoot, '.opencode/tdd/tdd.log')
    const testOutputPath = join(
      fixtureRoot,
      '.opencode/tdd/smoke-test-output.txt',
    )

    await rm(testOutputPath, { force: true })

    const originalCwd = process.cwd()
    process.chdir(fixtureRoot)

    await rm(logPath, { force: true })

    const { client, server } = await createOpencode({
      hostname: '127.0.0.1',
      port: 4097,
    })

    try {
      const sessionResult = await client.session.create({
        body: { title: 'sdk block edit' },
      })
      if ('error' in sessionResult && sessionResult.error) {
        throw new Error('Failed to create session')
      }

      const sessionId = sessionResult.data?.id
      if (!sessionId) {
        throw new Error('Missing session id')
      }

      // Trigger prompt but don't await - it may hang if LLM is unavailable
      client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [
            {
              type: 'text',
              text: 'Add a comment "// Example constant" above the foo export in src/foo.ts',
            },
          ],
        },
      })

      // Give plugin time to intercept and log
      await Bun.sleep(2000)

      const log = await waitForLogEntry(logPath, 'Run tests first', 30000)
      expect(log).toContain('Run tests first')
    } finally {
      server.close()
      process.chdir(originalCwd)
    }
  }, 45000)
})
