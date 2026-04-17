/**
 * Autocomplete Handler
 * 
 * Provides autocomplete suggestions for command options
 */

import { type AutocompleteInteraction, type GuildMember } from 'discord.js'
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

  // Bot autocomplete for /get_config, /get_prompt (from EMS filesystem —
  // these need access to bot config YAML files, so the EMS directory name is
  // the right key).
  if (
    focused.name === 'bot' &&
    (
      commandName === 'get_config'
      || commandName === 'get_prompt'
    )
  ) {
    const choices = autocompleteBotNames(focused.value)
    await interaction.respond(choices)
    return
  }

  // Bot autocomplete for /pause, /unpause — iterate this guild's bot members.
  // Guild membership is the canonical source because (a) it works for any bot,
  // not just ones registered in EMS or `bot_costs`, and (b) it gives us the
  // Discord user ID to emit as an unambiguous `<@id>` mention in the pin —
  // ChapterX matches pins by botId / config name / Discord username / global
  // name / user ID, so the mention is always resolvable.
  if (
    focused.name === 'bot' &&
    (commandName === 'pause' || commandName === 'unpause')
  ) {
    await handleBotGuildMemberAutocomplete(interaction, focused.value)
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

/**
 * Autocomplete bot users in the current guild. Filters guild members to only
 * those whose Discord user is a bot. The displayed choice name is the global
 * display name (what humans see in Discord); the submitted value is the bot's
 * Discord user ID, which /pause will format as a `<@id>` mention in the pin.
 */
async function handleBotGuildMemberAutocomplete(
  interaction: AutocompleteInteraction,
  query: string,
): Promise<void> {
  const guild = interaction.guild
  if (!guild) {
    await interaction.respond([])
    return
  }

  const q = query.trim().toLowerCase()
  const matches: GuildMember[] = []
  for (const member of guild.members.cache.values()) {
    if (!member.user.bot) continue
    if (member.user.id === interaction.client.user?.id) continue  // don't list self
    if (q.length > 0) {
      const displayName = (member.displayName ?? '').toLowerCase()
      const globalName = (member.user.globalName ?? '').toLowerCase()
      const username = member.user.username.toLowerCase()
      if (
        !displayName.includes(q)
        && !globalName.includes(q)
        && !username.includes(q)
      ) continue
    }
    matches.push(member)
    if (matches.length >= 25) break  // Discord's hard limit on choices
  }

  // Sort alphabetically by display name for stable UX.
  matches.sort((a, b) => a.displayName.localeCompare(b.displayName))

  const choices = matches.map(m => ({
    name: `${m.displayName} (@${m.user.username})`.slice(0, 100),  // Discord: choice name ≤ 100 chars
    value: m.user.id,
  }))

  await interaction.respond(choices)
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


