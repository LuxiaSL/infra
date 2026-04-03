/**
 * Pino logger setup for Infra
 *
 * Logs to stdout (for screen session) AND to a file at LOG_DIR/soma.log
 * so logs can be inspected remotely without attaching to screen.
 */

import { pino, type Logger, multistream } from 'pino'
import { createWriteStream, mkdirSync } from 'fs'
import { join } from 'path'
import { getLogLevel, isDevelopment } from '../config.js'

const LOG_DIR = process.env.LOG_DIR || './logs'
const LOG_FILE = join(LOG_DIR, 'soma.log')

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true })
} catch {
  // best-effort — falls back to stdout only
}

// Build streams: always include stdout, add file stream if possible
const streams: Array<{ stream: NodeJS.WritableStream; level?: string }> = [
  { stream: process.stdout },
]

try {
  const fileStream = createWriteStream(LOG_FILE, { flags: 'a' })
  streams.push({ stream: fileStream })
} catch {
  // File logging unavailable — stdout only
}

const pinoOpts: pino.LoggerOptions = {
  level: getLogLevel(),
}

// In development, use pino-pretty on stdout only (no multistream)
// In production, use multistream for stdout + file
export const logger: Logger = isDevelopment()
  ? pino({
      ...pinoOpts,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    })
  : pino(pinoOpts, multistream(streams))

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
