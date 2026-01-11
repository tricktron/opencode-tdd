import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export type AuditEntry = {
  timestamp: string
  filePath: string
  phase: 'GREEN' | 'RED'
  prompt: string
  response: string
  decision: 'allow' | 'block'
  reason: string
}

export type Auditor = {
  record: (entry: AuditEntry) => Promise<void>
}

export const createAuditor = (projectRoot: string): Auditor => {
  const auditPath = join(projectRoot, '.opencode', 'tdd', 'audit.jsonl')

  return {
    record: async (entry) => {
      await mkdir(join(projectRoot, '.opencode', 'tdd'), { recursive: true })
      const line = `${JSON.stringify(entry)}\n`
      await appendFile(auditPath, line)
    },
  }
}
