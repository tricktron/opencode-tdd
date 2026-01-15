# Slice 11: Simplify Verifier to Plain Text Response

## User Story

**As a** developer maintaining the TDD plugin
**I want** the verifier to use plain text responses instead of JSON
**So that** parsing is simpler, more robust, and less prone to LLM non-determinism

## Acceptance Criteria

- Verifier prompt requests plain text: `ALLOW` or `BLOCK: <reason>`
- Prompt includes chain-of-thought instructions before decision
- Response parsing handles plain text (no JSON extraction)
- Parse errors still include truncated response for debugging
- Audit entries still record prompt/response/decision/reason
- Remove unused fields: `editType`, `testScope`, `acceptanceFailingTests`, `unitFailingTests`
- All existing tests updated to new format
- Backward compatibility not required (breaking change acceptable)

## Technical Notes

### New Response Format

```
ALLOW
```

or

```
BLOCK: Write a failing test first
```

### Chain-of-Thought Prompt Structure

```
First, analyze the edit:
1. Count failing tests by scope (acceptance vs unit)
2. Classify edit type (test, implementation, or refactor)
3. Apply outside-in TDD rules

Then respond with your decision:
ALLOW
or
BLOCK: <brief reason>
```

### Parsing Logic

- `response.trim() === 'ALLOW'` → allow
- `response.trim().startsWith('BLOCK:')` → block with reason after colon
- Anything else → parse error with truncated response

### Cleanup

- Remove `extractJson()` function
- Remove `ParsedResponse` type
- Simplify `parseResponse()` to handle text only
- Remove `status` and `errorType` from audit entries (no longer needed for parse error distinction)
- Update audit type to only required fields

## Impact

- **Reduces conceptual mass**: Removes JSON parsing, markdown extraction, optional fields
- **Improves robustness**: Plain text less prone to LLM formatting errors
- **Maintains functionality**: Still enforces TDD rules, still audits decisions
- **Breaking change**: Old audit entries have different schema (acceptable)
