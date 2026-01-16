# Slice 14: Session-Based Test Output

## Goal

Replace file-based test output contract with session history query. Eliminates brittleness from driving LLM forgetting to redirect test output to file.

## Acceptance Criteria

1. When edit is attempted, verifier receives bash outputs from session history (not file)
2. Config fields `testOutputFile` and `maxTestOutputAge` no longer required
3. When session has no bash output, edit is blocked with: "No bash command output found in session. Run tests first."
4. Last 5 completed bash outputs are included in verifier context

## Test Scenarios (Outside-In)

### Outer Boundary: Hook Behavior

1. **Session has test output → verifier decides**
   - Given: Session contains completed bash output with "FAIL: test_foo"
   - When: Edit attempted on enforced file
   - Then: Verifier LLM receives the bash output and makes decision

2. **Session has no bash output → blocked**
   - Given: Session contains no bash tool parts
   - When: Edit attempted on enforced file
   - Then: Error "No bash command output found in session. Run tests first."

3. **Session query fails → error**
   - Given: SDK returns error when querying messages
   - When: Edit attempted on enforced file
   - Then: Error "Failed to read session history"

4. **Multiple bash outputs → last 5 included**
   - Given: Session contains 7 completed bash outputs
   - When: Edit attempted
   - Then: Verifier receives outputs 3-7 (last 5)

5. **Only completed bash outputs included**
   - Given: Session contains pending and completed bash outputs
   - When: Edit attempted
   - Then: Only completed outputs passed to verifier

### Config Changes

6. **Config without testOutputFile is valid**
   - Given: Config has only `verifierModel` and `enforcePatterns`
   - When: Config loaded
   - Then: Config loads successfully

## Out of Scope

- Heuristics to identify "test" commands (verifier LLM handles interpretation)
- Limiting to specific "step" (use simple last N approach)
