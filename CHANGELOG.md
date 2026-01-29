# Changelog

## [0.2.0] - 2026-01-29

### Changed

- **Breaking:** simplify verifier to plain text response format (`ALLOW`/`BLOCK: reason`) ([#2])
- **Breaking:** remove file-based test output fallback; verifier now runs tests directly ([#2])
- **Breaking:** remove standalone logger; errors surface via tool error mechanism ([#2])
- Use two-category test hierarchy: acceptance + unit, removing "integration" ([#2])
- Make response parsing tolerant of verbose LLM output ([#2])
- Prefix error messages with "TDD violation:" for actionability ([#2])

### Added

- Add LLM-based TDD verification using child sessions with bash tool access ([#2])
- Add audit logging to `.opencode/tdd/audit.jsonl` with test command and output ([#2])
- Add `testOutputLines` config option to limit test output in errors (default: 50) ([#2])
- Allow fixing compile errors without being blocked by TDD rules ([#2])
- Allow scaffolding implementation with 1 red acceptance test and 0 red unit tests ([#2])
- Include actual test output in block errors for ground truth ([#2])
- Export `SdkClient` type for typed test mocks ([#2])

### Fixed

- Centralize `SdkClient` type definition to prevent drift between modules ([#2])

## [0.1.0] - 2026-01-08

_First release._

[#2]: https://github.com/tricktron/opencode-tdd/pull/2
