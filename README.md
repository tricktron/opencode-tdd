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
  "testOutputFile": "test-output.txt",
  "enforcePatterns": ["src/**/*.ts"],
  "verifierModel": "anthropic/claude-sonnet-4-20250514"
}
```

| Option             | Description                             | Default    |
| ------------------ | --------------------------------------- | ---------- |
| `testOutputFile`   | Path to test runner output              | required   |
| `enforcePatterns`  | Globs for files to enforce TDD on       | `["**/*"]` |
| `verifierModel`    | LLM model for edit classification       | required   |
| `maxTestOutputAge` | Max seconds before test output is stale | `300`      |

## How It Works

The plugin reads your test output file and enforces this state machine:

| State   | Condition        | Allowed                          |
| ------- | ---------------- | -------------------------------- |
| RED     | 1 failing test   | Any edit                         |
| GREEN   | 0 failing tests  | Test edits only (LLM classifies) |
| BLOCKED | 2+ failing tests | Must fix existing test first     |

## Verification Audit

During GREEN phase, an LLM classifies edits as test or implementation code.
Since LLMs are non-deterministic, all verification decisions are logged to
`.opencode/tdd/audit.jsonl`:

```jsonl
{
  "timestamp": "2026-01-11T10:30:00Z",
  "filePath": "src/foo.ts",
  "prompt": "...",
  "response": "...",
  "decision": "block",
  "reason": "Write a failing test first"
}
```

Each entry contains:

- `timestamp` - When verification occurred
- `filePath` - File being edited
- `prompt` - What was sent to the LLM
- `response` - Raw LLM response
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
