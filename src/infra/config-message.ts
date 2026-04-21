/**
 * Config/History message formatting utilities
 *
 * Generates .config and .history dot-command messages in the format
 * that ChapterX bots consume during context assembly.
 *
 * Format:
 *   .command [targets...]
 *   ---
 *   key: value
 *   key2: value2
 */

import { stringify as yamlStringify, parse as yamlParse } from 'yaml'
import type { User } from 'discord.js'

/**
 * Compile a dot-command message (.config, .history, etc.)
 *
 * @param commandPrefix - The command name (e.g., "config", "history")
 * @param configDict - Key-value pairs to serialize as YAML
 * @param targets - Optional users or string names to target
 * @returns Formatted message content string
 *
 * @example
 * compileConfigMessage('history', { last: 'https://discord.com/channels/...' })
 * // Returns:
 * // .history
 * // ---
 * // last: https://discord.com/channels/...
 *
 * @example
 * compileConfigMessage('config', { temperature: 0.8, mute: true }, [someUser])
 * // Returns:
 * // .config @SomeUser
 * // ---
 * // temperature: 0.8
 * // mute: true
 */
export function compileConfigMessage(
  commandPrefix: string,
  configDict?: Record<string, unknown>,
  targets?: Array<User | string>,
): string {
  // Filter out null/undefined values
  const cleanDict: Record<string, unknown> = {}
  if (configDict) {
    for (const [key, value] of Object.entries(configDict)) {
      if (value !== null && value !== undefined) {
        cleanDict[key] = value
      }
    }
  }

  const yamlContent = Object.keys(cleanDict).length > 0
    ? yamlStringify(cleanDict, { lineWidth: 0 }).trimEnd()
    : ''

  let message = `.${commandPrefix}`

  if (targets && targets.length > 0) {
    for (const target of targets) {
      if (target) {
        message += typeof target === 'string'
          ? ` ${target}`
          : ` ${target.toString()}`  // User.toString() produces <@id> mention
      }
    }
  }

  message += '\n---\n' + yamlContent

  return message
}

// ============================================================================
// Config key definitions
// ============================================================================

/**
 * Valid config keys that can be set via /config.
 * Maps key name to a description for autocomplete.
 *
 * Sourced from ChapterX BotConfig (types.ts) plus soma-specific keys.
 */
export const CONFIG_KEYS: Record<string, string> = {
  // Model
  continuation_model: 'LLM model to use for responses',
  temperature: 'Sampling temperature (0.0 - 2.0)',
  top_p: 'Top-P nucleus sampling (0.0 - 1.0)',
  frequency_penalty: 'Frequency penalty (0.0 - 2.0)',
  presence_penalty: 'Presence penalty (0.0 - 2.0)',
  max_tokens: 'Maximum tokens in response',
  prefill_thinking: 'Enable extended thinking (boolean)',
  debug_thinking: 'Send thinking as dot-prefixed debug message (boolean)',
  preserve_thinking_context: 'Preserve thinking traces in context (boolean)',
  mode: 'Bot mode: chat | prefill | base-model',
  streaming: 'Enable streaming LLM calls (boolean, default: true)',

  // Context
  recency_window: 'Number of recent messages to include in context',
  recency_window_messages: 'Max messages in context window',
  recency_window_characters: 'Max characters in context window',
  hard_max_characters: 'Hard max characters — never exceeded',
  rolling_threshold: 'Messages before truncation begins',
  recent_participant_count: 'Recent participants for stop sequences',
  prompt_caching: 'Enable Anthropic prompt caching (boolean, default: true)',
  cache_ttl: 'Anthropic cache TTL: 5m | 1h',

  // Activation & replies
  reply_on_random: 'Random reply chance (0 = never, 1000 = always)',
  reply_on_name: 'Activate when bot name is mentioned (boolean)',
  max_queued_replies: 'Max queued replies before dropping',
  may_speak: 'List of bot names allowed to speak',
  mute: 'Mute the bot in this channel',

  // Images
  include_images: 'Include images in context (boolean)',
  max_images: 'Max images to include in context',
  max_ephemeral_images: 'Max images in rolling window after cache marker',
  cache_images: 'Include images in cached prefix (boolean)',
  generate_images: 'Enable image generation (boolean)',

  // Text attachments
  include_text_attachments: 'Include text attachments in context (boolean)',
  max_text_attachment_kb: 'Max size per text attachment in KB',

  // Reply tags
  include_reply_tags: 'Keep <reply:@user> tags in context (boolean)',

  // Tools
  tools_enabled: 'Enable tool use (boolean)',
  tool_output_visible: 'Show tool output in Discord (boolean)',
  max_tool_depth: 'Max tool call depth per turn',
  max_mcp_images: 'Max images from MCP tool results',

  // Stop sequences & delimiters
  stop_sequences: 'Custom stop sequences (YAML list)',
  message_delimiter: 'Delimiter appended to each message',
  turn_end_token: 'Token appended after each message content',

  // Participant display
  use_display_names: 'Use display names instead of usernames (boolean)',
  participant_stop_sequences: 'Auto-generate stop sequences from participant names (boolean)',

  // Loop prevention
  max_bot_reply_chain_depth: 'Max consecutive bot messages in reply chain',
  bot_reply_chain_depth_emote: 'Emote shown when chain depth limit hit',

  // Retries
  llm_retries: 'Number of LLM retries on failure',
  discord_backoff_max: 'Max Discord backoff in ms',
  deferred_retries: 'Enable deferred retries (boolean)',
  supports_continuation: 'Allow continuation when last message is own (boolean)',

  // Steering
  steer_visible: 'Make .steer messages visible in bot context (boolean)',
  steer_readout: 'Send probe readout after steered generation (boolean)',
  authorized_roles: 'Roles authorized for .history commands (YAML list)',
  steer_roles: 'Roles authorized for .steer commands (YAML list)',

  // Prompts (text values — use file-based keys in YAML configs for long prompts)
  system_prompt: 'System prompt text',
  context_prefix: 'Prefix inserted as first cached assistant message',
  prefill_user_message: 'Custom synthetic user message (replaces [Start])',

  // Misc
  api_only: 'Disable Discord activation, API-only mode (boolean)',
  split_message: 'Split long messages into multiple',
  ignore_dotted_messages: 'Ignore messages starting with .',
  message_history_format: 'Message format for context',
  provider_params: 'Provider-specific params (YAML object)',
}

/**
 * Parse a string value into the appropriate JS type for YAML serialization.
 * Uses YAML parsing so "true" → boolean, "0.8" → number, "[a, b]" → array, etc.
 */
export function parseConfigValue(value: string): unknown {
  try {
    const parsed = yamlParse(value)
    return parsed ?? value
  } catch {
    return value
  }
}
