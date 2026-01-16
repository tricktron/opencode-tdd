---
date: 2026-01-16T00:00:00Z
topic: "Plugin errors are thrown and blocked correctly, but the driving LLM does not see the error message. How does error propagation work from tool.execute.before to the LLM conversation context?"
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

---

# Research Results (2026-01-16)

## Key Files

### Plugin Hook Execution

- `packages/opencode/src/session/prompt.ts:694-718` - `tool.execute.before/after` hooks called
- `packages/opencode/src/plugin/index.ts` - Plugin.trigger implementation

### Error Capture & Storage

- `packages/opencode/src/session/processor.ts:196-220` - `tool-error` event handler
- `packages/opencode/src/session/message-v2.ts:273-287` - ToolStateError schema

### Error → LLM Conversion

- `packages/opencode/src/session/message-v2.ts:524-532` - Error state → `output-error` part

## How It Works

```
Plugin throws → AI SDK catches → tool-error event → processor.ts:204 stores error → message-v2.ts:530 sends errorText to LLM
```

1. **prompt.ts:696-706**: `Plugin.trigger("tool.execute.before", ...)` - no try/catch, errors bubble up
2. **AI SDK internal**: Catches error, emits `tool-error` stream event
3. **processor.ts:196-220**: Handles `tool-error`, stores `state.error = (value.error).toString()` at line 204
4. **message-v2.ts:524-532**: When converting for LLM, creates `output-error` with `errorText: part.state.error`

## Existing Patterns

**File-changed-since-read** (`src/file/time.ts:54-63`):

```typescript
throw new Error(
  `File ${filepath} has been modified since it was last read.\nLast modification: ${stats.mtime.toISOString()}\nLast read: ${time.toISOString()}\n\nPlease read the file again before modifying it.`,
)
```

**Built-in tools** (read, edit, write):

```typescript
throw new Error(`File not found: ${filepath}`)
throw new Error(`Cannot read binary file: ${filepath}`)
```

All use simple `throw new Error(message)` - the message becomes `errorText` sent to LLM.

## Conclusion

**The error propagation path IS correct.** Plugin errors thrown from `tool.execute.before` should flow:

1. Plugin throws → processor.ts:204 stores → message-v2.ts:530 sends to LLM

If the TDD plugin error is NOT reaching the LLM, investigate:

1. **Is `part.state.status === "error"`?** The condition at message-v2.ts:524 must be true
2. **Is `part.state.error` populated?** The string from processor.ts:204 must exist
3. **Is the message included in the next request?** Check if the message with error part is passed to `toModelMessage()`

**Most likely issue**: The session might be **stopping before the next LLM turn** happens (due to `blocked = true` at processor.ts:216-217 for certain error types, or the stream ending).
