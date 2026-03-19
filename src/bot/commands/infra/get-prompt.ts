/**
 * /get_prompt Command
 *
 * Retrieves the assembled LLM prompt for a message from trace files.
 * Uses the trace-based approach: reads the requestBodyRef from the bot's
 * trace files rather than rebuilding the prompt live.
 *
 * Trace files live at the configured TRACE_DIRS paths on the VPS.
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
  AttachmentBuilder,
} from 'discord.js'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { logger } from '../../../utils/logger.js'

/**
 * Trace directories to search.
 * These match the trace-server's LOGS_DIRS configuration.
 */
function getTraceDirs(): string[] {
  const dirs = process.env.TRACE_DIRS || '/opt/chapterx/logs/traces,/opt/chapterx_staging/logs/traces'
  return dirs.split(',').map(d => d.trim()).filter(Boolean)
}

export const getPromptCommand = new SlashCommandBuilder()
  .setName('get_prompt')
  .setDescription('View the LLM prompt that was sent for a message (from traces)')
  .addStringOption(opt =>
    opt.setName('message_id')
      .setDescription('The message ID to look up (the bot\'s response message)')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('bot')
      .setDescription('Bot name to search traces for (narrows search)')
      .setRequired(false)
      .setAutocomplete(true)
  )

export async function executeGetPrompt(
  interaction: ChatInputCommandInteraction,
  _client: Client,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const messageId = interaction.options.getString('message_id', true)
    const botFilter = interaction.options.getString('bot')

    const traceDirs = getTraceDirs()
    let foundTrace: Record<string, unknown> | null = null
    let foundBotName: string | null = null

    // Search trace index files for a trace containing this message
    for (const traceDir of traceDirs) {
      if (!existsSync(traceDir)) continue

      // If bot filter provided, only search that bot's traces
      const botDirs = botFilter
        ? [botFilter]
        : readdirSync(traceDir).filter(name => {
            const path = join(traceDir, name)
            try { return require('fs').statSync(path).isDirectory() } catch { return false }
          })

      for (const botName of botDirs) {
        const botTraceDir = join(traceDir, botName)
        if (!existsSync(botTraceDir)) continue

        // Search trace files for this message ID
        const traceFiles = readdirSync(botTraceDir).filter(f => f.endsWith('.json'))

        // Search newest first (most likely to find recent messages)
        traceFiles.sort().reverse()

        for (const file of traceFiles.slice(0, 200)) { // Limit search depth
          try {
            const content = readFileSync(join(botTraceDir, file), 'utf-8')

            // Quick string check before parsing JSON
            if (!content.includes(messageId)) continue

            const trace = JSON.parse(content) as Record<string, unknown>

            // Check if this trace's triggering message, sent messages, or context messages match
            if (
              trace.triggeringMessageId === messageId ||
              (Array.isArray(trace.sentMessageIds) && trace.sentMessageIds.includes(messageId)) ||
              (Array.isArray(trace.contextMessageIds) && trace.contextMessageIds.includes(messageId))
            ) {
              foundTrace = trace
              foundBotName = botName
              break
            }
          } catch {
            continue // Skip malformed trace files
          }
        }

        if (foundTrace) break
      }

      if (foundTrace) break
    }

    if (!foundTrace) {
      await interaction.editReply({
        content: `❌ No trace found containing message \`${messageId}\`.${botFilter ? ` (searched bot: ${botFilter})` : ''}\n\nTips:\n- The message must have been processed by a ChapterX bot\n- Try specifying the bot name to narrow the search\n- Very old traces may have been cleaned up`,
      })
      return
    }

    // Extract the LLM request body
    const llmCalls = foundTrace.llmCalls as Array<Record<string, unknown>> | undefined
    if (!llmCalls || llmCalls.length === 0) {
      await interaction.editReply({
        content: `Found trace for **${foundBotName}** but it has no LLM calls (may have been filtered/muted).`,
      })
      return
    }

    const firstCall = llmCalls[0]!
    const bodyRefs = firstCall.bodyRefs as Record<string, unknown> | undefined
    const refs = bodyRefs?.requestBodyRefs as string[] | undefined
    const requestRef = (bodyRefs?.requestBodyRef as string | undefined) ?? refs?.[0]

    if (!requestRef) {
      await interaction.editReply({
        content: `Found trace for **${foundBotName}** but no request body reference was saved.`,
      })
      return
    }

    // Load the request body from the bodies directory
    // Bodies are stored in a `bodies` subdirectory relative to the trace dir
    let requestBody: string | null = null
    for (const traceDir of getTraceDirs()) {
      // Try common body locations
      const candidates = [
        join(traceDir, 'bodies', requestRef),
        join(traceDir, '..', 'llm-requests', requestRef),
        join(traceDir, '..', 'membrane-requests', requestRef),
      ]

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          requestBody = readFileSync(candidate, 'utf-8')
          break
        }
      }
      if (requestBody) break
    }

    if (!requestBody) {
      // Fall back to showing trace summary
      const traceId = foundTrace.traceId as string
      await interaction.editReply({
        content: `Found trace **${traceId}** for **${foundBotName}**, but the request body file \`${requestRef}\` was not found on disk.\n\nThe trace itself exists — try the trace viewer for the full details.`,
      })
      return
    }

    // Format and return
    let formatted: string
    try {
      const parsed = JSON.parse(requestBody)
      formatted = JSON.stringify(parsed, null, 2)
    } catch {
      formatted = requestBody
    }

    const filename = `prompt-${foundBotName}-${messageId}.json`
    const attachment = new AttachmentBuilder(
      Buffer.from(formatted, 'utf-8'),
      { name: filename },
    )

    const traceId = foundTrace.traceId as string
    const model = (llmCalls[0] as Record<string, unknown>)?.model as string | undefined

    await interaction.editReply({
      content: `Prompt for **${foundBotName}** (trace: ${traceId}, model: ${model || 'unknown'}):`,
      files: [attachment],
    })

    logger.info({
      userId: interaction.user.id,
      messageId,
      botName: foundBotName,
      traceId,
    }, 'Prompt retrieved via /get_prompt')
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /get_prompt command')
    await interaction.editReply({
      content: `❌ Failed to retrieve prompt: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}
