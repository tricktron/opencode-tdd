export type LlmClient = {
  chat: (
    model: string,
    messages: Array<{ role: string; content: string }>,
  ) => Promise<string>
}

type VerifyResult = { allowed: true } | { allowed: false; reason: string }

const SYSTEM_PROMPT = `You are a TDD (Test-Driven Development) compliance verifier.

Analyze the file edit and determine:
1. Is this edit adding/modifying TEST code or IMPLEMENTATION code?
2. If implementation: does it follow TDD rules?

TDD Rules for GREEN phase (all tests passing):
- Adding new test code: ALLOWED (starting next RED phase)
- Refactoring without new behavior: ALLOWED
- Adding new implementation behavior: BLOCKED (write failing test first)

Respond with JSON only:
{
  "editType": "test" | "impl",
  "decision": "allow" | "block",
  "reason": "brief explanation"
}

If editType is "test", decision is ignored (tests always allowed in GREEN).`

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

export const verifyEdit = async (
  client: LlmClient,
  model: string,
  filePath: string,
  testOutput: string,
): Promise<VerifyResult> => {
  let response: string
  try {
    response = await client.chat(model, [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `File: ${filePath}\nTest Output: ${testOutput}`,
      },
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { allowed: false, reason: `Verification failed: ${message}` }
  }

  try {
    const parsed = parseResponse(response)
    if (parsed.editType === 'test') {
      return { allowed: true }
    }
    if (parsed.decision !== 'allow') {
      return { allowed: false, reason: parsed.reason ?? 'Verification blocked' }
    }
    return { allowed: true }
  } catch {
    return { allowed: false, reason: 'Invalid verifier response' }
  }
}
