# Changelog

## [0.2.0] - 2026-01-29

### Added

- SDK-driven E2E tests for TDD plugin verification
- LLM-based verification with child session support
- Audit logging for verification decisions in `.opencode/tdd/audit.jsonl`
- Structured logging for non-fatal errors via `client.app.log()`
- Verifier runs tests directly in child session
- Block errors include actual test output for ground truth
- Configurable `testOutputLines` option (default: 50)
- Compile error handling: fixing compile errors is always allowed
- Scaffolding rule: allow implementation with 1 red acceptance test
- Verification timeout advice: suggest retry on timeout
- Export `SdkClient` type for typed test mocks

### Changed

- Simplify verifier to plain text response format (ALLOW/BLOCK)
- Tolerant response parsing extracts decisions from verbose LLM output
- Actionable error messages with "TDD violation:" prefix
- Two-category test hierarchy: acceptance + unit (removed "integration")

### Fixed

- Centralized `SdkClient` type definition to prevent drift

### Removed

- File-based test output fallback (session-only now)
- Logger component (errors surface via tool error mechanism)

## [0.1.0] - 2026-01-08

_First release._
