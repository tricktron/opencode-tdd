# Slice 18: Fix ESLint Warnings

**Status: COMPLETE**

## Goal

Fix two ESLint warnings: unused error variable (loss of debug info) and unused import (cleanup).

## Acceptance Criteria

1. Error details preserved when session query fails
2. Unused `readFile` import removed
3. ESLint passes with no warnings

## Test Scenarios (Outside-In)

### Outer Boundary: Hook Behavior

1. **Session query fails with details**
   - Given: SDK throws error "Network timeout" when querying session
   - When: Edit attempted on enforced file
   - Then: Error message is "TDD violation: Failed to read session history: Network timeout"

### Cleanup

2. **Remove unused import**
   - Given: `actionable-errors.test.ts` imports unused `readFile`
   - When: Import removed
   - Then: ESLint passes with no warnings
