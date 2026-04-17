/**
 * /pause and /unpause — admin-gated infra commands for temporarily muting
 * chapterx bots in a channel.
 *
 * Mechanics:
 *   - /pause pins a `.pause <botName>` message with `started_at`, optional
 *     `duration_seconds`, optional `messages`, and optional `reason`. ChapterX
 *     bots honor this locally via their event-driven pin tracker — soma does
 *     not need to talk to chapterx directly.
 *   - A row is also written to `bot_pauses` so soma can schedule the unpin
 *     when the duration expires (survives soma restarts via the sweeper).
 *   - /unpause deletes the row and unpins the message immediately.
 *
 * Only one active pause per (channel, bot). Re-running /pause replaces the
 * existing pause (upsert) — the old pinned message is unpinned as part of the
 * transition.
 *
 * At least one of `duration` / `messages` must be provided. `duration` is
 * always recorded as an `expires_at` (even when messages-only, defaulting to
 * 24h) so the sweeper always cleans up the pin.
 *
 * Hard cap: 24h on any single pause. Admins can re-run /pause to extend.
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
  type TextChannel,
  type ThreadChannel,
  type Message,
} from 'discord.js'
import type { Database } from 'better-sqlite3'
import { compileConfigMessage } from '../../../infra/config-message.js'
import { markPinsDirty } from '../../../infra/pin-cache.js'
import { hasAdminRole } from '../admin.js'
import { getOrCreateServer } from '../../../services/user.js'
import { createPause, removePause } from '../../../services/pauses.js'
import { parseDuration, formatDuration } from '../../../utils/time.js'
import { Emoji, Colors } from '../../embeds/builders.js'
import { logger } from '../../../utils/logger.js'

// 24h cap on any single pause.
const MAX_PAUSE_MS = 24 * 60 * 60 * 1000

// Fallback expires_at window for messages-only pauses — hygiene for the
// sweeper only; chapterx ends the pause at the message count.
const MESSAGES_ONLY_EXPIRY_MS = 24 * 60 * 60 * 1000

// ============================================================================
// /pause
// ============================================================================

export const pauseCommand = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Temporarily mute a chapterx bot in this channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(opt =>
    opt.setName('bot')
      .setDescription('Bot to pause (autocomplete from EMS directory)')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(opt =>
    opt.setName('duration')
      .setDescription('Duration (e.g., 30m, 2h). Max 24h.')
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName('messages')
      .setDescription('Number of non-dot messages (from any author) before unpause')
      .setMinValue(1)
      .setMaxValue(10_000)
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Human-readable reason (optional)')
      .setMaxLength(200)
      .setRequired(false)
  )

export async function executePause(
  interaction: ChatInputCommandInteraction,
  db: Database,
  _client: Client,
): Promise<void> {
  // Runtime admin check on top of the default-member-permissions hide
  if (!hasAdminRole(interaction, db)) {
    logger.warn({
      userId: interaction.user.id,
      command: interaction.commandName,
    }, 'Unauthorized /pause attempt')
    await interaction.reply({
      content: `${Emoji.CROSS} You don't have permission to use this command.`,
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const channel = interaction.channel as TextChannel | ThreadChannel | null
  const serverId = interaction.guildId

  if (!channel || !serverId) {
    await interaction.editReply({
      content: `${Emoji.CROSS} This command must be run in a server text channel.`,
    })
    return
  }

  // The autocompleted value is the target bot's Discord user ID. If an admin
  // skipped autocomplete and typed something else (a display name, etc.),
  // resolve it against the guild's bot members — tolerant of whatever the
  // admin might type.
  const rawBot = interaction.options.getString('bot', true).trim()
  const botMember = resolveBotMember(interaction, rawBot)
  if (!botMember) {
    await interaction.editReply({
      content: `${Emoji.CROSS} Could not find a bot matching \`${rawBot}\` in this server. Pick one from autocomplete.`,
    })
    return
  }
  const botUserId = botMember.user.id
  const botDisplay = botMember.displayName  // for human-facing output only

  const durationStr = interaction.options.getString('duration') ?? undefined
  const messages = interaction.options.getInteger('messages') ?? undefined
  const reason = interaction.options.getString('reason') ?? undefined

  if (!durationStr && messages === undefined) {
    await interaction.editReply({
      content: `${Emoji.CROSS} Provide at least one of \`duration\` or \`messages\`.`,
    })
    return
  }

  // Parse + validate duration.
  let durationMs: number | null = null
  if (durationStr) {
    durationMs = parseDuration(durationStr)
    if (durationMs === null) {
      await interaction.editReply({
        content: `${Emoji.CROSS} Invalid duration \`${durationStr}\`. Use formats like \`30m\`, \`2h\`, \`1d\`.`,
      })
      return
    }
    if (durationMs > MAX_PAUSE_MS) {
      await interaction.editReply({
        content: `${Emoji.CROSS} Duration cannot exceed 24h. Re-run /pause to extend.`,
      })
      return
    }
  }

  const now = new Date()
  const startedAt = now.toISOString()
  const effectiveMs = durationMs ?? MESSAGES_ONLY_EXPIRY_MS
  const expiresAtDate = new Date(now.getTime() + effectiveMs)
  const expiresAt = expiresAtDate.toISOString()

  // Build the .pause pinned message. The target line becomes `.pause <botName>`.
  const pauseBody: Record<string, unknown> = {
    started_at: startedAt,
  }
  if (durationMs !== null) {
    pauseBody.duration_seconds = Math.round(durationMs / 1000)
  }
  if (messages !== undefined) {
    pauseBody.messages = messages
  }
  if (reason) {
    pauseBody.reason = reason
  }
  // Write the pin with a canonical `<@id>` mention so chapterx resolves the
  // target by Discord user ID (unambiguous across config-name vs display-name).
  const content = compileConfigMessage('pause', pauseBody, [`<@${botUserId}>`])

  // Step 1: send the new .pause message.
  let pauseMsg: Message
  try {
    pauseMsg = await channel.send(content)
  } catch (error) {
    logger.error({ error, channelId: channel.id, botUserId, botDisplay }, 'Failed to send .pause message')
    await interaction.editReply({
      content: `${Emoji.CROSS} Failed to send .pause message: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
    return
  }

  // Step 2: pin the new message. On failure, delete the stray send and abort.
  try {
    await pauseMsg.pin()
  } catch (error) {
    logger.error({ error, channelId: channel.id, messageId: pauseMsg.id }, 'Failed to pin .pause message')
    pauseMsg.delete().catch(() => {})  // best effort cleanup
    await interaction.editReply({
      content: `${Emoji.CROSS} Failed to pin .pause message: ${error instanceof Error ? error.message : 'Unknown error'}. Check bot permissions.`,
    })
    return
  }

  // Step 3: upsert DB row. This returns the previous pinned message id (if
  // we're replacing an existing pause) so we can unpin it.
  const server = getOrCreateServer(db, serverId, interaction.guild?.name)
  const pauseResult = createPause(db, {
    serverInternalId: server.id,
    channelId: channel.id,
    botName: botUserId,  // DB key: Discord user ID — unambiguous across rename/display-name changes
    messageId: pauseMsg.id,
    startedAt,
    expiresAt,
    ...(messages !== undefined ? { messagesInitial: messages } : {}),
    createdBy: interaction.user.id,
    ...(reason ? { reason } : {}),
  })

  // Step 4: best-effort unpin of the replaced message.
  if (pauseResult.replacedMessageId) {
    unpinMessageIfPresent(channel, pauseResult.replacedMessageId).catch(err =>
      logger.warn({ err, messageId: pauseResult.replacedMessageId }, 'Failed to unpin replaced .pause'),
    )
  }

  // Step 5: mark soma's own pin cache dirty.
  markPinsDirty(channel.id)

  // Compose the admin-facing ephemeral reply.
  const gateSummary = [
    durationMs !== null ? formatDuration(durationMs) : null,
    messages !== undefined ? `${messages} message${messages === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' or ')

  logger.info({
    pauseId: pauseResult.id,
    userId: interaction.user.id,
    serverId,
    channelId: channel.id,
    botUserId,
    botDisplay,
    messageId: pauseMsg.id,
    durationMs,
    messages,
    reason,
    replacedExisting: pauseResult.replacedExisting,
  }, 'Pause created via /pause')

  await interaction.editReply({
    content:
      `${Emoji.CHECK} Paused **${botDisplay}** in this channel ` +
      `for ${gateSummary}` +
      (pauseResult.replacedExisting ? ` (replaced previous pause).` : `.`) +
      `\n→ ${pauseMsg.url}`,
  })

  // Public channel announcement, mirroring /ichor sale style.
  const expiresTimestamp = Math.floor(expiresAtDate.getTime() / 1000)
  const announcement = new EmbedBuilder()
    .setColor(Colors.WARNING_ORANGE)
    .setTitle(`⏸ ${botDisplay} paused`)
    .setDescription(
      `**${botDisplay}** will not respond in this channel for ${gateSummary}.` +
      (reason ? `\n\n*${reason}*` : '') +
      `\n\nUse \`/unpause bot:${botDisplay}\` to end early.`
    )

  if (durationMs !== null) {
    announcement.addFields({
      name: 'Time gate ends',
      value: `<t:${expiresTimestamp}:R> (<t:${expiresTimestamp}:f>)`,
      inline: true,
    })
  }
  if (messages !== undefined) {
    announcement.addFields({
      name: 'Count gate',
      value: `${messages} message${messages === 1 ? '' : 's'}`,
      inline: true,
    })
  }

  announcement.setTimestamp()

  try {
    await channel.send({ embeds: [announcement] })
  } catch (err) {
    logger.warn({ err, channelId: channel.id }, 'Failed to send pause announcement')
  }
}

// ============================================================================
// /unpause
// ============================================================================

export const unpauseCommand = new SlashCommandBuilder()
  .setName('unpause')
  .setDescription('End an active pause for a bot in this channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(opt =>
    opt.setName('bot')
      .setDescription('Bot to unpause')
      .setRequired(true)
      .setAutocomplete(true)
  )

export async function executeUnpause(
  interaction: ChatInputCommandInteraction,
  db: Database,
  _client: Client,
): Promise<void> {
  if (!hasAdminRole(interaction, db)) {
    logger.warn({
      userId: interaction.user.id,
      command: interaction.commandName,
    }, 'Unauthorized /unpause attempt')
    await interaction.reply({
      content: `${Emoji.CROSS} You don't have permission to use this command.`,
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const channel = interaction.channel as TextChannel | ThreadChannel | null
  const serverId = interaction.guildId

  if (!channel || !serverId) {
    await interaction.editReply({
      content: `${Emoji.CROSS} This command must be run in a server text channel.`,
    })
    return
  }

  const rawBot = interaction.options.getString('bot', true).trim()
  const botMember = resolveBotMember(interaction, rawBot)
  if (!botMember) {
    await interaction.editReply({
      content: `${Emoji.CROSS} Could not find a bot matching \`${rawBot}\` in this server. Pick one from autocomplete.`,
    })
    return
  }
  const botUserId = botMember.user.id
  const botDisplay = botMember.displayName

  const server = getOrCreateServer(db, serverId, interaction.guild?.name)

  const removed = removePause(db, server.id, channel.id, botUserId)

  if (!removed) {
    await interaction.editReply({
      content: `${Emoji.CROSS} No active pause for **${botDisplay}** in this channel.`,
    })
    return
  }

  // Best-effort unpin of the .pause message.
  await unpinMessageIfPresent(channel, removed.message_id).catch(err =>
    logger.warn({ err, messageId: removed.message_id }, 'Failed to unpin .pause on /unpause'),
  )
  markPinsDirty(channel.id)

  logger.info({
    pauseId: removed.id,
    userId: interaction.user.id,
    serverId,
    channelId: channel.id,
    botUserId,
    botDisplay,
    messageId: removed.message_id,
  }, 'Pause cleared via /unpause')

  await interaction.editReply({
    content: `${Emoji.CHECK} Pause cleared for **${botDisplay}**.`,
  })

  // Public notice so users know the bot is back.
  const announcement = new EmbedBuilder()
    .setColor(Colors.SUCCESS_GREEN)
    .setTitle(`▶ ${botDisplay} unpaused`)
    .setDescription(`**${botDisplay}** will respond in this channel again.`)
    .setTimestamp()

  try {
    await channel.send({ embeds: [announcement] })
  } catch (err) {
    logger.warn({ err, channelId: channel.id }, 'Failed to send unpause announcement')
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the bot the admin wants to target. Normally the autocomplete value
 * is already a Discord user ID, but admins can also type a display name,
 * username, or `<@id>` mention directly. We handle all forms against the
 * guild's bot members so a typo doesn't silently create a pause that no bot
 * will honor.
 */
function resolveBotMember(
  interaction: ChatInputCommandInteraction,
  input: string,
): GuildMember | null {
  const guild = interaction.guild
  if (!guild) return null

  // Unwrap `<@id>` / `<@!id>` mentions.
  const mentionMatch = input.match(/^<@!?(\d+)>$/)
  const asId = mentionMatch ? mentionMatch[1]! : /^\d+$/.test(input) ? input : null

  if (asId) {
    const byId = guild.members.cache.get(asId)
    if (byId && byId.user.bot) return byId
  }

  const q = input.toLowerCase()
  for (const m of guild.members.cache.values()) {
    if (!m.user.bot) continue
    if (
      m.displayName.toLowerCase() === q
      || (m.user.globalName ?? '').toLowerCase() === q
      || m.user.username.toLowerCase() === q
    ) {
      return m
    }
  }
  return null
}

async function unpinMessageIfPresent(
  channel: TextChannel | ThreadChannel,
  messageId: string,
): Promise<void> {
  try {
    const msg = await channel.messages.fetch(messageId)
    if (msg?.pinned) {
      await msg.unpin()
    }
  } catch (error) {
    // Message may already be gone (deleted) or unpinned — don't treat as fatal.
    const err = error as { code?: number; message?: string }
    if (err?.code === 10008) return  // Unknown Message
    if (err?.code === 10019) return  // Unknown Webhook (defensive)
    throw error
  }
}
