/**
 * Soma Discord Bot - Entry Point
 * 
 * This bot handles:
 * - User commands (/balance, /transfer, /costs, /history)
 * - Admin commands (/soma grant, /soma set-cost, etc.)
 * - Reaction watching for rewards and tips
 * - DM notifications (including insufficient funds from API)
 */

import { Client, GatewayIntentBits, Partials, Events, ActivityType } from 'discord.js'
import type { Database } from 'better-sqlite3'
import type { SomaEventBus } from '../types/events.js'
import { registerCommands, handleInteraction } from './commands/index.js'
import { handleReactionAdd } from './handlers/reactions.js'
import { setupNotificationHandlers } from './handlers/notifications.js'
import { logAdminConfig } from '../services/roles.js'
import { logger } from '../utils/logger.js'

/** Discord intents and partials needed for Soma bot functionality */
const CLIENT_OPTIONS = {
  intents: [
    GatewayIntentBits.Guilds,              // Basic guild info
    GatewayIntentBits.GuildMessages,        // Track bot messages
    GatewayIntentBits.GuildMessageReactions, // Watch reactions
    GatewayIntentBits.GuildMembers,         // Get member roles for multipliers
    GatewayIntentBits.DirectMessages,       // Send DM notifications
    GatewayIntentBits.MessageContent,       // Read message content (privileged)
  ],
  partials: [
    Partials.Message,   // Reactions on uncached messages
    Partials.Reaction,  // Partial reaction data
    Partials.Channel,   // DM channels
  ],
}

export class SomaBot {
  private client: Client
  private db: Database
  private token: string
  private eventBus?: SomaEventBus

  constructor(db: Database, token: string, eventBus?: SomaEventBus) {
    this.db = db
    this.token = token
    this.eventBus = eventBus
    this.client = new Client(CLIENT_OPTIONS)

    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    // Ready event
    this.client.once(Events.ClientReady, (readyClient) => {
      logger.info({
        user: readyClient.user.tag,
        guildCount: readyClient.guilds.cache.size,
      }, 'Soma bot connected to Discord')

      // Set activity
      readyClient.user.setActivity('your ichor balance', { type: ActivityType.Watching })

      // Set up notification handlers for API events (insufficient funds, etc.)
      if (this.eventBus) {
        setupNotificationHandlers(this.eventBus, this.client, this.db)
      }
    })

    // Interaction events (commands, buttons, modals)
    this.client.on(Events.InteractionCreate, async (interaction) => {
      try {
        await handleInteraction(interaction, this.db, this.client)
      } catch (error) {
        logger.error({ error }, 'Error handling interaction')
      }
    })

    // Message events — fork thread auto-renaming
    this.client.on(Events.MessageCreate, async (message) => {
      try {
        // Auto-rename fork threads when a new message arrives
        // Fork threads have names ending with ⌥
        if (
          message.channel.isThread() &&
          message.channel.name.endsWith('⌥') &&
          !message.system
        ) {
          // Only rename if the new message is from a different author than the previous
          const recent = await message.channel.messages.fetch({ before: message.id, limit: 1 })
          const prev = recent.first()
          if (!prev || prev.author.id !== message.author.id) {
            const clean = message.content
              .replace(/<@!?\d+>/g, '')
              .replace(/<#\d+>/g, '')
              .replace(/```[\s\S]*?```/g, '')
              .trim()
            if (clean) {
              const newName = '⌥ ' + clean.slice(0, 40) + '...'
              await message.channel.setName(newName.slice(0, 100))
            }
          }
        }
      } catch (error) {
        // Non-critical — just log and move on
        logger.debug({ error, channelId: message.channel.id }, 'Failed to auto-rename fork thread')
      }
    })

    // Reaction events
    this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
      try {
        await handleReactionAdd(reaction, user, this.db, this.client)
      } catch (error) {
        logger.error({ error }, 'Error handling reaction')
      }
    })

    // Error handling
    this.client.on(Events.Error, (error) => {
      logger.error({ error }, 'Discord client error')
    })

    this.client.on(Events.Warn, (message) => {
      logger.warn({ message }, 'Discord client warning')
    })
  }

  async start(): Promise<void> {
    logger.info('Starting Soma Discord bot...')

    // Log admin configuration for verification
    logAdminConfig()

    // Register slash commands
    await registerCommands(this.token)

    // Login to Discord
    await this.client.login(this.token)
  }

  async stop(): Promise<void> {
    logger.info('Stopping Soma Discord bot...')
    this.client.destroy()
  }

  get discordClient(): Client {
    return this.client
  }
}


