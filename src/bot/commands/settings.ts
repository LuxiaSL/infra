/**
 * /settings Command
 * 
 * User preferences management (DM opt-in, etc.)
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js'
import type { Database } from 'better-sqlite3'
import { getOrCreateUser, extractDiscordUserInfo } from '../../services/user.js'
import { getUserPreferences, toggleDmOptIn } from '../../services/preferences.js'
import { getUnreadCount } from '../../services/notifications.js'
import { Emoji, Colors } from '../embeds/builders.js'
import { logger } from '../../utils/logger.js'

export const settingsCommand = new SlashCommandBuilder()
  .setName('settings')
  .setDescription('Manage your infra preferences')
  .addSubcommand(sub =>
    sub
      .setName('view')
      .setDescription('View your current settings'))
  .addSubcommand(sub =>
    sub
      .setName('dm')
      .setDescription('Toggle whether Infra can send you DMs'))

export async function executeSettings(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const subcommand = interaction.options.getSubcommand()

  switch (subcommand) {
    case 'view':
      await executeSettingsView(interaction, db)
      break
    case 'dm':
      await executeToggleDm(interaction, db)
      break
    default:
      await interaction.reply({
        content: `${Emoji.CROSS} Unknown subcommand.`,
        flags: MessageFlags.Ephemeral,
      })
  }
}

async function executeSettingsView(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const user = getOrCreateUser(db, interaction.user.id, extractDiscordUserInfo(interaction.user))
  const prefs = getUserPreferences(db, user.id)
  const unreadCount = getUnreadCount(db, user.id)

  const embed = new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle('⚙️ Your Settings')
    .setDescription('Manage how Infra interacts with you')
    .addFields(
      {
        name: '📬 DM Notifications',
        value: prefs.dmOptIn
          ? `${Emoji.CHECK} **Enabled** — You'll receive DMs for tips, transfers, and alerts`
          : `${Emoji.CROSS} **Disabled** — Notifications go to your inbox instead`,
        inline: false,
      },
      {
        name: '📥 Notification Inbox',
        value: unreadCount > 0
          ? `You have **${unreadCount}** unread notification${unreadCount !== 1 ? 's' : ''}. Use \`/notifications\` to view.`
          : 'No unread notifications',
        inline: false,
      }
    )
    .setFooter({ text: 'Use /settings dm to toggle DM notifications' })
    .setTimestamp()

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('settings_toggle_dm')
        .setLabel(prefs.dmOptIn ? '🔕 Disable DMs' : '🔔 Enable DMs')
        .setStyle(prefs.dmOptIn ? ButtonStyle.Secondary : ButtonStyle.Primary),
    )

  if (unreadCount > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('notifications_view')
        .setLabel(`📥 View Inbox (${unreadCount})`)
        .setStyle(ButtonStyle.Primary),
    )
  }

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  })
}

async function executeToggleDm(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const user = getOrCreateUser(db, interaction.user.id, extractDiscordUserInfo(interaction.user))
  const newValue = toggleDmOptIn(db, user.id)

  logger.info({
    userId: user.id,
    dmOptIn: newValue,
  }, 'User toggled DM preference via command')

  const embed = new EmbedBuilder()
    .setColor(newValue ? Colors.SUCCESS_GREEN : Colors.NEUTRAL_GREY)
    .setTitle(newValue ? '🔔 DMs Enabled' : '🔕 DMs Disabled')
    .setDescription(
      newValue
        ? 'You will now receive DM notifications for:\n' +
          '• Tips received\n' +
          '• Transfers received\n' +
          '• Insufficient funds alerts\n\n' +
          '_You can disable this anytime with `/settings dm`_'
        : 'DM notifications are now **disabled**.\n\n' +
          'Important notifications will be stored in your inbox instead.\n' +
          'Use `/notifications` to check for new messages.\n\n' +
          '_You can enable DMs anytime with `/settings dm`_'
    )
    .setTimestamp()

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  })
}

/**
 * Handle settings button interactions
 */
export async function handleSettingsButton(
  customId: string,
  interaction: any,
  db: Database
): Promise<boolean> {
  if (customId === 'settings_toggle_dm') {
    const user = getOrCreateUser(db, interaction.user.id, extractDiscordUserInfo(interaction.user))
    const newValue = toggleDmOptIn(db, user.id)

    logger.info({
      userId: user.id,
      dmOptIn: newValue,
    }, 'User toggled DM preference via button')

    const embed = new EmbedBuilder()
      .setColor(newValue ? Colors.SUCCESS_GREEN : Colors.NEUTRAL_GREY)
      .setTitle(newValue ? '🔔 DMs Enabled' : '🔕 DMs Disabled')
      .setDescription(
        newValue
          ? 'You will now receive DM notifications.'
          : 'DM notifications disabled. Check `/notifications` for updates.'
      )
      .setTimestamp()

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('settings_toggle_dm')
          .setLabel(newValue ? '🔕 Disable DMs' : '🔔 Enable DMs')
          .setStyle(newValue ? ButtonStyle.Secondary : ButtonStyle.Primary),
      )

    await interaction.update({
      embeds: [embed],
      components: [row],
    })
    return true
  }

  return false
}

