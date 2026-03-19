/**
 * Pino logger setup for Infra
 */

import { pino, type Logger } from 'pino'
import { getLogLevel, isDevelopment } from '../config.js'

const transport = isDevelopment()
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    }
  : undefined

export const logger = pino({
  level: getLogLevel(),
  transport,
})

/**
 * Create a child logger with additional context
 */
export function createLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings)
}

/**
 * Convenience exports for common log levels
 */
export const log = {
  trace: logger.trace.bind(logger),
  debug: logger.debug.bind(logger),
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger),
  fatal: logger.fatal.bind(logger),
}
