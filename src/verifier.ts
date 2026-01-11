import type { Auditor } from './auditor'

export type LlmClient = {
  chat: (
    model: string,
    messages: Array<{ role: string; content: string }>,
  ) => Promise<string>
}

export type VerifyEditOptions = {
  client: LlmClient
  model: string
  filePath: string
  editContent: string
  testOutput: string
  auditor?: Auditor
}

const SYSTEM_PROMPT = `You are a TDD (Test-Driven Development) compliance verifier.

Analyze the file edit and determine:
1. Is this edit adding/modifying TEST code or IMPLEMENTATION code?
2. If implementation: does it follow TDD rules?

TDD Rules for GREEN phase (all tests passing):
- Adding new test code: ALLOWED (starting next RED phase)
- Refactoring without new behavior: ALLOWED
- Adding new implementation behavior: BLOCKED (Write a failing test first)

Respond with JSON only (no markdown, no code blocks):
{
  "editType": "test" | "impl",
  "decision": "allow" | "block",
  "reason": "brief explanation"
}

If editType is "test", decision is ignored (tests always allowed in GREEN).
For implementation edits in GREEN phase, use reason: "Write a failing test first".`

const extractJson = (response: string): string => {
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/)
  return codeBlockMatch ? codeBlockMatch[1].trim() : response
}

type ParsedResponse = {
  editType?: 'test' | 'impl'
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
  const decision =
    parsed.editType === 'test' || parsed.decision === 'allow'
      ? 'allow'
      : 'block'
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
    } catch {
      // Audit failure should not affect verification
    }
  }

  if (parsed.editType === 'test') {
    return
  }

  if (parsed.decision !== 'allow') {
    throw new Error(parsed.reason ?? 'Write a failing test first')
  }
}
