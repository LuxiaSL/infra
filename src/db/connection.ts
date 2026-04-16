/**
 * SQLite Database Connection
 */

import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { SCHEMA } from './schema.js'
import { runMigrations } from './migrations.js'
import { clearExpiredOverrides } from '../services/cost.js'
import { logger } from '../utils/logger.js'
import { DatabaseError } from '../utils/errors.js'

export type { Database } from 'better-sqlite3'

/**
 * Initialize database connection and create schema
 */
export function initDatabase(dbPath: string): Database.Database {
  // Ensure directory exists
  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    logger.info({ dir }, 'Created database directory')
  }

  try {
    const db = new Database(dbPath)

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL')

    // Enable foreign keys
    db.pragma('foreign_keys = ON')

    // Create schema
    db.exec(SCHEMA)

    // Run any pending migrations
    runMigrations(db)

    // Clean up any expired cost overrides from previous sessions
    clearExpiredOverrides(db)

    logger.info({ dbPath }, 'Database initialized')

    return db
  } catch (error) {
    throw new DatabaseError(
      `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Close database connection
 */
export function closeDatabase(db: Database.Database): void {
  try {
    db.close()
    logger.info('Database connection closed')
  } catch (error) {
    logger.error({ error }, 'Error closing database')
  }
}

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Run a function in a transaction
 */
export function withTransaction<T>(
  db: Database.Database,
  fn: () => T
): T {
  const transaction = db.transaction(fn)
  return transaction()
}
