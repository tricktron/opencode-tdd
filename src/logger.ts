export type AppLogger = {
  log: (opts: {
    body: {
      service: string
      level: 'debug' | 'info' | 'warn' | 'error'
      message: string
      extra?: Record<string, unknown>
    }
  }) => Promise<unknown>
}

export const safeLog = (
  logger: AppLogger | undefined,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, unknown>,
): void => {
  if (!logger) return

  logger
    .log({
      body: {
        service: 'tdd-plugin',
        level,
        message,
        extra,
      },
    })
    .catch(() => {})
}

export const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
