---
date: 2026-01-16T00:00:00Z
topic: 'Plugin errors are thrown and blocked correctly, but the driving LLM does not see the error message. How does error propagation work from tool.execute.before to the LLM conversation context?'
agents: [codebase-locator, codebase-analyzer, codebase-patterns]
---

# Research: Plugin Error Propagation to LLM

## Problem Statement

The TDD plugin correctly throws errors like:

```
Error: TDD: Invalid verifier response (got: "I need to analyze the test output...")
```

The edit IS blocked. The error IS visible in SSE events (`message.part.updated` with `state.status: "error"`). However, the **driving LLM does not see this error** and thus does not react to it.

## Key Files (opencode-tdd plugin)

### Error Throwing

- `src/index.ts:148-162` - `verifyWithLlm()` wraps errors with `TDD:` prefix
- `src/index.ts:186-214` - `tool.execute.before` hook throws to block edits
- `src/verifier.ts:53-67` - `parseResponse()` throws on invalid format

### E2E Test Assertions

- `test/e2e/tdd-enforcement.test.ts:30-55` - `waitForToolError()` asserts on SSE events

## Current Behavior

1. Plugin throws `Error('TDD: ...')` from `tool.execute.before` hook
2. OpenCode runtime catches the error
3. SSE event emitted: `message.part.updated` with:
   - `part.type: "tool"`
   - `part.state.status: "error"`
   - `part.state.error: "TDD: ..."` (the error message)
4. Tool execution is blocked
5. **LLM does NOT receive the error message in its conversation context**

## SDK Analysis

The `@opencode-ai/sdk` (v1.1.20) contains only HTTP client wrappers. The actual hook execution and error handling happens in the `opencode` Go binary.

### Available Hooks

From `@opencode-ai/plugin`:

```typescript
"tool.execute.before"?: (input: {
  tool: string;
  sessionID: string;
  callID: string;
}, output: {
  args: any;
}) => Promise<void>;

"tool.execute.after"?: (input: {
  tool: string;
  sessionID: string;
  callID: string;
}, output: {
  title: string;
  output: string;  // The tool result
  metadata: any;
}) => Promise<void>;
```

No `stop` hook exists.

## Open Questions for OpenCode Runtime

### Q1: Does throwing from `tool.execute.before` return error to LLM?

When `tool.execute.before` throws:

- Does the error message become the tool_result sent back to the LLM?
- Or is it only surfaced via SSE events (for TUI/observability)?

**Expected behavior (like file-changed-since-read):**

```
Tool: edit
Result: Error: File has been modified since last read. Please read the file again.
```

The LLM sees this and reacts. Our TDD errors should work the same way.

### Q2: Is there a difference between built-in tool errors and plugin hook errors?

Built-in tools (edit, write) return error strings that the LLM sees. Do plugin hook errors get the same treatment?

### Q3: Does `tool.execute.after` run when `tool.execute.before` throws?

If yes, we could potentially use it to inject error context. If no, this isn't an option.

### Q4: Can we inject error as user message?

Alternative approach:

```typescript
'tool.execute.before': async (input, output) => {
  try {
    await verifyWithLlm(...)
  } catch (error) {
    // Option: Send error as user message before throwing?
    await client.session.prompt({
      path: { id: input.sessionID },
      body: { parts: [{ type: 'text', text: `TDD Error: ${error.message}` }] }
    })
    throw error
  }
}
```

Is this the intended pattern? Or should throwing be sufficient?

## Comparison: File-Changed-Since-Read Error

When the built-in `edit` tool detects the file changed since last read:

1. Tool returns error string as result
2. LLM receives error in conversation
3. LLM reacts by reading file again

This is the behavior we need for TDD errors. The question is whether plugin hook errors follow the same path.

## Hypothesis

The SSE event (`message.part.updated` with error) is for TUI/observability. The tool_result sent to the LLM may be different - possibly empty or a generic error, not the specific error message from the plugin.

## Requested Clarification

1. How does the opencode runtime handle errors thrown from `tool.execute.before`?
2. Is the error message returned to the LLM as the tool_result?
3. If not, what is the intended pattern for plugins to communicate errors to the LLM?

## References

- Plugin hook types: `node_modules/@opencode-ai/plugin/dist/index.d.ts`
- E2E test showing SSE events work: `test/e2e/tdd-enforcement.test.ts:41-49`
- Error throwing: `src/index.ts:160`
