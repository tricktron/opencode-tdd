# Slice 16: Migrate Tests to Session-Based Mocks

## Goal

Update all tests in `index.test.ts` to use session-based mocks instead of file-based test output setup. Delete obsolete file-based tests. Remove file-based test helpers.

## Acceptance Criteria

1. All tests pass (no file-based test failures)
2. No tests write test output files
3. All tests use session-based mocks with `session.messages`
4. File-based helpers (`writeTestOutput`, etc.) removed
5. Obsolete tests deleted (tests for file existence, staleness, empty file)

## Test Scenarios

### Migration Pattern

For each test:

1. **Obsolete** (tests file-based features) → Delete
2. **Current** (tests behavior) → Migrate to session mocks

### Examples of Obsolete Tests (Delete)

- "Test output file does not exist" → Delete (no file anymore)
- "Test output is stale" → Delete (no staleness check)
- "Test output file is empty" → Delete (no file)

### Examples of Current Tests (Migrate)

- "Verifier receives test output" → Migrate to session mock
- "Block when no failing test" → Migrate to session mock
- "Allow when failing test exists" → Migrate to session mock

### Cleanup

1. **Remove file-based helpers**
   - Given: `writeTestOutput()` helper exists
   - When: All tests migrated/deleted
   - Then: Helper deleted

2. **All tests pass**
   - Given: Tests migrated to session mocks, obsolete tests deleted
   - When: Test suite runs
   - Then: All remaining tests pass

## Out of Scope

- Deep compaction (removing redundant tests) → defer to slice 17
- Changing test behavior or assertions
- Adding new test coverage
