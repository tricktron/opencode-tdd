# Slice 10: Include Truncated Response in Parse Errors

## User Story

**As a** driving LLM receiving verification errors
**I want** the error message to include what the verifier actually returned
**So that** I understand why verification failed and can adjust my approach

## Acceptance Criteria

- Parse errors include first 100 chars of raw response
- Format: `Invalid verifier response (got: "<truncated>")`
- Truncation indicated with `...` when response exceeds limit
- Error still prefixed with `TDD:` by plugin wrapper

## Technical Notes

- Change at `src/verifier.ts:74` or call site at `src/verifier.ts:91`
- `parseResponse()` is pure; may need to catch at call site and enrich
- Update test at `test/index.test.ts:51-53` to expect new format
