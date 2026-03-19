/**
 * Embed Builders
 * 
 * Helpers for creating consistent, beautiful embeds
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'

/** Infra color palette */
export const Colors = {
  ICHOR_PURPLE: 0x9B59B6,    // Primary embed color
  SUCCESS_GREEN: 0x2ECC71,   // Positive transactions
  WARNING_ORANGE: 0xE67E22,  // Low balance, warnings
  DANGER_RED: 0xE74C3C,      // Insufficient funds, errors
  NEUTRAL_GREY: 0x95A5A6,    // Secondary info
}

/** Emoji vocabulary */
export const Emoji = {
  ICHOR: '💫',
  REGEN: '⏳',
  STATS: '📊',
  HISTORY: '📜',
  COSTS: '💰',
  SPEND: '🔴',
  CREDIT: '🟢',
  TRANSFER_OUT: '🔵',
  TRANSFER_IN: '💜',
  REWARD: '⭐',
  TIP: '🫀',
  GRANT: '🎁',
  REVOKE: '⚠️',
  INSUFFICIENT: '💸',
  DM_FAILED: '📭',
  QUICK: '⚡',
  REFRESH: '🔄',
  CHECK: '✅',
  CROSS: '❌',
}

/**
 * Format time duration in a human-friendly way
 */
function formatTimeToFull(hours: number): string {
  if (hours <= 0) return '✨ Full!'
  
  const totalMinutes = hours * 60
  
  if (totalMinutes < 1) {
    // Less than a minute - show seconds
    const seconds = Math.ceil(totalMinutes * 60)
    return `~${seconds}s`
  } else if (totalMinutes < 60) {
    // Less than an hour - show minutes
    const minutes = Math.ceil(totalMinutes)
    return `~${minutes}m`
  } else if (hours < 24) {
    // Less than a day - show hours and minutes
    const h = Math.floor(hours)
    const m = Math.round((hours - h) * 60)
    return m > 0 ? `~${h}h ${m}m` : `~${h}h`
  } else {
    // More than a day
    const days = Math.floor(hours / 24)
    const remainingHours = Math.round(hours % 24)
    return remainingHours > 0 ? `~${days}d ${remainingHours}h` : `~${days}d`
  }
}

/**
 * Format regen rate - always show per hour
 */
export function formatRegenRate(ratePerHour: number): string {
  if (ratePerHour >= 1) {
    // Show as whole number if no decimal, otherwise 1 decimal
    return `**${ratePerHour % 1 === 0 ? ratePerHour : ratePerHour.toFixed(1)}**/hour`
  } else {
    // Low rate: show per hour with decimals
    return `**${ratePerHour.toFixed(2)}**/hour`
  }
}

/**
 * Create a visual progress bar for balance
 */
function createProgressBar(current: number, max: number, length: number = 10): string {
  const ratio = Math.min(1, current / max)
  const filled = Math.round(ratio * length)
  const empty = length - filled
  
  // Use different fill characters based on fullness
  const fillChar = ratio >= 0.8 ? '█' : ratio >= 0.4 ? '▓' : '░'
  const emptyChar = '·'
  
  const bar = fillChar.repeat(filled) + emptyChar.repeat(empty)
  const percent = Math.round(ratio * 100)
  return `\`${bar}\` ${percent}%`
}

/**
 * Create a balance embed
 */
export function createBalanceEmbed(data: {
  balance: number
  maxBalance: number
  regenRate: number
  effectiveRegenRate: number
  roleBonus?: { multiplier: number; roleName?: string }
  rewardStatus?: {
    rewardsRemaining: number
    maxDailyRewards: number
    cooldownRemainingSeconds: number
    nextRewardAt: Date | null
  }
}): EmbedBuilder {
  // Calculate time to full
  const deficit = data.maxBalance - data.balance
  const hoursToFull = deficit > 0 ? deficit / data.effectiveRegenRate : 0
  const timeToFullStr = formatTimeToFull(hoursToFull)
  
  // Create progress bar
  const progressBar = createProgressBar(data.balance, data.maxBalance)
  
  const embed = new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle(`${Emoji.ICHOR} Your Ichor Balance`)
    .setDescription(
      `**${data.balance.toFixed(1)}** / ${data.maxBalance} ichor\n` +
      progressBar
    )
    .addFields(
      {
        name: `${Emoji.REGEN} Regeneration`,
        value: formatRegenRate(data.effectiveRegenRate),
        inline: true,
      },
      {
        name: '⏱️ Time to Full',
        value: data.balance >= data.maxBalance ? '✨ Full!' : timeToFullStr,
        inline: true,
      },
      {
        name: `${Emoji.STATS} Maximum`,
        value: `**${data.maxBalance}**`,
        inline: true,
      }
    )
    .setFooter({ text: 'Ichor Economy' })
    .setTimestamp()

  // Add reward status if configured (max > 0)
  if (data.rewardStatus && data.rewardStatus.maxDailyRewards > 0) {
    const { rewardsRemaining, maxDailyRewards, cooldownRemainingSeconds, nextRewardAt } = data.rewardStatus
    
    let statusValue: string
    
    if (rewardsRemaining <= 0) {
      // No rewards left today
      statusValue = `🚫 **0/${maxDailyRewards}** remaining today\n_Resets at midnight_`
    } else if (cooldownRemainingSeconds > 0 && nextRewardAt) {
      // On cooldown
      statusValue = `⏳ **${rewardsRemaining}/${maxDailyRewards}** remaining\nReady <t:${Math.floor(nextRewardAt.getTime() / 1000)}:R>`
    } else {
      // Ready to reward
      statusValue = `${Emoji.CHECK} **${rewardsRemaining}/${maxDailyRewards}** remaining\nReady to reward!`
    }
    
    embed.addFields({
      name: `${Emoji.REWARD} Free Rewards`,
      value: statusValue,
      inline: true,
    })
  }

  // Add role bonus note if applicable
  if (data.roleBonus && data.roleBonus.multiplier > 1) {
    const roleName = data.roleBonus.roleName || 'your role'
    embed.addFields({
      name: '\u200B',
      value: `💡 As a **${roleName}** member, you regenerate ${data.roleBonus.multiplier}x faster!`,
    })
  }

  return embed
}

/**
 * Create balance action buttons
 */
export function createBalanceButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('balance_refresh')
        .setLabel(`${Emoji.REFRESH} Refresh`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('history_view')
        .setLabel(`${Emoji.HISTORY} History`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('costs_view')
        .setLabel(`${Emoji.COSTS} View Costs`)
        .setStyle(ButtonStyle.Primary),
    )
}

/**
 * Create a transaction history embed
 */
export function createHistoryEmbed(
  transactions: Array<{
    type: string
    amount: number
    timestamp: Date
    description: string
  }>,
  page: number,
  totalPages: number
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle(`${Emoji.HISTORY} Transaction History`)
    .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
    .setTimestamp()

  if (transactions.length === 0) {
    embed.setDescription('No transactions yet.')
    return embed
  }

  const lines = transactions.map(t => {
    const emoji = getTransactionEmoji(t.type, t.amount)
    const sign = t.amount > 0 ? '+' : ''
    const timestamp = `<t:${Math.floor(t.timestamp.getTime() / 1000)}:R>`
    return `${emoji} **${sign}${t.amount.toFixed(1)}** ${t.description} ${timestamp}`
  })

  embed.setDescription(lines.join('\n'))
  return embed
}

/**
 * Create pagination buttons for history
 */
export function createPaginationButtons(
  page: number,
  totalPages: number
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`history_prev_${page}`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`history_page_${page}`)
        .setLabel(`${page + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`history_next_${page}`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
    )
}

/**
 * Create a costs embed
 */
export function createCostsEmbed(
  bots: Array<{
    name: string
    cost: number
    description: string | null
    canAfford: boolean
  }>,
  userBalance: number,
  discountPercent?: number
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle(`${Emoji.COSTS} Bot Activation Costs`)
    .setTimestamp()

  let description = ''
  for (const bot of bots) {
    const affordIcon = bot.canAfford ? Emoji.CHECK : Emoji.CROSS
    description += `**${bot.name}** • ${bot.cost.toFixed(1)} ichor ${affordIcon}\n`
    // Only show description if it's different from the name
    if (bot.description && bot.description !== bot.name) {
      description += `${bot.description}\n`
    }
    description += '\n'
  }

  embed.setDescription(description)

  // Footer with balance info
  let footerText = `${Emoji.ICHOR} Your balance: ${userBalance.toFixed(1)} ichor`
  if (discountPercent && discountPercent > 0) {
    footerText += `\n💎 Role discount: ${discountPercent}% off all bots`
  }
  embed.addFields({ name: '\u200B', value: footerText })

  return embed
}

/**
 * Create costs embed for all servers (DM view)
 */
export function createAllServersCostsEmbed(
  serverCosts: Array<{
    serverName: string
    bots: Array<{ name: string; cost: number }>
  }>,
  userBalance: number
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle(`${Emoji.COSTS} Bot Costs Across All Servers`)
    .setTimestamp()

  if (serverCosts.length === 0) {
    embed.setDescription('No bots have been configured in any servers yet.')
    return embed
  }

  for (const server of serverCosts.slice(0, 25)) { // Discord max 25 fields
    const botList = server.bots
      .slice(0, 10) // Limit bots per server
      .map(b => {
        const affordIcon = userBalance >= b.cost ? Emoji.CHECK : Emoji.CROSS
        return `• **${b.name}** • ${b.cost.toFixed(1)} ichor ${affordIcon}`
      })
      .join('\n')

    const moreText = server.bots.length > 10
      ? `\n_...and ${server.bots.length - 10} more_`
      : ''

    embed.addFields({
      name: server.serverName,
      value: botList + moreText || 'No bots configured',
      inline: false,
    })
  }

  embed.setFooter({ text: `${Emoji.ICHOR} Your balance: ${userBalance.toFixed(1)} ichor` })

  return embed
}

/**
 * Create a transfer confirmation embed
 */
export function createTransferConfirmEmbed(
  recipientTag: string,
  amount: number,
  currentBalance: number,
  note?: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle(`${Emoji.ICHOR} Confirm Transfer`)
    .setDescription(`Send **${amount} ichor** to **${recipientTag}**?`)
    .addFields({
      name: 'Your balance',
      value: `${currentBalance.toFixed(1)} → **${(currentBalance - amount).toFixed(1)} ichor**`,
    })

  if (note) {
    embed.addFields({ name: `${Emoji.HISTORY} Note`, value: `"${note}"` })
  }

  return embed
}

/**
 * Create transfer success embed
 */
export function createTransferSuccessEmbed(
  recipientTag: string,
  amount: number,
  newBalance: number
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.SUCCESS_GREEN)
    .setTitle(`${Emoji.CHECK} Transfer Complete`)
    .setDescription(`Sent **${amount} ichor** to **${recipientTag}**`)
    .addFields({
      name: 'Your new balance',
      value: `**${newBalance.toFixed(1)} ichor**`,
    })
    .setTimestamp()
}

/**
 * Create transfer received DM embed
 */
export function createTransferReceivedEmbed(
  senderTag: string,
  amount: number,
  newBalance: number,
  note?: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle(`${Emoji.ICHOR} You Received Ichor!`)
    .setDescription(`**${senderTag}** sent you **${amount} ichor**`)
    .addFields({
      name: 'Your new balance',
      value: `**${newBalance.toFixed(1)} ichor**`,
    })
    .setTimestamp()

  if (note) {
    embed.addFields({ name: `${Emoji.HISTORY} Note`, value: `"${note}"` })
  }

  return embed
}

/**
 * Create tip received DM embed
 */
export function createTipReceivedEmbed(
  tipperTag: string,
  amount: number,
  channelName: string,
  newBalance: number,
  _messageUrl: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle(`${Emoji.TIP} You Received a Tip!`)
    .setDescription(
      `**${tipperTag}** tipped you **${amount} ichor**\n` +
      `for your message in **#${channelName}**`
    )
    .addFields({
      name: 'Your new balance',
      value: `**${newBalance.toFixed(1)} ichor**`,
    })
    .setTimestamp()
}

/**
 * Create bounty earned embed (for DMs when bounty tier is reached)
 */
export function createBountyEarnedEmbed(
  amount: number,
  starCount: number,
  channelName: string,
  newBalance: number,
  _messageUrl: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.SUCCESS_GREEN)
    .setTitle(`${Emoji.REWARD} Bounty Earned!`)
    .setDescription(
      `Your message in **#${channelName}** reached **${starCount} ⭐**!\n` +
      `You earned **${amount} ichor** bounty.`
    )
    .addFields({
      name: 'Your new balance',
      value: `**${newBalance.toFixed(1)} ichor**`,
    })
    .setTimestamp()
}

/**
 * Create insufficient funds embed (for DMs)
 */
export function createInsufficientFundsEmbed(
  botName: string,
  cost: number,
  currentBalance: number,
  regenRate: number
): EmbedBuilder {
  const deficit = cost - currentBalance
  const hoursToAfford = deficit / regenRate
  const timeStr = formatTimeToFull(hoursToAfford)

  const embed = new EmbedBuilder()
    .setColor(Colors.DANGER_RED)
    .setTitle(`${Emoji.ICHOR} Insufficient Ichor`)
    .setDescription(
      `You tried to summon **${botName}** but you only have ` +
      `**${currentBalance.toFixed(1)} ichor** (costs **${cost}**)`
    )
    .addFields({
      name: `${Emoji.REGEN} Time to afford`,
      value: timeStr,
      inline: true,
    })
    .setTimestamp()

  return embed
}

/**
 * Create low balance warning embed (for DMs)
 */
export function createLowBalanceEmbed(
  balance: number,
  regenRate: number,
  maxBalance: number,
  affordableBots: Array<{ name: string; cost: number }>
): EmbedBuilder {
  const hoursToFull = (maxBalance - balance) / regenRate
  const timeToFullStr = formatTimeToFull(hoursToFull)

  const embed = new EmbedBuilder()
    .setColor(Colors.WARNING_ORANGE)
    .setTitle(`${Emoji.REVOKE} Low Ichor Balance`)
    .setDescription(
      `Your ichor balance is running low!\n\n` +
      `Current balance: **${balance.toFixed(1)} ichor**`
    )
    .addFields(
      {
        name: 'You can afford',
        value: affordableBots.length > 0
          ? affordableBots.map(b => `• ${b.name} (${b.cost} ichor)`).join('\n')
          : 'No bots right now',
      },
      {
        name: `${Emoji.REGEN} Regeneration`,
        value: `${formatRegenRate(regenRate)} — full in ${timeToFullStr}`,
      }
    )
    .setTimestamp()

  return embed
}

/**
 * Create admin grant success embed
 */
export function createGrantEmbed(
  recipientTag: string,
  amount: number,
  newBalance: number,
  reason?: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.SUCCESS_GREEN)
    .setTitle(`${Emoji.GRANT} Ichor Granted`)
    .setDescription(`Granted **${amount} ichor** to **${recipientTag}**`)
    .addFields({
      name: 'New balance',
      value: `**${newBalance.toFixed(1)} ichor**`,
    })
    .setTimestamp()

  if (reason) {
    embed.addFields({ name: 'Reason', value: reason })
  }

  return embed
}

/**
 * Get transaction emoji based on type and amount
 */
function getTransactionEmoji(type: string, amount: number): string {
  switch (type) {
    case 'spend':
      return Emoji.SPEND
    case 'regen':
      return Emoji.CREDIT
    case 'reward':
      return Emoji.REWARD
    case 'tip':
      return Emoji.TIP
    case 'transfer':
      return amount > 0 ? Emoji.TRANSFER_IN : Emoji.TRANSFER_OUT
    case 'grant':
      return Emoji.GRANT
    case 'revoke':
      return Emoji.REVOKE
    case 'refund':
      return Emoji.CREDIT
    default:
      return amount > 0 ? Emoji.CREDIT : Emoji.SPEND
  }
}

