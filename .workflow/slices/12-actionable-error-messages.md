# Slice 12: Actionable Error Messages for Driving LLM

## User Story

**As a** driving LLM receiving TDD verification errors
**I want** clear, actionable error messages
**So that** I understand why my edit was blocked and what to do next

## Context

Research confirmed that error messages DO reach the driving LLM via the AI SDK's `output-error` format. However, the LLM doesn't react because:

1. Error messages like `Invalid verifier response (got: ...)` are not actionable
2. The driving LLM doesn't know a TDD verifier is supervising its edits

## Acceptance Criteria

- [ ] Error messages use prefix `TDD violation:` instead of `TDD:`
- [ ] Verifier parse errors default to actionable block reason instead of exposing internal failure
- [ ] All error messages end with clear instruction for what to do next
- [ ] README documents system prompt addition for driving LLM awareness

## Technical Changes

### 1. Error Message Format

| Current                                     | New                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `TDD: Run tests first`                      | `TDD violation: Run tests first before editing implementation.`     |
| `TDD: Re-run tests`                         | `TDD violation: Test output is stale. Re-run tests before editing.` |
| `TDD: Write a failing test first`           | `TDD violation: Write a failing test first, then retry this edit.`  |
| `TDD: Invalid verifier response (got: ...)` | `TDD violation: Write a failing test first, then retry this edit.`  |

### 2. Files to Change

- `src/index.ts:14` - "Run tests first" message
- `src/index.ts:19` - "Re-run tests" message
- `src/index.ts:160` - Error prefix `TDD:` → `TDD violation:`
- `src/verifier.ts:60` - Default reason for missing BLOCK reason
- `src/verifier.ts:66` - Parse error → default to block with actionable reason

### 3. System Prompt Documentation

Add to README:

```markdown
## Driving LLM System Prompt

Add this to your driving LLM's system prompt for best results:

> Your edits to source files are verified by a TDD guardian. If you violate
> TDD principles (e.g., writing implementation without a failing test), your
> edit will be blocked with a "TDD violation" error. When this happens, follow
> the error's instructions before retrying.
```

## Out of Scope

- Adding `experimental.chat.system.transform` hook (user configures their own system prompt)
- Changing verifier LLM prompt (separate concern)

## Test Updates

Update expected error strings in:

- `test/index.test.ts` - All error assertions
- `test/e2e/tdd-enforcement.test.ts` - E2E error pattern matching
