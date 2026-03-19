/**
 * /config, /config_speakers, /unset_config Commands
 *
 * Manages channel-level bot configuration via pinned .config messages.
 * ChapterX bots read these during config resolution.
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
  type ThreadChannel,
  MessageFlags,
} from 'discord.js'
import { compileConfigMessage } from '../../../infra/config-message.js'
import { logger } from '../../../utils/logger.js'

// ============================================================================
// /config — Set channel configuration
// ============================================================================

export const configCommand = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Set bot configuration for this channel via pinned .config message')
  .addStringOption(opt =>
    opt.setName('targets')
      .setDescription('Bot names to target (space-separated, or "all")')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('continuation_model')
      .setDescription('LLM model to use')
      .setRequired(false)
  )
  .addNumberOption(opt =>
    opt.setName('temperature')
      .setDescription('Sampling temperature (0.0 - 2.0)')
      .setMinValue(0)
      .setMaxValue(2)
      .setRequired(false)
  )
  .addNumberOption(opt =>
    opt.setName('top_p')
      .setDescription('Top-P nucleus sampling (0.0 - 1.0)')
      .setMinValue(0)
      .setMaxValue(1)
      .setRequired(false)
  )
  .addNumberOption(opt =>
    opt.setName('frequency_penalty')
      .setDescription('Frequency penalty (0.0 - 2.0)')
      .setMinValue(0)
      .setMaxValue(2)
      .setRequired(false)
  )
  .addNumberOption(opt =>
    opt.setName('presence_penalty')
      .setDescription('Presence penalty (0.0 - 2.0)')
      .setMinValue(0)
      .setMaxValue(2)
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName('max_tokens')
      .setDescription('Maximum tokens in response')
      .setMinValue(1)
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName('recency_window')
      .setDescription('Number of recent messages to include in context')
      .setMinValue(1)
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName('reply_on_random')
      .setDescription('Random reply chance (0 = never, 1000 = always)')
      .setMinValue(0)
      .setMaxValue(1000)
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('mute')
      .setDescription('Mute the bot in this channel')
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('split_message')
      .setDescription('Split long responses into multiple messages')
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('ignore_dotted_messages')
      .setDescription('Ignore messages starting with .')
      .setRequired(false)
  )

export async function executeConfig(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const channel = interaction.channel as TextChannel | ThreadChannel
    if (!channel) {
      await interaction.editReply({ content: '❌ Cannot use this command here.' })
      return
    }

    // Build config dict from provided options
    const configDict: Record<string, unknown> = {}
    const configKeys = [
      'continuation_model', 'temperature', 'top_p', 'frequency_penalty',
      'presence_penalty', 'max_tokens', 'recency_window', 'reply_on_random',
      'mute', 'split_message', 'ignore_dotted_messages',
    ]

    for (const key of configKeys) {
      const value = interaction.options.get(key)?.value
      if (value !== undefined && value !== null) {
        configDict[key] = value
      }
    }

    if (Object.keys(configDict).length === 0) {
      await interaction.editReply({
        content: '❌ No config options provided. Use at least one option.',
      })
      return
    }

    // Parse targets
    const targetsStr = interaction.options.getString('targets')
    const targets = targetsStr ? targetsStr.split(/\s+/).filter(Boolean) : undefined

    const content = compileConfigMessage('config', configDict, targets)
    const configMsg = await channel.send(content)
    await configMsg.pin()

    const keyList = Object.keys(configDict).join(', ')
    const targetLabel = targets ? ` for ${targets.join(', ')}` : ''

    logger.info({
      userId: interaction.user.id,
      channelId: channel.id,
      keys: Object.keys(configDict),
      targets,
    }, 'Config set via /config')

    await interaction.editReply({
      content: `✓ Set **${keyList}**${targetLabel} → ${configMsg.url}`,
    })
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /config command')
    await interaction.editReply({
      content: `❌ Failed to set config: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}

// ============================================================================
// /config_speakers — Set may_speak list
// ============================================================================

export const configSpeakersCommand = new SlashCommandBuilder()
  .setName('config_speakers')
  .setDescription('Set which bots may speak in this channel')
  .addStringOption(opt =>
    opt.setName('speakers')
      .setDescription('Space-separated list of bot names that may speak')
      .setRequired(true)
  )

export async function executeConfigSpeakers(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const channel = interaction.channel as TextChannel | ThreadChannel
    if (!channel) {
      await interaction.editReply({ content: '❌ Cannot use this command here.' })
      return
    }

    const speakersStr = interaction.options.getString('speakers', true)
    const speakers = speakersStr.split(/\s+/).filter(Boolean)

    if (speakers.length === 0) {
      await interaction.editReply({ content: '❌ Provide at least one bot name.' })
      return
    }

    const content = compileConfigMessage('config', { may_speak: speakers })
    const configMsg = await channel.send(content)
    await configMsg.pin()

    logger.info({
      userId: interaction.user.id,
      channelId: channel.id,
      speakers,
    }, 'Speakers set via /config_speakers')

    await interaction.editReply({
      content: `✓ Set **may_speak** to [${speakers.join(', ')}] → ${configMsg.url}`,
    })
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /config_speakers command')
    await interaction.editReply({
      content: `❌ Failed to set speakers: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}

// ============================================================================
// /unset_config — Remove all pinned .config messages
// ============================================================================

export const unsetConfigCommand = new SlashCommandBuilder()
  .setName('unset_config')
  .setDescription('Remove all pinned .config messages in this channel (reset to base config)')

export async function executeUnsetConfig(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const channel = interaction.channel as TextChannel | ThreadChannel
    if (!channel) {
      await interaction.editReply({ content: '❌ Cannot use this command here.' })
      return
    }

    const pins = await channel.messages.fetchPinned()
    let unpinned = 0

    for (const pin of pins.values()) {
      if (pin.content.startsWith('.config')) {
        try {
          await pin.unpin()
          unpinned++
        } catch (error) {
          logger.warn({ messageId: pin.id, error }, 'Failed to unpin config message')
        }
      }
    }

    logger.info({
      userId: interaction.user.id,
      channelId: channel.id,
      unpinnedCount: unpinned,
    }, 'Config cleared via /unset_config')

    await interaction.editReply({
      content: unpinned > 0
        ? `✓ Unpinned **${unpinned}** .config message${unpinned > 1 ? 's' : ''}.`
        : 'No .config messages found in pins.',
    })
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /unset_config command')
    await interaction.editReply({
      content: `❌ Failed to clear config: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}
