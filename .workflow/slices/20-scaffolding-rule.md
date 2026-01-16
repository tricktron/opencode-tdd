# Slice: Scaffolding Rule

## User Story

As an opencode-tdd plugin user, I want the verifier to allow minimal scaffolding when my acceptance test fails due to missing imports/modules, so that I can follow natural outside-in TDD without being forced to write unit tests prematurely.

## Acceptance Criteria

Given an acceptance test that fails with import/module error (e.g., "Cannot find module")
When I create minimal scaffolding (empty export, function stub)
Then the verifier allows the edit

Given an acceptance test that fails with an assertion error
When I try to add implementation code
Then the verifier blocks with "write unit test first"

## Technical Notes

- Update `SYSTEM_PROMPT` in `src/verifier.ts`
- Add new rule after line 45 distinguishing scaffolding vs implementation
- Test output already available to LLM for analysis
- Add unit tests for both scenarios

## Out of Scope

- Changing plugin architecture
- Adding explicit scaffolding detection code
- Modifying how test output is extracted
