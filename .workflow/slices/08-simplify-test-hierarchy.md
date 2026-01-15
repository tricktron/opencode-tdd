# Slice: Simplify Test Hierarchy to Two Categories

**Status: COMPLETE**

## Layer

middle - simplifies verifier schema and prompt

## User Story

As an outside-in TDD practitioner, I want a simpler two-category test model (acceptance + unit), so that there's less ambiguity about test classification.

## Acceptance Criteria

- Given verifier prompt, when LLM classifies a test, then `testScope` is either "acceptance" or "unit" (no "integration")
- Given verifier response schema, when parsing, then `innerFailingTests` is renamed to `unitFailingTests`
- Given existing unit tests with "integration" scope, when updated, then they use "unit" scope instead
- Given all changes, when tests run, then all tests pass

## Architecture Context

- This slice modifies: `src/verifier.ts` (prompt + schema), `test/index.test.ts` (mock responses)
- Depends on: slice 07 (outside-in TDD enforcement)
- Simplifies: test scope from 3 categories to 2

## Technical Notes

### Schema change

```typescript
// Before
testScope?: 'acceptance' | 'integration' | 'unit'
innerFailingTests: number

// After
testScope?: 'acceptance' | 'unit'
unitFailingTests: number
```

### Prompt update

Remove integration from Test Scopes section:

```
Test Scopes:
- Acceptance: guides the slice, verifies user-facing behavior end-to-end
- Unit: drives implementation, tests components in isolation or together
- When ambiguous, treat as unit test (stricter rule)
```

### Test updates

Update all mocked responses:

- `testScope: 'integration'` → `testScope: 'unit'`
- `innerFailingTests` → `unitFailingTests`

## Out of Scope

- Changing acceptance test rules
- Changing blocking logic (just renaming)
