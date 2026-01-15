# Slice: SDK GREEN Block Non-Test Edit

**Status: COMPLETE**

## Layer

outer - SDK-driven e2e test using a fixture workspace

## User Story

As an opencode plugin author, I want a SDK-based e2e test that blocks a non-test edit when all tests pass, so I can verify the GREEN-phase LLM verification rule.

## Acceptance Criteria

- [x] Given the fixture workspace is the process cwd and the test output file contains 0 FAILs,
      when the SDK starts opencode and `session.prompt` asks to add a comment to `src/foo.ts`,
      then `.opencode/tdd/tdd.log` contains "Blocked" and "Write a failing test".
- [x] The server is disposed after the test to avoid port conflicts.

## Architecture Context

- This slice implements: TDD Log Assertion (GREEN block path)
- Depends on interfaces from: `01-sdk-block-edit.md`, `02-sdk-allow-edit.md`
- Defines interfaces for: none
- New concepts introduced: SDK client adapter for LLM verification

## Implementation Notes

### Changes Made

1. **`src/index.ts`**: Added `createSdkAdapter` function that uses the OpenCode SDK client
   to make LLM verification calls via child sessions.

2. **`src/verifier.ts`**: Updated error messages for better debugging.

3. **`test/e2e/sdk-block-edit.test.ts`**: Added third test case for GREEN phase blocking.

### Key Discovery

The OpenCode SDK client passed to plugins has `session.create` and `session.prompt` methods
that can be used to make LLM calls from within plugins. The adapter:

1. Creates a child session with the parent session ID
2. Sends the verification prompt via `session.prompt`
3. Extracts the text response from the result
4. Cleans up the child session

## Out of Scope

- GREEN allow path (test file edits)
- Permission API validation
