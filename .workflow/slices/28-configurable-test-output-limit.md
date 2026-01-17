# Slice: Configurable Test Output Limit

## User Story

As a plugin user, I want to configure how much test output is included in block errors so that I can tune it for my test framework's verbosity.

## Outer Boundary

- Entry point: `tdd.json` config file
- Test file: `test/config.test.ts`
- Framework: bun:test

## Acceptance Criteria

Given a `tdd.json` with `"testOutputLines": 20`
When a block error includes test output
Then only the first 20 lines are included

Default: 50 lines when not configured.

## Uses

- `src/config.ts` - add `testOutputLines` to schema
- `src/verifier.ts` - respect the limit when formatting errors
- `src/index.ts` - pass config value to verifier

## Notes

- Single config value, not lines+bytes (simpler)
- Validated as positive integer

## Implemented

### Config Schema

- Added optional `testOutputLines?: number` to `TDDConfig` type
- Created `optionalPositiveInteger` validator that:
  - Returns undefined when value is undefined/null
  - Validates value is a positive integer
  - Throws error with helpful message on invalid values
- Config loader parses and validates the value

### Verifier Integration

- Updated `parseResponse` to accept optional `maxLines` parameter
- `truncateOutput` now uses the provided limit (defaults to 50)
- `VerifyEditWithTestRunnerOptions` includes optional `testOutputLines`
- Value flows from config → index.ts → verifier → parseResponse

### Tests

- `test/config.test.ts`: 3 tests covering load, default, and validation
- `test/verifier.test.ts`: 2 tests for parseResponse behavior and integration
- All 71 tests pass
