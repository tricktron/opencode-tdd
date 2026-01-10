# Architecture: opencode-tdd SDK E2E

## Problem Statement

Add SDK-driven end-to-end tests that start an opencode server/client programmatically, trigger an edit via prompt, and verify the TDD plugin allow/block behavior by observing log output.

## Key Decisions

- Use `createOpencode()` from SDK to start server+client in-process for tests
- Set process cwd to fixture root so config/plugin loading mirrors real usage
- Rely on fixture `opencode.json` for model/provider settings (no SDK config overrides)
- Use `session.promptAsync()` + SSE events for non-blocking prompts:
  - `promptAsync()` returns HTTP 204 immediately, prompt runs in background
  - SSE `session.idle` event signals completion
  - Subscribe to SSE **before** calling `promptAsync()` to avoid missing events
- Assert outcomes via `.opencode/tdd/tdd.log` contents
- Avoid LLM variability: use missing test output for block, single FAIL for allow
- Use `Promise.race(log polling, session.idle)` for reliability when plugin blocks before LLM runs

## Out of Scope

- TUI automation or slash command flows
- Permission request API validation
- Verifying actual file diffs as primary signal

## C4 Model

See [architecture.dsl](architecture.dsl) for formal C4 model.
