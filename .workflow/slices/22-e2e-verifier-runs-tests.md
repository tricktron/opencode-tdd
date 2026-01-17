# Slice 22: E2E Verifier Runs Tests (Make It Pass)

## Goal

Make the E2E test pass to verify the plugin still works after slice 21 changes (verifier runs tests directly). The test worked before commits `83664ab` and `1153b23`, so we need to restore that confidence level.

## User Story

As a maintainer, I want the E2E test to pass at least once, so that I have confidence the plugin works end-to-end with the real SDK.

## Acceptance Criteria

1. E2E test runs without being skipped
2. LLM receives prompt to edit `src/foo.ts`
3. Verifier creates child session with bash tool access
4. Verifier runs `bun test` and sees 1 failing test
5. Verifier allows edit (1 red test satisfies TDD)
6. Session reaches idle state within 60 seconds
7. Test passes (may be non-deterministic, but should pass at least once)

## Current State

- E2E test exists in `test/e2e/tdd-enforcement.test.ts` (not skipped)
- Fixture has failing test: `test/foo.test.ts` expects `foo === 2`, but `foo === 1`
- Timeout: 65 seconds
- Verifier already passes `tools: { bash: true }` (from commit `1153b23`)

## Test Scenario

### 1. Acceptance: Full E2E flow completes successfully

```
Given: Fixture with failing test (foo should be 2, but is 1)
And: LLM has access to bash tool
When: LLM prompted to "Add a comment above foo export in src/foo.ts"
Then: LLM attempts to edit src/foo.ts
And: Plugin hook intercepts edit
And: Verifier creates child session with bash access
And: Verifier runs tests (discovers 1 failing test)
And: Verifier allows edit (1 red test = valid TDD state)
And: Edit succeeds
And: Session becomes idle
And: E2E test passes
```

## Potential Issues to Fix

1. **Verifier prompt clarity**: Does the verifier prompt clearly instruct the LLM to run tests first?
2. **Test discovery**: Can the verifier LLM find and run the test file?
3. **Working directory**: Is the verifier running tests in the correct directory?
4. **Model capability**: Does `minimax-m2.1-free` understand the verifier prompt and bash tool?
5. **Timeout tuning**: Is 60 seconds enough for LLM + test execution?

## Implementation Approach

1. Run the E2E test manually: `bun test test/e2e/tdd-enforcement.test.ts`
2. If it fails, examine logs/audit trail to identify the issue
3. Fix the identified issue (update verifier prompt, adjust timeout, etc.)
4. Iterate until test passes at least once
5. Document any brittleness or known issues

## Success Criteria

- Test passes **at least once** when run manually
- We understand what made it pass (not just random success)
- If non-deterministic, document why and what % success rate is acceptable

## Out of Scope

- Making the test 100% deterministic (acceptable if it passes most of the time)
- Testing BLOCK scenario
- Multiple test files or complex fixtures
