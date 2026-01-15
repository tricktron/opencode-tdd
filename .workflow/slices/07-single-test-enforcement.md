# Slice: Outside-In TDD Enforcement via LLM

**Status: COMPLETE**

## Layer

middle - replaces heuristic logic with LLM-based decision making

## User Story

As an outside-in TDD practitioner, I want the plugin to allow one guiding acceptance test to remain red while enforcing strict TDD for inner tests, so that I can practice GOOS-style development.

## Acceptance Criteria

### Acceptance test rules

- Given 0 red acceptance tests, when adding 1 acceptance test, then allow
- Given 1 red acceptance test, when adding another acceptance test, then block with "Finish current feature first"
- Given 1 red acceptance test, when modifying that acceptance test, then allow (refinement ok)

### Inner test rules (integration/unit)

- Given 0 red inner tests, when adding 1 inner test, then allow
- Given 1 red inner test, when adding another inner test, then block with "Fix failing test first"

### Implementation rules

- Given 0 red inner tests, when adding implementation, then block with "Write a failing test first"
- Given 1 red inner test, when adding implementation, then allow
- Given 1 red acceptance + 0 red inner, when adding implementation, then block with "Write a failing test first"

### Refactoring

- Given all inner tests green, when refactoring, then allow

## Architecture Context

- This slice modifies: `src/verifier.ts` (prompt + response schema), `src/index.ts` (remove countFailingTests, always call verifier)
- Depends on interfaces from: existing verifier infrastructure
- Defines interfaces for: none
- Removes: `countFailingTests` function, RED phase fast path

## Out of Scope

- Config-based test scope identification (LLM infers from context)
- Multiple acceptance tests for parallel features
- Test file naming conventions

## Technical Notes

### New verifier response schema

```typescript
type VerifierResponse = {
  editType: 'test' | 'impl' | 'refactor'
  testScope?: 'acceptance' | 'integration' | 'unit' // when editType === "test"
  acceptanceFailingTests: number
  innerFailingTests: number
  decision: 'allow' | 'block'
  reason: string
}
```

### Prompt guidance for LLM

The prompt should clarify:

- Acceptance tests: verify user-facing behavior end-to-end, broader scope
- Integration tests: verify component interaction
- Unit tests: verify single component in isolation
- When ambiguous, treat as inner test (stricter rule)

### Changes to index.ts

1. Remove `countFailingTests` function
2. Remove RED phase early return (lines 161-163)
3. Always call `verifyWithLlm` after getting test output
4. Let verifier handle all blocking decisions
