---
date: 2026-01-11T00:00:00Z
topic: 'Interface abstraction for sdkClient/verifier - TypeScript best practices'
agents: [codebase-locator, codebase-analyzer, codebase-patterns]
---

# Research: Interface Abstraction for sdkClient/verifier

## Question

We use the sdkClient to create the verifier. In Go, you'd hide this behind an
interface for loose coupling and testability. What are TypeScript best practices
and should we consider introducing this here?

## Key Files

### Implementation

| File              | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `src/index.ts`    | SDK adapter, client resolution, plugin entry |
| `src/verifier.ts` | LlmClient interface, verifyEdit function     |
| `src/logger.ts`   | Logger factory with dependency injection     |

### Tests

| File                              | Purpose                        |
| --------------------------------- | ------------------------------ |
| `test/index.test.ts`              | Unit tests with mock clients   |
| `test/e2e/sdk-block-edit.test.ts` | E2E tests with real SDK client |

## How It Works

### Current Architecture

```
Plugin receives `client: unknown` (src/index.ts:190)
       ↓
resolveLlmClient() duck-types to detect mock vs SDK (src/index.ts:109-115)
       ↓
 ┌─────────────────────────────────────────────┐
 │ Mock path: client.chat exists → return as-is │
 │ SDK path: wrap in createSdkAdapter()         │
 └─────────────────────────────────────────────┘
       ↓
LlmClient interface (src/verifier.ts:1-6)
       ↓
verifyEdit() uses client.chat() (src/verifier.ts:64)
```

### LlmClient Interface (src/verifier.ts:1-6)

```typescript
export type LlmClient = {
  chat: (
    model: string,
    messages: Array<{ role: string; content: string }>,
  ) => Promise<string>
}
```

### SDK Adapter (src/index.ts:57-105)

```typescript
const createSdkAdapter = (
  sdkClient: SdkClient,
  parentSessionId: string,
): LlmClient => ({
  chat: async (model, messages) => {
    // 1. Create child session
    // 2. Send prompt
    // 3. Extract response
    // 4. Cleanup session in finally
  },
})
```

### Client Resolution (src/index.ts:109-115)

```typescript
const resolveLlmClient = (client: unknown, sessionId: string): LlmClient => {
  const mockClient = client as LlmClient | undefined
  if (mockClient && typeof mockClient.chat === 'function') {
    return mockClient // Duck typing detection
  }
  return createSdkAdapter(client as SdkClient, sessionId)
}
```

## Existing Patterns

### 1. Interface-Based Abstraction (LlmClient)

Already implemented. The `LlmClient` type defines a contract that both the SDK
adapter and test mocks implement:

```typescript
// Production: SDK adapter (src/index.ts:57-105)
const createSdkAdapter = (...): LlmClient => ({ chat: async (...) => {...} })

// Test: Mock (test/index.test.ts:9-14)
const mockClient = (response: string) => ({ chat: async () => response })
```

### 2. Factory Pattern (Logger)

```typescript
// src/logger.ts:10-25
export const createLogger = (projectRoot: string): Logger => ({
  info: (message) => log('INFO', message),
  warn: (message) => log('WARN', message),
  error: (message) => log('ERROR', message),
})
```

### 3. Context Object (TDDContext)

```typescript
// src/index.ts:145-152
type TDDContext = {
  filePath: string
  editContent: string
  config: TDDConfig
  testOutput: string
  logger: Logger
  llmClient: LlmClient // Dependency injected
}
```

## TypeScript vs Go: Best Practices Comparison

### Go Approach

```go
type LlmClient interface {
    Chat(model string, messages []Message) (string, error)
}

// Production
type SdkAdapter struct { client *SdkClient }
func (a *SdkAdapter) Chat(...) (string, error) { ... }

// Test
type MockClient struct { response string }
func (m *MockClient) Chat(...) (string, error) { return m.response, nil }
```

### TypeScript Approach (Current)

```typescript
// Type alias defines contract (structural typing)
type LlmClient = { chat: (...) => Promise<string> }

// Any object with matching shape satisfies the contract
const adapter: LlmClient = { chat: async (...) => {...} }
const mock: LlmClient = { chat: async () => "response" }
```

### Key Difference: Structural vs Nominal Typing

| Aspect         | Go (Nominal)                 | TypeScript (Structural)      |
| -------------- | ---------------------------- | ---------------------------- |
| Interface      | Explicit `interface` keyword | `type` or `interface`        |
| Implementation | Implicit satisfaction        | Duck typing (shape matching) |
| Test doubles   | Implement interface          | Any matching object literal  |
| Boilerplate    | More (struct + methods)      | Less (object literals)       |

## Assessment: Do We Need Changes?

### What We Already Have

1. **Interface abstraction**: `LlmClient` type in `src/verifier.ts:1-6`
2. **Adapter pattern**: `createSdkAdapter()` wraps SDK → LlmClient
3. **Dependency injection**: LlmClient passed via context/options
4. **Test doubles**: Simple mock objects in tests

### What We Don't Need

1. **Explicit interface declaration**: TypeScript's structural typing makes
   `type LlmClient = {...}` equivalent to Go's `interface LlmClient {...}`

2. **Formal mock framework**: Object literals with matching shape work fine:

   ```typescript
   const mock = { chat: async () => 'response' } // Valid LlmClient
   ```

3. **Separate interface file**: The type is already exported and shared

### One Potential Improvement

The duck-typing detection in `resolveLlmClient()` is slightly awkward:

```typescript
// Current (src/index.ts:109-115)
const resolveLlmClient = (client: unknown, sessionId: string): LlmClient => {
  const mockClient = client as LlmClient | undefined
  if (mockClient && typeof mockClient.chat === 'function') {
    return mockClient
  }
  return createSdkAdapter(client as SdkClient, sessionId)
}
```

**Alternative**: Make the plugin signature explicit about what it receives:

```typescript
// Option A: Plugin receives LlmClient directly (requires framework change)
type Plugin = (opts: { client: LlmClient, ... }) => ...

// Option B: Separate test entry point (adds complexity)
export const TDDPluginWithClient = (llmClient: LlmClient) => ...
```

**Verdict**: The current approach is pragmatic. Duck typing detection works,
tests are simple, and the cost of change outweighs the benefit.

## Conclusion

**No changes recommended.**

The codebase already follows TypeScript best practices for loose coupling:

1. `LlmClient` type defines the abstraction
2. `createSdkAdapter()` adapts the SDK to that abstraction
3. Tests use simple mock objects that match the type
4. Dependencies are injected via options/context

The key insight: TypeScript's structural typing gives you interface-based
abstraction without the ceremony of Go's explicit interfaces. What looks like
"duck typing" in `resolveLlmClient()` is actually the idiomatic TypeScript
approach—any object with the right shape is a valid implementation.

## Open Questions

None. The architecture is well-suited to TypeScript's type system.
