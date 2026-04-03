/**
 * Pin Cache — In-memory + disk caching for Discord pinned messages.
 *
 * Adapted from ChapterX connector.ts pin caching pattern.
 * Eliminates redundant fetchPinned() API calls that trigger Cloudflare
 * rate limits on shared-IP deployments (80+ bots on one machine).
 *
 * Cache layers:
 *   1. In-memory Map (hot, sub-ms) — full Message objects for unpin support
 *   2. In-memory data Map (warm) — serialized pin data
 *   3. Disk JSON (cold) — persisted per channel, loaded on startup
 *
 * Invalidation:
 *   - channelPinsUpdate gateway event → markDirty (lazy)
 *   - After our own pin/unpin mutations → markDirty
 *   - Dirty channels re-fetch on next read
 */

import type { Collection, Message } from 'discord.js'
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { logger } from '../utils/logger.js'

/** Serialized pin data for disk persistence and read-only consumers */
export interface CachedPin {
  id: string
  content: string
  authorId: string
  authorBot: boolean
}

/** Any channel that supports fetchPinned() */
export interface PinnableChannel {
  readonly id: string
  readonly messages: {
    fetchPinned(): Promise<Collection<string, Message>>
  }
}

const PIN_CACHE_DIR = process.env.SOMA_PIN_CACHE_DIR || './data/pin-cache'
const FETCH_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

/** Full Message objects from API — supports .unpin() */
const messageCache = new Map<string, Collection<string, Message>>()

/** Serialized pin data — from memory or disk */
const dataCache = new Map<string, CachedPin[]>()

/** Channels whose cache is stale and needs re-fetch */
const dirtySet = new Set<string>()

let initialized = false

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the pin cache — creates disk directory and loads persisted data.
 * Call once at startup before any cache reads.
 */
export function initPinCache(): void {
  if (initialized) return
  initialized = true

  try {
    mkdirSync(PIN_CACHE_DIR, { recursive: true })
  } catch (err) {
    logger.warn({ err, dir: PIN_CACHE_DIR }, 'Failed to create pin cache directory')
    return
  }

  try {
    const files = readdirSync(PIN_CACHE_DIR).filter(f => f.endsWith('.json'))
    for (const file of files) {
      const channelId = file.replace('.json', '')
      const data = loadFromDisk(channelId)
      if (data) {
        dataCache.set(channelId, data)
        // Mark dirty so first access upgrades to real Message objects
        dirtySet.add(channelId)
      }
    }
    if (files.length > 0) {
      logger.info({ channels: files.length }, 'Loaded pin cache from disk')
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load pin cache from disk')
  }
}

/**
 * Mark a channel's pin cache as stale. Next read will re-fetch from API.
 * Call after pin/unpin mutations or from channelPinsUpdate handler.
 */
export function markPinsDirty(channelId: string): void {
  dirtySet.add(channelId)
}

/**
 * Get pinned messages as full Message objects (supports .unpin()).
 * Returns null if both cache and API are unavailable.
 *
 * Fallback chain: memory cache → API fetch → stale memory cache → null
 */
export async function getPinnedMessages(
  channel: PinnableChannel,
): Promise<Collection<string, Message> | null> {
  const { id: channelId } = channel

  // Cache hit (clean)
  if (messageCache.has(channelId) && !dirtySet.has(channelId)) {
    return messageCache.get(channelId)!
  }

  // Fetch from API with timeout
  const fetched = await fetchPinnedWithTimeout(channel)
  if (fetched) {
    cacheResult(channelId, fetched)
    return fetched
  }

  // API failed — return stale message cache if available
  if (messageCache.has(channelId)) {
    logger.warn({ channelId }, 'Pin fetch failed — returning stale message cache')
    return messageCache.get(channelId)!
  }

  return null
}

/**
 * Get pinned message data for read-only consumers (no .unpin() needed).
 * Falls back to disk cache when API is unavailable.
 *
 * Fallback chain: data cache → API fetch → stale/disk data cache → empty []
 */
export async function getPinnedData(
  channel: PinnableChannel,
): Promise<CachedPin[]> {
  const { id: channelId } = channel

  // Fast path: clean data cache (memory or previously loaded from disk)
  if (dataCache.has(channelId) && !dirtySet.has(channelId)) {
    return dataCache.get(channelId)!
  }

  // Try API fetch (populates both caches)
  const fetched = await getPinnedMessages(channel)
  if (fetched) {
    return dataCache.get(channelId) ?? []
  }

  // Fall back to stale/disk data cache
  if (dataCache.has(channelId)) {
    logger.info({ channelId }, 'Using stale/disk-cached pin data')
    return dataCache.get(channelId)!
  }

  return []
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function cacheResult(channelId: string, pins: Collection<string, Message>): void {
  messageCache.set(channelId, pins)
  dirtySet.delete(channelId)

  const data: CachedPin[] = [...pins.values()].map(msg => ({
    id: msg.id,
    content: msg.content,
    authorId: msg.author.id,
    authorBot: msg.author.bot,
  }))
  dataCache.set(channelId, data)

  saveToDisk(channelId, data)
}

async function fetchPinnedWithTimeout(
  channel: PinnableChannel,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Collection<string, Message> | null> {
  try {
    const result = await Promise.race([
      channel.messages.fetchPinned(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ])
    if (!result) {
      logger.warn({ channelId: channel.id }, 'fetchPinned timed out')
    }
    return result
  } catch (err) {
    logger.warn({ err, channelId: channel.id }, 'fetchPinned failed')
    return null
  }
}

function saveToDisk(channelId: string, data: CachedPin[]): void {
  try {
    writeFileSync(
      join(PIN_CACHE_DIR, `${channelId}.json`),
      JSON.stringify(data),
      'utf-8',
    )
  } catch (err) {
    logger.warn({ err, channelId }, 'Failed to save pin cache to disk')
  }
}

function loadFromDisk(channelId: string): CachedPin[] | null {
  try {
    const raw = readFileSync(join(PIN_CACHE_DIR, `${channelId}.json`), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed as CachedPin[]
  } catch {
    return null
  }
}
