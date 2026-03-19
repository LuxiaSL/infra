/**
 * Discord utility functions for infra commands
 *
 * Message resolution, link parsing, embed construction, and other
 * shared helpers used across loom, config, and webhook commands.
 */

import {
  type Message,
  type TextChannel,
  type ThreadChannel,
  type Client,
  type Channel,
  EmbedBuilder,
} from 'discord.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Link parsing
// ============================================================================

/** Discord message link pattern: https://discord.com/channels/{guild}/{channel}/{message} */
const MESSAGE_LINK_RE = /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/

export interface ParsedMessageLink {
  guildId: string
  channelId: string
  messageId: string
}

/**
 * Parse a Discord message URL into its components.
 * Supports ptb. and canary. subdomains.
 */
export function parseMessageLink(link: string): ParsedMessageLink | null {
  const match = link.match(MESSAGE_LINK_RE)
  if (!match) return null
  return {
    guildId: match[1]!,
    channelId: match[2]!,
    messageId: match[3]!,
  }
}

/**
 * Minify a full Discord message link to guild/channel/message format.
 * Used for button custom_id storage (Discord has 100-char limit on custom_id).
 */
export function minifyLink(link: string): string {
  const parsed = parseMessageLink(link)
  if (!parsed) return link
  return `${parsed.guildId}/${parsed.channelId}/${parsed.messageId}`
}

/** Reconstruct a full Discord message link from minified format. */
export function reconstructLink(minified: string): string {
  return `https://discord.com/channels/${minified}`
}

// ============================================================================
// Message fetching
// ============================================================================

/** Channel cache to avoid redundant API calls within a single operation. */
const channelCache = new Map<string, Channel>()

/**
 * Fetch a channel by ID, using cache for repeated lookups.
 * Returns null if the channel doesn't exist or isn't accessible.
 */
export async function getChannelCached(client: Client, channelId: string): Promise<Channel | null> {
  const cached = channelCache.get(channelId)
  if (cached) return cached

  try {
    const channel = client.channels.cache.get(channelId) ?? await client.channels.fetch(channelId)
    if (channel) {
      channelCache.set(channelId, channel)
    }
    return channel
  } catch (error) {
    logger.debug({ channelId, error }, 'Failed to fetch channel')
    return null
  }
}

/**
 * Fetch a message from a Discord message link.
 * Returns null if the message doesn't exist or isn't accessible.
 */
export async function getMessageFromLink(client: Client, link: string): Promise<Message | null> {
  const parsed = parseMessageLink(link)
  if (!parsed) return null

  try {
    const channel = await getChannelCached(client, parsed.channelId)
    if (!channel || !('messages' in channel)) return null

    const textChannel = channel as TextChannel | ThreadChannel
    return await textChannel.messages.fetch(parsed.messageId)
  } catch (error) {
    logger.debug({ link, error }, 'Failed to fetch message from link')
    return null
  }
}

/**
 * Get the thread attached to a message (if any).
 * In Discord, a thread created from a message has the same ID as the message.
 */
export async function getThreadFromMessage(client: Client, message: Message): Promise<ThreadChannel | null> {
  try {
    const channel = await getChannelCached(client, message.id)
    if (channel && 'isThread' in channel && (channel as ThreadChannel).isThread()) {
      return channel as ThreadChannel
    }
    return null
  } catch {
    return null
  }
}

/**
 * Find the last "normal" message before a target message in a channel.
 * Normal = not system, not a bot message from the infra bot.
 */
export async function lastNormalMessage(
  channel: TextChannel | ThreadChannel,
  before: Message,
  botId?: string,
): Promise<Message | null> {
  const messages = await channel.messages.fetch({ before: before.id, limit: 10 })
  for (const msg of messages.values()) {
    if (msg.system) continue
    if (botId && msg.author.id === botId) continue
    return msg
  }
  return null
}

// ============================================================================
// Embeds
// ============================================================================

/**
 * Build a preview embed from a message, matching chapter2's embed_from_message format.
 * Shows author, content preview, timestamp, and link.
 */
export function embedFromMessage(
  message: Message,
  options: {
    maxLength?: number
    anchorAtEnd?: boolean
    color?: number
    timestamp?: boolean
  } = {},
): EmbedBuilder {
  const {
    maxLength,
    anchorAtEnd = false,
    color = 0x5865F2, // Discord blurple
    timestamp = true,
  } = options

  let content = message.content || ''
  if (maxLength && content.length > maxLength) {
    content = anchorAtEnd
      ? '...' + content.slice(-maxLength)
      : content.slice(0, maxLength) + '...'
  }
  content += `\n-# :link: ${message.url}`

  const embed = new EmbedBuilder()
    .setDescription(content)
    .setColor(color)

  embed.setAuthor({
    name: message.author.displayName || message.author.username,
    iconURL: message.author.displayAvatarURL(),
    url: message.url,
  })

  if (timestamp) {
    embed.setTimestamp(message.createdAt)
  }

  return embed
}

// ============================================================================
// Text preview
// ============================================================================

/**
 * Generate a short text preview from a message, used for thread titles.
 * @param maxLength - Maximum length of the preview
 * @param anchorAtEnd - If true, show the end of the message (not the start)
 */
export function messagePreviewText(
  message: Message,
  maxLength: number = 20,
  anchorAtEnd: boolean = true,
): string {
  // Strip Discord formatting and mentions for cleaner titles
  const clean = message.content
    .replace(/<@!?\d+>/g, '@user')
    .replace(/<#\d+>/g, '#channel')
    .replace(/<@&\d+>/g, '@role')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`[^`]+`/g, '[code]')
    .trim()

  if (!clean) return 'untitled'
  if (clean.length <= maxLength) return clean

  return anchorAtEnd
    ? '...' + clean.slice(-maxLength)
    : clean.slice(0, maxLength) + '...'
}
