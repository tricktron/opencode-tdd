# Slice 09: Audit Failed Verifier Responses

## User Story

**As a** developer debugging TDD verification issues
**I want** failed verifier responses logged to the audit file
**So that** I can analyze why the verifier LLM produced invalid output

## Acceptance Criteria

- Parse failures write to `.opencode/tdd/audit.jsonl` before throwing
- Audit entry includes: timestamp, filePath, prompt, raw response, error type
- Existing successful verification auditing unchanged

## Technical Notes

- Audit currently happens at `src/verifier.ts:97` after successful parse
- Move audit call before `parseResponse()` or add separate failure path
- Consider adding `status: 'success' | 'parse_error'` field to distinguish entries
