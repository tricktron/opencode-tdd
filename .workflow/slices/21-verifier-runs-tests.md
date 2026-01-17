# Slice 21: Verifier Runs Tests

## Goal

Replace session history query with verifier running tests directly. Eliminates brittleness from "last 5 bash outputs" heuristic which may contain stale or irrelevant commands.

## User Story

As an opencode-tdd user, I want the verifier to run the relevant tests itself before making a decision, so that it always has fresh, accurate test output for the edited file.

## Acceptance Criteria

1. When edit is attempted, verifier session has bash tool access
2. Verifier determines which tests to run based on the edited file
3. Verifier runs tests and uses that output for ALLOW/BLOCK decision
4. Verifier session times out after 60 seconds, defaulting to BLOCK
5. Audit log includes test commands executed and their output
6. `getTestOutputFromSession` logic is removed

## Test Scenarios (Outside-In)

### 1. Acceptance: Block when all tests pass (no red test)

```
Given: Project with passing tests
And: Edit to implementation file `src/foo.ts`
When: Verifier runs tests
Then: Edit blocked with "write test first"
```

**Why first**: Core TDD enforcement - can't add implementation without failing test.

### 2. Acceptance: Allow when 1 red test exists

```
Given: Project with 1 failing unit test for `src/foo.ts`
And: Edit to `src/foo.ts` adding implementation
When: Verifier runs tests
Then: Edit allowed
```

**Why second**: Completes the happy path - red test enables implementation.

### 3. Acceptance: Block on timeout

```
Given: Tests hang indefinitely
And: Edit attempted
When: 60 seconds elapse
Then: Edit blocked with "Verification timed out"
And: Verifier session cleaned up
```

**Why third**: Fail-safe behavior - unknown state defaults to block.

### 4. Unit: Audit includes test execution details

```
Given: Verifier runs `npm test -- foo.test.ts`
When: Decision recorded
Then: Audit entry contains:
  - testCommand: "npm test -- foo.test.ts"
  - testOutput: <actual output>
  - decision: "allow" | "block"
```

### 5. Unit: Child session cleanup

```
Given: Verifier session created
When: Verification completes (success, block, or timeout)
Then: Child session deleted
```

## Implementation Notes

- Replace `createSdkAdapter` with session that has bash tool access
- Verifier prompt: identify tests for edited file, run them, apply TDD rules
- Timeout via `Promise.race` with 60s timer
- Delete `getTestOutputFromSession`, `getTestOutput` functions
- Extend `AuditEntry` type with `testCommand` and `testOutput` fields

## Out of Scope

- `testCommand` config (LLM infers from project structure)
- Explicit test file mapping config
- Custom timeout config (hardcode 60s)
