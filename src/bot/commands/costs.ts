/**
 * /costs Command
 * 
 * View bot activation costs for the server (or all known servers in DMs)
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js'
import type { Database } from 'better-sqlite3'
import { getBalance, getEffectiveCostMultiplier } from '../../services/balance.js'
import { getAllBotCosts, getUserKnownServersCosts, getActiveCostOverride } from '../../services/cost.js'
import { getOrCreateUser, getOrCreateServer, extractDiscordUserInfo } from '../../services/user.js'
import { createCostsEmbed, createAllServersCostsEmbed } from '../embeds/builders.js'
import { logger } from '../../utils/logger.js'

export const costsCommand = new SlashCommandBuilder()
  .setName('costs')
  .setDescription('View bot activation costs')
  .addStringOption(option =>
    option
      .setName('bot')
      .setDescription('Specific bot to show')
      .setAutocomplete(true))

export async function executeCosts(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const serverId = interaction.guildId
  const specificBot = interaction.options.getString('bot')

  // Ensure user exists and cache their profile
  const user = getOrCreateUser(db, interaction.user.id, extractDiscordUserInfo(interaction.user))

  // In DMs: show costs from all servers the user is known to be in
  if (!serverId) {
    const balanceData = getBalance(db, user.id)
    
    // Get costs only from servers the user has been seen in
    const serverCosts = getUserKnownServersCosts(db, user.id)
    
    if (serverCosts.length === 0) {
      await interaction.reply({
        content: '❌ No bot costs found. Use `/costs` in a server first to see costs there.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const embed = createAllServersCostsEmbed(serverCosts, balanceData.balance)

    logger.debug({
      userId: user.id,
      serverCount: serverCosts.length,
    }, 'Costs command executed (DM - all known servers)')

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  // In server: show this server's costs
  const server = getOrCreateServer(db, serverId, interaction.guild?.name)

  // Get user's roles for multipliers
  const userRoles: string[] = interaction.member
    ? Array.from((interaction.member.roles as any).cache?.keys?.() || []).map(String)
    : []

  // Get balance and cost multiplier
  const balanceData = getBalance(db, user.id, serverId, userRoles)
  const costMultiplier = getEffectiveCostMultiplier(db, serverId, userRoles)

  // Get bot costs for this server (with proper deduplication)
  let allCosts = getAllBotCosts(db, serverId)

  // Filter by specific bot if provided
  if (specificBot) {
    const searchLower = specificBot.toLowerCase()
    allCosts = allCosts.filter(c =>
      c.botDiscordId === specificBot ||
      c.botDiscordId.includes(specificBot) ||
      (c.description && c.description.toLowerCase().includes(searchLower))
    )
  }

  if (allCosts.length === 0) {
    await interaction.reply({
      content: specificBot
        ? `❌ No bot found matching "${specificBot}".`
        : '❌ No bots have been configured for this server yet. Ask an admin to run `/soma set-cost`.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  // Calculate effective costs and affordability, checking for active sales
  const bots = allCosts.map(bot => {
    const override = getActiveCostOverride(db, bot.botDiscordId, serverId)
    const baseCost = override ? override.override_cost : bot.baseCost
    const effectiveCost = baseCost * costMultiplier
    return {
      name: bot.description || bot.botDiscordId,
      cost: effectiveCost,
      description: null,  // Don't duplicate description - it's already in the name
      canAfford: balanceData.balance >= effectiveCost,
      onSale: override !== null,
      originalCost: override ? bot.baseCost * costMultiplier : undefined,
    }
  })

  // Calculate discount percentage
  const discountPercent = costMultiplier < 1
    ? Math.round((1 - costMultiplier) * 100)
    : undefined

  const embed = createCostsEmbed(bots, balanceData.balance, discountPercent)

  logger.debug({
    userId: user.id,
    serverId: server.id,
    botCount: bots.length,
    costMultiplier,
  }, 'Costs command executed')

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  })
}

