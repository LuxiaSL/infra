/**
 * Sleep Sweeper
 *
 * Periodically scans `bot_sleeps` for rows whose `expires_at` has passed and:
 *   1. Unpins the associated `.sleep` message (best effort).
 *   2. Deletes the row.
 *
 * ChapterX bots already stop honoring expired sleeps via their own clock
 * (`started_at + duration_seconds`). The sweeper exists purely to clean up the
 * pinned message so it doesn't linger in the channel's pins.
 *
 * Runs an initial sweep on startup so any sleeps that expired while soma was
 * down get cleaned up immediately.
 */

import type { Database } from 'better-sqlite3'
import type { Client, TextChannel, ThreadChannel } from 'discord.js'
import { listExpiredSleeps, removeSleepById, type BotSleepRow } from './sleeps.js'
import { markPinsDirty } from '../infra/pin-cache.js'
import { logger } from '../utils/logger.js'

export interface SleepSweeperHandle {
  stop(): void
}

const DEFAULT_INTERVAL_MS = 30_000   // 30s — pin lingers up to this long post-expiry

export function startSleepSweeper(
  db: Database,
  client: Client,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): SleepSweeperHandle {
  let stopped = false

  const sweepOnce = async (): Promise<void> => {
    if (stopped) return
    if (!client.isReady()) return

    let expired: BotSleepRow[]
    try {
      expired = listExpiredSleeps(db)
    } catch (error) {
      logger.error({ error }, 'Sleep sweeper: failed to query expired sleeps')
      return
    }

    if (expired.length === 0) return

    logger.debug({ count: expired.length }, 'Sleep sweeper: found expired sleeps')

    for (const row of expired) {
      try {
        await unpinExpiredSleep(client, row)
      } catch (error) {
        logger.warn({
          error,
          sleepId: row.id,
          channelId: row.channel_id,
          messageId: row.message_id,
        }, 'Sleep sweeper: unpin failed; deleting row anyway')
      }

      try {
        removeSleepById(db, row.id)
      } catch (error) {
        logger.error({ error, sleepId: row.id }, 'Sleep sweeper: failed to delete row')
      }
    }
  }

  const runInitialSweep = (): void => {
    void sweepOnce().catch(err =>
      logger.error({ err }, 'Sleep sweeper: initial sweep errored'),
    )
  }

  if (client.isReady()) {
    runInitialSweep()
  } else {
    client.once('ready', runInitialSweep)
  }

  const timer = setInterval(() => {
    void sweepOnce().catch(err =>
      logger.error({ err }, 'Sleep sweeper: sweep errored'),
    )
  }, intervalMs)

  logger.info({ intervalMs }, 'Sleep sweeper started')

  return {
    stop(): void {
      stopped = true
      clearInterval(timer)
      logger.info('Sleep sweeper stopped')
    },
  }
}

async function unpinExpiredSleep(client: Client, row: BotSleepRow): Promise<void> {
  let channel: TextChannel | ThreadChannel | null = null
  try {
    const fetched = await client.channels.fetch(row.channel_id)
    if (fetched && (fetched.isTextBased() || fetched.isThread())) {
      channel = fetched as TextChannel | ThreadChannel
    }
  } catch (error) {
    const err = error as { code?: number }
    if (err?.code === 10003) {
      logger.info({ sleepId: row.id, channelId: row.channel_id }, 'Sleep sweeper: channel gone, dropping row')
      return
    }
    throw error
  }

  if (!channel) {
    logger.info({ sleepId: row.id, channelId: row.channel_id }, 'Sleep sweeper: no text channel, dropping row')
    return
  }

  try {
    const msg = await channel.messages.fetch(row.message_id)
    if (msg.pinned) {
      await msg.unpin()
    }
    markPinsDirty(channel.id)
    logger.info({
      sleepId: row.id,
      channelId: row.channel_id,
      botName: row.bot_name,
      messageId: row.message_id,
    }, 'Sleep sweeper: unpinned expired sleep')
  } catch (error) {
    const err = error as { code?: number }
    if (err?.code === 10008) {
      markPinsDirty(channel.id)
      logger.info({ sleepId: row.id, messageId: row.message_id }, 'Sleep sweeper: message already gone')
      return
    }
    throw error
  }
}
