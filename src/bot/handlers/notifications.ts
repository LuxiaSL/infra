/**
 * Notification Event Handler
 * 
 * Handles events from the API server to send notifications via Discord
 * Primarily for insufficient funds DM notifications
 * 
 * Respects user DM opt-in preferences - falls back to stored notifications
 * and emoji reactions when DMs are disabled.
 */

import type { Client, TextChannel } from 'discord.js'
import type { Database } from 'better-sqlite3'
import type { InfraEventBus, InsufficientFundsEvent } from '../../types/events.js'
import { createInsufficientFundsEmbed, Emoji } from '../embeds/builders.js'
import { sendDM, createBalanceCheckButtons } from '../notifications/dm.js'
import { getOrCreateUser } from '../../services/user.js'
import { isDmOptedIn } from '../../services/preferences.js'
import { notifyInsufficientFunds } from '../../services/notifications.js'
import { logger } from '../../utils/logger.js'

/**
 * Set up event handlers for API -> Bot notifications
 */
export function setupNotificationHandlers(
  eventBus: InfraEventBus,
  client: Client,
  db: Database
): void {
  logger.info('Setting up notification event handlers')

  eventBus.on('insufficientFunds', async (event: InsufficientFundsEvent) => {
    try {
      await handleInsufficientFunds(client, db, event)
    } catch (error) {
      logger.error({ error, event }, 'Failed to handle insufficient funds notification')
    }
  })

  logger.info('Notification event handlers ready - bot is now fully operational')
}

/**
 * Handle insufficient funds event:
 * 1. Always add 💸 reaction to the triggering message
 * 2. Check if user has opted into DMs
 * 3. If opted in, send DM with details
 * 4. If not opted in (or DM fails), store notification in inbox
 */
async function handleInsufficientFunds(
  client: Client,
  db: Database,
  event: InsufficientFundsEvent
): Promise<void> {
  logger.debug({
    userId: event.userDiscordId,
    channelId: event.channelId,
    messageId: event.messageId,
    cost: event.cost,
    balance: event.currentBalance,
  }, 'Handling insufficient funds notification')

  // 1. Always add 💸 reaction to the triggering message (universal indicator)
  if (event.channelId && event.messageId) {
    try {
      const channel = await client.channels.fetch(event.channelId)
      if (channel?.isTextBased()) {
        const message = await (channel as TextChannel).messages.fetch(event.messageId)
        await message.react(Emoji.INSUFFICIENT) // 💸
        logger.debug({
          messageId: event.messageId,
          emoji: Emoji.INSUFFICIENT,
        }, 'Added insufficient funds reaction')
      }
    } catch (error) {
      logger.error({ error, messageId: event.messageId }, 'Failed to add insufficient funds reaction')
    }
  }

  // Get internal user ID for preferences check
  const user = getOrCreateUser(db, event.userDiscordId)
  const dmOptedIn = isDmOptedIn(db, user.id)

  // 2. If user has opted into DMs, try to send DM
  let dmSent = false
  if (dmOptedIn) {
    try {
      const discordUser = await client.users.fetch(event.userDiscordId)
      
      const embed = createInsufficientFundsEmbed(
        event.botName,
        event.cost,
        event.currentBalance,
        event.regenRate
      )
      
      const buttons = createBalanceCheckButtons()
      
      dmSent = await sendDM(discordUser, {
        embeds: [embed],
        components: [buttons],
      })

      if (dmSent) {
        logger.info({
          userId: event.userDiscordId,
          botName: event.botName,
          cost: event.cost,
          balance: event.currentBalance,
        }, 'Sent insufficient funds DM')
      }
    } catch (error) {
      logger.error({ error, userId: event.userDiscordId }, 'Failed to send insufficient funds DM')
    }
  }

  // 3. If DMs not enabled or DM failed, store notification in inbox
  if (!dmSent) {
    notifyInsufficientFunds(
      db,
      user.id,
      event.botName,
      event.cost,
      event.currentBalance
    )
    
    logger.debug({
      userId: user.id,
      dmOptedIn,
    }, 'Stored insufficient funds notification in inbox')
  }
}

