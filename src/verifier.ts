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

Respond with JSON only (no markdown, no code blocks):
{
  "editType": "test" | "impl" | "refactor",
  "testScope": "acceptance" | "unit" | undefined,
  "acceptanceFailingTests": number,
  "unitFailingTests": number,
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
  testScope?: 'acceptance' | 'unit'
  acceptanceFailingTests?: number
  unitFailingTests?: number
  decision?: string
  reason?: string
}

const parseResponse = (response: string): ParsedResponse => {
  try {
    const json = extractJson(response)
    return JSON.parse(json) as ParsedResponse
  } catch {
    const truncated = response.slice(0, 100)
    const suffix = response.length > 100 ? '...' : ''
    throw new Error(`Invalid verifier response (got: "${truncated}${suffix}")`)
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

  let parsed: ParsedResponse
  try {
    parsed = parseResponse(response)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown parse error'

    // Audit parse failure before throwing
    if (opts.auditor) {
      try {
        await opts.auditor.record({
          timestamp: new Date().toISOString(),
          filePath: opts.filePath,
          prompt,
          response,
          decision: 'block',
          reason: errorMessage,
          status: 'parse_error',
          errorType: errorMessage,
        })
      } catch (auditError) {
        safeLog(opts.client.app, 'warn', 'Failed to write audit entry', {
          filePath: opts.filePath,
          error: formatError(auditError),
        })
      }
    }

    throw error
  }

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
        status: 'success',
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
