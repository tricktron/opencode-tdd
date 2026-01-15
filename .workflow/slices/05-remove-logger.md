# Slice: Remove Logger

## Status

COMPLETE

## Layer

middle - cleanup of unused component

## User Story

As a plugin maintainer, I want to remove the redundant logger because errors are surfaced through OpenCode's tool error mechanism and audit.jsonl covers LLM verification, so that the codebase has fewer concepts to maintain.

## Acceptance Criteria

- [x] Given plugin throws an error, when tool executes, then error surfaces via `message.part.updated` event with `state.status: "error"`
- [x] Given logger is removed, when tests run, then all tests pass
- [x] Given E2E tests, when asserting on blocked edits, then assertions use tool error events instead of log files
- [x] Given audit.jsonl exists, when GREEN phase verification occurs, then LLM interactions are still recorded

## Architecture Context

- This slice removes: Logger component, `src/logger.ts`
- Depends on: Spike confirmed errors surface via tool events
- Affects: E2E tests need refactoring to use event-based assertions
- No new concepts introduced (this is a deletion)

## Technical Approach

1. Update E2E tests to assert on `message.part.updated` events:
   - Filter for `part.type === "tool"` and `part.state.status === "error"`
   - Assert `part.state.error` contains expected message

2. Remove logger from codebase:
   - Delete `src/logger.ts`
   - Remove logger creation from `src/index.ts`
   - Remove `Logger` type from `TDDContext`
   - Remove all `ctx.logger.*` calls

3. Remove logger unit tests from `test/index.test.ts`

4. Verify all tests pass

## Out of Scope

- Changing audit.jsonl behavior

## Superseded By

Slice 06 (Structured Logging) re-introduced `src/logger.ts` as a shared module for `client.app.log()` integration. This is different from the original logger (file-based) - the new logger uses SDK's app.log API for observability.

## Test Strategy

- E2E tests: Refactor to use event-based assertions
- Unit tests: Remove logger tests, keep all other tests
- Run full test suite to verify nothing breaks

## Technical Notes

- Tool errors surface via: `message.part.updated` with `part.state.status === "error"`
- Error message is in: `part.state.error`
- No `session.error` event for plugin errors (verified by spike)
