/**
 * /help Command
 * 
 * Comprehensive help and system overview
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
import { getOrCreateServer } from '../../services/user.js'
import { getGlobalConfig, getDefaultServerConfig } from '../../services/config.js'
import { Colors, Emoji, formatRegenRate } from '../embeds/builders.js'

export const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Learn about ichor economy and infra commands')
  .addStringOption(opt =>
    opt
      .setName('topic')
      .setDescription('Specific topic to learn about')
      .addChoices(
        { name: '📖 Overview', value: 'overview' },
        { name: '⚡ Commands', value: 'commands' },
        { name: '⭐ Bounty System', value: 'bounty' },
        { name: '😀 Emoji Reactions', value: 'reactions' },
        { name: '💰 Ichor Economy', value: 'economy' },
        { name: '⚙️ Settings', value: 'settings' },
      ))

export async function executeHelp(
  interaction: ChatInputCommandInteraction,
  db: Database
): Promise<void> {
  const topic = interaction.options.getString('topic') ?? 'overview'

  // Get server config for emoji info
  const serverId = interaction.guildId
  let serverConfig = getDefaultServerConfig()
  if (serverId) {
    const server = getOrCreateServer(db, serverId, interaction.guild?.name)
    serverConfig = server.config
  }

  const globalConfig = getGlobalConfig()

  let embed: EmbedBuilder
  let components: ActionRowBuilder<ButtonBuilder>[] = []

  switch (topic) {
    case 'overview':
      embed = createOverviewEmbed(globalConfig, serverConfig)
      components = createHelpNavRows('overview')
      break
    case 'commands':
      embed = createCommandsEmbed()
      components = createHelpNavRows('commands')
      break
    case 'bounty':
      embed = createBountyEmbed(serverConfig)
      components = createHelpNavRows('bounty')
      break
    case 'reactions':
      embed = createReactionsEmbed(serverConfig)
      components = createHelpNavRows('reactions')
      break
    case 'economy':
      embed = createEconomyEmbed(globalConfig)
      components = createHelpNavRows('economy')
      break
    case 'settings':
      embed = createSettingsEmbed()
      components = createHelpNavRows('settings')
      break
    default:
      embed = createOverviewEmbed(globalConfig, serverConfig)
      components = createHelpNavRows('overview')
  }

  await interaction.reply({
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral,
  })
}

function createOverviewEmbed(globalConfig: any, serverConfig: any): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle(`${Emoji.ICHOR} Welcome to Infra`)
    .setDescription(
      'Infra is the **ichor economy and loom system** that manages AI bot activations across servers.\n\n' +
      '**How it works:**\n' +
      '• You have a balance of **ichor** (a shared currency)\n' +
      '• Mentioning or replying to AI bots costs ichor\n' +
      '• Ichor regenerates over time automatically\n' +
      '• You can earn extra ichor through tips and rewards'
    )
    .addFields(
      {
        name: '🚀 Quick Start',
        value: 
          '`/balance` — Check your ichor\n' +
          '`/costs` — See bot activation costs\n' +
          '`/help commands` — All available commands',
      },
      {
        name: '📊 Your Economy',
        value:
          `Regeneration: ${formatRegenRate(globalConfig.baseRegenRate)}\n` +
          `Maximum balance: **${globalConfig.maxBalance}** ichor\n` +
          `Starting balance: **${globalConfig.startingBalance}** ichor`,
        inline: true,
      },
      {
        name: '😀 This Server',
        value:
          `Reward emoji: ${serverConfig.rewardEmoji.join(' ')}\n` +
          `Tip emoji: ${serverConfig.tipEmoji}\n` +
          `Bounty emoji: ${serverConfig.bountyEmoji || '⭐'}`,
        inline: true,
      }
    )
    .setFooter({ text: 'Use the buttons below to learn more about specific topics' })
}

function createCommandsEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle('⚡ Ichor Commands')
    .setDescription('All available slash commands:')
    .addFields(
      {
        name: '📊 Information',
        value:
          '`/balance` — View ichor balance, regen rate, and free rewards remaining\n' +
          '`/costs` — See what each bot costs to activate\n' +
          '`/history` — View your transaction history\n' +
          '`/leaderboard` — See top ichor holders',
      },
      {
        name: '💸 Transactions',
        value:
          '`/transfer @user amount` — Send ichor to another user\n' +
          '_You can also tip users by reacting to their bot messages!_\n' +
          '_Note: Daily limits apply to both transfers and tips._',
      },
      {
        name: '⚙️ Settings & Notifications',
        value:
          '`/settings view` — View your current preferences\n' +
          '`/settings dm` — Toggle DM notifications on/off\n' +
          '`/notifications` — View your notification inbox\n' +
          '`/notifications unread:True` — Show only unread notifications\n' +
          '`/help [topic]` — Get help on a specific topic',
      },
      {
        name: '🔧 Admin Commands (`/ichor`)',
        value:
          '**User Management:**\n' +
          '`grant` / `revoke` — Add or remove ichor from users\n' +
          '`update-user` — Refresh a user\'s role cache\n' +
          '`stats` — View server-wide statistics\n\n' +
          '**Bot & Role Config:**\n' +
          '`set-cost` — Set bot activation costs\n' +
          '`set-role` — Configure role multipliers\n\n' +
          '**Server Config:**\n' +
          '`config-view` — View current server settings\n' +
          '`config-rewards-emoji` / `config-rewards-amount`\n' +
          '`config-tip-emoji` / `config-tip-amount`\n' +
          '`config-bounty-emoji` / `config-bounty-cost` / `config-bounty-tiers`\n' +
          '`config-reset` — Reset to defaults\n\n' +
          '**Global Config:**\n' +
          '`global-view` — View global settings\n' +
          '`global-cost-multiplier` — Adjust all bot costs\n' +
          '`global-reward-cooldown` / `global-max-daily-rewards`\n' +
          '`global-max-daily-sent` / `global-max-daily-received`',
      }
    )
}

function createBountyEmbed(serverConfig: any): EmbedBuilder {
  const bountyEmoji = serverConfig.bountyEmoji || '⭐'
  const bountyStarCost = serverConfig.bountyStarCost ?? 50
  const bountyTiers = serverConfig.bountyTiers || [{ threshold: 4, reward: 500 }, { threshold: 7, reward: 1500 }]

  return new EmbedBuilder()
    .setColor(0xFFD700) // Gold color for bounty
    .setTitle('⭐ Bounty System')
    .setDescription(
      'The **bounty system** lets you support great AI interactions with **paid stars**.\n\n' +
      'When a message accumulates enough stars, the author earns **bounty rewards**!'
    )
    .addFields(
      {
        name: '🌟 How It Works',
        value:
          `1. React with ${bountyEmoji} to a bot message you appreciate\n` +
          `2. You pay **${bountyStarCost} ichor** per star (deflationary — goes to the void)\n` +
          `3. Stars from everyone on that message accumulate\n` +
          `4. When thresholds are reached, the author gets rewarded!`,
      },
      {
        name: '🏆 Bounty Tiers',
        value:
          bountyTiers.map((t: any, i: number) => 
            `**Tier ${i + 1}:** ${t.threshold} ${bountyEmoji} → **${t.reward} ichor** to author`
          ).join('\n') + '\n\n' +
          '_Each tier pays out once per message. Rewards are cumulative!_',
      },
      {
        name: '💡 Example',
        value:
          `A message gets **${bountyTiers[0]?.threshold || 4} stars** from different users:\n` +
          `• Each star cost **${bountyStarCost} ichor** (total spent: ${(bountyTiers[0]?.threshold || 4) * bountyStarCost})\n` +
          `• Author receives **${bountyTiers[0]?.reward || 500} ichor** bounty!\n\n` +
          (bountyTiers[1] ? 
            `If it reaches **${bountyTiers[1].threshold} stars**, author gets another **${bountyTiers[1].reward} ichor**!` :
            '_Only one tier is configured._'),
      },
      {
        name: '📋 Rules',
        value:
          '• **One star per user per message** (Discord enforces this)\n' +
          '• **Can\'t star your own messages** (no self-bounty)\n' +
          '• **No refunds** if you remove your star\n' +
          '• Stars are tracked for **7 days** (same as message tracking)',
      },
      {
        name: '⚙️ Server Configuration',
        value:
          'Admins can customize the bounty system:\n' +
          '`/ichor config-bounty-emoji` — Change the star emoji\n' +
          '`/ichor config-bounty-cost` — Adjust cost per star\n' +
          '`/ichor config-bounty-tiers` — Set tier thresholds & rewards',
      }
    )
    .setFooter({ text: `This server: ${bountyEmoji} costs ${bountyStarCost} ichor | Tiers: ${bountyTiers.map((t: any) => t.threshold + '⭐').join(', ')}` })
}

function createReactionsEmbed(serverConfig: any): EmbedBuilder {
  const bountyEmoji = serverConfig.bountyEmoji || '⭐'

  return new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle('😀 Emoji Reactions')
    .setDescription(
      'Infra watches for special emoji reactions on **bot messages** to enable tipping, rewards, and bounties.'
    )
    .addFields(
      {
        name: `⭐ Bounty Stars (${bountyEmoji})`,
        value:
          `React with ${bountyEmoji} to **support a message with paid stars**.\n` +
          `Stars accumulate → author earns bounty rewards at milestones!\n\n` +
          `_See the **⭐ Bounty** tab for full details._`,
      },
      {
        name: `${Emoji.TIP} Tipping (${serverConfig.tipEmoji})`,
        value:
          `React with ${serverConfig.tipEmoji} to a bot's message to **tip the person who triggered it**.\n\n` +
          `• Costs you **${serverConfig.tipAmount} ichor**\n` +
          `• That ichor goes directly to the message author\n` +
          `• They'll be notified via DM or their inbox`,
      },
      {
        name: `🔥 Free Rewards (${serverConfig.rewardEmoji.join(' ')})`,
        value:
          `React with any of these emoji to **give a free reward**:\n` +
          `${serverConfig.rewardEmoji.join(' ')}\n\n` +
          `• Costs you nothing!\n` +
          `• Gives **${serverConfig.rewardAmount} ichor** to the message author\n` +
          `• One reward per message per person\n` +
          `• Subject to daily limits and cooldowns`,
      },
      {
        name: '⏳ Reward Limits',
        value:
          'Free rewards have daily limits and cooldowns to prevent spam.\n' +
          'Check `/balance` to see your remaining rewards and cooldown status.\n' +
          '_Admins can adjust these with `/ichor global-*` commands._',
      },
      {
        name: '💡 Other Reactions You Might See',
        value:
          `${Emoji.INSUFFICIENT} **Insufficient funds** — You tried to activate a bot but ran out of ichor\n` +
          `${Emoji.DM_FAILED} **DM unavailable** — Infra couldn't send you a DM (check \`/notifications\` instead)`,
      }
    )
    .setFooter({ text: 'Server admins can customize emoji with /ichor config-* commands' })
}

function createEconomyEmbed(globalConfig: any): EmbedBuilder {
  // Format daily rewards display
  const dailyRewardsStr = globalConfig.maxDailyRewards === 0 
    ? 'unlimited' 
    : `**${globalConfig.maxDailyRewards}**`
  
  // Format cooldown display
  const cooldownStr = globalConfig.rewardCooldownMinutes === 0
    ? 'No cooldown between rewards.'
    : globalConfig.rewardCooldownMinutes === 1
      ? 'There\'s a **1 minute** cooldown between rewards.'
      : `There's a **${globalConfig.rewardCooldownMinutes} minute** cooldown between rewards.`

  const embed = new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle('💰 Ichor Economy')
    .setDescription(
      '**Ichor** is the currency that powers AI bot interactions. ' +
      'Here\'s everything you need to know:'
    )
    .addFields(
      {
        name: '⏳ Regeneration',
        value:
          `Your ichor regenerates automatically at ${formatRegenRate(globalConfig.baseRegenRate)}.\n` +
          `Maximum balance: **${globalConfig.maxBalance}** ichor\n\n` +
          `_Some roles may have faster regeneration rates!_`,
      },
      {
        name: '💸 Spending',
        value:
          'Ichor is spent when you:\n' +
          '• **Mention** a bot (@BotName)\n' +
          '• **Reply** to a bot\'s message\n' +
          '• **Continue** a conversation (m-continue)\n\n' +
          'Each bot can have different costs. Use `/costs` to check.',
      },
      {
        name: '📈 Earning',
        value:
          'Ways to get more ichor:\n' +
          '• **Wait** for regeneration\n' +
          '• **Earn bounties** when your messages get enough stars\n' +
          '• **Receive tips** from other users (costs them ichor)\n' +
          '• **Get rewards** when people react to your bot messages\n' +
          '• **Receive transfers** from generous users\n' +
          '• **Admin grants** for special occasions',
      },
      {
        name: `${Emoji.REWARD} Free Rewards`,
        value:
          `You can give ${dailyRewardsStr} free rewards per day.\n` +
          `${cooldownStr}\n` +
          `One reward per message per person (permanent).\n\n` +
          `_Check your remaining rewards with_ \`/balance\``,
      },
      {
        name: '🎭 Role Benefits',
        value:
          'Server admins can configure special roles that provide:\n' +
          '• Faster ichor regeneration\n' +
          '• Discounts on bot activation costs\n\n' +
          '_Check `/balance` to see if you have any role bonuses!_',
      }
    )

  // Show global cost multiplier if it's not 1.0
  if (globalConfig.globalCostMultiplier !== 1.0) {
    const mult = globalConfig.globalCostMultiplier
    const discountOrSurcharge = mult < 1 
      ? `🎉 **Global Discount Active!** All bots cost **${Math.round((1 - mult) * 100)}% less** right now!`
      : `⚠️ **Global Surcharge Active!** All bots cost **${Math.round((mult - 1) * 100)}% more** right now.`
    embed.addFields({
      name: '🌐 Current Global Pricing',
      value: discountOrSurcharge,
    })
  }

  return embed
}

function createSettingsEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.ICHOR_PURPLE)
    .setTitle('⚙️ Settings & Notifications')
    .setDescription('Customize how Infra interacts with you.')
    .addFields(
      {
        name: '📬 DM Notifications',
        value:
          'By default, Infra **does not send DMs**. All notifications go to your inbox.\n\n' +
          'If you prefer DM notifications, you can enable them:\n' +
          '`/settings dm` — Toggle DMs on/off\n' +
          '`/settings view` — See your current preferences\n\n' +
          'When DMs are enabled, you\'ll receive messages for:\n' +
          '• Tips received\n' +
          '• Transfers received\n' +
          '• Insufficient funds alerts',
      },
      {
        name: '📥 Notification Inbox',
        value:
          'When DMs are disabled (default), notifications are stored in your inbox.\n\n' +
          '`/notifications` — View your inbox\n' +
          '`/notifications unread:True` — Show only unread\n\n' +
          'Features:\n' +
          '• Pagination for long histories\n' +
          '• Mark all as read button\n' +
          '• Filter toggle between all/unread\n' +
          '• Action hints to guide next steps',
      },
      {
        name: '🔔 Notification Types',
        value:
          '💸 **Insufficient funds** — You tried to activate a bot without enough ichor\n' +
          '💜 **Transfer received** — Someone sent you ichor\n' +
          '🫀 **Tip received** — Someone tipped your bot message\n' +
          '⭐ **Bounty earned** — Your message reached a star milestone!\n' +
          '🔥 **Reward received** — Someone rewarded your bot message\n' +
          '🎁 **Grant received** — An admin granted you ichor',
      },
      {
        name: '💡 Tips',
        value:
          '• Emoji reactions on your messages still work regardless of DM settings\n' +
          `• The ${Emoji.INSUFFICIENT} reaction on your message means you were out of ichor\n` +
          '• Check your balance regularly with `/balance`',
      }
    )
}

function createHelpNavRows(current: string): ActionRowBuilder<ButtonBuilder>[] {
  // Row 1: Main topics
  const row1Topics = [
    { id: 'overview', label: '📖 Overview' },
    { id: 'commands', label: '⚡ Commands' },
    { id: 'bounty', label: '⭐ Bounty' },
  ]

  // Row 2: Additional topics
  const row2Topics = [
    { id: 'reactions', label: '😀 Reactions' },
    { id: 'economy', label: '💰 Economy' },
    { id: 'settings', label: '⚙️ Settings' },
  ]

  const createRow = (topics: typeof row1Topics) => 
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        topics.map(topic =>
          new ButtonBuilder()
            .setCustomId(`help_${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === current ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(topic.id === current)
        )
      )

  return [createRow(row1Topics), createRow(row2Topics)]
}

/**
 * Handle help button navigation
 */
export async function handleHelpButton(
  customId: string,
  interaction: any,
  db: Database
): Promise<boolean> {
  if (!customId.startsWith('help_')) {
    return false
  }

  const topic = customId.replace('help_', '')
  
  // Get server config for emoji info
  const serverId = interaction.guildId
  let serverConfig = getDefaultServerConfig()
  if (serverId) {
    const server = getOrCreateServer(db, serverId, interaction.guild?.name)
    serverConfig = server.config
  }

  const globalConfig = getGlobalConfig()

  let embed: EmbedBuilder

  switch (topic) {
    case 'overview':
      embed = createOverviewEmbed(globalConfig, serverConfig)
      break
    case 'commands':
      embed = createCommandsEmbed()
      break
    case 'bounty':
      embed = createBountyEmbed(serverConfig)
      break
    case 'reactions':
      embed = createReactionsEmbed(serverConfig)
      break
    case 'economy':
      embed = createEconomyEmbed(globalConfig)
      break
    case 'settings':
      embed = createSettingsEmbed()
      break
    default:
      embed = createOverviewEmbed(globalConfig, serverConfig)
  }

  await interaction.update({
    embeds: [embed],
    components: createHelpNavRows(topic),
  })

  return true
}

