# Slice: Scaffolding Rule

**Status: COMPLETE**

## User Story

As an opencode-tdd plugin user, I want the verifier to allow scaffolding when my acceptance test is failing, so that I can follow natural outside-in TDD without being forced to write unit tests prematurely.

## Acceptance Criteria

Given 1 red acceptance test and 0 red unit tests
When I add implementation code
Then the verifier allows the edit (scaffolding phase)

Given 0 red acceptance tests and 0 red unit tests
When I try to add implementation code
Then the verifier blocks with "write unit test first"

## Implementation

Updated `SYSTEM_PROMPT` in `src/verifier.ts` with rule:

```
- Implementation with 0 unit failing tests:
  - If acceptance test failing → ALLOW (scaffolding phase)
  - Otherwise → BLOCK (write unit test first)
```

The scaffolding phase is naturally limited by existing constraint: `acceptanceFailingTests > 1 → BLOCK` (only one red acceptance test allowed).

## Out of Scope

- Changing plugin architecture
- Adding explicit scaffolding detection code
- Modifying how test output is extracted
- Mock-based unit tests (deleted as they provide no real validation)
