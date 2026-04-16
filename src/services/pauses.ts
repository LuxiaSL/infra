/**
 * Pauses Service
 *
 * Persists scheduled unpin state for pinned `.pause` messages.
 *
 * The pinned Discord message is the source of truth for pause semantics
 * (started_at, duration_seconds, messages, reason, target bot). Each chapterx
 * bot reads the pin directly via its event-driven pin tracker and honors it
 * locally.
 *
 * This table exists purely so soma can unpin the message when the time gate
 * expires, surviving soma restarts. Nothing else consults it as authority.
 */

import type { Database } from 'better-sqlite3'
import { generateId } from '../db/connection.js'
import { logger } from '../utils/logger.js'

export interface BotPauseRow {
  id: string
  server_id: string                 // internal soma server id (NOT the Discord guild id)
  channel_id: string                // Discord channel id
  bot_name: string                  // chapterx botId (EMS directory name), lowercased
  message_id: string                // pinned .pause message id
  started_at: string                // ISO
  expires_at: string                // ISO; hard cap even when messages-only
  messages_initial: number | null   // NULL when time-only
  created_by: string                // Discord user id of the admin
  reason: string | null
  created_at: string
}

export interface CreatePauseParams {
  serverInternalId: string
  channelId: string
  botName: string
  messageId: string
  startedAt: string
  expiresAt: string
  messagesInitial?: number
  createdBy: string
  reason?: string
}

/**
 * Upsert a pause for `(server, channel, botName)`. Replaces any existing row
 * (matches the /config upsert convention).
 */
export function createPause(
  db: Database,
  params: CreatePauseParams,
): { id: string; replacedExisting: boolean; replacedMessageId: string | null } {
  const id = generateId()
  const botName = params.botName.toLowerCase()

  // Pull any existing row so the caller can unpin the old message. Doing this
  // in a transaction with the insert means we always return a consistent
  // "replacedMessageId" — the delete never races against a concurrent insert.
  const result = db.transaction(() => {
    const existing = db.prepare(`
      SELECT message_id FROM bot_pauses
      WHERE server_id = ? AND channel_id = ? AND bot_name = ?
    `).get(params.serverInternalId, params.channelId, botName) as Pick<BotPauseRow, 'message_id'> | undefined

    if (existing) {
      db.prepare(`
        DELETE FROM bot_pauses
        WHERE server_id = ? AND channel_id = ? AND bot_name = ?
      `).run(params.serverInternalId, params.channelId, botName)
    }

    db.prepare(`
      INSERT INTO bot_pauses (
        id, server_id, channel_id, bot_name, message_id,
        started_at, expires_at, messages_initial, created_by, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.serverInternalId,
      params.channelId,
      botName,
      params.messageId,
      params.startedAt,
      params.expiresAt,
      params.messagesInitial ?? null,
      params.createdBy,
      params.reason ?? null,
    )

    return {
      id,
      replacedExisting: !!existing,
      replacedMessageId: existing?.message_id ?? null,
    }
  })()

  logger.info({
    id,
    serverInternalId: params.serverInternalId,
    channelId: params.channelId,
    botName,
    messageId: params.messageId,
    startedAt: params.startedAt,
    expiresAt: params.expiresAt,
    messagesInitial: params.messagesInitial,
    replacedExisting: result.replacedExisting,
  }, 'Created bot pause')

  return result
}

/**
 * Remove the pause for `(server, channel, botName)`. Returns the deleted row
 * (so caller can unpin the message) or null if none existed.
 */
export function removePause(
  db: Database,
  serverInternalId: string,
  channelId: string,
  botName: string,
): BotPauseRow | null {
  const lowered = botName.toLowerCase()
  const row = db.prepare(`
    SELECT * FROM bot_pauses
    WHERE server_id = ? AND channel_id = ? AND bot_name = ?
  `).get(serverInternalId, channelId, lowered) as BotPauseRow | undefined

  if (!row) return null

  db.prepare(`DELETE FROM bot_pauses WHERE id = ?`).run(row.id)

  logger.info({
    id: row.id,
    serverInternalId,
    channelId,
    botName: lowered,
    messageId: row.message_id,
  }, 'Removed bot pause')

  return row
}

/** Delete by row id (used by the sweeper). */
export function removePauseById(db: Database, id: string): void {
  db.prepare(`DELETE FROM bot_pauses WHERE id = ?`).run(id)
}

/** Rows whose `expires_at <= now`. Used by the sweeper. */
export function listExpiredPauses(db: Database, now: Date = new Date()): BotPauseRow[] {
  return db.prepare(`
    SELECT * FROM bot_pauses WHERE expires_at <= ?
    ORDER BY expires_at ASC
  `).all(now.toISOString()) as BotPauseRow[]
}

/** All active (not-yet-expired) pauses, optionally scoped to a server. */
export function listActivePauses(
  db: Database,
  serverInternalId?: string,
): BotPauseRow[] {
  const now = new Date().toISOString()
  if (serverInternalId) {
    return db.prepare(`
      SELECT * FROM bot_pauses
      WHERE server_id = ? AND expires_at > ?
      ORDER BY expires_at ASC
    `).all(serverInternalId, now) as BotPauseRow[]
  }
  return db.prepare(`
    SELECT * FROM bot_pauses WHERE expires_at > ?
    ORDER BY expires_at ASC
  `).all(now) as BotPauseRow[]
}
