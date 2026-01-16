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
1. Count failing tests by scope (acceptance vs unit)
2. Classify edit type (test, implementation, or refactor)
3. Apply outside-in TDD rules

Test Scopes:
- Acceptance: guides the slice, verifies user-facing behavior end-to-end
- Unit: drives implementation, tests components in isolation or together
- When ambiguous, treat as unit test (stricter rule)

Outside-In TDD Rules:
- acceptanceFailingTests > 1 → BLOCK
- unitFailingTests > 1 → BLOCK
- Adding acceptance test while one is red → BLOCK
- Adding unit test while one is red → BLOCK
- Implementation with 0 unit failing tests → BLOCK (write test first)
- Implementation with 1 unit failing test → ALLOW
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
