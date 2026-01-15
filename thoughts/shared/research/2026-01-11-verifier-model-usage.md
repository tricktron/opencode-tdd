---
date: 2026-01-11T00:00:00Z
topic: 'Is the configured verifierModel actually used by the verifier? How does the verifier work? Is it a new subagent? Does it run with the same agent? Does it create a new session?'
agents: [codebase-locator, codebase-analyzer, codebase-patterns]
---

# Research: Verifier Model Usage and Architecture

## Key Files

### Configuration

- `src/config.ts:7,55,64` - verifierModel type definition, validation, and export
- `.opencode/tdd.json` - Runtime config file (verifierModel string)

### Implementation

- `src/verifier.ts:60-105` - `verifyEdit()` - Core verification logic
- `src/index.ts:43-91` - `createSdkAdapter()` - Child session creation
- `src/index.ts:93-101` - `resolveLlmClient()` - Mock vs SDK resolution
- `src/index.ts:152-169` - `verifyWithLlm()` - Verification entry point

### Tests

- `test/index.test.ts:8-21` - Mock client pattern
- `test/e2e/tdd-enforcement.test.ts:118-126` - Session creation in E2E

## How It Works

### Q1: Is verifierModel actually used?

**Yes.** Direct usage path:

1. Config loaded: `index.ts:183` → `loadConfig(projectRoot)`
2. Passed to context: `index.ts:159` → `model: ctx.config.verifierModel`
3. Used in LLM call: `verifier.ts:65` → `opts.client.chat(opts.model, [...])`
4. Model parsed in adapter: `index.ts:54` → `const [providerId, modelId] = model.split('/')`
5. Sent to SDK: `index.ts:70` → `model: { providerID: providerId, modelID: modelId }`

### Q2: How does the verifier work?

1. **Entry**: `verifyEdit()` at `verifier.ts:60`
2. **Prompt**: Combines file path + edit content + test output (`verifier.ts:61`)
3. **LLM Call**: System prompt defines TDD rules, expects JSON response (`verifier.ts:64-72`)
4. **Parse**: Extracts JSON from response (`verifier.ts:74`)
5. **Decision**: Allow if `editType === 'test'` OR `decision === 'allow'`, else block (`verifier.ts:75-80`)
6. **Audit**: Records entry if auditor present (`verifier.ts:82-96`)
7. **Enforce**: Throws error if blocked (`verifier.ts:102-104`)

### Q3: Is it a new subagent?

**Yes.** The verifier runs as a child session, not the same agent.

- `index.ts:56-58` creates new session: `await sdkClient.session.create({ body: { title: 'TDD Verifier', parent: parentSessionId } })`
- `index.ts:67-73` sends prompt to child session
- `index.ts:88` deletes child session in finally block

### Q4: Does it create a new session?

**Yes.** Every verification creates and destroys an isolated child session:

1. **Creation** (`index.ts:56-62`): Parent is main agent's `input.sessionID` from plugin hook
2. **Usage** (`index.ts:67-80`): Single prompt sent
3. **Deletion** (`index.ts:87-89`): Always in finally block, cleanup guaranteed

## Existing Patterns

### SDK Adapter Pattern (`index.ts:43-91`)

```typescript
const createSdkAdapter = (sdkClient: SdkClient, parentSessionId: string): LlmClient => ({
  chat: async (model, messages) => {
    const [providerId, modelId] = model.split('/')
    const sessionResult = await sdkClient.session.create({
      body: { title: 'TDD Verifier', parent: parentSessionId },
    })
    const childId = sessionResult.data.id
    try {
      const promptResult = await sdkClient.session.prompt({ path: { id: childId }, body: { model: { providerID: providerId, modelID: modelId }, parts: [...] } })
      return textPart.text
    } finally {
      await sdkClient.session.delete({ path: { id: childId } }).catch(() => {})
    }
  },
})
```

### Client Resolution Pattern (`index.ts:93-101`)

```typescript
const resolveLlmClient = (client: unknown, sessionId: string): LlmClient => {
  const mockClient = client as LlmClient | undefined
  if (mockClient && typeof mockClient.chat === 'function') {
    return mockClient // Unit tests bypass session creation
  }
  return createSdkAdapter(client as SdkClient, sessionId) // Real usage
}
```

### LlmClient Interface (`verifier.ts:3-8`)

```typescript
export type LlmClient = {
  chat: (
    model: string,
    messages: Array<{ role: string; content: string }>,
  ) => Promise<string>
}
```

## Data Flow Summary

```
Plugin hook (index.ts:176)
  → input.sessionID (parent)
  → loadConfig() gets verifierModel (index.ts:183)
  → verifyWithLlm() (index.ts:152)
  → verifyEdit(model: ctx.config.verifierModel) (index.ts:159)
  → createSdkAdapter creates child session (index.ts:56)
  → opts.client.chat(opts.model, ...) (verifier.ts:65)
  → Child session deleted (index.ts:88)
```

## Open Questions

None - the implementation is clear:

1. **verifierModel is used**: Config → context → verifyEdit → SDK adapter → session.prompt
2. **New subagent**: Child session with `parent: parentSessionId`
3. **Ephemeral session**: Created per-verification, deleted in finally block
