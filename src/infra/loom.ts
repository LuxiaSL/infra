/**
 * Loom System — Thread forking with ancestry tracking
 *
 * The loom is NOT a persistent data structure — it's emergent from:
 * 1. Discord threads with `.history last:` messages (context splice)
 * 2. Index threads (named `[LOOM INDEX] ...⌥*`) tracking alternative futures
 * 3. Ancestry chains built by walking `.history` links backwards
 *
 * No database, no files — everything lives in Discord messages.
 *
 * Key concepts:
 * - **Fork**: Create a new thread from a message, with a .history link back
 * - **Index thread**: A thread on the fork source message that tracks all forks
 * - **Ancestry chain**: The path from a message back through .history links to the root
 * - **Futures**: Alternative timelines branching from the same message
 */

import {
  type Client,
  type Message,
  type TextChannel,
  type ThreadChannel,
  type Interaction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  ComponentType,
} from 'discord.js'
import {
  getMessageFromLink,
  getThreadFromMessage,
  minifyLink,
  reconstructLink,
  messagePreviewText,
  embedFromMessage,
} from './discord-utils.js'
import { compileConfigMessage } from './config-message.js'
import { parse as yamlParse } from 'yaml'

// ============================================================================
// Constants
// ============================================================================

const FUTURES_PREFIX = '.:twisted_rightwards_arrows: **futures**'
const ANCESTRY_PREFIX = '.:arrows_counterclockwise: **ancestry**:'

// ============================================================================
// Ancestry traversal
// ============================================================================

/**
 * Get the parent node of a message in the loom tree.
 * Follows .history `last:` or `root:` links in the thread to find where
 * this thread was forked from.
 *
 * Returns null if the message is a root (not in a thread, or no .history).
 */
export async function getParentNode(
  client: Client,
  message: Message,
): Promise<Message | null> {
  const channel = message.channel
  if (!('isThread' in channel) || !channel.isThread()) {
    return null
  }

  const thread = channel as ThreadChannel

  // Walk the thread's earliest messages looking for .history
  // Use a high limit — the .history message is usually first, but could be
  // preceded by system messages or other content in edge cases
  const messages = await thread.messages.fetch({
    after: thread.id, // Thread ID = starter message ID
    limit: 100,
  })

  // Sort oldest first
  const sorted = [...messages.values()].reverse()

  for (const msg of sorted) {
    if (msg.content.startsWith('.history')) {
      // Parse the YAML to find the link
      const yamlStart = msg.content.indexOf('---')
      if (yamlStart === -1) continue

      try {
        const yamlContent = msg.content.slice(yamlStart + 3).trim()
        const config = yamlParse(yamlContent) as Record<string, string>

        const parentLink = config.root ?? config.last
        if (parentLink) {
          return await getMessageFromLink(client, parentLink)
        }
      } catch {
        continue
      }
    }
  }

  // No .history found — try the thread's structural parent (starter message)
  // Special thread-name conventions from chapter2:
  //   "new:..." = tabula rasa context, no parent
  //   "past:<messageId>" = custom starter message ID (not the thread ID)
  if (thread.name.startsWith('new:')) {
    return null // Tabula rasa — deliberately no parent
  }

  try {
    if (thread.parentId) {
      const parent = thread.parent as TextChannel
      if (parent) {
        // "past:" prefix encodes a custom starter message ID
        const starterMessageId = thread.name.startsWith('past:')
          ? thread.name.split('past:')[1]!
          : thread.id // Default: thread ID === starter message ID
        return await parent.messages.fetch(starterMessageId)
      }
    }
  } catch {
    // Thread may not have a fetchable starter message
  }

  return null
}

/**
 * Build the full ancestry chain for a message.
 * Walks backwards through .history links until reaching a root.
 *
 * @returns Array of messages from the given message to the root (current first, root last)
 */
export async function getNodeAncestry(
  client: Client,
  message: Message,
): Promise<Message[]> {
  const ancestry: Message[] = []
  let current: Message | null = message

  // Safety limit to prevent infinite loops
  const MAX_DEPTH = 20

  while (current && ancestry.length < MAX_DEPTH) {
    ancestry.push(current)
    current = await getParentNode(client, current)
  }

  return ancestry
}

// ============================================================================
// Index thread management
// ============================================================================

/**
 * Find the loom index for a message.
 *
 * The index thread is attached to the root ancestor of the ancestry chain.
 * It's named `[LOOM INDEX] ...⌥*` (trailing * marks it as an index).
 *
 * @returns Tuple of (indexThread, indexMessage, ancestors, ancestorIndexMessages)
 */
export async function getLoomIndex(
  client: Client,
  message: Message,
): Promise<{
  indexThread: ThreadChannel | null
  indexMessage: Message | null
  ancestors: Message[]
  ancestorIndexMessages: Map<string, string> // ancestor URL → index message URL
  indexAnchorMessage: Message | null
}> {
  const ancestors = await getNodeAncestry(client, message)
  const root = ancestors[ancestors.length - 1]!

  let indexThread: ThreadChannel | null = null
  let indexMessage: Message | null = null
  let indexAnchorMessage: Message | null = null
  const ancestorIndexMessages = new Map<string, string>()

  // Only look for index thread if the root is NOT inside a thread
  if (!('isThread' in root.channel) || !(root.channel as ThreadChannel).isThread()) {
    indexThread = await getThreadFromMessage(client, root)
    indexAnchorMessage = root

    if (indexThread) {
      // Check if this thread is actually a loom index (name ends with *)
      if (indexThread.name.endsWith('*')) {
        // Scan the index thread for the entry matching our message
        const result = await findIndexMessage(message, indexThread, ancestors)
        indexMessage = result.indexMessage
        for (const [k, v] of result.ancestorIndexMessages) {
          ancestorIndexMessages.set(k, v)
        }
      } else {
        // Thread exists but isn't a loom index — don't use it
        indexAnchorMessage = null
        indexThread = null
      }
    }
  }

  return { indexThread, indexMessage, ancestors, ancestorIndexMessages, indexAnchorMessage }
}

/**
 * Scan an index thread for the entry corresponding to a specific message.
 * Also collects ancestor index message mappings along the way.
 */
async function findIndexMessage(
  targetMessage: Message,
  indexThread: ThreadChannel,
  ancestors: Message[],
): Promise<{
  indexMessage: Message | null
  ancestorIndexMessages: Map<string, string>
}> {
  const ancestorUrls = new Set(ancestors.map(a => a.url))
  const ancestorIndexMessages = new Map<string, string>()
  let indexMessage: Message | null = null

  // Fetch messages from index thread — scan in batches to handle large indices
  // Python version uses limit=None (unbounded). We fetch up to 500 which covers
  // even extremely branched loom trees.
  let allMessages: Message[] = []
  let lastId: string | undefined
  while (allMessages.length < 500) {
    const batch = await indexThread.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    })
    if (batch.size === 0) break
    allMessages.push(...batch.values())
    lastId = batch.last()?.id
    if (batch.size < 100) break
  }
  // allMessages is now oldest-first
  for (const msg of allMessages) {
    const parsed = parseIndexMessage(msg)
    if (!parsed) continue

    if (parsed.rootLink === targetMessage.url) {
      indexMessage = msg
      break
    }

    if (ancestorUrls.has(parsed.rootLink)) {
      ancestorIndexMessages.set(parsed.rootLink, msg.url)
    }
  }

  return { indexMessage, ancestorIndexMessages }
}

/**
 * Create a new loom index thread on a message.
 * Named `[LOOM INDEX] <preview>⌥*` — the trailing * marks it as an index.
 */
export async function createIndexThread(
  message: Message,
  title: string,
  reason: string = 'Loom index created by infra',
): Promise<ThreadChannel> {
  const threadName = `[LOOM INDEX] ${title}⌥*`
  return await message.startThread({
    name: threadName.slice(0, 100), // Discord thread name limit
    reason,
  })
}

/**
 * Create a new index entry for a message in the index thread.
 * Includes a select menu for navigating futures.
 *
 * @param inheritHistory - If true, auto-links to the next user message
 * @param childrenLinks - URLs of fork threads to include
 */
export async function createIndexEntry(
  client: Client,
  message: Message,
  indexThread: ThreadChannel,
  childrenLinks: string[] = [],
  inheritHistory: boolean = true,
): Promise<{ indexMessage: Message; view: ActionRowBuilder<StringSelectMenuBuilder> | null }> {
  // If inheriting, find the next non-system message after this one
  if (inheritHistory) {
    const nextMessages = await message.channel.messages.fetch({
      after: message.id,
      limit: 3,
    })
    // Sort oldest first
    const sorted = [...nextMessages.values()].reverse()
    for (const msg of sorted) {
      if (!msg.system && msg.author.id !== client.user?.id) {
        childrenLinks = [msg.url, ...childrenLinks]
        break
      }
    }
  }

  const { content, row, embeds } = buildFuturesMessage(message, childrenLinks)

  const indexMessage = await indexThread.send({
    content,
    components: row ? [row] : [],
    embeds,
  })

  return { indexMessage, view: row }
}

/**
 * Update an existing index entry with new children links.
 */
export async function editIndexEntry(
  message: Message,
  indexMessage: Message,
  childrenLinks: string[],
): Promise<{ indexMessage: Message; view: ActionRowBuilder<StringSelectMenuBuilder> | null }> {
  const { content, row, embeds } = buildFuturesMessage(message, childrenLinks)

  const edited = await indexMessage.edit({
    content,
    components: row ? [row] : [],
    embeds,
  })

  return { indexMessage: edited, view: row }
}

// ============================================================================
// Index message formatting
// ============================================================================

/**
 * Build the futures message content with select menu for navigation.
 */
function buildFuturesMessage(
  rootMessage: Message,
  childrenLinks: string[],
): {
  content: string
  row: ActionRowBuilder<StringSelectMenuBuilder> | null
  embeds: EmbedBuilder[]
} {
  const content = `${FUTURES_PREFIX} of ${rootMessage.url}:`

  if (childrenLinks.length === 0) {
    return { content, row: null, embeds: [] }
  }

  // Build select menu for navigation
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`loom_select|${minifyLink(rootMessage.url)}`)
    .setPlaceholder('Navigate futures...')

  for (let i = 0; i < Math.min(childrenLinks.length, 25); i++) {
    const link = childrenLinks[i]!
    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`Future ${i + 1}`)
        .setDescription(link.slice(0, 100))
        .setValue(minifyLink(link))
    )
  }

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)

  // If more than 25 children, add overflow embeds
  const embeds: EmbedBuilder[] = []
  if (childrenLinks.length > 25) {
    const overflow = childrenLinks.slice(25)
    const overflowEmbed = new EmbedBuilder()
      .setTitle('more futures...')
      .setDescription(overflow.map(l => `- ${l}`).join('\n'))
    embeds.push(overflowEmbed)
  }

  return { content, row, embeds }
}

/**
 * Parse an index message to extract the root link and children links.
 * Handles both select menu format and legacy text format.
 */
export function parseIndexMessage(
  message: Message,
): { rootLink: string; childrenLinks: string[] } | null {
  // Try select menu format first
  for (const row of message.components) {
    // ActionRow.components contains the actual interactive components
    // Use toJSON() to get raw API data — discord.js component types are complex
    const rowData = row.toJSON() as { components: Array<{ type: number; custom_id?: string; options?: Array<{ value: string; description?: string }> }> }
    for (const component of rowData.components) {
      if (component.type === ComponentType.StringSelect && component.custom_id) {
        const parts = component.custom_id.split('|')
        if (parts.length >= 2 && parts[1]) {
          const rootLink = reconstructLink(parts[1])
          const childrenLinks = (component.options ?? []).map(opt => reconstructLink(opt.value))
          return { rootLink, childrenLinks }
        }
      }
    }
  }

  // Fallback: parse from message content
  if (!message.content.startsWith(FUTURES_PREFIX)) return null

  const ofIdx = message.content.indexOf(' of ')
  if (ofIdx === -1) return null

  const afterOf = message.content.slice(ofIdx + 4).trim()
  const rootLink = afterOf.replace(/:$/, '')

  // Collect children from embeds
  const childrenLinks: string[] = []
  for (const embed of message.embeds) {
    if (embed.title === 'more futures...') {
      const lines = (embed.description || '').split('\n')
      for (const line of lines) {
        if (line.startsWith('- ')) {
          childrenLinks.push(line.slice(2).trim())
        }
      }
    } else if (embed.author?.url) {
      childrenLinks.push(embed.author.url)
    }
  }

  // YAML fallback for old-format index messages (no embeds, YAML body)
  if (childrenLinks.length === 0 && message.embeds.length === 0) {
    const colonIdx = afterOf.indexOf(':')
    if (colonIdx !== -1) {
      try {
        const yamlBody = afterOf.slice(colonIdx + 1).trim()
        const parsed = yamlParse(yamlBody)
        if (Array.isArray(parsed)) {
          childrenLinks.push(...parsed.filter((v): v is string => typeof v === 'string'))
        } else if (parsed && typeof parsed === 'object') {
          const values = Object.values(parsed)
          for (const v of values) {
            if (Array.isArray(v)) {
              childrenLinks.push(...v.filter((item): item is string => typeof item === 'string'))
            }
          }
        }
      } catch {
        // Not valid YAML — leave childrenLinks empty
      }
    }
  }

  return { rootLink, childrenLinks }
}

// ============================================================================
// Ancestry formatting
// ============================================================================

/**
 * Format an ancestry chain for display.
 * Each ancestor becomes a nested bullet point with indent.
 * Current message is bold, others are dimmed.
 */
export function formatAncestryChain(
  ancestors: Message[],
  ancestorIndexMessages: Map<string, string>,
  currentMessage: Message,
): string {
  let result = ''
  let indent = ''

  // ancestors are current→root, we want root→current for display
  const reversed = [...ancestors].reverse()

  for (const ancestor of reversed) {
    result += `\n${indent}- `

    if (ancestor.url === currentMessage.url) {
      result += `**⌥**${ancestor.url}`
    } else {
      result += `-# ⌥${ancestor.url}`
    }

    // If this ancestor has an index entry, add clickable link
    const indexUrl = ancestorIndexMessages.get(ancestor.url)
    if (indexUrl) {
      result += `[⌥](${indexUrl})`
    }

    indent += '  '
  }

  return result
}

// ============================================================================
// Fork operations
// ============================================================================

/**
 * Create a thread for a fork (public or private).
 *
 * Public: sends an anchor message in the channel, then creates a thread from it.
 * Private: creates a standalone private thread.
 *
 * @returns [thread, anchorMessage (null for private)]
 */
async function createForkThread(
  channel: TextChannel,
  content: string,
  isPublic: boolean,
  title: string,
  reason: string,
): Promise<[ThreadChannel, Message | null]> {
  if (isPublic) {
    // Send anchor message, then create thread from it
    const anchor = await channel.send(content)
    const thread = await anchor.startThread({
      name: title.slice(0, 100),
      reason,
    })
    return [thread, anchor]
  } else {
    // Create standalone private thread, then send the ancestry content inside it
    const thread = await channel.threads.create({
      name: title.slice(0, 100),
      type: ChannelType.PrivateThread,
      reason,
    })
    // Send ancestry content into private thread (Python does this too)
    await thread.send(content)
    return [thread, null]
  }
}

/**
 * Fork a message into a new thread with full loom integration.
 *
 * This is the core operation that:
 * 1. Builds the ancestry chain
 * 2. Creates/updates the loom index
 * 3. Creates the fork thread with ancestry message
 * 4. Sends the .history message linking back to the source
 *
 * @returns [newThread, indexMessage]
 */
export async function forkToThread(
  client: Client,
  interaction: Interaction,
  message: Message,
  options: {
    title?: string
    isPublic?: boolean
    reason?: string
  } = {},
): Promise<{ thread: ThreadChannel; indexMessage: Message | null }> {
  const {
    title: customTitle,
    isPublic = true,
    reason = `Forked by ${interaction.user.username}`,
  } = options

  const previewText = messagePreviewText(message, 20, true)
  const title = customTitle ?? (previewText + '⌥')

  // Resolve to parent channel if we're in a thread
  const channel = ('parent' in message.channel && message.channel.isThread())
    ? message.channel.parent as TextChannel
    : message.channel as TextChannel

  // Step 1: Get loom index and ancestry
  const { indexThread: existingIndex, indexMessage: existingEntry, ancestors, ancestorIndexMessages, indexAnchorMessage } =
    await getLoomIndex(client, message)

  // Step 2: Build ancestry display
  const ancestryContent = ANCESTRY_PREFIX
    + formatAncestryChain(ancestors, ancestorIndexMessages, message)
    + '**⌥**'

  // Step 3: Create the fork thread
  const [newThread] = await createForkThread(
    channel,
    ancestryContent + `\n-# forked by ${interaction.user.toString()}`,
    isPublic,
    title,
    reason,
  )

  // Step 4: Manage loom index
  let indexThread = existingIndex
  let lastView: ActionRowBuilder<StringSelectMenuBuilder> | null = null
  let indexMessage = existingEntry

  if (indexAnchorMessage && !indexThread && isPublic) {
    // Create new index thread
    indexThread = await createIndexThread(indexAnchorMessage, previewText, reason)
  }

  if (isPublic && indexThread) {
    if (!indexMessage) {
      // Send ancestry context into index thread if we have deep ancestry
      if (ancestors.length > 1) {
        let reference: Message | undefined
        const parentUrl = ancestors[1]?.url
        if (parentUrl && ancestorIndexMessages.has(parentUrl)) {
          const refMsg = await getMessageFromLink(client, ancestorIndexMessages.get(parentUrl)!)
          if (refMsg) reference = refMsg
        }

        const embed = embedFromMessage(message, { maxLength: 1000, anchorAtEnd: true })
        await indexThread.send({
          content: ancestryContent,
          embeds: [embed],
          ...(reference ? { reply: { messageReference: reference.id } } : {}),
        })
      }

      // Create new index entry
      const result = await createIndexEntry(
        client,
        message,
        indexThread,
        [newThread.url],
        true,
      )
      indexMessage = result.indexMessage
      lastView = result.view
    } else {
      // Update existing index entry with new fork
      const parsed = parseIndexMessage(indexMessage)
      if (parsed) {
        parsed.childrenLinks.push(newThread.url)
        const result = await editIndexEntry(message, indexMessage, parsed.childrenLinks)
        indexMessage = result.indexMessage
        lastView = result.view
      }
    }
  }

  // Step 5: Build embed for the .history message
  const embed = embedFromMessage(message, { maxLength: 1000, anchorAtEnd: true })

  // Add futures link to embed if we have an index
  if (indexMessage) {
    embed.setDescription(
      (embed.data.description || '')
      + `\n\n:twisted_rightwards_arrows: [alt futures](${indexMessage.url})`
    )
  }

  // Step 6: Send .history message in the new fork thread
  // Include the select menu components so users can navigate futures from within the fork
  await newThread.send({
    content: compileConfigMessage('history', { last: message.url }),
    embeds: [embed],
    ...(lastView ? { components: [lastView] } : {}),
  })

  return { thread: newThread, indexMessage }
}
