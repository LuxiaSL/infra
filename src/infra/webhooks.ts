/**
 * Webhook infrastructure for infra commands
 *
 * Shared by /copy, /send, and /stash commands.
 * Handles webhook creation, caching, and thread-aware sending.
 */

import {
  type TextChannel,
  type ThreadChannel,
  type Message,
  type Webhook,
  type Client,
} from 'discord.js'
import { logger } from '../utils/logger.js'

/** Cache webhooks per channel to avoid repeated API calls. */
const webhookCache = new Map<string, Webhook>()

/**
 * Get or create a webhook owned by the bot in a channel.
 * If the target is a thread, uses the parent channel's webhooks.
 *
 * Discord limits channels to 15 webhooks. We reuse existing ones
 * owned by our bot rather than creating new ones each time.
 */
export async function getOrCreateWebhook(
  client: Client,
  channel: TextChannel | ThreadChannel,
): Promise<Webhook> {
  // Threads use parent channel webhooks
  const targetChannel = 'parent' in channel && channel.parent
    ? channel.parent as TextChannel
    : channel as TextChannel

  // Check cache first
  const cached = webhookCache.get(targetChannel.id)
  if (cached) return cached

  try {
    const webhooks = await targetChannel.fetchWebhooks()
    const botId = client.user?.id

    // Find existing webhook owned by our bot
    const existing = webhooks.find(wh =>
      wh.owner?.id === botId
    )

    if (existing) {
      webhookCache.set(targetChannel.id, existing)
      return existing
    }

    // Create new webhook
    const botUser = client.user!
    const webhook = await targetChannel.createWebhook({
      name: botUser.displayName || botUser.username,
      avatar: botUser.displayAvatarURL(),
      reason: 'Infra bot webhook for /copy, /send, /stash commands',
    })

    webhookCache.set(targetChannel.id, webhook)
    logger.info({ channelId: targetChannel.id }, 'Created new webhook for infra commands')
    return webhook
  } catch (error) {
    logger.error({ channelId: targetChannel.id, error }, 'Failed to get or create webhook')
    throw new Error(`Cannot create webhook in #${targetChannel.name}: missing Manage Webhooks permission?`)
  }
}

/**
 * Send a message via webhook, impersonating a user.
 * Handles thread-aware sending (webhooks live on parent channels
 * but can post to threads via the `threadId` parameter).
 *
 * @returns The sent message
 */
export async function webhookSend(
  webhook: Webhook,
  channel: TextChannel | ThreadChannel,
  options: {
    content: string
    username: string
    avatarURL?: string | null
  },
): Promise<Message> {
  const { content, username, avatarURL } = options

  const sendOptions: Record<string, unknown> = {
    content,
    username,
    avatarURL: avatarURL ?? undefined,
    wait: true, // Return the sent message
  }

  // If target is a thread, pass the thread ID
  if ('parent' in channel && channel.isThread()) {
    sendOptions.threadId = channel.id
  }

  return await webhook.send(sendOptions) as Message
}

/**
 * Copy a message to a destination channel via webhook,
 * preserving the original author's name and avatar.
 *
 * @returns The copied message
 */
export async function copyMessage(
  client: Client,
  message: Message,
  destination: TextChannel | ThreadChannel,
): Promise<Message> {
  const webhook = await getOrCreateWebhook(client, destination)
  return await webhookSend(webhook, destination, {
    content: message.content,
    username: message.author.displayName || message.author.username,
    avatarURL: message.author.avatarURL(),
  })
}

/**
 * Invalidate the webhook cache for a channel.
 * Call this if a webhook is deleted externally.
 */
export function invalidateWebhookCache(channelId: string): void {
  webhookCache.delete(channelId)
}
