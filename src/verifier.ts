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

Analyze the file edit and test output to determine:
1. Parse test output to count failing tests by scope
2. Classify edit type and scope
3. Apply outside-in TDD rules

Test Scopes:
- Acceptance: end-to-end user behavior (broader scope)
- Integration: component interaction
- Unit: single component isolation
- When ambiguous, treat as inner test (stricter rule)

Outside-In TDD Rules:
- acceptanceFailingTests > 1 → BLOCK
- innerFailingTests > 1 → BLOCK
- Adding acceptance test while one is red → BLOCK
- Adding inner test while one is red → BLOCK
- Implementation with 0 inner failing tests → BLOCK (write test first)
- Implementation with 1 inner failing test → ALLOW
- Modifying the red acceptance test → ALLOW (refinement ok)
- Refactoring → ALLOW

Respond with JSON only (no markdown, no code blocks):
{
  "editType": "test" | "impl" | "refactor",
  "testScope": "acceptance" | "integration" | "unit" | undefined,
  "acceptanceFailingTests": number,
  "innerFailingTests": number,
  "decision": "allow" | "block",
  "reason": "brief explanation"
}

testScope is required when editType is "test", undefined otherwise.`

const extractJson = (response: string): string => {
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/)
  return codeBlockMatch ? codeBlockMatch[1].trim() : response
}

type ParsedResponse = {
  editType?: 'test' | 'impl' | 'refactor'
  testScope?: 'acceptance' | 'integration' | 'unit'
  acceptanceFailingTests?: number
  innerFailingTests?: number
  decision?: string
  reason?: string
}

const parseResponse = (response: string): ParsedResponse => {
  try {
    const json = extractJson(response)
    return JSON.parse(json) as ParsedResponse
  } catch {
    throw new Error('Invalid verifier response')
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
  const decision = parsed.decision === 'allow' ? 'allow' : 'block'
  const reason =
    parsed.reason ?? (decision === 'block' ? 'Write a failing test first' : '')

  if (opts.auditor) {
    try {
      await opts.auditor.record({
        timestamp: new Date().toISOString(),
        filePath: opts.filePath,
        prompt,
        response,
        decision,
        reason,
      })
    } catch (error) {
      // Audit failure should not affect verification - log it
      safeLog(opts.client.app, 'warn', 'Failed to write audit entry', {
        filePath: opts.filePath,
        error: formatError(error),
      })
    }
  }

  if (decision !== 'allow') {
    throw new Error(reason)
  }
}
