/**
 * Infra - Discord Bot Service
 *
 * Entry point for the Infra API server and Discord bot
 */

import 'dotenv/config'
import { EventEmitter } from 'events'

import { loadConfig } from './config.js'
import { initDatabase, closeDatabase } from './db/connection.js'
import { ApiServer } from './api/server.js'
import { InfraBot } from './bot/index.js'
import { cleanupExpiredMessages } from './services/tracking.js'
import { setConfigDatabase } from './services/config.js'
import { setRewardDatabase, cleanupRewardCooldowns } from './bot/handlers/reactions.js'
import { logger } from './utils/logger.js'
import type { InfraEventBus } from './types/events.js'

async function main(): Promise<void> {
  logger.info('Starting Infra...')

  // Load configuration
  const config = loadConfig()
  logger.info({
    port: config.port,
    databasePath: config.databasePath,
    tokenCount: config.serviceTokens.length,
    botEnabled: !!config.discordToken,
  }, 'Configuration loaded')

  // Initialize database
  const db = initDatabase(config.databasePath)

  // Initialize config service with database for runtime-configurable settings
  setConfigDatabase(db)

  // Initialize reward tracking with database
  setRewardDatabase(db)

  // Create shared event bus for API <-> Bot communication
  const eventBus = new EventEmitter() as InfraEventBus
  eventBus.setMaxListeners(20) // Prevent warnings for multiple listeners

  // Create API server (pass eventBus for insufficient funds notifications)
  const server = new ApiServer(config, db, eventBus)

  // Create Discord bot (if token is configured)
  let bot: InfraBot | null = null
  if (config.discordToken) {
    bot = new InfraBot(db, config.discordToken, eventBus)
  } else {
    logger.warn('SOMA_DISCORD_TOKEN not set - Discord bot will not start')
  }

  // Handle graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down...')

    if (bot) {
      await bot.stop()
    }
    await server.stop()
    closeDatabase(db)

    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Start API server
  await server.start()
  logger.info(`Infra API ready at http://localhost:${config.port}`)

  // Start Discord bot
  if (bot) {
    await bot.start()
  }

  // Start periodic cleanup of expired tracked messages and old reward entries
  setInterval(() => {
    try {
      cleanupExpiredMessages(db)
      cleanupRewardCooldowns()
    } catch (error) {
      logger.error({ error }, 'Error during periodic cleanup')
    }
  }, 60 * 60 * 1000) // Every hour

  logger.info('Infra startup complete')
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start Infra')
  process.exit(1)
})
