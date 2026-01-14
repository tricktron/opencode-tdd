# Architecture: opencode-tdd

## Problem Statement

Enforce TDD for AI coding agents by intercepting edit/write operations and blocking them unless the Red-Green-Refactor cycle is followed.

## E2E Testing Strategy

SDK-driven end-to-end tests start an opencode server/client programmatically, trigger an edit via prompt, and verify the TDD plugin allow/block behavior by observing SDK events (`message.part.updated` with error status).

## Key Decisions

- Use `createOpencode()` from SDK to start server+client in-process for tests
- Set process cwd to fixture root so config/plugin loading mirrors real usage
- Rely on fixture `opencode.json` for model/provider settings (no SDK config overrides)
- Use `session.promptAsync()` + SSE events for non-blocking prompts:
  - `promptAsync()` returns HTTP 204 immediately, prompt runs in background
  - SSE `session.idle` event signals completion
  - Subscribe to SSE **before** calling `promptAsync()` to avoid missing events
- Assert outcomes via SDK events (tool errors surface in `message.part.updated` with `state.status: "error"`)

## Plugin LLM Access

The plugin needs to make LLM calls for GREEN phase verification. Key insight:

- The `client` passed to plugins is **always available** (not optional in `PluginInput`)
- It's an OpenCode SDK client with `session.create` and `session.prompt` methods
- **Do NOT use raw HTTP fetch** - the server API is internal and undocumented
- Use the SDK client to create child sessions for verification:

```typescript
// Create child session
const result = await client.session.create({
  body: { title: 'TDD Verifier', parent: parentSessionId },
})

// Send prompt and wait for response
const response = await client.session.prompt({
  path: { id: childId },
  body: {
    model: { providerID, modelID },
    parts: [{ type: 'text', text: prompt }],
  },
})

// Extract text from response.data.parts
// Clean up child session when done
```

This approach:

- Works reliably in E2E tests
- Reuses the same model/provider configuration
- Properly integrates with OpenCode's session management

For unit tests, inject a mock client with a `chat` method via the same `client` parameter. The `resolveLlmClient` function duck-types to detect mock vs real SDK client at runtime. This is a pragmatic solution given the Plugin interface from `@opencode-ai/plugin` doesn't allow custom parameters for dependency injection.

## Observability

Non-fatal errors are logged via `client.app.log()` using the `safeLog` helper in `src/logger.ts`. Log levels: error (config failures), warn (audit failures), debug (session cleanup). Logging never throws and handles missing logger gracefully.

## Test Isolation Strategy

To ensure tests can run together without side effects:

- **Random port allocation**: Use `port: 0` to let OS assign available ports
- **Clean shared state**: `afterEach` hook restores fixture state:
  - Git restore source files that LLM may edit
  - Remove test output files (`.opencode/tdd/smoke-test-output.txt`)
- **Process cwd restoration**: Always restore in `finally` blocks
- **Server cleanup**: Always close server in `finally` blocks

These measures prevent:

- Port conflicts between tests
- State leakage via log files
- Source file mutations persisting between tests
- Process state corruption

## Outside-In TDD Enforcement

The plugin supports outside-in TDD (GOOS style) where one "guiding" acceptance test may remain red while inner tests follow strict TDD.

### Test Hierarchy

| Level       | Scope                            | Rule                                    |
| ----------- | -------------------------------- | --------------------------------------- |
| Acceptance  | End-to-end, user-facing behavior | Max 1 red at a time, acts as north star |
| Integration | Component interaction            | Strict TDD: 0 or 1 red                  |
| Unit        | Single component isolation       | Strict TDD: 0 or 1 red                  |

### Decision Logic (LLM-based)

All edits go through the verifier LLM. No heuristic-based fast paths. The LLM:

1. Parses test output to count failing tests by scope
2. Classifies the edit (test/impl/refactor) and scope
3. Applies rules:
   - `acceptanceFailingTests > 1` → block
   - `innerFailingTests > 1` → block
   - Adding acceptance test while one is red → block
   - Adding inner test while one is red → block
   - Implementation with 0 inner failing tests → block (write test first)
   - Implementation with 1 inner failing test → allow
   - Modifying the red acceptance test → allow (refinement ok)
   - Refactoring → allow

### Why LLM-only

- Acceptance vs inner test distinction requires understanding intent, not pattern matching
- Test output formats vary across frameworks - LLM handles all
- Single decision point, no brittle heuristics
- Full test output already sent to verifier

## Out of Scope

- TUI automation or slash command flows
- Permission request API validation
- Verifying actual file diffs as primary signal

## C4 Model

See [architecture.dsl](architecture.dsl) for formal C4 model.
