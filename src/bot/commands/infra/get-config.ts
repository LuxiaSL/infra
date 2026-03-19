/**
 * /get_config Command
 *
 * Retrieves the effective configuration for a bot in the current channel.
 * Reads pinned .config messages and overlays them onto the bot's base config.
 *
 * Uses the EMS config layout on disk to load base configs.
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
  type ThreadChannel,
  MessageFlags,
  AttachmentBuilder,
} from 'discord.js'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { CONFIG_KEYS } from '../../../infra/config-message.js'
import { logger } from '../../../utils/logger.js'

/** Sensitive keys to strip from config output */
const SENSITIVE_KEYS = [
  'discord_token',
  'api_key',
  'openai_api_key',
  'anthropic_api_key',
  'openrouter_api_key',
  'token',
  'secret',
  'password',
]

/**
 * EMS path — the directory containing bot configs in EMS layout.
 * Expected structure: {EMS_PATH}/{botName}/config.yaml
 */
function getEmsPath(): string {
  return process.env.EMS_PATH || '/opt/chapter2/ems'
}

export const getConfigCommand = new SlashCommandBuilder()
  .setName('get_config')
  .setDescription('View the effective config for a bot in this channel')
  .addStringOption(opt =>
    opt.setName('bot')
      .setDescription('Bot name to check config for')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(opt =>
    opt.setName('property')
      .setDescription('Specific config property to view (returns full config if blank)')
      .setRequired(false)
      .setAutocomplete(true)
  )

export async function executeGetConfig(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const botName = interaction.options.getString('bot', true)
    const property = interaction.options.getString('property')
    const channel = interaction.channel as TextChannel | ThreadChannel

    if (!channel) {
      await interaction.editReply({ content: '❌ Cannot use this command here.' })
      return
    }

    // Load base config from EMS
    const emsPath = getEmsPath()
    const configPath = join(emsPath, botName, 'config.yaml')

    if (!existsSync(configPath)) {
      await interaction.editReply({
        content: `❌ No config found for bot **${botName}** at ${configPath}`,
      })
      return
    }

    let config: Record<string, unknown>
    try {
      const raw = readFileSync(configPath, 'utf-8')
      config = yamlParse(raw) as Record<string, unknown>
    } catch (error) {
      await interaction.editReply({
        content: `❌ Failed to parse config for **${botName}**: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
      return
    }

    // Overlay pinned .config messages from this channel
    try {
      const pins = await channel.messages.fetchPinned()
      // Process oldest first (so newest overrides oldest)
      const configPins = [...pins.values()]
        .filter(msg => msg.content.startsWith('.config'))
        .reverse()

      for (const pin of configPins) {
        const yamlStart = pin.content.indexOf('---')
        if (yamlStart === -1) continue

        // Check targeting: does this config apply to our bot?
        const headerLine = pin.content.slice(0, yamlStart).trim()
        const targets = headerLine.slice('.config'.length).trim()

        if (targets && !targets.split(/\s+/).some(t =>
          t.toLowerCase() === botName.toLowerCase() ||
          t === 'all'
        )) {
          continue // This config targets other bots
        }

        try {
          const yamlContent = pin.content.slice(yamlStart + 3).trim()
          // Strip markdown code blocks if present
          const cleanYaml = yamlContent
            .replace(/^```(?:yaml)?\n?/m, '')
            .replace(/\n?```$/m, '')

          const overrides = yamlParse(cleanYaml)
          if (overrides && typeof overrides === 'object') {
            Object.assign(config, overrides)
          }
        } catch {
          // Skip malformed config pins
        }
      }
    } catch (error) {
      logger.warn({ error, channelId: channel.id }, 'Failed to fetch pinned configs (may be rate limited)')
      // Continue with base config only
    }

    // Strip sensitive keys
    for (const key of SENSITIVE_KEYS) {
      delete config[key]
    }

    // Return specific property or full config
    if (property) {
      const value = config[property]
      if (value === undefined) {
        await interaction.editReply({
          content: `**${botName}**.${property} is not set.`,
        })
      } else {
        const formatted = typeof value === 'object'
          ? '```yaml\n' + yamlStringify(value, { lineWidth: 0 }) + '```'
          : `\`${String(value)}\``
        await interaction.editReply({
          content: `**${botName}**.${property} = ${formatted}`,
        })
      }
    } else {
      // Return full config as YAML file
      const yamlOutput = yamlStringify(config, { lineWidth: 0 })
      const filename = `${botName}-config.yaml`
      const attachment = new AttachmentBuilder(
        Buffer.from(yamlOutput, 'utf-8'),
        { name: filename },
      )

      await interaction.editReply({
        content: `Config for **${botName}** in <#${channel.id}>:`,
        files: [attachment],
      })
    }

    logger.info({
      userId: interaction.user.id,
      botName,
      channelId: channel.id,
      property,
    }, 'Config retrieved via /get_config')
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /get_config command')
    await interaction.editReply({
      content: `❌ Failed to get config: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}

// ============================================================================
// Autocomplete handlers
// ============================================================================

/**
 * Provide autocomplete for bot names from EMS directory.
 */
export function autocompleteBotNames(query: string): Array<{ name: string; value: string }> {
  try {
    const emsPath = getEmsPath()
    if (!existsSync(emsPath)) return []

    const dirs = readdirSync(emsPath, { withFileTypes: true })
    return dirs
      .filter(d => d.isDirectory())
      .filter(d => existsSync(join(emsPath, d.name, 'config.yaml')))
      .filter(d => d.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 25) // Discord autocomplete limit
      .map(d => ({ name: d.name, value: d.name }))
  } catch {
    return []
  }
}

/**
 * Provide autocomplete for config property names.
 */
export function autocompleteConfigKeys(query: string): Array<{ name: string; value: string }> {
  return Object.entries(CONFIG_KEYS)
    .filter(([key]) => key.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 25)
    .map(([key, desc]) => ({ name: `${key} — ${desc}`, value: key }))
}
