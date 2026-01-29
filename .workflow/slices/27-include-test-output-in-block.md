# Slice: Include Test Output in Block Errors

**Status: COMPLETE**

## User Story

As a driving LLM, I want block errors to include actual test output so that I can see ground truth, not just the verifier's interpretation.

## Outer Boundary

- Entry point: `parseResponse()` in `src/verifier.ts`
- Test file: `test/verifier.test.ts`
- Framework: vitest

## Acceptance Criteria

Given a block decision with test output
When the error is thrown
Then the error message contains both the reason AND truncated test output

```
TDD violation: Write a failing test first

Test output:
  873 passing
  0 failing
```

## Uses

- `parseResponse()` - needs new signature to accept test output
- `verifyEditWithTestRunner()` - passes test output to parseResponse

## Notes

- ANSI codes must be stripped from test output
- Test output truncated to configurable limit (default 50 lines)
- Only included on BLOCK, not on ALLOW

## Implemented

### Components

- **`parseResponse()`** - Now accepts optional `testOutput` parameter
  - Strips ANSI codes using regex pattern `/\u001b\[[0-9;]*m/g`
  - Truncates output to 50 lines with "... (output truncated)" message
  - Appends formatted test output to block reasons

- **`verifyEditWithTestRunner()`** - Extracts test details before parsing response
  - Calls `extractTestDetails()` to get test command and output
  - Passes test output to `parseResponse()` for inclusion in block errors

- **Helper Functions**
  - `stripAnsi()` - Removes ANSI color codes from text
  - `truncateOutput()` - Limits output to max lines (default 50)

### Tests

- 1 acceptance test (end-to-end through hook)
- 3 unit tests for parseResponse:
  - Basic test output inclusion
  - ANSI code stripping
  - Output truncation to 50 lines

### Changes to Existing Tests

- Updated `test/index.test.ts` - Audit test now expects test output in reason field
- Updated `test/verifier-runs-tests.test.ts` - Test now expects `extractTestDetails` to be called for block errors

### Discoveries

None
