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

import { stringify as yamlStringify } from 'yaml'
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
 */
export const CONFIG_KEYS: Record<string, string> = {
  continuation_model: 'LLM model to use for responses',
  temperature: 'Sampling temperature (0.0 - 2.0)',
  top_p: 'Top-P nucleus sampling (0.0 - 1.0)',
  frequency_penalty: 'Frequency penalty (0.0 - 2.0)',
  presence_penalty: 'Presence penalty (0.0 - 2.0)',
  max_tokens: 'Maximum tokens in response',
  recency_window: 'Number of recent messages to include in context',
  reply_on_random: 'Random reply chance (0 = never, 1000 = always)',
  split_message: 'Split long messages into multiple',
  mute: 'Mute the bot in this channel',
  ignore_dotted_messages: 'Ignore messages starting with .',
  may_speak: 'List of bot names allowed to speak',
  message_history_format: 'Message format for context',
}
