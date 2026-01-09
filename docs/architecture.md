# Architecture: OpenCode TDD Plugin

## Problem Statement

AI coding agents tend to implement first and test later. This plugin enforces
TDD sequencing by intercepting file-changing tool calls (edit, write) and
blocking them unless the Red -> Green -> Refactor cycle is followed.

## Core Concepts

1. **TDD State Machine** - Implicit state derived from test output:
   - RED (1 failing test): Allow any edit to enforced files
   - GREEN (0 failing tests): LLM classifies edit as test or impl
   - BLOCKED (2+ failing tests): Fix existing test first

2. **Verifier Adapter** - Bridges plugin to OpenCode SDK:
   - Uses `client.session.prompt()` instead of `client.chat()`
   - Reuses a single verifier session per plugin instance

3. **LLM Verification** - In GREEN phase, LLM determines:
   - Is this a test edit? -> Allow (write next test)
   - Is this an impl edit? -> Verify TDD compliance

4. **Config** - `.opencode/tdd.json` controls plugin behavior

## Components

```
                    +------------------+
                    |   TDDPlugin      |
                    |   (index.ts)     |
                    +--------+---------+
                             |
            +----------------+----------------+
            |                |                |
    +-------v------+  +------v------+  +------v------+
    |   Config     |  | Verifier    |  |   Logger    |
    | (config.ts)  |  | Adapter     |  | (logger.ts) |
    +-------+------+  |(verifier.ts)|  +------+------+
            |         +------+------+         |
            |                |                |
            v                v                v
      .opencode/      OpenCode SDK       .opencode/
                                          tdd/tdd.log
       tdd.json       session.prompt()
                          |
                          v
                         LLM
```

## Interfaces

### Plugin Entry Point

```typescript
type TDDPlugin = Plugin = async ({ client, directory }) => {
  return {
    'tool.execute.before': async (input, output) => { ... }
  }
}
```

### Config Shape

```typescript
type TDDConfig = {
  testOutputFile: string
  enforcePatterns?: string[]
  verifierModel: string
  maxTestOutputAge: number // defaults to 300
}
```

### LLM Response Shape

```typescript
type LlmResponse = {
  editType?: 'test' | 'impl'
  decision?: 'allow' | 'block'
  reason?: string
}
```

### Verifier Adapter Interface

```typescript
type VerifierAdapter = {
  getSessionId: () => Promise<string>
  verifyEdit: (input: {
    model: string
    filePath: string
    editContent: string
    testOutput: string
  }) => Promise<VerifyResult>
}
```

The adapter is responsible for creating/reusing a verifier session and
sending prompts via `client.session.prompt()`. It hides session lifecycle
from the rest of the plugin.

## Decisions

1. **Test output file vs. running tests** - Plugin reads pre-existing test
   output rather than running tests. This keeps the plugin fast and lets users
   control test execution.

2. **Staleness via mtime** - Simple file modification time check.

3. **LLM classifies edits** - Instead of pattern-based test file detection,
   LLM determines if edit is test or impl code. Works for any language
   including Rust (tests in same file).

4. **Verifier session reuse** - Create one verifier session per plugin instance
   and reuse it for all edits. Avoids per-edit session churn.

5. **One failing test rule** - Blocks when 2+ tests failing. Enforces proper
   RED -> GREEN -> REFACTOR cycle.

## Out of Scope

- Running tests (user's responsibility)
- IDE integration (OpenCode handles this)
- Multi-project workspaces (single config per project root)
- Toast notifications (too intrusive for optional plugin)

## E2E / Smoke Testing

### Approach

Smoke test verifies plugin loads and works in real OpenCode runtime.
Fixture is committed to source control; only generated files are gitignored.

### Test Fixture Structure

```
test/e2e/
  fixture/                      # Committed to source control
    .opencode/
      plugin/index.js          # Generated: copied from dist/
      tdd.json                 # Committed: test config
      tdd/                     # Generated: logs
    .git/                      # Generated: isolates from parent repo
    opencode.json              # Committed: empty config
    src/foo.ts                 # Committed: file to trigger edit on
  smoke.test.ts                # Smoke test using `opencode run`
```

### What the Smoke Test Proves

1. Plugin export is discoverable by OpenCode's loader
2. `tool.execute.before` hook is called for edit operations
3. Config loading works with real file paths
4. Errors propagate correctly to user
