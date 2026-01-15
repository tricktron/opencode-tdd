---
date: 2026-01-14T10:30:00Z
topic: 'TDD test output file: missing file behavior and path resolution (absolute vs relative)'
agents:
  [thoughts-locator, codebase-locator, codebase-analyzer, codebase-patterns]
---

# Research: TDD Test Output File Path Handling

## Key Files

### Implementation

| File                       | Purpose                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `src/index.ts:10-23`       | `getTestOutput()` - file existence check, staleness, reading |
| `src/config.ts:4-9, 31-68` | Config schema, loading, validation                           |

### Tests

| File                               | Purpose                                                |
| ---------------------------------- | ------------------------------------------------------ |
| `test/index.test.ts:463-472`       | Unit test for missing file behavior                    |
| `test/e2e/tdd-enforcement.test.ts` | E2E test for "blocks edit when test output is missing" |

### Configuration Examples

| File                                  | Purpose                                 |
| ------------------------------------- | --------------------------------------- |
| `test/e2e/fixture/.opencode/tdd.json` | E2E fixture config                      |
| `README.md`                           | Documents `testOutputFile` config field |

## How It Works

### 1. What Happens When File Not Found

**Location**: `src/index.ts:10-15`

```typescript
const getTestOutput = async (projectRoot: string, config: TDDConfig) => {
  const testOutputPath = join(projectRoot, config.testOutputFile)
  const testOutputStat = await stat(testOutputPath).catch(() => null)
  if (!testOutputStat) {
    throw new Error('TDD: Run tests first')
  }
  // ...
}
```

**Behavior**:

- `stat()` catches errors and returns `null`
- Missing file immediately throws `Error('TDD: Run tests first')`
- **No retry logic**
- **No fallback/default**
- **Fail-fast approach**

### 2. Path Resolution: Relative to Project Root

**Location**: `src/index.ts:11`

```typescript
const testOutputPath = join(projectRoot, config.testOutputFile)
```

**Resolution chain**:

1. Plugin receives `directory` parameter (`src/index.ts:200`)
2. Falls back to `process.cwd()` if undefined (`src/index.ts:201`)
3. This becomes `projectRoot`
4. Config's `testOutputFile` is joined to `projectRoot`

**Conclusion**: Path is **relative to project root** (the directory passed to the plugin, or `cwd` if not specified).

### 3. Configuration

**Location**: `src/config.ts:4-5, 47`

```typescript
export type TDDConfig = {
  testOutputFile: string // Required, non-empty
  // ...
}

// Validation
requireString(config.testOutputFile, 'testOutputFile')
```

**Example values** (from tests):

- `.opencode/tdd/test-output.txt`
- `.opencode/tdd/smoke-test-output.txt`

## Existing Patterns

### File Stat Before Read Pattern

```typescript
// src/index.ts:10-23
const testOutputStat = await stat(testOutputPath).catch(() => null)
if (!testOutputStat) {
  throw new Error('TDD: Run tests first')
}
// ... age check ...
return readFile(testOutputPath, 'utf8')
```

### Graceful Fallback Pattern (config loading)

```typescript
// src/config.ts:35-37
const configRaw = await readFile(configPath, 'utf8').catch(() => null)
if (!configRaw) {
  return { kind: 'missing' }
}
```

### Path Building Pattern

```typescript
// Always uses join() with projectRoot as base
const configPath = join(projectRoot, '.opencode', 'tdd.json')
const testOutputPath = join(projectRoot, config.testOutputFile)
const auditPath = join(projectRoot, '.opencode', 'tdd', 'audit.jsonl')
```

## Summary

| Question                     | Answer                                                         |
| ---------------------------- | -------------------------------------------------------------- |
| **File not found behavior?** | Throws `Error('TDD: Run tests first')`                         |
| **Absolute or relative?**    | Relative                                                       |
| **Relative to what?**        | `projectRoot` (plugin's `directory` param, or `process.cwd()`) |
| **Validation?**              | Must be non-empty string                                       |
| **Convention?**              | `.opencode/tdd/<filename>.txt`                                 |

## Open Questions

None - the behavior is clearly defined and well-tested.
