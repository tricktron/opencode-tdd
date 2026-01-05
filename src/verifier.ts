export type LlmClient = {
  chat: (
    model: string,
    messages: Array<{ role: string; content: string }>,
  ) => Promise<string>
}

type VerifyResult = { allowed: true } | { allowed: false; reason: string }

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
