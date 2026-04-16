/**
 * Autocomplete Handler
 * 
 * Provides autocomplete suggestions for command options
 */

import { type AutocompleteInteraction } from 'discord.js'
import type { Database } from 'better-sqlite3'
import type { BotCostRow } from '../../types/index.js'
import { getOrCreateServer } from '../../services/user.js'
import { autocompleteBotNames, autocompleteConfigKeys } from '../commands/infra/get-config.js'
import { logger } from '../../utils/logger.js'

export async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  db: Database
): Promise<void> {
  const { commandName, options } = interaction
  const focused = options.getFocused(true)

  logger.debug({
    commandName,
    focusedName: focused.name,
    focusedValue: focused.value,
  }, 'Handling autocomplete')

  // Bot autocomplete for /costs and /soma set-cost (from DB)
  if (focused.name === 'bot' && (commandName === 'costs' || commandName === 'soma')) {
    await handleBotAutocomplete(interaction, db, focused.value)
    return
  }

  // Bot autocomplete for /get_config, /get_prompt, /pause, /unpause (from EMS filesystem)
  if (
    focused.name === 'bot' &&
    (
      commandName === 'get_config'
      || commandName === 'get_prompt'
      || commandName === 'pause'
      || commandName === 'unpause'
    )
  ) {
    const choices = autocompleteBotNames(focused.value)
    await interaction.respond(choices)
    return
  }

  // Config property autocomplete for /get_config
  if (focused.name === 'property' && commandName === 'get_config') {
    const choices = autocompleteConfigKeys(focused.value)
    await interaction.respond(choices)
    return
  }

  // Default: return empty
  await interaction.respond([])
}

async function handleBotAutocomplete(
  interaction: AutocompleteInteraction,
  db: Database,
  query: string
): Promise<void> {
  const serverId = interaction.guildId

  if (!serverId) {
    await interaction.respond([])
    return
  }

  const server = getOrCreateServer(db, serverId)

  // Search for bots matching the query
  const bots = db.prepare(`
    SELECT bot_discord_id, base_cost, description
    FROM bot_costs
    WHERE (server_id = ? OR server_id IS NULL)
    AND (
      bot_discord_id LIKE ?
      OR description LIKE ?
    )
    ORDER BY base_cost ASC
    LIMIT 25
  `).all(server.id, `%${query}%`, `%${query}%`) as BotCostRow[]

  const choices = bots.map(bot => ({
    name: `${bot.description || bot.bot_discord_id} (${bot.base_cost} ichor)`,
    value: bot.bot_discord_id,
  }))

  await interaction.respond(choices)
}


