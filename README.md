# opencode-tdd

Enforces TDD for AI coding agents.

## Why?

AI agents implement first, test later. This plugin intercepts edit/write
operations and blocks them unless the Red-Green-Refactor cycle is followed.

## Install

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-tdd"]
}
```

## Configure

Create `.opencode/tdd.json`:

```json
{
  "enforcePatterns": ["src/**/*.ts"],
  "verifierModel": "anthropic/claude-sonnet-4-20250514"
}
```

| Option            | Description                              | Default    |
| ----------------- | ---------------------------------------- | ---------- |
| `enforcePatterns` | Globs for files to enforce TDD on        | `["**/*"]` |
| `verifierModel`   | LLM model for TDD verification           | required   |
| `testOutputLines` | Max lines of test output in block errors | `50`       |

## Driving LLM System Prompt

Add this to your driving LLM's system prompt for best results:

> Your edits to source files are verified by a TDD guardian. If you violate
> TDD principles (e.g., writing implementation without a failing test), your
> edit will be blocked with a "TDD violation" error. When this happens, follow
> the error's instructions before retrying.

## How It Works

When you edit a file matching `enforcePatterns`:

1. Plugin runs relevant tests automatically
2. Verifier LLM analyzes test results and your edit
3. Edit is allowed or blocked based on TDD rules

### TDD Rules

**Test Categories:**

- **Acceptance tests** - Verify user-facing behavior end-to-end
- **Unit tests** - Drive implementation, test components in isolation

**Workflow:**

| Scenario                      | Action             | Result                                 |
| ----------------------------- | ------------------ | -------------------------------------- |
| 0 red tests                   | Add test           | ✅ Allow                               |
| 1 red test                    | Add another test   | ❌ Block: "Fix failing test first"     |
| 0 red tests                   | Add implementation | ❌ Block: "Write a failing test first" |
| 1 red unit test               | Add implementation | ✅ Allow                               |
| 1 red acceptance + 0 red unit | Add implementation | ✅ Allow (scaffolding)                 |
| All tests green               | Refactor           | ✅ Allow                               |

**Special cases:**

- Fixing compile errors is always allowed
- Compile errors don't trigger "multiple failing tests" rule
- With 1 red acceptance test, you can scaffold implementation before writing unit tests

**Block errors include test output** so you can see ground truth, not just the verifier's interpretation:

```
TDD violation: Write a failing test first

Test output:
  PASS src/foo.test.ts
  873 passing, 0 failing
```

## Verification Audit

All verification decisions are logged to `.opencode/tdd/audit.jsonl`:

```jsonl
{
  "timestamp": "2026-01-17T10:30:00Z",
  "filePath": "src/foo.ts",
  "testCommand": "npm test -- foo.test.ts",
  "testOutput": "...",
  "decision": "block",
  "reason": "Write a failing test first"
}
```

Each entry contains:

- `timestamp` - When verification occurred
- `filePath` - File being edited
- `testCommand` - Test command executed
- `testOutput` - Test results
- `decision` - "allow" or "block"
- `reason` - Why the decision was made

Use this to debug unexpected blocks or tune your workflow.

## Development

```bash
bun install    # Install deps
bun test       # Run tests
bun run build  # Build plugin
```

## License

MIT
