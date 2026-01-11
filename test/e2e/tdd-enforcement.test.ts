import { afterEach, beforeAll, describe, test } from 'bun:test'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createOpencode } from '@opencode-ai/sdk'

const repoRoot = process.cwd()
const fixtureRoot = join(repoRoot, 'test', 'e2e', 'fixture')
const testOutputPath = join(fixtureRoot, '.opencode/tdd/smoke-test-output.txt')
const auditPath = join(fixtureRoot, '.opencode/tdd/audit.jsonl')

const EVENT_WAIT_TIMEOUT_MS = 20000
const TEST_TIMEOUT_MS = 25000

type EventStream = AsyncGenerator<{
  type: string
  properties: unknown
}>

type ToolEvent = {
  properties: {
    part?: {
      sessionID?: string
      type?: string
      tool?: string
      state?: { status?: string; error?: string }
    }
  }
}

const waitForToolError = async (
  stream: EventStream,
  sessionId: string,
  errorPattern: string,
): Promise<void> => {
  const start = Date.now()
  for await (const event of stream) {
    if (Date.now() - start > EVENT_WAIT_TIMEOUT_MS) {
      throw new Error(`Timeout waiting for tool error: ${errorPattern}`)
    }

    if (event.type === 'message.part.updated') {
      const { part } = (event as unknown as ToolEvent).properties
      if (
        part?.sessionID === sessionId &&
        part?.type === 'tool' &&
        (part?.tool === 'edit' || part?.tool === 'write') &&
        part?.state?.status === 'error' &&
        part?.state?.error?.includes(errorPattern)
      ) {
        return
      }
    }
  }
  throw new Error(`Stream ended without tool error: ${errorPattern}`)
}

const waitForSessionIdle = async (stream: EventStream, sessionId: string) => {
  for await (const event of stream) {
    if (event.type === 'session.idle') {
      const props = event.properties as { sessionID?: string }
      if (props.sessionID === sessionId) {
        return
      }
    }
  }
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
  await rm(testOutputPath, { force: true })
  await rm(auditPath, { force: true })
}

interface TestContext {
  setupTestOutput: () => Promise<void>
  expectedErrorPattern?: string
  shouldSucceed?: boolean
}

const runTddPluginTest = async (ctx: TestContext) => {
  await ctx.setupTestOutput()

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

    if (ctx.expectedErrorPattern) {
      await waitForToolError(
        stream as EventStream,
        sessionId,
        ctx.expectedErrorPattern,
      )
    } else if (ctx.shouldSucceed) {
      await waitForSessionIdle(stream as EventStream, sessionId)
    }
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
        expectedErrorPattern: 'Run tests first',
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
        shouldSucceed: true,
      }),
    TEST_TIMEOUT_MS,
  )
})
