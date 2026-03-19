/**
 * /history Command (splice)
 *
 * Sends a .history dot-command message and pins it, creating a context
 * splice point. ChapterX bots follow .history messages during context
 * assembly to jump to linked message ranges.
 *
 * Note: Named history-splice.ts to avoid collision with soma's existing
 * /history command (transaction history). The slash command is registered
 * as /history_splice to avoid the name conflict.
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

export const historySpliceCommand = new SlashCommandBuilder()
  .setName('history_splice')
  .setDescription('Splice history range into context by sending a .history message')
  .addStringOption(opt =>
    opt.setName('last')
      .setDescription('Link to the last (newest) message to include')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('first')
      .setDescription('Link to the first (oldest) message to include')
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('passthrough')
      .setDescription('If true, messages before the splice are still included (default: false)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('targets')
      .setDescription('Bot names this applies to (space-separated, or blank for all)')
      .setRequired(false)
  )

export async function executeHistorySplice(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const channel = interaction.channel as TextChannel | ThreadChannel
    if (!channel) {
      await interaction.editReply({ content: '❌ Cannot use this command here.' })
      return
    }

    const last = interaction.options.getString('last')
    const first = interaction.options.getString('first')
    const passthrough = interaction.options.getBoolean('passthrough')

    // Build the YAML config
    const configDict: Record<string, unknown> = {}
    if (last) configDict.last = last
    if (first) configDict.first = first
    if (passthrough !== null && passthrough !== undefined) {
      configDict.passthrough = passthrough
    }

    // Parse targets
    const targetsStr = interaction.options.getString('targets')
    const targets = targetsStr ? targetsStr.split(/\s+/).filter(Boolean) : undefined

    // If no options at all, this is a bare .history (context clear)
    const content = compileConfigMessage('history', configDict, targets)
    const historyMsg = await channel.send(content)

    // Pin the .history message so it's always in the channel timeline
    try {
      await historyMsg.pin()
    } catch (error) {
      logger.warn({ messageId: historyMsg.id, error }, 'Failed to pin .history message (may be at pin limit)')
    }

    const description = last
      ? `Splicing context from${first ? ` ${first} to` : ''} ${last}${passthrough ? ' (passthrough)' : ''}`
      : 'Context cleared (bare .history)'

    logger.info({
      userId: interaction.user.id,
      channelId: channel.id,
      last,
      first,
      passthrough,
      targets,
    }, 'History splice created')

    await interaction.editReply({
      content: `✓ ${description} → ${historyMsg.url}`,
    })
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /history_splice command')
    await interaction.editReply({
      content: `❌ Failed to create history splice: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}
