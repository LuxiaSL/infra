/**
 * /send Command
 *
 * Sends a message to a channel from a given user via webhook.
 * Allows impersonating any user's name and avatar.
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
import { getOrCreateWebhook, webhookSend } from '../../../infra/webhooks.js'
import { logger } from '../../../utils/logger.js'

export const sendCommand = new SlashCommandBuilder()
  .setName('send')
  .setDescription('Sends a message to a channel from a given user')
  .addStringOption(opt =>
    opt.setName('content')
      .setDescription('Message content to send')
      .setRequired(true)
  )
  .addUserOption(opt =>
    opt.setName('user')
      .setDescription('User to impersonate (uses their name and avatar)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('username')
      .setDescription('Custom username (overrides user option)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('avatar_url')
      .setDescription('Custom avatar URL (overrides user option)')
      .setRequired(false)
  )
  .addChannelOption(opt =>
    opt.setName('channel')
      .setDescription('Destination channel (defaults to current)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread)
      .setRequired(false)
  )

export async function executeSend(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const content = interaction.options.getString('content', true)
    const user = interaction.options.getUser('user')
    const customUsername = interaction.options.getString('username')
    const customAvatarUrl = interaction.options.getString('avatar_url')
    const channel = (interaction.options.getChannel('channel') ?? interaction.channel) as TextChannel | ThreadChannel

    if (!channel) {
      await interaction.editReply({ content: '❌ Could not resolve destination channel.' })
      return
    }

    // Resolve username: custom > user option > interaction user
    const username = customUsername
      ?? user?.displayName
      ?? user?.username
      ?? interaction.user.displayName
      ?? interaction.user.username

    // Resolve avatar: custom > user option > interaction user
    const avatarURL = customAvatarUrl
      ?? user?.avatarURL()
      ?? interaction.user.avatarURL()

    const webhook = await getOrCreateWebhook(client, channel)
    const sentMessage = await webhookSend(webhook, channel, {
      content,
      username,
      avatarURL,
    })

    logger.info({
      userId: interaction.user.id,
      impersonating: username,
      channelId: channel.id,
    }, 'Message sent via /send')

    await interaction.editReply({
      content: `✓ Sent as **${username}** → ${sentMessage.url}`,
    })
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /send command')
    await interaction.editReply({
      content: `❌ Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}
