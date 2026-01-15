# Slice: SDK Block Edit

**Status: COMPLETE**

## Layer

outer - SDK-driven e2e test using a fixture workspace

## User Story

As an opencode plugin author, I want a SDK-based e2e test that blocks an edit when test output is missing, so I can verify the TDD rule triggers correctly.

## Acceptance Criteria

- [x] Given the fixture workspace is the process cwd and the test output file is missing,
      when the SDK starts opencode and `session.prompt` asks to add a comment to `src/foo.ts`,
      then the tool error event contains "Run tests first".
- [x] The server is disposed after the test to avoid port conflicts.

## Architecture Context

- This slice implements: SDK Harness + TDD Log Assertion (block path)
- Depends on interfaces from: none
- Defines interfaces for: `02-sdk-allow-edit.md`
- New concepts introduced: none

## Out of Scope

- Allow path behavior
- Permission API validation

## Technical Notes

- Use `createOpencode()` with a fixed host/port.
- Use `session.promptAsync()` + SSE events for non-blocking prompt execution:
  ```typescript
  await client.session.promptAsync({ path: { id }, body: { parts: [...] } })
  const { stream } = await client.event.subscribe()
  for await (const event of stream) {
    if (event.type === "session.idle" && event.properties.sessionID === id) break
  }
  ```
- Assert using `message.part.updated` events with `state.status: "error"`.
