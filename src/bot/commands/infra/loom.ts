/**
 * Loom Commands — /fork, /mu, /stash
 *
 * Thread forking with full loom index and ancestry tracking.
 * Also includes context menu commands for right-click operations.
 */

import {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  type ButtonInteraction,
  type Client,
  type Message,
  type TextChannel,
  type ThreadChannel,
  MessageFlags,
} from 'discord.js'
import { forkToThread } from '../../../infra/loom.js'
import { minifyLink, reconstructLink, getMessageFromLink, lastNormalMessage } from '../../../infra/discord-utils.js'
import { copyMessage } from '../../../infra/webhooks.js'
import { logger } from '../../../utils/logger.js'

// ============================================================================
// /fork — Create a new thread from a message
// ============================================================================

export const forkCommand = new SlashCommandBuilder()
  .setName('fork')
  .setDescription('Fork a new thread from a message (loom)')
  .addStringOption(opt =>
    opt.setName('message_link')
      .setDescription('Link to the message to fork from (defaults to last message)')
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('public')
      .setDescription('Create a public thread (default: true)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('title')
      .setDescription('Custom thread title')
      .setRequired(false)
  )

export async function executeFork(
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  client: Client,
  options?: {
    message?: Message
    isPublic?: boolean
    title?: string
  },
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    let message: Message | undefined | null = options?.message
    let isPublic = options?.isPublic
    let title = options?.title

    // Resolve from slash command options if not provided
    if (!message && interaction.isChatInputCommand()) {
      const messageLink = interaction.options.getString('message_link')
      isPublic = interaction.options.getBoolean('public') ?? true
      title = interaction.options.getString('title') ?? undefined

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
      }
    }

    if (!message) {
      await interaction.editReply({ content: '❌ No message to fork from.' })
      return
    }

    isPublic = isPublic ?? true

    const { thread, indexMessage } = await forkToThread(client, interaction, message, {
      title,
      isPublic,
      reason: `Forked by ${interaction.user.username} via /${interaction.isContextMenuCommand() ? interaction.commandName : 'fork'}`,
    })

    const emoji = isPublic ? '✓' : '✓ :lock:'

    // Build confirmation with +⌥ fork button (lets users quickly chain-fork)
    let content = `.${emoji} **created fork:** ${message.url} ⌥ ${thread.url}`
    if (indexMessage) {
      content += `\n[:twisted_rightwards_arrows: see in loom index](${indexMessage.url})`
    }

    const forkButton = new ButtonBuilder()
      .setCustomId(`fork_button|${minifyLink(message.url)}|${isPublic}`)
      .setLabel('+⌥')
      .setStyle(ButtonStyle.Secondary)

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(forkButton)

    await interaction.editReply({
      content,
      components: [row],
    })

    logger.info({
      userId: interaction.user.id,
      sourceMessageId: message.id,
      threadId: thread.id,
      isPublic,
    }, 'Fork created')
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /fork command')
    await interaction.editReply({
      content: `❌ Failed to fork: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}

// ============================================================================
// /mu — Regenerate (fork from parent message + continue)
// ============================================================================

export const muCommand = new SlashCommandBuilder()
  .setName('mu')
  .setDescription('Regenerate: fork from the message before the target and trigger continuation')
  .addStringOption(opt =>
    opt.setName('message_link')
      .setDescription('Link to the message to regenerate (defaults to last message)')
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('public')
      .setDescription('Create a public thread (default: true)')
      .setRequired(false)
  )

export async function executeMu(
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  client: Client,
  options?: {
    message?: Message
    isPublic?: boolean
  },
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    let message: Message | undefined | null = options?.message
    let isPublic = options?.isPublic

    // Resolve from slash command options if not provided
    if (!message && interaction.isChatInputCommand()) {
      const messageLink = interaction.options.getString('message_link')
      isPublic = interaction.options.getBoolean('public') ?? true

      if (messageLink) {
        message = await getMessageFromLink(client, messageLink)
        if (!message) {
          await interaction.editReply({ content: '❌ Could not find message at that link.' })
          return
        }
      } else {
        // Use lastNormalMessage to skip system/bot messages
        const channel = interaction.channel as TextChannel | ThreadChannel
        const recent = await channel.messages.fetch({ limit: 5 })
        const first = recent.first()
        if (first) {
          message = first.system ? await lastNormalMessage(channel, first, client.user?.id) : first
        }
      }
    }

    if (!message) {
      await interaction.editReply({ content: '❌ No message to regenerate.' })
      return
    }

    isPublic = isPublic ?? true

    // Find the message BEFORE the target (the parent message)
    const channel = message.channel as TextChannel | ThreadChannel
    const parentMessage = await lastNormalMessage(channel, message, client.user?.id)

    if (!parentMessage) {
      await interaction.editReply({ content: '❌ No parent message found to fork from.' })
      return
    }

    // Fork from the parent
    const { thread } = await forkToThread(client, interaction, parentMessage, {
      isPublic,
      reason: `Mu (regenerate) by ${interaction.user.username}`,
    })

    // Send `m continue @author` to trigger the bot to regenerate
    const originalAuthor = message.author
    await thread.send(`m continue ${originalAuthor.toString()}`)

    await interaction.editReply({
      content: `.✓ **mu** (regenerate): ${parentMessage.url} ⌥ ${thread.url}`,
    })

    logger.info({
      userId: interaction.user.id,
      targetMessageId: message.id,
      parentMessageId: parentMessage.id,
      threadId: thread.id,
      triggeredBot: originalAuthor.id,
    }, 'Mu (regenerate) created')
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /mu command')
    await interaction.editReply({
      content: `❌ Failed to regenerate: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}

// ============================================================================
// /stash — Move messages to a fork
// ============================================================================

export const stashCommand = new SlashCommandBuilder()
  .setName('stash')
  .setDescription('Deletes messages from the current channel and moves them to a fork')
  .addStringOption(opt =>
    opt.setName('message_link')
      .setDescription('Link to the first message to stash (defaults to last message)')
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('public')
      .setDescription('Create a public fork (default: true)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('title')
      .setDescription('Custom thread title')
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName('max_messages')
      .setDescription('Maximum messages to stash (default: 10)')
      .setMinValue(1)
      .setMaxValue(100)
      .setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName('stop_at_author_change')
      .setDescription('Stop when message author changes (default: true)')
      .setRequired(false)
  )

export async function executeStash(
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  client: Client,
  options?: {
    message?: Message
    isPublic?: boolean
  },
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    let message: Message | undefined | null = options?.message
    let isPublic = options?.isPublic ?? true
    let title: string | undefined
    let maxMessages = 10
    let stopAtAuthorChange = true

    // Resolve from slash command options if not provided
    if (!message && interaction.isChatInputCommand()) {
      const messageLink = interaction.options.getString('message_link')
      isPublic = interaction.options.getBoolean('public') ?? true
      title = interaction.options.getString('title') ?? undefined
      maxMessages = interaction.options.getInteger('max_messages') ?? 10
      stopAtAuthorChange = interaction.options.getBoolean('stop_at_author_change') ?? true

      if (messageLink) {
        message = await getMessageFromLink(client, messageLink)
        if (!message) {
          await interaction.editReply({ content: '❌ Could not find message at that link.' })
          return
        }
      } else {
        const channel = interaction.channel as TextChannel | ThreadChannel
        const messages = await channel.messages.fetch({ limit: 1 })
        message = messages.first()
      }
    }

    if (!message) {
      await interaction.editReply({ content: '❌ No message to stash.' })
      return
    }

    // Can't stash a message that has a thread attached
    if (message.thread) {
      await interaction.editReply({ content: '❌ Cannot stash a message that has a thread attached.' })
      return
    }

    // Find the parent message to fork from
    const channel = message.channel as TextChannel | ThreadChannel
    const parentMessage = await lastNormalMessage(channel, message, client.user?.id)

    if (!parentMessage) {
      await interaction.editReply({ content: '❌ No parent message found to fork from.' })
      return
    }

    // Create the fork
    const { thread } = await forkToThread(client, interaction, parentMessage, {
      title,
      isPublic,
      reason: `Stash by ${interaction.user.username}`,
    })

    // Copy the target message to the fork and delete the original
    let stashedCount = 0

    await copyMessage(client, message, thread)
    await message.delete()
    stashedCount++

    // Copy subsequent messages from the same author
    if (maxMessages > 1) {
      const followUp = await channel.messages.fetch({
        after: message.id,
        limit: maxMessages - 1,
      })

      // Sort oldest first
      const sorted = [...followUp.values()].reverse()

      for (const msg of sorted) {
        // Stop conditions
        if (stopAtAuthorChange && msg.author.username !== message.author.username) break
        if (msg.thread) break

        await copyMessage(client, msg, thread)
        await msg.delete()
        stashedCount++
      }
    }

    await interaction.editReply({
      content: `.✓ **stashed ${stashedCount} message${stashedCount > 1 ? 's' : ''}** → ${thread.url}`,
    })

    logger.info({
      userId: interaction.user.id,
      stashedCount,
      threadId: thread.id,
      isPublic,
    }, 'Messages stashed')
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /stash command')
    await interaction.editReply({
      content: `❌ Failed to stash: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}

// ============================================================================
// Context menu commands
// ============================================================================

export const forkContextMenu = new ContextMenuCommandBuilder()
  .setName('fork')
  .setType(ApplicationCommandType.Message)

export const forkPrivateContextMenu = new ContextMenuCommandBuilder()
  .setName('fork (private)')
  .setType(ApplicationCommandType.Message)

export const muContextMenu = new ContextMenuCommandBuilder()
  .setName('mu')
  .setType(ApplicationCommandType.Message)

export const stashContextMenu = new ContextMenuCommandBuilder()
  .setName('stash')
  .setType(ApplicationCommandType.Message)

/**
 * Handle context menu interactions for loom commands.
 * Called from the main interaction handler when a message context menu is used.
 */
export async function handleLoomContextMenu(
  interaction: MessageContextMenuCommandInteraction,
  client: Client,
): Promise<void> {
  const message = interaction.targetMessage

  switch (interaction.commandName) {
    case 'fork':
      await executeFork(interaction, client, { message, isPublic: true })
      break
    case 'fork (private)':
      await executeFork(interaction, client, { message, isPublic: false })
      break
    case 'mu':
      await executeMu(interaction, client, { message, isPublic: true })
      break
    case 'stash':
      await executeStash(interaction, client, { message, isPublic: true })
      break
    default:
      logger.warn({ commandName: interaction.commandName }, 'Unknown loom context menu command')
  }
}

// ============================================================================
// Button interaction handler
// ============================================================================

/**
 * Handle button interactions for loom.
 * Called from the main interaction handler when a button with a loom prefix is clicked.
 *
 * Button custom_id formats:
 *   fork_button|<minified_url>|<is_public>  — quick-fork from the +⌥ button
 */
export async function handleLoomButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<boolean> {
  const customId = interaction.customId

  if (customId.startsWith('fork_button|')) {
    const parts = customId.split('|')
    if (parts.length < 3) return false

    const messageUrl = reconstructLink(parts[1]!)
    const isPublic = parts[2]!.toLowerCase() === 'true'

    const message = await getMessageFromLink(client, messageUrl)
    if (!message) {
      await interaction.reply({
        content: '❌ Could not find the original message to fork from.',
        flags: MessageFlags.Ephemeral,
      })
      return true
    }

    // Defer and fork
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const { thread, indexMessage } = await forkToThread(client, interaction, message, {
      isPublic,
      reason: `Chain-forked by ${interaction.user.username} via +⌥ button`,
    })

    let content = `.${isPublic ? '✓' : '✓ :lock:'} **created fork:** ${message.url} ⌥ ${thread.url}`
    if (indexMessage) {
      content += `\n[:twisted_rightwards_arrows: see in loom index](${indexMessage.url})`
    }

    // Include another +⌥ button for chain-forking
    const forkButton = new ButtonBuilder()
      .setCustomId(`fork_button|${minifyLink(message.url)}|${isPublic}`)
      .setLabel('+⌥')
      .setStyle(ButtonStyle.Secondary)

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(forkButton)

    await interaction.editReply({
      content,
      components: [row],
    })

    logger.info({
      userId: interaction.user.id,
      sourceMessageId: message.id,
      threadId: thread.id,
      isPublic,
    }, 'Chain-fork created via +⌥ button')

    return true
  }

  return false // Not a loom button
}
