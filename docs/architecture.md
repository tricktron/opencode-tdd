# Architecture: opencode-tdd

## Problem Statement

Enforce TDD for AI coding agents by intercepting edit/write operations and blocking them unless the Red-Green-Refactor cycle is followed.

## E2E Testing Strategy

SDK-driven end-to-end tests start an opencode server/client programmatically, trigger an edit via prompt, and verify the TDD plugin allow/block behavior by observing log output.

## Key Decisions

- Use `createOpencode()` from SDK to start server+client in-process for tests
- Set process cwd to fixture root so config/plugin loading mirrors real usage
- Rely on fixture `opencode.json` for model/provider settings (no SDK config overrides)
- Use `session.promptAsync()` + SSE events for non-blocking prompts:
  - `promptAsync()` returns HTTP 204 immediately, prompt runs in background
  - SSE `session.idle` event signals completion
  - Subscribe to SSE **before** calling `promptAsync()` to avoid missing events
- Assert outcomes via `.opencode/tdd/tdd.log` contents
- Use `Promise.race(log polling, session.idle)` for reliability when plugin blocks before LLM runs

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

For unit tests, inject a mock client with a `chat` method - the plugin detects this and uses it directly instead of the SDK adapter.

## Test Isolation Strategy

To ensure tests can run together without side effects:

- **Random port allocation**: Use `port: 0` to let OS assign available ports
- **Clean shared state**: `afterEach` hook restores fixture state:
  - Git restore source files that LLM may edit
  - Remove log files (`.opencode/tdd/tdd.log`)
  - Remove test output files (`.opencode/tdd/smoke-test-output.txt`)
- **Process cwd restoration**: Always restore in `finally` blocks
- **Server cleanup**: Always close server in `finally` blocks

These measures prevent:

- Port conflicts between tests
- State leakage via log files
- Source file mutations persisting between tests
- Process state corruption

## Out of Scope

- TUI automation or slash command flows
- Permission request API validation
- Verifying actual file diffs as primary signal

## C4 Model

See [architecture.dsl](architecture.dsl) for formal C4 model.
