/**
 * /get_prompt Command
 *
 * Retrieves the assembled LLM prompt for a message via the trace server API.
 * Uses the same API that trace-mcp uses: search → get trace → get request body.
 *
 * Requires TRACE_SERVER_URL and optionally TRACE_SERVER_TOKEN env vars.
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
  AttachmentBuilder,
} from 'discord.js'
import { logger } from '../../../utils/logger.js'

// ============================================================================
// Trace server client (mirrors trace-mcp/src/client.ts)
// ============================================================================

function getTraceServerUrl(): string {
  return process.env.TRACE_SERVER_URL || 'http://localhost:3847'
}

function getTraceServerToken(): string {
  return process.env.TRACE_SERVER_TOKEN || ''
}

async function traceRequest<T>(path: string): Promise<T> {
  const url = `${getTraceServerUrl()}${path}`
  const token = getTraceServerToken()

  const res = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Trace server ${res.status}: ${body}`)
  }

  return (await res.json()) as T
}

// ============================================================================
// Command
// ============================================================================

export const getPromptCommand = new SlashCommandBuilder()
  .setName('get_prompt')
  .setDescription('View the LLM prompt that was sent for a message (from traces)')
  .addStringOption(opt =>
    opt.setName('message_id')
      .setDescription('Message ID or link to look up')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('bot')
      .setDescription('Bot name to filter by (narrows search)')
      .setRequired(false)
      .setAutocomplete(true)
  )

export async function executeGetPrompt(
  interaction: ChatInputCommandInteraction,
  _client: Client,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    let messageId = interaction.options.getString('message_id', true)
    const botFilter = interaction.options.getString('bot')

    // Accept both raw message IDs and full Discord URLs
    const urlMatch = messageId.match(/discord(?:app)?\.com\/channels\/\d+\/\d+\/(\d+)/)
    if (urlMatch) {
      messageId = urlMatch[1]!
    }

    // Step 1: Search for traces containing this message
    const searchParams = new URLSearchParams({ q: messageId })
    if (botFilter) searchParams.set('bot', botFilter)

    const searchResult = await traceRequest<{
      messageId: string
      results: Array<{
        traceId: string
        role: string
        botName: string
        channelName: string
        success: boolean
      }>
      count: number
    }>(`/api/search?${searchParams}`)

    if (!searchResult.results || searchResult.results.length === 0) {
      await interaction.editReply({
        content: `❌ No trace found containing message \`${messageId}\`.${botFilter ? ` (searched bot: ${botFilter})` : ''}\n\nTips:\n- The message must have been processed by a ChapterX bot\n- Try specifying the bot name to narrow the search\n- Very old traces may have been cleaned up`,
      })
      return
    }

    // Prefer 'sent' role (bot's response), then 'trigger', then any
    const sorted = searchResult.results.sort((a, b) => {
      const priority = (r: string) => r === 'sent' ? 0 : r === 'trigger' ? 1 : 2
      return priority(a.role) - priority(b.role)
    })
    const match = sorted[0]!

    // Step 2: Get the full trace to find LLM call body refs
    const trace = await traceRequest<Record<string, unknown>>(`/api/trace/${match.traceId}`)

    const llmCalls = trace.llmCalls as Array<Record<string, unknown>> | undefined
    if (!llmCalls || llmCalls.length === 0) {
      await interaction.editReply({
        content: `Found trace **${match.traceId}** for **${match.botName}** but it has no LLM calls (may have been filtered/muted).`,
      })
      return
    }

    const firstCall = llmCalls[0]!
    // The trace server API flattens bodyRefs to top-level fields on each LLM call,
    // while the raw trace file on disk nests them under bodyRefs.
    // Handle both formats for robustness.
    const requestRef = (firstCall.requestBodyRef as string | undefined)
      ?? (firstCall.bodyRefs as Record<string, unknown> | undefined)?.requestBodyRef as string | undefined

    if (!requestRef) {
      await interaction.editReply({
        content: `Found trace **${match.traceId}** for **${match.botName}** but no request body reference was saved.`,
      })
      return
    }

    // Step 3: Get the request body via trace server API
    const requestBody = await traceRequest<unknown>(`/api/request/${encodeURIComponent(requestRef)}`)

    const formatted = JSON.stringify(requestBody, null, 2)
    const filename = `prompt-${match.botName}-${messageId}.json`
    const attachment = new AttachmentBuilder(
      Buffer.from(formatted, 'utf-8'),
      { name: filename },
    )

    const model = firstCall.model as string | undefined

    await interaction.editReply({
      content: `Prompt for **${match.botName}** (trace: ${match.traceId}, model: ${model || 'unknown'}):`,
      files: [attachment],
    })

    logger.info({
      userId: interaction.user.id,
      messageId,
      botName: match.botName,
      traceId: match.traceId,
    }, 'Prompt retrieved via /get_prompt')
  } catch (error) {
    logger.error({ error, userId: interaction.user.id }, 'Error in /get_prompt command')
    await interaction.editReply({
      content: `❌ Failed to retrieve prompt: ${error instanceof Error ? error.message : 'Unknown error'}`,
    })
  }
}
