/**
 * Sleeps Service
 *
 * Persists scheduled unpin state for pinned `.sleep` messages.
 *
 * The pinned Discord message is the source of truth for sleep semantics
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

export interface BotSleepRow {
  id: string
  server_id: string                 // internal soma server id (NOT the Discord guild id)
  channel_id: string                // Discord channel id
  bot_name: string                  // chapterx botId (EMS directory name), lowercased
  message_id: string                // pinned .sleep message id
  started_at: string                // ISO
  expires_at: string                // ISO; hard cap even when messages-only
  messages_initial: number | null   // NULL when time-only
  created_by: string                // Discord user id of the admin
  reason: string | null
  created_at: string
}

export interface CreateSleepParams {
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
 * Upsert a sleep for `(server, channel, botName)`. Replaces any existing row
 * (matches the /config upsert convention).
 */
export function createSleep(
  db: Database,
  params: CreateSleepParams,
): { id: string; replacedExisting: boolean; replacedMessageId: string | null } {
  const id = generateId()
  const botName = params.botName.toLowerCase()

  const result = db.transaction(() => {
    const existing = db.prepare(`
      SELECT message_id FROM bot_sleeps
      WHERE server_id = ? AND channel_id = ? AND bot_name = ?
    `).get(params.serverInternalId, params.channelId, botName) as Pick<BotSleepRow, 'message_id'> | undefined

    if (existing) {
      db.prepare(`
        DELETE FROM bot_sleeps
        WHERE server_id = ? AND channel_id = ? AND bot_name = ?
      `).run(params.serverInternalId, params.channelId, botName)
    }

    db.prepare(`
      INSERT INTO bot_sleeps (
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
  }, 'Created bot sleep')

  return result
}

/**
 * Remove the sleep for `(server, channel, botName)`. Returns the deleted row
 * (so caller can unpin the message) or null if none existed.
 */
export function removeSleep(
  db: Database,
  serverInternalId: string,
  channelId: string,
  botName: string,
): BotSleepRow | null {
  const lowered = botName.toLowerCase()
  const row = db.prepare(`
    SELECT * FROM bot_sleeps
    WHERE server_id = ? AND channel_id = ? AND bot_name = ?
  `).get(serverInternalId, channelId, lowered) as BotSleepRow | undefined

  if (!row) return null

  db.prepare(`DELETE FROM bot_sleeps WHERE id = ?`).run(row.id)

  logger.info({
    id: row.id,
    serverInternalId,
    channelId,
    botName: lowered,
    messageId: row.message_id,
  }, 'Removed bot sleep')

  return row
}

/** Delete by row id (used by the sweeper). */
export function removeSleepById(db: Database, id: string): void {
  db.prepare(`DELETE FROM bot_sleeps WHERE id = ?`).run(id)
}

/** Rows whose `expires_at <= now`. Used by the sweeper. */
export function listExpiredSleeps(db: Database, now: Date = new Date()): BotSleepRow[] {
  return db.prepare(`
    SELECT * FROM bot_sleeps WHERE expires_at <= ?
    ORDER BY expires_at ASC
  `).all(now.toISOString()) as BotSleepRow[]
}

/** All active (not-yet-expired) sleeps, optionally scoped to a server. */
export function listActiveSleeps(
  db: Database,
  serverInternalId?: string,
): BotSleepRow[] {
  const now = new Date().toISOString()
  if (serverInternalId) {
    return db.prepare(`
      SELECT * FROM bot_sleeps
      WHERE server_id = ? AND expires_at > ?
      ORDER BY expires_at ASC
    `).all(serverInternalId, now) as BotSleepRow[]
  }
  return db.prepare(`
    SELECT * FROM bot_sleeps WHERE expires_at > ?
    ORDER BY expires_at ASC
  `).all(now) as BotSleepRow[]
}
