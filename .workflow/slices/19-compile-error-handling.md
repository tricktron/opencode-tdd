# Slice 19: Compile Error Handling

**Status: COMPLETE**

## User Story

As an opencode-tdd plugin user, I want the verifier to recognize compile errors so that I can fix them without being blocked by the "multiple failing tests" rule.

## Acceptance Criteria

- Given test output shows compile/syntax error, when fixing the compile error, then ALLOW
- Given test output shows compile/syntax error, when adding new implementation beyond the fix, then BLOCK
- Given test output shows compile error affecting multiple tests, when fixing the error, then ALLOW (not treated as multiple failing tests)
- Given test output shows 2 actual test failures (not compile errors), when editing, then BLOCK (existing behavior preserved)

## Technical Constraint

Solve via enhanced LLM system prompt only - no new code paths or compile error detection logic. The verifier LLM already has full context (edit content + test output) to make this judgment.

See ADR: `docs/decisions/0001-compile-error-handling.md`

## Out of Scope

- Language-specific compile error detection in code
- Retry mechanisms
- Tracking which file caused the compile error
