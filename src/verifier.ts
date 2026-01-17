import type { Auditor } from './auditor'

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
    messages?: (opts: { path: { id: string } }) => Promise<{
      data?: Array<SessionMessage>
      error?: unknown
    }>
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

type TestDetails = { command: string; output: string } | null

type SessionMessage = {
  info: { id: string; role: string }
  parts: Array<MessagePart>
}

type MessagePart = { type: 'text'; text: string } | BashToolPart

type BashToolPart = {
  type: 'tool'
  tool: string
  input?: { command?: string }
  state?: { status?: string; output?: string }
}

const findBashToolPart = (parts: Array<MessagePart>): BashToolPart | null => {
  for (const part of parts) {
    if (part.type !== 'tool') continue

    const toolPart = part as BashToolPart
    if (toolPart.tool === 'bash' && toolPart.state?.status === 'completed') {
      return toolPart
    }
  }
  return null
}

export const extractTestDetails = async (
  sdkClient: SdkClient,
  sessionId: string,
): Promise<TestDetails> => {
  if (!sdkClient.session.messages) {
    return null
  }

  const messagesResult = await sdkClient.session.messages({
    path: { id: sessionId },
  })

  if (!messagesResult.data) {
    return null
  }

  for (const msg of messagesResult.data) {
    const bashPart = findBashToolPart(msg.parts)
    if (bashPart) {
      return {
        command: bashPart.input?.command || '',
        output: bashPart.state?.output || '',
      }
    }
  }

  return null
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

      const parsed = parseResponse(response)

      if (opts.auditor) {
        // Extract test execution details from session messages
        const testDetails = await extractTestDetails(opts.sdkClient, childId)
        if (testDetails) {
          testCommand = testDetails.command
          testOutput = testDetails.output
        }

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
