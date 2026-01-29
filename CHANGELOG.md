# Changelog

## [0.3.0] - 2026-01-29

### Added

- Verifier runs tests directly in child session instead of parsing session history
- Block errors now include actual test output for ground truth
- Configurable `testOutputLines` option to limit test output in errors (default: 50)
- Compile error handling: fixing compile errors is always allowed
- Scaffolding rule: allow implementation with 1 red acceptance test and 0 red unit tests
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

## [0.2.0] - 2026-01-11

### Added

- Add SDK-driven E2E tests for TDD plugin verification ([#2](https://github.com/tricktron/opencode-tdd/issues/2)) (Thibault Gagnaux)
- Add LLM-based GREEN phase verification with child session support ([#2](https://github.com/tricktron/opencode-tdd/issues/2)) (Thibault Gagnaux)
- Add audit logging for LLM verification decisions in `.opencode/tdd/audit.jsonl` ([#2](https://github.com/tricktron/opencode-tdd/issues/2)) (Thibault Gagnaux)
- Add structured logging for non-fatal errors via `client.app.log()` ([#2](https://github.com/tricktron/opencode-tdd/issues/2)) (Thibault Gagnaux)

## [0.1.0] - 2026-01-08

_First release._
