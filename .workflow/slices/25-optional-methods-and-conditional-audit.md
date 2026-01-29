# Slice 25: Optional Methods and Conditional Audit

**Status: COMPLETE**

## Goal

1. Add `messages?` as optional method to verifier's `SdkClient` type (removes `as any` cast)
2. Gate `extractTestDetails` behind `auditor` check (avoids unnecessary work in tests)

## User Story

As a developer, I want cleaner types and efficient test execution, so that the code is safer and tests run faster.

## Acceptance Criteria

1. Verifier's `SdkClient` type includes `messages?` as optional method
2. No `as any` casts in `extractTestDetails`
3. `extractTestDetails` only runs when `opts.auditor` is defined
4. All tests still pass (behavior unchanged)
5. Tests run slightly faster (no message extraction when no auditor)

## Test Scenarios (Outside-In)

### 1. Acceptance: Behavior preserved after refactoring

```
Given: Current implementation with as any casts and unconditional extraction
When: Add optional messages method and gate extraction
Then: All unit tests pass
And: E2E test passes
And: No as any casts remain
```

### 2. Unit: extractTestDetails only runs with auditor

```
Given: verifyEditWithTestRunner called without auditor
When: Verification completes
Then: extractTestDetails is NOT called
And: No session.messages() network call made
```

### 3. Unit: extractTestDetails runs with auditor

```
Given: verifyEditWithTestRunner called with auditor
When: Verification completes
Then: extractTestDetails IS called
And: Test details included in audit entry
```

## Implementation Notes

### Change 1: Add `messages?` to `SdkClient` in verifier.ts

```typescript
type SdkClient = {
  session: {
    create: (opts: ...) => Promise<...>
    prompt: (opts: ...) => Promise<...>
    delete: (opts: ...) => Promise<unknown>
    messages?: (opts: { path: { id: string } }) => Promise<{
      data?: Array<SessionMessage>
      error?: unknown
    }>
  }
}
```

### Change 2: Update `extractTestDetails` to use optional method

```typescript
const extractTestDetails = async (
  sdkClient: SdkClient,
  sessionId: string,
): Promise<TestDetails> => {
  if (!sdkClient.session.messages) {
    return null
  }

  const messagesResult = await sdkClient.session.messages({
    path: { id: sessionId },
  })

  // Rest of implementation (no as any casts needed)
}
```

### Change 3: Gate extraction in `verifyEditWithTestRunner`

Before:

```typescript
const testDetails = await extractTestDetails(opts.sdkClient, childId)
if (testDetails) {
  testCommand = testDetails.command
  testOutput = testDetails.output
}

const parsed = parseResponse(response)

if (opts.auditor) {
  await opts.auditor.record({
    ...,
    testCommand: testCommand || undefined,
    testOutput: testOutput || undefined,
  })
}
```

After:

```typescript
const parsed = parseResponse(response)

if (opts.auditor) {
  let testCommand: string | undefined
  let testOutput: string | undefined

  const testDetails = await extractTestDetails(opts.sdkClient, childId)
  if (testDetails) {
    testCommand = testDetails.command
    testOutput = testDetails.output
  }

  await opts.auditor.record({
    ...,
    testCommand,
    testOutput,
  })
}
```

## Out of Scope

- Consolidating `SdkClient` types across files (creates coupling)
- Further refactoring of `verifyEditWithTestRunner` complexity
- Making auditor non-optional (tests benefit from optionality)
