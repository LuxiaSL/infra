/**
 * Database Row Types
 * These match the SQLite schema structure
 */

/**
 * User record (Discord users we know about)
 */
export interface UserRow {
  id: string           // UUID
  discord_id: string   // Discord user ID
  username: string | null      // Discord username (cached)
  display_name: string | null  // Discord display name (cached)
  avatar_hash: string | null   // Discord avatar hash (cached)
  last_seen: string | null     // ISO timestamp of last interaction
  created_at: string   // ISO timestamp
}

/**
 * Global user balance (shared across all servers)
 */
export interface BalanceRow {
  user_id: string      // References users.id
  amount: number       // Current stored ichor
  last_regen_at: string // ISO timestamp of last regen calculation
}

/**
 * Server (Discord guild) record
 */
export interface ServerRow {
  id: string           // UUID
  discord_id: string   // Discord guild ID
  config: string       // JSON string of ServerConfig
  created_at: string   // ISO timestamp
}

/**
 * Bot cost configuration
 */
export interface BotCostRow {
  id: string           // UUID
  bot_discord_id: string
  server_id: string | null  // NULL for global default
  base_cost: number
  description: string | null
}

/**
 * Role-based multipliers (per-server)
 */
export interface RoleConfigRow {
  id: string           // UUID
  server_id: string    // References servers.id
  role_discord_id: string
  regen_multiplier: number
  max_balance_override: number | null
  cost_multiplier: number
}

/**
 * Transaction record (audit log)
 */
export interface TransactionRow {
  id: string           // UUID
  timestamp: string    // ISO timestamp
  server_id: string | null
  type: string         // TransactionType
  from_user_id: string | null
  to_user_id: string | null
  bot_discord_id: string | null
  amount: number
  balance_after: number
  metadata: string     // JSON string
}

/**
 * Tracked message record (for reaction rewards/tips)
 */
export interface TrackedMessageRow {
  message_id: string      // Discord message ID (primary key) - bot's response
  channel_id: string      // Discord channel ID
  server_id: string | null // References servers.id
  bot_discord_id: string  // Bot's Discord ID
  trigger_user_id: string // References users.id
  trigger_message_id: string | null // Discord message ID of user's triggering message
  created_at: string      // ISO timestamp
  expires_at: string      // ISO timestamp
}

/**
 * Domain objects (parsed from rows)
 */

export interface User {
  id: string
  discordId: string
  username: string | null
  displayName: string | null
  avatarHash: string | null
  lastSeen: Date | null
  createdAt: Date
}

export interface Balance {
  userId: string
  amount: number
  lastRegenAt: Date
}

export interface Server {
  id: string
  discordId: string
  config: import('./index.js').ServerConfig
  createdAt: Date
}

export interface BotCost {
  id: string
  botDiscordId: string
  serverId: string | null
  baseCost: number
  description: string | null
}

export interface RoleConfig {
  id: string
  serverId: string
  roleDiscordId: string
  regenMultiplier: number
  maxBalanceOverride: number | null
  costMultiplier: number
}

export interface Transaction {
  id: string
  timestamp: Date
  serverId: string | null
  type: import('./index.js').TransactionType
  fromUserId: string | null
  toUserId: string | null
  botDiscordId: string | null
  amount: number
  balanceAfter: number
  metadata: Record<string, unknown>
}

export interface TrackedMessage {
  messageId: string
  channelId: string
  serverId: string | null
  botDiscordId: string
  triggerUserId: string
  triggerMessageId: string | null
  createdAt: Date
  expiresAt: Date
}

/**
 * Cost override (temporary sale/discount)
 */
export interface CostOverrideRow {
  id: string
  bot_discord_id: string
  server_id: string | null
  override_cost: number
  original_cost: number
  created_by: string       // Discord user ID of the admin
  created_at: string       // ISO timestamp
  expires_at: string       // ISO timestamp
}

export interface CostOverride {
  id: string
  botDiscordId: string
  serverId: string | null
  overrideCost: number
  originalCost: number
  createdBy: string
  createdAt: Date
  expiresAt: Date
}
