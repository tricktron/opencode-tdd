# Slice 13: Tolerant Response Parsing

**Status: COMPLETE**

## User Story

**As a** TDD plugin user
**I want** the verifier to extract block reasons from verbose LLM responses
**So that** I get meaningful error messages regardless of LLM output format

## Context

LLMs often ignore formatting instructions and return verbose responses:

```
Let me analyze this edit...
...reasoning...
**BLOCK: Cannot add unit test while "CRD Completion should fail" is red.**
```

Current parser only matches responses starting with `BLOCK:`, causing all verbose responses to fall through to the default reason "Write a failing test first, then retry this edit." - losing the actual context.

## Acceptance Criteria

- [x] Parser extracts `BLOCK: reason` from anywhere in response (not just start)
- [x] Parser handles markdown bold: `**BLOCK: reason**`, `**BLOCK:** reason`
- [x] Parser strips markdown formatting (`*`, `**`) from extracted reason
- [x] Parser extracts `ALLOW` from end of verbose responses
- [x] Audit log `reason` field contains actual LLM reason, not default

## Technical Changes

### 1. Update `parseResponse()` in `src/verifier.ts:53-71`

From:

```typescript
if (trimmed.startsWith('BLOCK:')) {
  const reason = trimmed.slice(6).trim() || 'Write a failing test first...'
  return { decision: 'block', reason }
}
```

To:

```typescript
// Search for BLOCK: anywhere (LLM often adds reasoning before)
const blockMatch = trimmed.match(/\*{0,2}BLOCK:\*{0,2}\s*(.*)$/m)
if (blockMatch) {
  const reason =
    blockMatch[1].replace(/^\*+|\*+$/g, '').trim() ||
    'Write a failing test first, then retry this edit.'
  return { decision: 'block', reason }
}

// Search for ALLOW anywhere
if (/\bALLOW\b/.test(trimmed)) {
  return { decision: 'allow', reason: '' }
}
```

### 2. Files to Change

- `src/verifier.ts:53-71` - `parseResponse()` function

## Test Cases

1. `BLOCK: reason` - exact format (existing)
2. `BLOCK:` - empty reason (existing)
3. `...analysis...\nBLOCK: reason` - reasoning before decision
4. `**BLOCK: reason**` - markdown bold wrapped
5. `**BLOCK:** reason` - markdown bold on prefix only
6. `...analysis...\nALLOW` - reasoning before allow
7. `invalid response` - falls through to default (existing)

## Out of Scope

- Changing system prompt (already strict, LLMs ignore it)
- Structured output / JSON mode (not all models support)
- Two-pass LLM calls (over-engineered)
