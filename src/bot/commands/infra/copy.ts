/**
 * /copy Command
 *
 * Copies a message to another channel via webhook, preserving the
 * original author's name and avatar.
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type TextChannel,
  type ThreadChannel,
  MessageFlags,
  ChannelType,
} from 'discord.js'
import { copyMessage } from '../../../infra/webhooks.js'
import { getMessageFromLink } from '../../../infra/discord-utils.js'
import { logger } from '../../../utils/logger.js'

export const copyCommand = new SlashCommandBuilder()
  .setName('copy')
  .setDescription('Copies a message to a channel')
  .addStringOption(opt =>
    opt.setName('message_link')
      .setDescription('Link to the message to copy (defaults to last message)')
      .setRequired(false)
  )
  .addChannelOption(opt =>
    opt.setName('channel')
      .setDescription('Destination channel (defaults to current)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread)
      .setRequired(false)
  )

export async function executeCopy(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const messageLink = interaction.options.getString('message_link')
    const destinationChannel = (interaction.options.getChannel('channel') ?? interaction.channel) as TextChannel | ThreadChannel

    if (!destinationChannel) {
      await interaction.editReply({ content: '❌ Could not resolve destination channel.' })
      return
    }

    // Resolve the source message
    let message
    if (messageLink) {
      message = await getMessageFromLink(client, messageLink)
      if (!message) {
        await interaction.editReply({ content: '❌ Could not find message at that link.' })
        return
      }
    } else {
      // Default to last message in channel
      const channel = interaction.channel as TextChannel | ThreadChannel
      const messages = await channel.messages.fetch({ limit: 1 })
      message = messages.first()
      if (!message) {
        await interaction.editReply({ content: '❌ No messages found in this channel.' })
        return
      }
    }

    const copiedMessage = await copyMessage(client, message, destinationChannel)

    logger.info({
      userId: interaction.user.id,
      sourceMessageId: message.id,
      destinationChannelId: destinationChannel.id,
    }, 'Message copied via /copy')

    await interaction.editReply({
      content: `✓ Copied → ${copiedMessage.url}`,
    })
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /copy command')
    await interaction.editReply({
      content: `❌ Failed to copy message: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}
