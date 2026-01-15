---
date: 2026-01-10T00:00:00Z
topic: 'E2E tests for TDD plugin rules'
agents: [thoughts-locator, codebase-locator, codebase-patterns]
---

# Research: E2E Tests for TDD Plugin Rules

## Prior Research

Significant architecture work exists:

| Document                                | Content                                       |
| --------------------------------------- | --------------------------------------------- |
| `docs/architecture.md`                  | SDK E2E testing strategy with decisions       |
| `docs/architecture.dsl`                 | C4 model for the system                       |
| `.workflow/slices/01-sdk-block-edit.md` | IMPLEMENTED - blocks when test output missing |
| `.workflow/slices/02-sdk-allow-edit.md` | IMPLEMENTED - allows edit in RED phase        |

### Key Decisions Already Made

1. **SDK-based testing**: Use `createOpencode()` for in-process server/client
2. **Fixture approach**: Set `process.cwd()` to fixture root
3. **Log-based assertion**: Assert via `.opencode/tdd/tdd.log` contents
4. **Non-blocking prompts**: Use `session.promptAsync()` + SSE events
5. **Test isolation**: Random port (`:0`), `afterEach` cleanup, git restore

## Key Files

### Source Files

- `src/index.ts` - Main plugin entry (TDDPlugin export)
- `src/config.ts` - Configuration loading
- `src/verifier.ts` - LLM-based edit classification
- `src/logger.ts` - Logging to `.opencode/tdd/tdd.log`

### Test Files

- `test/index.test.ts` - Unit tests (comprehensive, 700+ lines)
- `test/e2e/sdk-block-edit.test.ts` - E2E tests (2 tests implemented)

### Test Infrastructure

- `test/e2e/fixture/` - Fixture workspace
- `test/e2e/fixture/.opencode/tdd.json` - Plugin config for fixture

## Existing Patterns

### E2E Test Structure

```typescript
interface TestContext {
  setupTestOutput: () => Promise<void>
  expectedLogPattern: string
  assertions: (log: string) => void
}

const runTddPluginTest = async (ctx: TestContext) => {
  // 1. Setup test output
  // 2. Start opencode server
  // 3. Create session, send prompt
  // 4. Wait for log entry or session.idle
  // 5. Assert log contents
  // 6. Cleanup in finally
}
```

### Tests Already Implemented

1. `blocks edit when test output is missing` - Tests BLOCKED state (no file)
2. `allows edit when exactly one test fails` - Tests RED state

## TDD Rules (from README)

| State   | Condition        | Allowed                          |
| ------- | ---------------- | -------------------------------- |
| RED     | 1 failing test   | Any edit                         |
| GREEN   | 0 failing tests  | Test edits only (LLM classifies) |
| BLOCKED | 2+ failing tests | Must fix existing test first     |

## Gap Analysis: Missing E2E Tests

Based on the TDD rules, these scenarios need E2E coverage:

1. **GREEN phase - allow test edit**: Test that when 0 tests fail, editing a test file is allowed
2. ~~**GREEN phase - block non-test edit**: Test that when 0 tests fail, editing source files is blocked~~ ✅ IMPLEMENTED
3. **BLOCKED phase - multiple failures**: Test that when 2+ tests fail, all edits are blocked
4. **Stale test output**: Test that stale test output triggers "Run tests first"

## Implementation Notes

### GREEN Phase E2E (Slice 03)

Successfully implemented by creating an SDK client adapter that:

- Uses `client.session.create` to make child verification sessions
- Uses `client.session.prompt` to send verification prompts and get responses
- Properly cleans up child sessions after verification

The key insight was that the OpenCode SDK client passed to plugins has the necessary
methods to make LLM calls - we just needed to use the SDK API correctly instead of
trying to make raw HTTP calls.

## Open Questions (Resolved)

1. ~~Should we test the LLM verifier in E2E tests, or mock it?~~ **Answer**: Use real LLM via SDK adapter
2. ~~How to reliably trigger the GREEN phase verifier path in E2E?~~ **Answer**: Use SDK client adapter
3. Should stale test output be an E2E test or is unit coverage sufficient? (Unit tests cover this well)
