# Slice: Fix SdkClient Type Mismatch

**Status: COMPLETE**

## User Story

As a TypeScript developer, I want a single source of truth for the SdkClient type so that type safety is enforced and drift is prevented.

## Outer Boundary

- Entry point: `src/index.ts` (plugin entry point)
- Test file: `test/index.test.ts`
- Framework: bun:test

## Acceptance Criteria

Given the plugin initializes
When it passes sdkClient to verifyEditWithTestRunner
Then TypeScript compiles without type errors

## Uses

- `src/verifier.ts` - exports SdkClient (already done in slice 26)
- `src/index.ts` - should import SdkClient instead of defining it
- `src/logger.ts` - provides AppLogger type for SDK client logging

## Notes

**Current bug**: LSP error at `src/index.ts:70`

```
Type 'SdkClient' is not assignable to type 'import("...verifier").SdkClient'
```

**Root cause**: Two different SdkClient definitions have diverged:

- `index.ts:9-35` - `messages` is required, parts are generic `{ type: string }`
- `verifier.ts:56-78` - `messages?` is optional, parts are `MessagePart[]` (includes BashToolPart)

**Fix**: Delete duplicate in index.ts, import from verifier.ts

## Implemented

### Changes

1. **src/index.ts**
   - Removed duplicate `SdkClient` type definition (lines 9-35)
   - Added import: `import { verifyEditWithTestRunner, type SdkClient } from './verifier'`

2. **src/verifier.ts**
   - Added `app?: AppLogger` property to `SdkClient` type
   - Added import: `import type { AppLogger } from './logger'`

3. **test/index.test.ts**
   - Added acceptance test: "SdkClient Type Safety"
   - Verifies type-safe SdkClient can be passed to plugin without TypeScript errors

### Results

- ✅ TypeScript compiles without errors (`bunx tsc --noEmit`)
- ✅ All 72 tests pass
- ✅ Single source of truth for SdkClient type in `verifier.ts`
- ✅ Type drift prevented through centralized definition
