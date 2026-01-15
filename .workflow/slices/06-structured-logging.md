# Slice: Structured Logging

## Status

COMPLETE

## Layer

middle - observability for non-fatal errors

## User Story

As a plugin maintainer, I want structured logging for non-fatal errors (audit write failures, session cleanup failures) using `client.app.log()`, so that I can diagnose production issues without breaking the main flow.

## Acceptance Criteria

- [x] Given audit write fails, when error occurs, then warning is logged via `client.app.log()` with level 'warn', message, and error details
- [x] Given session cleanup fails, when error occurs, then debug log is written via `client.app.log()` with level 'debug', sessionId, and error details
- [x] Given config parse fails, when error occurs, then error log is written via `client.app.log()` with level 'error', configPath, and error details before throwing
- [x] Given logging is added, when tests run, then all tests pass
- [x] Given empty catch blocks exist, when logging is added, then all silent failures have structured logs

## Architecture Context

- This slice implements: Observability layer using OpenCode SDK's app.log API
- Depends on interfaces from: `05-remove-logger.md` (uses SDK client, not custom logger)
- Defines interfaces for: None (leaf enhancement)
- New concepts introduced: `src/logger.ts` module with `safeLog` helper and `AppLogger` type

## Technical Approach

1. Create `src/logger.ts` shared module:
   - `AppLogger` type for SDK client's app.log interface
   - `safeLog(logger, level, message, extra?)` helper - non-blocking, handles missing logger
   - `formatError(error)` helper for consistent error formatting

2. Update `src/index.ts`:
   - Add logging to session cleanup catch block with level 'debug'

3. Update `src/verifier.ts`:
   - Pass optional `AppLogger` to `verifyEdit`
   - Add warn-level logging for audit write failures

4. Keep `src/auditor.ts` pure (file I/O only) - logging happens at call sites

## Out of Scope

- Custom log formatting or log levels beyond SDK's built-in levels
- Log aggregation or external logging services
- Performance metrics or tracing

## Test Strategy

- Unit tests: 2 behavior-focused tests (audit failure doesn't break verification, session cleanup failure doesn't break verification)
- E2E tests: Existing tests pass (logging is non-intrusive)
- Total: 53 tests passing

Note: Tests verify non-blocking behavior, not log message content (avoids brittle implementation-detail tests).

## Technical Notes

- `safeLog` never throws - catches and ignores logging failures
- Service name: `tdd-plugin` (consistent across all logs)
- Log levels used: 'debug' (cleanup), 'warn' (audit failures), 'error' (config parse failures)
- For fatal errors: log first, then throw (observability before propagation)
