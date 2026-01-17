# Slice 24: Extract Test Details Helper

## Goal

Extract nested test detail extraction logic from `verifyEditWithTestRunner` to improve Code Health from 8.62 → 10.0. This addresses CodeScene findings: Deep Nested Complexity (nesting=5), Complex Method (CC=30), Large Method (83 lines).

## Acceptance Criteria

1. Extract lines 131-150 into `extractTestDetails()` helper function
2. Helper properly types the session messages (removes `as any` casts)
3. Code Health score improves from 8.62 → 9.0+
4. All tests still pass

## Test Scenario

### 1. Acceptance: Refactoring preserves behavior

```
Given: verifyEditWithTestRunner with nested loops and as any casts
When: Extract test details logic into helper function
Then: All existing tests pass (behavior unchanged)
And: Code is easier to read (reduced nesting)
And: No as any casts in extracted helper
```

## Implementation Notes

Extract this block (lines 131-150):

```typescript
// Extract test execution details from session messages
if ('messages' in opts.sdkClient.session) {
  const messagesResult = await (opts.sdkClient.session as any).messages({
    path: { id: childId },
  })

  if (messagesResult.data) {
    for (const msg of messagesResult.data) {
      for (const part of msg.parts) {
        if (
          part.type === 'tool' &&
          (part as any).tool === 'bash' &&
          (part as any).state?.status === 'completed'
        ) {
          testCommand = (part as any).input?.command || ''
          testOutput = (part as any).state?.output || ''
        }
      }
    }
  }
}
```

Into:

```typescript
type TestDetails = { command: string; output: string } | null

const extractTestDetails = async (
  sdkClient: SdkClient,
  sessionId: string,
): Promise<TestDetails> => {
  // Properly typed implementation
}
```

## Out of Scope

- Further refactoring of `verifyEditWithTestRunner` (timeout, audit)
- Consolidating `SdkClient` types across files
- Making `messages` method required (it's optional for audit purposes)
