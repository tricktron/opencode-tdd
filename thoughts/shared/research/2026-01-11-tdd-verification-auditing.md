---
date: 2026-01-11T10:30:00Z
topic: 'TDD verification auditing for LLM determinism tracking'
agents:
  [thoughts-locator, codebase-locator, codebase-patterns, thoughts-analyzer]
---

# Research: TDD Verification Auditing

## Prior Research

### Interface Abstraction Patterns (2026-01-11)

- **LlmClient interface** exists as TypeScript type (`src/verifier.ts`)
- **SDK adapter pattern** wraps SDK client to match interface
- Adapter handles: child session creation, prompt sending, cleanup
- Current design is clean and testable via structural typing

### TDD E2E Tests (2026-01-10)

- **Log-based assertions** verify behavior via `.opencode/tdd/tdd.log`
- SDK-based testing with real LLM (not mocks)
- Test isolation: random ports, git restore, cleanup

### Architecture Decisions

- Plugin receives SDK client with session/prompt methods
- Child session pattern for verification
- Logger factory with dependency injection

## Key Files

### Core Implementation

| File              | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `src/index.ts`    | TDD enforcement, adapter creation, phase detection |
| `src/verifier.ts` | LLM-based edit classification                      |
| `src/logger.ts`   | File-based append logger                           |
| `src/config.ts`   | Config loading/validation                          |

### LLM Interaction Points (Audit Targets)

1. `resolveLlmClient()` - client resolution
2. `createSdkAdapter()` - SDK → LlmClient adapter
3. `verifyEdit()` - calls `client.chat()`

### Tests

| File                              | Coverage               |
| --------------------------------- | ---------------------- |
| `test/index.test.ts`              | Unit tests             |
| `test/e2e/sdk-block-edit.test.ts` | E2E via log assertions |

## Existing Patterns

### Current Logger

```typescript
// src/logger.ts:10-25
export const createLogger = (projectRoot: string): Logger => {
  const logPath = join(projectRoot, '.opencode', 'tdd', 'tdd.log')

  const log = async (level: string, message: string) => {
    await mkdir(join(projectRoot, '.opencode', 'tdd'), { recursive: true })
    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] [${level}] ${message}\n`
    await appendFile(logPath, line)
  }

  return {
    info: (message) => log('INFO', message),
    warn: (message) => log('WARN', message),
    error: (message) => log('ERROR', message),
  }
}
```

### Decision Logging

```typescript
// src/index.ts - current logging
await ctx.logger.info(`Allowed edit (RED): ${ctx.filePath}`)
await ctx.logger.info(`Allowed edit (verified): ${ctx.filePath}`)
await ctx.logger.warn(`Blocked: ${result.reason} - ${ctx.filePath}`)
```

### Notable Absences

- **No LLM prompt/response logging** - only final decisions logged
- **No execution history** - no structured event store
- **No step-by-step audit trail** - logs are decision-focused
- **No refactor phase tracking** - only RED (1 fail) and GREEN (0 fails)
- **No session/run correlation** - each log entry is independent

## Resolved Questions

1. **Audit scope**: Full LLM interactions (prompt, response, decision, reason)
2. **Output format**: Separate `.opencode/tdd/audit.jsonl` (JSON Lines)
3. **Granularity**: Per-LLM-call (GREEN phase only)
4. **User consumption**: File inspection (cat, jq, editor)

## Spike: Plugin Error Surfacing (2026-01-11)

Investigated how plugin errors surface in OpenCode events.

### Finding

Plugin errors do NOT emit `session.error`. Instead, they surface via:

```json
{
  "type": "message.part.updated",
  "part": {
    "type": "tool",
    "tool": "edit",
    "state": {
      "status": "error",
      "error": "Error: TDD: Run tests first"
    }
  }
}
```

### Implications

1. **Logger is redundant**: Errors surface through OpenCode's tool error mechanism
2. **E2E tests**: Can assert on `message.part.updated` events instead of log files
3. **No `client.app.log` needed**: Thrown errors are sufficient for user feedback

### Decision

Remove `src/logger.ts`. Keep only `src/auditor.ts` for LLM verification audit trail.
