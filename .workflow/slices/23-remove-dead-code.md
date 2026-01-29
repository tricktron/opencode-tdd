# Slice 23: Remove Dead Code

**Status: COMPLETE**

## Goal

Remove dead code from slice 21 refactoring. After switching from `verifyEdit()` to `verifyEditWithTestRunner()`, the old verification path and its types are no longer used.

## Acceptance Criteria

1. All tests still pass after deletion
2. Dead code removed:
   - `verifyEdit()` function (src/verifier.ts)
   - `LlmClient` type (src/verifier.ts, src/index.ts)
   - `VerifyEditOptions` type (src/verifier.ts)
   - `SYSTEM_PROMPT` constant (src/verifier.ts)
   - `ToolPart`, `Part` types (src/index.ts)

## Test Scenario

### 1. Acceptance: Tests pass after dead code removal

```
Given: Dead code identified (unused after slice 21)
When: Dead code deleted
Then: All unit tests pass
And: E2E test still passes
And: Build succeeds
```

## Implementation Notes

This is pure deletion - no refactoring. Run tests after each deletion to ensure nothing breaks.

## Out of Scope

- Refactoring `verifyEditWithTestRunner` complexity (separate concern)
- Consolidating `SdkClient` types (acceptable duplication for decoupling)
