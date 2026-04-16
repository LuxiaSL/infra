/**
 * Time/Duration Parsing Utilities
 *
 * Parses human-friendly duration strings like "30m", "2h", "1d", "3w"
 */

/** Supported time unit multipliers (in milliseconds) */
const UNIT_MS: Record<string, number> = {
  m: 60 * 1000,              // minutes
  h: 60 * 60 * 1000,         // hours
  d: 24 * 60 * 60 * 1000,    // days
  w: 7 * 24 * 60 * 60 * 1000, // weeks
}

/** Regex matching a numeric value followed by a time unit */
const DURATION_REGEX = /^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/i

/**
 * Parse a duration string into milliseconds
 *
 * @param input - Duration string (e.g., "30m", "2h", "1d", "3w")
 * @returns milliseconds, or null if the input is invalid
 *
 * @example
 * parseDuration("30m") // 1_800_000
 * parseDuration("2h")  // 7_200_000
 * parseDuration("1d")  // 86_400_000
 * parseDuration("3w")  // 1_814_400_000
 */
export function parseDuration(input: string): number | null {
  const match = input.trim().match(DURATION_REGEX)
  if (!match) return null

  const value = parseFloat(match[1])
  const unit = match[2].toLowerCase()

  if (value <= 0 || !isFinite(value)) return null

  const ms = UNIT_MS[unit]
  if (!ms) return null

  return Math.round(value * ms)
}

/**
 * Compute an expiration date from now + a duration string
 *
 * @returns ISO date string, or null if duration is invalid
 */
export function expiresFromNow(duration: string): string | null {
  const ms = parseDuration(duration)
  if (ms === null) return null
  return new Date(Date.now() + ms).toISOString()
}

/**
 * Format a duration in milliseconds to a human-readable string
 *
 * @example
 * formatDuration(7_200_000)    // "2h"
 * formatDuration(90_000)       // "1m 30s"
 * formatDuration(86_400_000)   // "1d"
 * formatDuration(90_000_000)   // "1d 1h"
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0m'

  const weeks = Math.floor(ms / UNIT_MS.w)
  ms %= UNIT_MS.w
  const days = Math.floor(ms / UNIT_MS.d)
  ms %= UNIT_MS.d
  const hours = Math.floor(ms / UNIT_MS.h)
  ms %= UNIT_MS.h
  const minutes = Math.floor(ms / UNIT_MS.m)

  const parts: string[] = []
  if (weeks > 0) parts.push(`${weeks}w`)
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)

  return parts.length > 0 ? parts.join(' ') : '<1m'
}

/**
 * Format remaining time from an expiration ISO string to a human-readable string.
 * Returns null if already expired.
 */
export function formatTimeRemaining(expiresAt: string): string | null {
  const remaining = new Date(expiresAt).getTime() - Date.now()
  if (remaining <= 0) return null
  return formatDuration(remaining)
}
