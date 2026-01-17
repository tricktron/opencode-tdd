import type { Auditor } from './auditor'
import { formatError, safeLog, type AppLogger } from './logger'

export type LlmClient = {
  chat: (
    model: string,
    messages: Array<{ role: string; content: string }>,
  ) => Promise<string>
  app?: AppLogger
}

export type VerifyEditOptions = {
  client: LlmClient
  model: string
  filePath: string
  editContent: string
  testOutput: string
  auditor?: Auditor
}

const SYSTEM_PROMPT = `You are a TDD (Test-Driven Development) compliance verifier supporting outside-in TDD.

First, analyze the edit:
1. Check if test output shows compile/syntax errors
2. Count failing tests by scope (acceptance vs unit)
3. Classify edit type (test, implementation, or refactor)
4. Apply outside-in TDD rules

Compile Error Handling:
- If test output shows compile/syntax errors (code doesn't run):
  - Fixing the compile error → ALLOW (restore runnable state)
  - Adding new implementation beyond the fix → BLOCK (write test first)
- Compile errors are NOT counted as failing tests

Test Scopes:
- Acceptance: guides the slice, verifies user-facing behavior end-to-end
- Unit: drives implementation, tests components in isolation or together
- When ambiguous, treat as unit test (stricter rule)

Outside-In TDD Rules:
- Max 1 red acceptance test, max 1 red unit test (both can be red simultaneously)
- Implementation:
  - With 1 red unit test → ALLOW
  - With 0 red unit tests and 1 red acceptance test → ALLOW (scaffolding)
  - With 0 red tests → BLOCK (write test first)
- Modifying the red acceptance test → ALLOW (refinement ok)
- Refactoring → ALLOW

Then respond with your decision:
ALLOW
or
BLOCK: <brief reason>`

type ParsedResponse = {
  decision: 'allow' | 'block'
  reason: string
}

const parseResponse = (response: string): ParsedResponse => {
  const trimmed = response.trim()

  // Search for BLOCK: anywhere (LLM often adds reasoning before)
  const blockMatch = trimmed.match(/\*{0,2}BLOCK:\*{0,2}\s*(.*)$/m)
  if (blockMatch) {
    const reason =
      blockMatch[1].replace(/^\*+|\*+$/g, '').trim() ||
      'Verification failed. Please retry this edit.'
    return { decision: 'block', reason }
  }

  // Search for ALLOW anywhere
  if (/\bALLOW\b/.test(trimmed)) {
    return { decision: 'allow', reason: '' }
  }

  // Parse error - default to actionable block reason instead of exposing internal failure
  return {
    decision: 'block',
    reason: 'Verification failed. Please retry this edit.',
  }
}

type SdkClient = {
  session: {
    create: (opts: {
      body: { title: string; parent?: string }
    }) => Promise<{ data?: { id: string }; error?: unknown }>
    prompt: (opts: {
      path: { id: string }
      body: {
        model: { providerID: string; modelID: string }
        parts: Array<{ type: string; text: string }>
        tools?: { [key: string]: boolean }
      }
    }) => Promise<{
      data?: { parts?: Array<{ type: string; text?: string }> }
      error?: unknown
    }>
    delete: (opts: { path: { id: string } }) => Promise<unknown>
  }
}

export type VerifyEditWithTestRunnerOptions = {
  sdkClient: SdkClient
  parentSessionId: string
  model: string
  filePath: string
  editContent: string
  projectRoot: string
  timeoutMs?: number
  auditor?: Auditor
}

const VERIFIER_PROMPT = `You are a TDD verification agent with bash tool access.

Your task:
1. Determine which tests to run for the edited file
2. Run those tests using the bash tool
3. Apply TDD rules based on test output
4. Respond with ALLOW or BLOCK: <reason>

TDD Rules:
- Implementation edit with 0 red tests → BLOCK: write test first
- Implementation edit with 1+ red tests → ALLOW
- Test file edit → ALLOW
- Refactoring (tests stay green) → ALLOW`

export const verifyEditWithTestRunner = async (
  opts: VerifyEditWithTestRunnerOptions,
): Promise<void> => {
  const [providerId, modelId] = opts.model.split('/')
  const timeoutMs = opts.timeoutMs ?? 60000

  const sessionResult = await opts.sdkClient.session.create({
    body: { title: 'TDD Verifier', parent: opts.parentSessionId },
  })

  if (sessionResult.error || !sessionResult.data?.id) {
    throw new Error('Failed to create verification session')
  }

  const childId = sessionResult.data.id

  let testCommand = ''
  let testOutput = ''
  let response = ''

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Verification timed out')), timeoutMs)
    })

    const verifyPromise = (async () => {
      const userPrompt = `File: ${opts.filePath}\nEdit Content:\n${opts.editContent}\n\nProject Root: ${opts.projectRoot}`

      const promptResult = await opts.sdkClient.session.prompt({
        path: { id: childId },
        body: {
          model: { providerID: providerId, modelID: modelId },
          parts: [
            {
              type: 'text',
              text: `${VERIFIER_PROMPT}\n\n${userPrompt}`,
            },
          ],
          tools: { bash: true },
        },
      })

      if (promptResult.error) {
        throw new Error('Verification prompt failed')
      }

      const textPart = promptResult.data?.parts?.find((p) => p.type === 'text')
      response = textPart?.text ?? ''

      if (!response) {
        throw new Error('No LLM response text received')
      }

      // Extract test execution details from session messages
      if ('messages' in opts.sdkClient.session) {
        const messagesResult = await (opts.sdkClient.session as any).messages({
          path: { id: childId },
        })

        if (messagesResult.data) {
          for (const msg of messagesResult.data) {
            for (const part of msg.parts) {
              if (
                part.type === 'tool' &&
                (part as any).tool === 'bash' &&
                (part as any).state?.status === 'completed'
              ) {
                testCommand = (part as any).input?.command || ''
                testOutput = (part as any).state?.output || ''
              }
            }
          }
        }
      }

      const parsed = parseResponse(response)

      if (opts.auditor) {
        await opts.auditor.record({
          timestamp: new Date().toISOString(),
          filePath: opts.filePath,
          prompt: userPrompt,
          response,
          decision: parsed.decision,
          reason: parsed.reason,
          testCommand: testCommand || undefined,
          testOutput: testOutput || undefined,
        })
      }

      if (parsed.decision !== 'allow') {
        throw new Error(parsed.reason)
      }
    })()

    await Promise.race([verifyPromise, timeoutPromise])
  } finally {
    await opts.sdkClient.session.delete({ path: { id: childId } }).catch(() => {
      // Cleanup failures are non-critical - session will eventually expire
    })
  }
}

export const verifyEdit = async (opts: VerifyEditOptions): Promise<void> => {
  const prompt = `File: ${opts.filePath}\nEdit Content:\n${opts.editContent}\n\nTest Output:\n${opts.testOutput}`

  let response: string
  try {
    response = await opts.client.chat(opts.model, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Verification failed: ${message}`)
  }

  const parsed = parseResponse(response)

  if (opts.auditor) {
    try {
      await opts.auditor.record({
        timestamp: new Date().toISOString(),
        filePath: opts.filePath,
        prompt,
        response,
        decision: parsed.decision,
        reason: parsed.reason,
      })
    } catch (error) {
      // Audit failure should not affect verification - log it
      safeLog(opts.client.app, 'warn', 'Failed to write audit entry', {
        filePath: opts.filePath,
        error: formatError(error),
      })
    }
  }

  if (parsed.decision !== 'allow') {
    throw new Error(parsed.reason)
  }
}
