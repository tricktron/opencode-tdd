import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createOpencode } from '@opencode-ai/sdk'

const repoRoot = process.cwd()
const fixtureRoot = join(repoRoot, 'test', 'e2e', 'fixture')
const logPath = join(fixtureRoot, '.opencode/tdd/tdd.log')
const testOutputPath = join(fixtureRoot, '.opencode/tdd/smoke-test-output.txt')

const LOG_WAIT_TIMEOUT_MS = 20000
const TEST_TIMEOUT_MS = 25000

const waitForLogEntry = async (pattern: string): Promise<void> => {
  const start = Date.now()
  while (Date.now() - start < LOG_WAIT_TIMEOUT_MS) {
    const content = await readFile(logPath, 'utf8').catch(() => '')
    if (content.includes(pattern)) return
    await Bun.sleep(500)
  }
  throw new Error(`Timeout waiting for log entry: ${pattern}`)
}

const setupFixture = async () => {
  for (const dir of ['.opencode/plugin', '.opencode/tdd', '.git']) {
    await rm(join(fixtureRoot, dir), { recursive: true, force: true })
  }
  const proc = Bun.spawn(['bun', 'run', 'build'], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Build failed with code ${exitCode}: ${stderr}`)
  }
  await mkdir(join(fixtureRoot, '.opencode/plugin'), { recursive: true })
  await mkdir(join(fixtureRoot, '.git'), { recursive: true })
  const distPath = join(repoRoot, 'dist', 'index.js')
  const pluginPath = join(fixtureRoot, '.opencode/plugin/index.js')
  await copyFile(distPath, pluginPath)
}

const cleanupTest = async () => {
  const proc = Bun.spawn(['git', 'restore', 'src/foo.ts'], {
    cwd: fixtureRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await proc.exited
  await rm(logPath, { force: true })
  await rm(testOutputPath, { force: true })
}

type EventStream = AsyncGenerator<{
  type: string
  properties: { sessionID: string }
}>

const waitForSessionIdle = async (stream: EventStream, sessionId: string) => {
  for await (const event of stream) {
    if (
      event.type === 'session.idle' &&
      event.properties.sessionID === sessionId
    ) {
      return
    }
  }
}

interface TestContext {
  setupTestOutput: () => Promise<void>
  expectedLogPattern: string
  assertions: (log: string) => void
}

const runTddPluginTest = async (ctx: TestContext) => {
  await ctx.setupTestOutput()
  await rm(logPath, { force: true })

  const originalCwd = process.cwd()
  process.chdir(fixtureRoot)

  const { client, server } = await createOpencode({
    hostname: '127.0.0.1',
    port: 0,
  })

  try {
    const sessionResult = await client.session.create({
      body: { title: 'sdk e2e test' },
    })
    if ('error' in sessionResult && sessionResult.error) {
      throw new Error('Failed to create session')
    }

    const sessionId = sessionResult.data?.id
    if (!sessionId) throw new Error('Missing session id')

    const { stream } = await client.event.subscribe()

    await client.session.promptAsync({
      path: { id: sessionId },
      body: {
        model: { providerID: 'opencode', modelID: 'minimax-m2.1-free' },
        parts: [
          {
            type: 'text',
            text: 'Add a comment "// Example constant" above the foo export in src/foo.ts',
          },
        ],
      },
    })

    await Promise.race([
      waitForLogEntry(ctx.expectedLogPattern),
      waitForSessionIdle(stream as EventStream, sessionId),
    ])

    const log = await readFile(logPath, 'utf8')
    ctx.assertions(log)
  } finally {
    server.close()
    process.chdir(originalCwd)
  }
}

describe('SDK E2E', () => {
  beforeAll(setupFixture)
  afterEach(cleanupTest)

  test(
    'blocks edit when test output is missing',
    () =>
      runTddPluginTest({
        setupTestOutput: () => rm(testOutputPath, { force: true }),
        expectedLogPattern: 'Run tests first',
        assertions: (log) => expect(log).toContain('Run tests first'),
      }),
    TEST_TIMEOUT_MS,
  )

  test(
    'allows edit when exactly one test fails',
    () =>
      runTddPluginTest({
        setupTestOutput: async () => {
          await Bun.write(testOutputPath, '1 test FAIL')
        },
        expectedLogPattern: 'Allowed edit (RED)',
        assertions: (log) => {
          expect(log).toContain('Allowed edit (RED)')
          expect(log).toContain('src/foo.ts')
        },
      }),
    TEST_TIMEOUT_MS,
  )

  test(
    'blocks non-test edit when all tests pass',
    () =>
      runTddPluginTest({
        setupTestOutput: async () => {
          await Bun.write(testOutputPath, 'PASS all tests')
        },
        expectedLogPattern: 'Blocked',
        assertions: (log) => {
          expect(log).toContain('Blocked')
          expect(log).toContain('Write a failing test')
        },
      }),
    TEST_TIMEOUT_MS,
  )
})
