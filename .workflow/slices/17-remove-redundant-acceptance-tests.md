# Slice 17: Remove Redundant Acceptance Tests

## Goal

Delete slice acceptance test files that served their purpose during implementation but are now redundant with coverage in `index.test.ts`.

## Acceptance Criteria

1. Coverage from slice tests is verified in `index.test.ts`
2. Three slice acceptance test files deleted
3. All remaining tests pass

## Test Scenarios

### Verify Coverage

1. **Session-based test output coverage**
   - Given: `session-based-test-output.test.ts` tests session history extraction
   - When: Review `index.test.ts`
   - Then: Equivalent coverage exists (session mocks, bash output extraction)

2. **File-based fallback removal coverage**
   - Given: `remove-file-based-fallback.test.ts` tests no file fallback
   - When: Review `index.test.ts`
   - Then: Equivalent coverage exists (session-only approach)

3. **Session mock migration coverage**
   - Given: `migrate-to-session-mocks.test.ts` tests migration to session mocks
   - When: Review `index.test.ts`
   - Then: All tests now use session mocks (migration complete)

### Delete Files

4. **Delete slice acceptance tests**
   - Given: Coverage verified in `index.test.ts`
   - When: Delete the 3 slice test files
   - Then: All remaining tests pass

## Files to Delete

- `test/session-based-test-output.test.ts`
- `test/remove-file-based-fallback.test.ts`
- `test/migrate-to-session-mocks.test.ts`

## Out of Scope

- Merging other test files
- Deleting source code
- Refactoring test structure
