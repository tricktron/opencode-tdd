# Slice 15: Remove File-Based Fallback

## Goal

Remove `testOutputFile` and `maxTestOutputAge` config fields and all file-based test output logic. Session history is now the only source of test output.

## Acceptance Criteria

1. Test output always comes from session history (no file fallback)
2. Config requires both `verifierModel` and `enforcePatterns`
3. `testOutputFile` and `maxTestOutputAge` fields removed from codebase

## Test Scenarios (Outside-In)

### Outer Boundary: Hook Behavior

1. **Edit uses session history only**
   - Given: Config has no `testOutputFile`, session has bash output
   - When: Edit attempted on enforced file
   - Then: Verifier receives bash output from session

### Config Validation

2. **Config with both required fields is valid**
   - Given: Config `{ "verifierModel": "...", "enforcePatterns": ["src/**/*.ts"] }`
   - When: Config loaded
   - Then: Loads successfully

3. **Config missing enforcePatterns is rejected**
   - Given: Config `{ "verifierModel": "..." }`
   - When: Config loaded
   - Then: Error "Missing config field: enforcePatterns"

4. **Config missing verifierModel is rejected**
   - Given: Config `{ "enforcePatterns": ["..."] }`
   - When: Config loaded
   - Then: Error "Missing config field: verifierModel"

## Breaking Change

Users must update `.opencode/tdd.json`:

1. Remove `testOutputFile`
2. Remove `maxTestOutputAge`
3. Add `enforcePatterns` if missing
