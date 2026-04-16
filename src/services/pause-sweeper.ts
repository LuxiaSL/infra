/**
 * Pause Sweeper
 *
 * Periodically scans `bot_pauses` for rows whose `expires_at` has passed and:
 *   1. Unpins the associated `.pause` message (best effort).
 *   2. Deletes the row.
 *
 * ChapterX bots already stop honoring expired pauses via their own clock
 * (`started_at + duration_seconds`). The sweeper exists purely to clean up the
 * pinned message so it doesn't linger in the channel's pins.
 *
 * Runs an initial sweep on startup so any pauses that expired while soma was
 * down get cleaned up immediately.
 */

import type { Database } from 'better-sqlite3'
import type { Client, TextChannel, ThreadChannel } from 'discord.js'
import { listExpiredPauses, removePauseById, type BotPauseRow } from './pauses.js'
import { markPinsDirty } from '../infra/pin-cache.js'
import { logger } from '../utils/logger.js'

export interface PauseSweeperHandle {
  stop(): void
}

const DEFAULT_INTERVAL_MS = 30_000   // 30s — pin lingers up to this long post-expiry

export function startPauseSweeper(
  db: Database,
  client: Client,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): PauseSweeperHandle {
  let stopped = false

  const sweepOnce = async (): Promise<void> => {
    if (stopped) return
    if (!client.isReady()) return

    let expired: BotPauseRow[]
    try {
      expired = listExpiredPauses(db)
    } catch (error) {
      logger.error({ error }, 'Pause sweeper: failed to query expired pauses')
      return
    }

    if (expired.length === 0) return

    logger.debug({ count: expired.length }, 'Pause sweeper: found expired pauses')

    for (const row of expired) {
      try {
        await unpinExpiredPause(client, row)
      } catch (error) {
        logger.warn({
          error,
          pauseId: row.id,
          channelId: row.channel_id,
          messageId: row.message_id,
        }, 'Pause sweeper: unpin failed; deleting row anyway')
      }

      // Always drop the row — unpin failure is non-recoverable from here and
      // keeping the row would cause endless retry on every sweep.
      try {
        removePauseById(db, row.id)
      } catch (error) {
        logger.error({ error, pauseId: row.id }, 'Pause sweeper: failed to delete row')
      }
    }
  }

  // First sweep runs once the client is ready (catches pauses that expired
  // while soma was down). Subsequent sweeps on the regular interval.
  const runInitialSweep = (): void => {
    void sweepOnce().catch(err =>
      logger.error({ err }, 'Pause sweeper: initial sweep errored'),
    )
  }

  if (client.isReady()) {
    runInitialSweep()
  } else {
    client.once('ready', runInitialSweep)
  }

  const timer = setInterval(() => {
    void sweepOnce().catch(err =>
      logger.error({ err }, 'Pause sweeper: sweep errored'),
    )
  }, intervalMs)

  logger.info({ intervalMs }, 'Pause sweeper started')

  return {
    stop(): void {
      stopped = true
      clearInterval(timer)
      logger.info('Pause sweeper stopped')
    },
  }
}

async function unpinExpiredPause(client: Client, row: BotPauseRow): Promise<void> {
  let channel: TextChannel | ThreadChannel | null = null
  try {
    const fetched = await client.channels.fetch(row.channel_id)
    if (fetched && (fetched.isTextBased() || fetched.isThread())) {
      channel = fetched as TextChannel | ThreadChannel
    }
  } catch (error) {
    const err = error as { code?: number }
    if (err?.code === 10003) {
      // Unknown Channel — soma was removed from the guild or channel deleted.
      logger.info({ pauseId: row.id, channelId: row.channel_id }, 'Pause sweeper: channel gone, dropping row')
      return
    }
    throw error
  }

  if (!channel) {
    logger.info({ pauseId: row.id, channelId: row.channel_id }, 'Pause sweeper: no text channel, dropping row')
    return
  }

  try {
    const msg = await channel.messages.fetch(row.message_id)
    if (msg.pinned) {
      await msg.unpin()
    }
    markPinsDirty(channel.id)
    logger.info({
      pauseId: row.id,
      channelId: row.channel_id,
      botName: row.bot_name,
      messageId: row.message_id,
    }, 'Pause sweeper: unpinned expired pause')
  } catch (error) {
    const err = error as { code?: number }
    if (err?.code === 10008) {
      // Unknown Message — already deleted/unpinned. Still markPinsDirty so
      // our cache re-reads.
      markPinsDirty(channel.id)
      logger.info({ pauseId: row.id, messageId: row.message_id }, 'Pause sweeper: message already gone')
      return
    }
    throw error
  }
}
