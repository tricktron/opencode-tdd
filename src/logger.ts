import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export type Logger = {
  info: (message: string) => Promise<void>
  warn: (message: string) => Promise<void>
  error: (message: string) => Promise<void>
}

export const createLogger = (projectRoot: string): Logger => {
  const logPath = join(projectRoot, '.opencode', 'tdd', 'tdd.log')

  const log = async (level: string, message: string) => {
    await mkdir(join(projectRoot, '.opencode', 'tdd'), { recursive: true })
    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] [${level}] ${message}\n`
    await appendFile(logPath, line)
  }

  return {
    info: (message) => log('INFO', message),
    warn: (message) => log('WARN', message),
    error: (message) => log('ERROR', message),
  }
}
