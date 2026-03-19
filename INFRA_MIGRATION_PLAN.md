# Infra Migration Plan: chapter2 Infra Commands into Soma

**Status**: Draft
**Last updated**: 2026-03-18
**Target**: Merge chapter2's `InfraInterface` functionality into the Soma TypeScript bot

---

## 1. Overview

### Goal

Port all user-facing infrastructure commands from chapter2's `infra_interface.py` (Python/discord.py) into the Soma codebase (TypeScript/discord.js). Soma will be expanded from a credit-economy bot into a combined economy + infra utility bot. The resulting bot replaces chapter2's infra instance on cyborg's VPS.

### Current State

**Soma** (`~/projects/anima-research/soma/`):
- TypeScript, discord.js v14, better-sqlite3, pino, zod, Express API
- 9 slash commands: `balance`, `transfer`, `costs`, `history`, `leaderboard`, `settings`, `notifications`, `help`, `/soma admin` (with subcommands: grant, set-cost, revoke, set-role, stats, update-user, plus server config subcommands)
- Button interaction framework, autocomplete dispatcher, admin auth (user IDs + role IDs)
- Embed builders with consistent styling
- Runs on `borgs.animalabs.ai` as a systemd service

**Chapter2 Infra** (`~/projects/anima-research/chapter2-ecosystem/chapter2/chapter2/interfaces/infra_interface.py`):
- Python, discord.py, pydantic, YAML
- ~1200 lines in `infra_interface.py` plus helpers in `discord_interface.py`
- Slash commands: `/fork`, `/mu`, `/history`, `/config`, `/config_speakers`, `/unset_config`, `/get_config`, `/get_prompt`, `/transcript`
- Steering commands: `/set_feature`, `/unset_feature`, `/unset_features`, `/get_features`
- Context menus: "fork", "fork (private)", "mu"
- Runs on cyborg's VPS

**ChapterX** (`~/projects/aethera-server/chapterx/working/`):
- Separate process (AI bot runtime)
- Already consumes `.history` and `.config` dot-command messages from Discord
- Writes traces to disk (JSONL index + per-trace JSON files + separate request/response bodies)
- `.history last:` and `.history first:` supported; `passthrough:` NOT yet supported

### Architecture After Migration

```
                  borgs.animalabs.ai
        +----------------------------------+
        |                                  |
        |  Soma/Infra Bot (single process) |
        |  - Credit economy commands       |
        |  - Infra slash commands          |
        |  - on_message: fork thread rename|
        |  - Express API (port 3100)       |
        |                                  |
        |  ChapterX Bots (N processes)     |
        |  - Reads .history/.config pins   |
        |  - Writes traces to disk         |
        |                                  |
        +----------------------------------+

        Communication:
        - Infra writes .history/.config messages to Discord
        - ChapterX reads them during context assembly
        - /get_prompt reads trace files from disk (read-only)
        - /get_config reads EMS config YAMLs from disk (read-only)
```

### What We Are NOT Doing

- No live prompt rebuild. `/get_prompt` reads traces, not re-simulates the context pipeline.
- No steering commands. The `set_feature`/`unset_feature`/`get_features` family depends on chapter2's ontology and Claude 3 Sonnet steering API. These are chapter2-specific and will not be ported.
- No chapter2 process management. The infra bot does not start/stop/supervise ChapterX bots. That stays in borgs-admin.
- No `.history passthrough:` in this migration scope. That requires a ChapterX change and is tracked separately.

---

## 2. Command Inventory

### New Top-Level Command Group: `/infra`

Discord has a 25-subcommand limit per top-level command. The `/soma admin` command is already near capacity. All infra commands go under a new `/infra` top-level command group.

### 2.1 Loom/Thread Commands

| Command | Type | Description | Params | Complexity |
|---------|------|-------------|--------|------------|
| `/infra fork` | Slash | Create a new fork thread from a message | `message_link?`, `public?` (default true), `title?` | High |
| `/infra mu` | Slash | Fork from parent of target message, trigger regeneration | `message_link?`, `public?` (default true), `title?` | High (depends on fork) |
| `/infra stash` | Slash | Move messages from channel into a new fork thread | `message_link?`, `max_messages?` (default 10), `stop_at_author_change?` | High (webhook + delete) |
| `/infra history` | Slash | Send a `.history` dot-command with YAML params | `targets?`, `last?`, `first?`, `passthrough?` | Medium |
| "fork" | Context Menu (Message) | Public fork from right-clicked message | (message from context) | Low (calls fork) |
| "fork (private)" | Context Menu (Message) | Private fork from right-clicked message | (message from context) | Low (calls fork) |
| "mu" | Context Menu (Message) | Mu from right-clicked message | (message from context) | Low (calls mu) |
| "stash" | Context Menu (Message) | Stash from right-clicked message | (message from context) | Low (calls stash) |

### 2.2 Webhook Commands

| Command | Type | Description | Params | Complexity |
|---------|------|-------------|--------|------------|
| `/infra copy` | Slash | Copy a message to another channel via webhook | `message_link`, `target_channel` | Medium |
| `/infra send` | Slash | Send content to a channel as a specified user | `target_channel`, `content`, `username`, `avatar_url?` | Medium |

### 2.3 Config Commands

| Command | Type | Description | Params | Complexity |
|---------|------|-------------|--------|------------|
| `/infra config` | Slash | Send `.config` dot-command with overrides, pin it | `targets?`, `name?`, `continuation_model?`, `temperature?`, `top_p?`, `frequency_penalty?`, `presence_penalty?`, `recency_window?`, `max_tokens?`, `reply_on_random?`, `split_message?`, `mute?`, `ignore_dotted_messages?`, `message_history_format?` | Medium |
| `/infra config-speakers` | Slash | Send `.config` with `may_speak: [list]`, pin it | `may_speak` | Low |
| `/infra unset-config` | Slash | Unpin all `.config` messages in channel | (none) | Low |
| `/infra get-config` | Slash | Get resolved config for a bot as YAML file | `bot` (required), `property?`, `public?` (default false) | Medium-High |

### 2.4 Prompt/Debug Commands

| Command | Type | Description | Params | Complexity |
|---------|------|-------------|--------|------------|
| `/infra get-prompt` | Slash | Retrieve assembled LLM prompt for a message from traces | `message_link?`, `public?` (default false) | Medium |
| `/infra transcript` | Slash | Export message history between two points as text file | `first_link?`, `last_link?`, `format?` (choices: irc, colon, infrastruct, chat), `public?` (default false) | Medium |

### 2.5 Event Handlers (Non-Command)

| Handler | Trigger | Description |
|---------|---------|-------------|
| Fork thread auto-rename | `messageCreate` | When a message arrives in a thread ending with `⌥`, rename to `⌥ {first 40 chars}...` if author differs from previous |

### Total Count

- 8 slash subcommands under `/infra`
- 4 context menu commands (message type)
- 1 event handler
- **13 new interaction points total**

---

## 3. Shared Infrastructure

New shared modules needed before implementing individual commands.

### 3.1 Webhook Utilities

**File**: `src/infra/shared/webhooks.ts`

All webhook operations (copy, send, stash) share a common pattern: find or create a bot-owned webhook, then send through it with author impersonation.

```typescript
import type {
  TextChannel,
  ThreadChannel,
  Webhook,
  Client,
  Message,
} from 'discord.js'

/** Options for sending a message via webhook. */
interface WebhookSendOptions {
  content: string
  username: string
  avatarURL?: string
  /** If sending to a thread, the thread ID. */
  threadId?: string
}

/**
 * Find an existing webhook owned by this bot in the channel,
 * or create a new one. Webhooks attach to the parent channel
 * (not the thread), so for threads we resolve the parent first.
 */
async function getOrCreateWebhook(
  channel: TextChannel | ThreadChannel,
  client: Client,
): Promise<Webhook> { /* ... */ }

/**
 * Send a message through a webhook, impersonating a user.
 * Handles thread-awareness: if target is a thread, passes threadId.
 */
async function webhookSend(
  webhook: Webhook,
  options: WebhookSendOptions,
): Promise<Message> { /* ... */ }
```

**Permissions required**: `ManageWebhooks` (must be added to bot invite link).

**Error handling**:
- Missing `ManageWebhooks` permission: throw `InfraError` with clear message
- Channel not accessible: throw `InfraError`
- Webhook creation fails (channel limit): log + throw

### 3.2 Message Resolution

**File**: `src/infra/shared/messages.ts`

Multiple commands need to resolve a `message_link` string or fall back to "last normal message in channel."

```typescript
import type { Message, TextBasedChannel, Client } from 'discord.js'

/** Discord message link regex. */
const MESSAGE_LINK_RE = /discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/

/** Parsed message link components. */
interface ParsedMessageLink {
  guildId: string
  channelId: string
  messageId: string
}

/**
 * Parse a Discord message link into its components.
 * Returns null if the string doesn't match.
 */
function parseMessageLink(link: string): ParsedMessageLink | null { /* ... */ }

/**
 * Fetch a message from a link string. Resolves the channel via
 * the client's channel cache, then fetches the specific message.
 * Throws InfraError if the channel or message is inaccessible.
 */
async function fetchMessageFromLink(
  client: Client,
  link: string,
): Promise<Message> { /* ... */ }

/**
 * Get the last "normal" message in a channel (default or reply type),
 * optionally before a given message. Scans up to 10 messages.
 * Returns null if no normal message is found.
 */
async function lastNormalMessage(
  channel: TextBasedChannel,
  before?: Message,
): Promise<Message | null> { /* ... */ }

/**
 * Resolve a message from either a link or "last in channel" fallback.
 * If messageLink is provided, fetches it. Otherwise returns lastNormalMessage.
 */
async function resolveMessage(
  client: Client,
  channel: TextBasedChannel,
  messageLink?: string | null,
): Promise<Message> { /* ... */ }
```

### 3.3 Dot-Command Compiler

**File**: `src/infra/shared/dot-commands.ts`

Shared by `/infra config`, `/infra history`, `/infra config-speakers`. Compiles a dot-command message string from parameters.

```typescript
import YAML from 'yaml'  // Need to add `yaml` dependency to package.json

/**
 * Compile a dot-command message (e.g., ".config" or ".history")
 * from a command prefix, config dict, and optional bot targets.
 *
 * Output format for .config:
 *   .config @bot1 @bot2
 *   ---
 *   ```yaml
 *   key: value
 *   ```
 *
 * Output format for .history:
 *   .history @bot1
 *   ---
 *   last: https://discord.com/...
 */
function compileDotCommand(options: {
  prefix: string          // "config" | "history"
  configDict: Record<string, unknown>
  targets?: string[]      // Bot sysnames or mentions
  codeblock?: boolean     // Wrap YAML in code fence (true for .config, false for .history)
}): string { /* ... */ }
```

### 3.4 Bot Registry / Autocomplete

**File**: `src/infra/shared/bot-registry.ts`

Commands like `/infra config`, `/infra get-config`, `/infra history` need autocomplete for bot names. Unlike chapter2 which loaded bot lists from the EMS at startup, the infra bot needs to discover bots from the environment.

```typescript
/** A known bot on this server. */
interface KnownBot {
  sysname: string       // ChapterX bot name (e.g., "claude", "haiku45")
  discordId: string     // Discord user ID
  displayName: string   // Display name for autocomplete
}

/**
 * Bot registry. Populated from:
 * 1. Environment variable INFRA_BOT_MAP (JSON: {"sysname": "discordId", ...})
 * 2. Or discovered from guild members that are bots (if bot map not provided)
 *
 * This is loaded once at startup and cached.
 */
class BotRegistry {
  private bots: KnownBot[] = []

  /** Initialize from env or guild member list. */
  async initialize(client: Client): Promise<void> { /* ... */ }

  /** Search bots matching a query string (for autocomplete). */
  search(query: string, guildId?: string): KnownBot[] { /* ... */ }

  /** Get a bot by sysname. */
  getBySysname(sysname: string): KnownBot | undefined { /* ... */ }

  /** Get a bot by Discord ID. */
  getByDiscordId(id: string): KnownBot | undefined { /* ... */ }
}
```

The bot map should be provided via an environment variable since the infra bot doesn't have access to ChapterX's config files directly. Format: `INFRA_BOT_MAP='{"claude":"123456789","haiku45":"987654321"}'`

### 3.5 Trace Reader

**File**: `src/infra/shared/trace-reader.ts`

Read-only access to ChapterX trace files for `/infra get-prompt`. The infra bot runs on the same VPS as ChapterX, so traces are accessible via filesystem.

```typescript
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/** Minimal trace index entry (matches ChapterX's TraceIndex). */
interface TraceIndexEntry {
  traceId: string
  timestamp: string
  channelId: string
  triggeringMessageId: string
  botName?: string
  success: boolean
  filename: string
  /** Discord message IDs included in context. */
  contextMessageIds: string[]
  /** Discord message IDs we sent. */
  sentMessageIds: string[]
}

/** LLM call info extracted from a trace. */
interface TraceLLMCall {
  model: string
  requestBodyRef?: string
  requestBodyRefs?: string[]
  responseBodyRef?: string
  tokenUsage: {
    inputTokens: number
    outputTokens: number
  }
}

/**
 * Read-only trace reader. Reads from ChapterX's trace directory.
 * Configurable via CHAPTERX_TRACE_DIR environment variable.
 *
 * Default paths:
 *   - Production: /opt/chapterx/logs/traces/
 *   - Staging: /opt/chapterx_staging/logs/traces/
 */
class TraceReader {
  private traceDir: string
  private bodiesDir: string
  private indexFile: string

  constructor(traceDir?: string) { /* ... */ }

  /**
   * Find traces containing a specific Discord message ID.
   * Searches the JSONL index for entries where the message appears
   * in contextMessageIds, sentMessageIds, or triggeringMessageId.
   */
  findByMessageId(messageId: string): TraceIndexEntry[] { /* ... */ }

  /**
   * Load a full trace JSON by trace ID.
   * Searches bot subdirectories since traces are organized by bot name.
   */
  loadTrace(traceId: string): Record<string, unknown> | null { /* ... */ }

  /**
   * Load a request body file by reference name.
   * The reference is a filename relative to the bodies/ subdirectory.
   */
  loadRequestBody(bodyRef: string): unknown | null { /* ... */ }

  /**
   * Format an LLM request body as human-readable text.
   * Extracts system prompt, messages (with role labels), and
   * tool definitions into a clean .txt format.
   */
  formatRequestAsText(requestBody: unknown): string { /* ... */ }
}
```

### 3.6 Config Reader (for /get-config)

**File**: `src/infra/shared/config-reader.ts`

Reads bot configuration from EMS layout on disk. Unlike chapter2 which could call its own `load_em_kv()` directly, the infra bot reads the YAML files as an external consumer.

```typescript
import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import YAML from 'yaml'

/** Sensitive keys that must not be exposed. */
const BLACKLISTED_KEYS = new Set([
  'folder',
  'novelai_api_key',
  'exa_search_api_key',
  'vendors',
  'discord_token',
  'discord_proxy_url',
])

/**
 * Read bot configuration from disk (EMS layout).
 * Configurable via CHAPTERX_EMS_DIR environment variable.
 * Default: /opt/chapter2/ems/
 */
class ConfigReader {
  private emsDir: string

  constructor(emsDir?: string) { /* ... */ }

  /**
   * Load the full config for a bot by sysname.
   * Reads the config.yaml from the EMS directory.
   * Strips blacklisted keys before returning.
   */
  loadConfig(sysname: string): Record<string, unknown> | null { /* ... */ }

  /**
   * Load a specific property from a bot's config.
   * Flattens em + interfaces[0] keys for property lookup
   * (matching chapter2's behavior).
   */
  loadProperty(
    sysname: string,
    property: string,
  ): unknown | null { /* ... */ }

  /**
   * Recursively remove blacklisted keys from a config object.
   */
  private cleanConfig(obj: unknown): unknown { /* ... */ }
}
```

### 3.7 Infra Error Class

**File**: `src/infra/shared/errors.ts`

```typescript
/** Base error for infra command failures. */
export class InfraError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'INFRA_ERROR',
  ) {
    super(message)
    this.name = 'InfraError'
  }
}

/** Message not found or inaccessible. */
export class MessageNotFoundError extends InfraError {
  constructor(detail: string) {
    super(`Message not found: ${detail}`, 'MESSAGE_NOT_FOUND')
  }
}

/** Channel not found or inaccessible. */
export class ChannelNotFoundError extends InfraError {
  constructor(detail: string) {
    super(`Channel not found: ${detail}`, 'CHANNEL_NOT_FOUND')
  }
}

/** Missing permissions for an operation. */
export class PermissionError extends InfraError {
  constructor(detail: string) {
    super(`Missing permission: ${detail}`, 'MISSING_PERMISSION')
  }
}

/** Trace or config file not found on disk. */
export class FileNotFoundError extends InfraError {
  constructor(detail: string) {
    super(`File not found: ${detail}`, 'FILE_NOT_FOUND')
  }
}
```

### 3.8 Interaction Wrapper

**File**: `src/infra/shared/interaction.ts`

Chapter2 has an `interaction_wrapper` that handles deferral, error reporting, and common pre-processing. We need a TypeScript equivalent.

```typescript
import type {
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  MessageFlags,
} from 'discord.js'
import { logger } from '../../utils/logger.js'
import { InfraError } from './errors.js'

type InfraInteraction =
  | ChatInputCommandInteraction
  | MessageContextMenuCommandInteraction

/**
 * Wraps an infra command handler with:
 * 1. Automatic deferReply (respects ephemeral flag)
 * 2. Error catching and user-friendly error messages
 * 3. Logging
 *
 * The handler receives the already-deferred interaction.
 */
async function infraInteraction(
  commandName: string,
  interaction: InfraInteraction,
  options: {
    ephemeral?: boolean
  },
  handler: () => Promise<void>,
): Promise<void> {
  try {
    await interaction.deferReply({
      flags: options.ephemeral ? MessageFlags.Ephemeral : undefined,
    })
    await handler()
  } catch (error) {
    const message = error instanceof InfraError
      ? `**Error** in **${commandName}**: ${error.message}`
      : `**Unexpected error** in **${commandName}**: ${error instanceof Error ? error.message : String(error)}`

    logger.error({ error, command: commandName }, 'Infra command failed')

    try {
      await interaction.followUp({
        content: message,
        flags: MessageFlags.Ephemeral,
      })
    } catch {
      // Interaction may have expired
    }
  }
}
```

---

## 4. Implementation Phases

### Phase 0: Project Setup & Shared Infrastructure
**Estimated effort**: 1-2 days
**Dependencies**: None
**Deliverables**: New directory structure, shared modules, dependency additions

#### Tasks

1. **Create directory structure**:
   ```
   src/infra/
     shared/
       webhooks.ts
       messages.ts
       dot-commands.ts
       bot-registry.ts
       trace-reader.ts
       config-reader.ts
       errors.ts
       interaction.ts
     commands/
       index.ts          # Command registration + routing
     context-menus/
       index.ts          # Context menu registration
     handlers/
       fork-rename.ts    # on_message thread rename handler
   ```

2. **Add npm dependencies**:
   ```bash
   npm install yaml
   npm install -D @types/yaml  # if needed (yaml package includes types)
   ```

3. **Add environment variables to `src/config.ts`**:
   ```typescript
   // In SomaConfig (to be renamed InfraConfig or kept as SomaConfig):
   infraBotMap: Record<string, string> | null     // INFRA_BOT_MAP
   chapterxTraceDir: string                        // CHAPTERX_TRACE_DIR
   chapterxEmsDir: string                          // CHAPTERX_EMS_DIR
   ```

4. **Implement all `src/infra/shared/` modules** as described in Section 3.

5. **Wire up infra command registration in `src/bot/commands/index.ts`**:
   - Import infra command builders and handlers
   - Add to the `commands` array
   - Add context menu commands to registration
   - Add `isMessageContextMenuCommand()` case to `handleInteraction()`

6. **Update bot intents** in `src/bot/index.ts`:
   - Add `GatewayIntentBits.ManageWebhooks` if not already present (verify -- discord.js may not require an intent for webhook management, just the permission)

7. **Write unit tests for shared modules**:
   - `parseMessageLink()` with valid/invalid inputs
   - `compileDotCommand()` with various config shapes
   - `cleanConfig()` with nested blacklisted keys
   - `formatRequestAsText()` with mock request body

#### Acceptance Criteria
- All shared modules compile with no type errors
- Unit tests pass for pure functions
- Bot starts without errors (no new commands registered yet)


### Phase 1: Config Commands
**Estimated effort**: 2-3 days
**Dependencies**: Phase 0
**Deliverables**: `/infra config`, `/infra config-speakers`, `/infra unset-config`, `/infra get-config`

Config commands are the simplest infra commands and exercise the shared dot-command compiler + autocomplete without needing the complex loom logic.

#### `/infra config`

**File**: `src/infra/commands/config.ts`

```typescript
// Slash command definition sketch:
const configSubcommand = (sub: SlashCommandSubcommandBuilder) =>
  sub
    .setName('config')
    .setDescription('Set channel configuration overrides for ChapterX bots')
    .addStringOption(opt =>
      opt.setName('targets')
        .setDescription('Space-separated bot names to target (blank = all bots)')
        .setAutocomplete(true))
    .addStringOption(opt =>
      opt.setName('name').setDescription('Bot display name override'))
    .addStringOption(opt =>
      opt.setName('continuation_model').setDescription('Model to use'))
    .addNumberOption(opt =>
      opt.setName('temperature').setDescription('Sampling temperature').setMinValue(0).setMaxValue(2))
    .addNumberOption(opt =>
      opt.setName('top_p').setDescription('Top-p sampling').setMinValue(0).setMaxValue(1))
    .addNumberOption(opt =>
      opt.setName('frequency_penalty').setDescription('Frequency penalty').setMinValue(-2).setMaxValue(2))
    .addNumberOption(opt =>
      opt.setName('presence_penalty').setDescription('Presence penalty').setMinValue(-2).setMaxValue(2))
    .addIntegerOption(opt =>
      opt.setName('recency_window').setDescription('Context window message count').setMinValue(1).setMaxValue(200))
    .addIntegerOption(opt =>
      opt.setName('max_tokens').setDescription('Max output tokens').setMinValue(1).setMaxValue(8192))
    .addIntegerOption(opt =>
      opt.setName('reply_on_random').setDescription('Reply on random (0 = never, 100 = always)').setMinValue(0).setMaxValue(100))
    .addBooleanOption(opt =>
      opt.setName('split_message').setDescription('Split long messages'))
    .addBooleanOption(opt =>
      opt.setName('mute').setDescription('Mute bot in this channel'))
    .addBooleanOption(opt =>
      opt.setName('ignore_dotted_messages').setDescription('Ignore messages starting with .'))
    .addStringOption(opt =>
      opt.setName('message_history_format')
        .setDescription('Message format')
        .addChoices(
          { name: 'irc', value: 'irc' },
          { name: 'colon', value: 'colon' },
          { name: 'infrastruct', value: 'infrastruct' },
          { name: 'chat', value: 'chat' },
        ))
```

**Handler logic**:
1. `deferReply()` (not ephemeral -- config messages should be visible)
2. Collect all non-null options into a config dict
3. If `message_history_format` is set, wrap as `{ name: value }` (matching chapter2)
4. Parse `targets` string into array (split on space)
5. Call `compileDotCommand({ prefix: 'config', configDict, targets, codeblock: true })`
6. `followUp({ content: dotCommandMessage })`
7. Pin the sent message

**Known issue**: `channel.pins()` is rate-limited by Cloudflare (Error 1015). The `pin()` call itself is a different endpoint and is not affected by the pins *fetch* rate limit. Pinning should work fine; it is only *reading* pins that is problematic.

#### `/infra config-speakers`

**Handler logic**:
1. `deferReply()`
2. Parse `may_speak` string into array (split on space), default to empty array
3. `compileDotCommand({ prefix: 'config', configDict: { may_speak: speakers }, codeblock: true })`
4. `followUp()` + pin

#### `/infra unset-config`

**Handler logic**:
1. `deferReply()`
2. Fetch pinned messages: `channel.messages.fetchPinned()`
   - **Cloudflare risk**: This call may hang under rate limiting. Wrap in a timeout (10 seconds). If it times out, report "Could not fetch pins -- try again later."
   - Alternative: use native `fetch()` to bypass discord.js REST manager (see MEMORY.md note about Cloudflare 429)
3. Filter pins where `content.startsWith('.config')`
4. Unpin each matching message
5. Report count to user

#### `/infra get-config`

**Handler logic**:
1. `deferReply({ ephemeral: !public })`
2. Resolve bot sysname from the `bot` autocomplete option
3. If `property` is specified:
   - Load config, flatten em + interfaces[0], look up property
   - Respond with inline YAML block
4. If no property:
   - Load full config from disk via `ConfigReader`
   - Serialize to YAML, send as file attachment (`{sysname}-config.yaml`)

**Autocomplete handlers needed**:
- `targets`: multi-value bot name autocomplete (space-separated, exclude already-typed names)
- `bot`: single bot name autocomplete (for `/infra get-config`)

#### Acceptance Criteria
- `/infra config temperature:0.7 mute:true` sends a properly formatted `.config` message and pins it
- `/infra config-speakers may_speak:bot1 bot2` sends `.config` with `may_speak: [bot1, bot2]`
- `/infra unset-config` unpins all `.config` pins in the channel
- `/infra get-config bot:claude` returns a YAML file attachment with blacklisted keys stripped
- Autocomplete returns matching bot names
- All commands handle errors gracefully (missing permissions, rate limits, etc.)


### Phase 2: History & Transcript Commands
**Estimated effort**: 1-2 days
**Dependencies**: Phase 0
**Deliverables**: `/infra history`, `/infra transcript`

#### `/infra history`

**Handler logic**:
1. `deferReply()`
2. Collect `last`, `first`, `passthrough` options
3. Parse `targets` into array
4. Build config dict: `{ last, first, passthrough }` (strip nulls)
5. `compileDotCommand({ prefix: 'history', configDict, targets, codeblock: false })`
6. `followUp()` + pin

The `.history` message format uses bare YAML (no code fence), matching chapter2's behavior:
```
.history @bot1
---
last: https://discord.com/channels/...
first: https://discord.com/channels/...
```

Note on `passthrough`: This parameter is accepted by the slash command and included in the YAML output. ChapterX does NOT yet handle `passthrough:` -- that is tracked in Phase 5 (ChapterX integration). The infra bot can emit it now; ChapterX will silently ignore it until support is added.

#### `/infra transcript`

**Handler logic**:
1. `deferReply({ ephemeral: !public })`
2. Resolve `first_link` and `last_link` to messages (or channel boundaries)
3. Fetch all messages between first and last (paginated via Discord API)
4. Format each message according to `format` choice:
   - `colon`: `AuthorName: message content`
   - `irc`: `<AuthorName> message content`
   - `infrastruct`: custom format (match chapter2 exactly)
   - `chat`: similar to colon but with timestamps
5. Join into transcript string
6. Send as `.txt` file attachment

**Implementation note**: Message fetching between two points requires walking backward from `last` until `first` is reached. Use `channel.messages.fetch({ before: lastId, limit: 100 })` in a loop. Cap at a reasonable limit (e.g., 2000 messages) to avoid excessive API calls.

```typescript
/** Transcript format renderers. */
const FORMATTERS: Record<string, (msg: Message) => string> = {
  colon: (msg) => `${msg.author.displayName}: ${msg.content}\n`,
  irc: (msg) => `<${msg.author.displayName}> ${msg.content}\n`,
  chat: (msg) => {
    const ts = msg.createdAt.toISOString().replace('T', ' ').slice(0, 19)
    return `[${ts}] ${msg.author.displayName}: ${msg.content}\n`
  },
  infrastruct: (msg) => `${msg.author.displayName}: ${msg.content}\n`,
}
```

#### Acceptance Criteria
- `/infra history last:https://...` sends a properly formatted `.history` message and pins it
- `/infra history` with no params sends a bare `.history` (context clear) and pins it
- `/infra transcript` exports messages between two points as a `.txt` attachment
- Transcript respects the `format` choice
- Both commands handle missing/inaccessible messages gracefully


### Phase 3: Loom (Fork, Mu, Stash)
**Estimated effort**: 3-4 days
**Dependencies**: Phase 0, Phase 2 (for `.history` message creation)
**Deliverables**: `/infra fork`, `/infra mu`, `/infra stash`, all 4 context menus, fork-rename handler

This is the most complex phase. The loom system is emergent from Discord threads + `.history` messages + futures index messages. There is no persistent state beyond what lives in Discord.

#### 3.1 Fork Implementation

**File**: `src/infra/commands/fork.ts`

The fork flow has several branches depending on whether the source message already has a thread and whether the fork is public or private.

```typescript
/**
 * Core fork logic. Creates a new thread branching from a source message.
 *
 * Flow:
 * 1. Determine if source message has an existing thread
 * 2. If no thread and public: create index thread on source message
 * 3. If thread exists: check for existing futures index message
 * 4. Create the new fork thread (public: via anchor message; private: standalone)
 * 5. Send .history message as first message in new thread
 * 6. Update futures index with new fork's .history URL
 * 7. For public forks: set embed on anchor message with source + alt futures link
 */
async function forkToThread(options: {
  message: Message
  client: Client
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction
  isPublic: boolean
  title?: string
}): Promise<{ thread: ThreadChannel; historyMessage: Message }> { /* ... */ }
```

**Detailed fork flow**:

```
Source message has NO thread AND fork is public:
  1. Create thread on source message with name "...{last 15 chars}⌥*"
  2. Send futures index message in that thread:
     ".:twisted_rightwards_arrows: **futures**\n- {source_msg_url}"
  3. Create anchor message in channel with embed + ".:rewind:{source_url}"
  4. Create fork thread on anchor message with name "{title or '...last15⌥'}"
  5. Send .history message in fork thread: ".history\n---\nlast: {source_url}"
  6. Edit futures index to append: "\n- {history_msg_url}"

Source message has a thread with existing futures index:
  1. Reuse existing futures index message
  2-6. Same as above (create anchor, create fork thread, send .history, update index)

Source message has a thread but NO futures index:
  1. Send new futures index message in existing thread
  2-6. Same as above

Source message in a thread:
  1. Use parent channel for creating new thread
  2. Skip futures index entirely (forks from within threads don't create index threads)
  3-6. Same flow but in parent channel

Fork is private:
  1. Skip anchor message and futures index entirely
  2. Create private thread in channel with title
  3. Send .history message as first message
  4. Send ping message ".{user.mention}" to add user to thread
```

**Embed construction** (for public fork anchor messages):

```typescript
function embedFromMessage(message: Message, indexUrl?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setDescription(
      indexUrl
        ? `${message.content}\n\n-# [:twisted_rightwards_arrows: alt futures](${indexUrl})`
        : message.content
    )
    .setAuthor({
      name: message.author.displayName,
      iconURL: message.author.displayAvatarURL(),
      url: message.url,
    })
  return embed
}
```

**Thread naming convention**:
- Fork threads: `...{last 15 chars of source}⌥` (or custom title)
- Index threads (on source message): `...{last 15 chars}⌥*`

**Futures index message format**:
```
.:twisted_rightwards_arrows: **futures**
- {original message URL}
- {fork 1 .history message URL}
- {fork 2 .history message URL}
```

The leading `.` makes these invisible to ChapterX (dot-prefixed messages are ignored).

#### 3.2 Mu Implementation

**File**: `src/infra/commands/mu.ts`

Mu is "fork from the parent of the target message, then trigger regeneration."

```typescript
async function muCommand(options: {
  message: Message            // The message to regenerate
  client: Client
  interaction: InfraInteraction
  isPublic: boolean
  title?: string
}): Promise<void> {
  // 1. Find the message immediately before the target
  const parentMessage = await lastNormalMessage(options.message.channel, options.message)
  if (!parentMessage) {
    throw new InfraError('No parent message found before the target')
  }

  // 2. Fork from the parent
  const { thread } = await forkToThread({
    message: parentMessage,
    client: options.client,
    interaction: options.interaction,
    isPublic: options.isPublic,
    title: options.title,
  })

  // 3. Send "m continue @author" to trigger ChapterX regeneration
  const author = options.message.author
  await thread.send(`m continue ${author}`)
}
```

#### 3.3 Stash Implementation

**File**: `src/infra/commands/stash.ts`

Stash moves messages from the current channel into a new fork thread by copying them via webhook and then deleting the originals.

```typescript
async function stashCommand(options: {
  message: Message           // Starting point (or last message in channel)
  client: Client
  interaction: InfraInteraction
  maxMessages?: number       // Default: 10
  stopAtAuthorChange?: boolean  // Default: false
}): Promise<void> {
  const maxMessages = options.maxMessages ?? 10
  const channel = options.interaction.channel

  // 1. Collect messages to stash (from target backwards)
  const toStash: Message[] = []
  let lastAuthor: string | null = null

  // Fetch messages ending at (and including) the target
  const messages = await channel.messages.fetch({
    before: options.message.id,
    limit: maxMessages,
  })
  // Add the target message itself
  const targetMsg = await channel.messages.fetch(options.message.id)
  const allMessages = [targetMsg, ...messages.values()]

  for (const msg of allMessages) {
    if (toStash.length >= maxMessages) break
    if (msg.author.bot && msg.content.startsWith('.')) continue // Skip dot-commands

    if (options.stopAtAuthorChange && lastAuthor && msg.author.id !== lastAuthor) {
      break
    }
    lastAuthor = msg.author.id
    toStash.push(msg)
  }

  if (toStash.length === 0) {
    throw new InfraError('No messages to stash')
  }

  // 2. Find the message just before the stash range (for fork anchor)
  const anchorMessage = await lastNormalMessage(channel, toStash[toStash.length - 1])
  if (!anchorMessage) {
    throw new InfraError('No anchor message found before the stash range')
  }

  // 3. Create fork thread from anchor
  const { thread } = await forkToThread({
    message: anchorMessage,
    client: options.client,
    interaction: options.interaction,
    isPublic: true,
    title: undefined, // Auto-generate
  })

  // 4. Copy messages to thread via webhook (preserving authorship)
  const webhook = await getOrCreateWebhook(thread, options.client)
  // Process oldest first (reverse the collected order)
  for (const msg of toStash.reverse()) {
    await webhookSend(webhook, {
      content: msg.content,
      username: msg.author.displayName,
      avatarURL: msg.author.displayAvatarURL(),
      threadId: thread.id,
    })
  }

  // 5. Delete original messages from channel
  //    Use bulkDelete if possible (messages < 14 days old and < 100)
  try {
    if (toStash.length > 1) {
      await (channel as TextChannel).bulkDelete(toStash)
    } else {
      await toStash[0].delete()
    }
  } catch (error) {
    // If bulk delete fails (messages too old), delete individually
    for (const msg of toStash) {
      try {
        await msg.delete()
      } catch {
        // Log but continue -- partial stash is better than failing entirely
      }
    }
  }

  // 6. Report
  await options.interaction.followUp(
    `.stash: moved ${toStash.length} message(s) to ${thread.url}`
  )
}
```

**Permissions required**: `ManageMessages` (for deleting originals), `ManageWebhooks`.

#### 3.4 Context Menu Commands

**File**: `src/infra/context-menus/index.ts`

```typescript
import { ContextMenuCommandBuilder, ApplicationCommandType } from 'discord.js'

export const forkContextMenu = new ContextMenuCommandBuilder()
  .setName('fork')
  .setType(ApplicationCommandType.Message)

export const forkPrivateContextMenu = new ContextMenuCommandBuilder()
  .setName('fork (private)')
  .setType(ApplicationCommandType.Message)

export const muContextMenu = new ContextMenuCommandBuilder()
  .setName('mu')
  .setType(ApplicationCommandType.Message)

export const stashContextMenu = new ContextMenuCommandBuilder()
  .setName('stash')
  .setType(ApplicationCommandType.Message)
```

Context menu handlers delegate to the same underlying functions as slash commands, mapping `interaction.targetMessage` to the `message` parameter.

#### 3.5 Fork Thread Auto-Rename Handler

**File**: `src/infra/handlers/fork-rename.ts`

```typescript
/**
 * When a message arrives in a thread whose name ends with "⌥",
 * and the message author differs from the previous normal message,
 * rename the thread to "⌥ {first 40 chars}..."
 */
async function handleForkRename(message: Message, client: Client): Promise<void> {
  if (!message.channel.isThread()) return
  if (!message.channel.name.endsWith('⌥')) return
  if (message.author.id === client.user?.id) return

  // Find the previous normal message
  const previous = await lastNormalMessage(message.channel, message)
  if (previous && previous.author.id === message.author.id) {
    return // Same author, no rename
  }

  // Strip Discord formatting for clean thread name
  const cleanContent = stripMentions(message.content)
  const newName = `⌥ ${cleanContent.slice(0, 40)}...`

  try {
    await message.channel.setName(newName)
  } catch (error) {
    // Thread rename can fail due to rate limits -- log but don't crash
    logger.warn({ error, threadId: message.channel.id }, 'Failed to rename fork thread')
  }
}
```

This handler is registered on the `messageCreate` event in `src/bot/index.ts`.

#### Acceptance Criteria
- `/infra fork` creates a public fork with correct futures index, anchor message, embed, and .history
- `/infra fork public:false` creates a private thread with .history and user ping
- Context menus "fork", "fork (private)", "mu" all work when right-clicking a message
- `/infra mu` forks from the parent message and sends `m continue @author`
- `/infra stash` copies messages via webhook, deletes originals, creates fork thread
- "stash" context menu works
- Fork threads auto-rename when a new author posts
- Futures index message is correctly maintained across multiple forks of the same source


### Phase 4: Webhook & Prompt Commands
**Estimated effort**: 2-3 days
**Dependencies**: Phase 0, Phase 3 (for webhook infrastructure)
**Deliverables**: `/infra copy`, `/infra send`, `/infra get-prompt`

#### `/infra copy`

**Handler logic**:
1. `deferReply({ ephemeral: true })`
2. Resolve source message from `message_link`
3. Resolve target channel
4. Get or create webhook in target channel
5. Send via webhook with source author's name and avatar
6. Report success with link to copied message

```typescript
const copySubcommand = (sub: SlashCommandSubcommandBuilder) =>
  sub
    .setName('copy')
    .setDescription('Copy a message to another channel via webhook')
    .addStringOption(opt =>
      opt.setName('message_link').setDescription('Message to copy').setRequired(true))
    .addChannelOption(opt =>
      opt.setName('target_channel').setDescription('Channel to copy to').setRequired(true))
```

#### `/infra send`

**Handler logic**:
1. `deferReply({ ephemeral: true })`
2. Get or create webhook in target channel
3. Send via webhook with specified username and optional avatar
4. Report success

```typescript
const sendSubcommand = (sub: SlashCommandSubcommandBuilder) =>
  sub
    .setName('send')
    .setDescription('Send a message to a channel as a specified user via webhook')
    .addChannelOption(opt =>
      opt.setName('target_channel').setDescription('Channel to send to').setRequired(true))
    .addStringOption(opt =>
      opt.setName('content').setDescription('Message content').setRequired(true))
    .addStringOption(opt =>
      opt.setName('username').setDescription('Display name').setRequired(true))
    .addStringOption(opt =>
      opt.setName('avatar_url').setDescription('Avatar image URL'))
```

#### `/infra get-prompt`

**File**: `src/infra/commands/get-prompt.ts`

This is the trace-based approach. Instead of rebuilding the prompt live (which would require simulating the entire context pipeline), we read the exact prompt that ChapterX sent from its trace files.

**Handler logic**:
1. `deferReply({ ephemeral: !public })`
2. Resolve message from `message_link` (or last message in channel)
3. Search trace index for entries containing this message ID:
   - Check `sentMessageIds` (the bot's response message)
   - Check `triggeringMessageId` (the message that triggered the bot)
   - Check `contextMessageIds` (any message in the context window)
4. If no trace found: report "No trace found for this message. The message may not have triggered a bot activation, or traces may have been rotated."
5. Load the trace file
6. Find the first LLM call with a `requestBodyRef`
7. Load the request body JSON
8. Format as readable text:
   - System prompt section
   - Each message with role label (user/assistant)
   - Tool definitions summary
9. Send as `.txt` file attachment

```typescript
/**
 * Format an LLM request body (Anthropic Messages API format) as readable text.
 */
function formatRequestAsText(body: Record<string, unknown>): string {
  const lines: string[] = []

  // System prompt
  if (body.system) {
    lines.push('=== SYSTEM PROMPT ===')
    if (typeof body.system === 'string') {
      lines.push(body.system)
    } else if (Array.isArray(body.system)) {
      for (const block of body.system) {
        if (block.type === 'text') {
          lines.push(block.text)
        }
      }
    }
    lines.push('')
  }

  // Messages
  if (Array.isArray(body.messages)) {
    lines.push('=== MESSAGES ===')
    for (const msg of body.messages) {
      lines.push(`--- ${(msg.role || 'unknown').toUpperCase()} ---`)
      if (typeof msg.content === 'string') {
        lines.push(msg.content)
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            lines.push(block.text)
          } else if (block.type === 'tool_use') {
            lines.push(`[Tool call: ${block.name}(${JSON.stringify(block.input)})]`)
          } else if (block.type === 'tool_result') {
            lines.push(`[Tool result for ${block.tool_use_id}]`)
            if (typeof block.content === 'string') {
              lines.push(block.content)
            }
          } else if (block.type === 'image') {
            lines.push('[Image]')
          }
        }
      }
      lines.push('')
    }
  }

  // Tools summary
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    lines.push('=== TOOLS ===')
    for (const tool of body.tools) {
      lines.push(`- ${tool.name}: ${tool.description || '(no description)'}`)
    }
  }

  // Model and parameters
  lines.push('')
  lines.push('=== PARAMETERS ===')
  lines.push(`Model: ${body.model || 'unknown'}`)
  if (body.max_tokens) lines.push(`Max tokens: ${body.max_tokens}`)
  if (body.temperature !== undefined) lines.push(`Temperature: ${body.temperature}`)
  if (body.stop_sequences) lines.push(`Stop sequences: ${JSON.stringify(body.stop_sequences)}`)

  return lines.join('\n')
}
```

**Edge cases**:
- Multiple traces found for one message (bot responded, then was re-triggered): use the most recent trace
- Trace exists but request body file is missing (rotated/deleted): report "Trace found but request body has been rotated"
- Message is from a non-bot user and was never triggered: report "No bot activation found for this message"

#### Acceptance Criteria
- `/infra copy` copies a message to another channel preserving author name/avatar
- `/infra send` sends arbitrary content as a specified user
- `/infra get-prompt` returns a `.txt` file with the formatted prompt from traces
- `/infra get-prompt` handles missing traces gracefully
- All webhook commands require ManageWebhooks permission


### Phase 5: ChapterX Integration (Passthrough Support)
**Estimated effort**: 2-3 days
**Dependencies**: None (can be done in parallel with other phases)
**Deliverables**: `passthrough:` field support in ChapterX context-fetch

This phase modifies ChapterX, not Soma. It is listed here because `/infra history passthrough:true` emits the field but ChapterX currently ignores it.

#### Current behavior in ChapterX

In `chapterx/working/src/discord/context-fetch.ts`:

When `fetchChannelMessages` encounters a `.history` command:
1. It calls `processHistoryCommand()`
2. If the `.history` has a `last:` URL, it recursively fetches messages from the linked channel
3. The result is `[linked range messages] + [messages newer than .history in current channel]`
4. Messages OLDER than the `.history` in the current channel are discarded (context is "cleared")

#### What passthrough should do

When `.history passthrough: true` is present:
1. Fetch the linked range as before
2. BUT: continue fetching messages OLDER than the `.history` in the current channel
3. Inject the linked range into the context at the position of the `.history` message
4. Result: `[older messages] + [linked range] + [newer messages]`

This allows "inserting" a conversation segment without losing the surrounding context.

#### Implementation sketch

In `processHistoryCommand()`, after parsing reveals `passthrough: true`:

```typescript
// Instead of returning immediately with only newerMessages + linkedRange,
// signal the caller to continue fetching older messages.

// Option A: Return a special result type that tells fetchChannelMessages to continue
interface HistoryResult {
  messages: Message[]
  didClear: boolean
  originChannelId: string | null
  /** If set, these messages should be injected at this position (passthrough mode). */
  injectedRange?: Message[]
}

// Option B: Don't return from the .history check; instead splice the range into
// the collected array and let the outer loop continue.
```

The `.history` YAML body already has the `passthrough` key parsed in `parseHistoryCommand()`. Currently the function only extracts `first` and `last`. Add `passthrough` to the parsed output.

**Modifications needed**:
1. `parseHistoryCommand()`: extract `passthrough: boolean` from YAML body
2. `HistoryRange` interface: add `passthrough?: boolean`
3. `processHistoryCommand()`: when `passthrough` is true, return a result that signals "continue fetching" rather than "stop here"
4. `fetchChannelMessages()`: handle the new signal by splicing in the linked range and continuing the fetch loop

#### Testing

Use `discord-qa-mcp` to:
1. Create test channel
2. Send a few messages (A, B, C)
3. Send `.history passthrough: true` with `last:` pointing to messages in another channel
4. Send messages D, E after the `.history`
5. Trigger a bot and verify the assembled context contains A, B, C, [linked range], D, E

#### Acceptance Criteria
- `.history` with `passthrough: true` injects linked range without clearing older context
- Existing `.history` behavior (without passthrough) is unchanged
- Recursion depth limit still applies
- Thread inheritance behavior is unaffected


### Phase 6: Polish, Permissions & Autocomplete
**Estimated effort**: 1-2 days
**Dependencies**: Phases 1-4
**Deliverables**: Final autocomplete handlers, permission checks, help text, error messages

#### Tasks

1. **Autocomplete for `targets` field** (multi-value bot name):
   - Parse the current input to find already-typed bot names
   - Filter bot registry to exclude already-typed names
   - Return matches for the last token being typed
   - This is the same pattern as chapter2's `targets_autocomplete`

2. **Autocomplete for `bot` field** (single bot name):
   - Standard search against bot registry
   - Show `sysname (displayName)` format

3. **Permission checks**:
   - All infra commands should require some base permission (e.g., `ManageMessages` or a custom role)
   - `/infra config`, `/infra unset-config`, `/infra config-speakers` are channel config changes -- consider requiring `ManageChannels`
   - `/infra stash` requires `ManageMessages` (deleting originals) + `ManageWebhooks`
   - `/infra copy`, `/infra send` require `ManageWebhooks`
   - Implement with `setDefaultMemberPermissions()` on the command builder

4. **Help text for `/infra` commands**:
   - Add an `/infra help` subcommand or integrate into the existing `/help` command
   - Brief description of the loom concept and each command's purpose

5. **Error message refinement**:
   - Consistent formatting across all infra commands
   - Include actionable suggestions (e.g., "Make sure the bot has ManageWebhooks permission")
   - Rate limit handling: detect 429 responses and suggest waiting

6. **Admin-only commands**:
   - `/infra send` and `/infra copy` are potentially abusable (impersonation)
   - Consider restricting to admin users or a specific role
   - Check `isAdminUserId()` from existing Soma auth system

---

## 5. ChapterX Integration Details

### 5.1 Trace File Layout

ChapterX writes traces to: `{TRACE_DIR}/{botName}/{channelId}-{traceId}-{timestamp}.json`

The JSONL index at `{TRACE_DIR}/index.jsonl` contains one JSON object per line:
```json
{
  "traceId": "abc123",
  "timestamp": "2026-03-18T10:30:00.000Z",
  "channelId": "123456789",
  "triggeringMessageId": "987654321",
  "botName": "claude",
  "success": true,
  "durationMs": 1500,
  "contextMessageIds": ["111", "222", "333"],
  "sentMessageIds": ["444"],
  "filename": "claude/123456789-abc123-2026-03-18T10-30-00-000Z.json"
}
```

Request bodies are at: `{TRACE_DIR}/bodies/{traceId}-req-{i}.json`
Response bodies are at: `{TRACE_DIR}/bodies/{traceId}-res-{i}.json`

The infra bot reads these as a filesystem consumer. No IPC or API calls to ChapterX.

### 5.2 EMS Config Layout

Bot configs are at: `{EMS_DIR}/{botName}/config.yaml`

The YAML structure matches chapter2's ontology:
```yaml
em:
  name: Claude
  continuation_model: claude-3-opus-20240229
  recency_window: 40
  temperature: 0.7
  # ... more em-level config
interfaces:
  - name: discord
    reply_on_random: 0
    split_message: true
    # ... more interface-level config
```

For `/infra get-config`, the infra bot reads the YAML, strips blacklisted keys, and returns it. It does NOT resolve pinned `.config` overrides from Discord -- that would require fetching pins (Cloudflare rate limit risk) and reimplementing chapter2's config resolution. The command returns the base config from disk.

If channel-level config resolution is needed later, it should be done via ChapterX's API (add an endpoint) rather than reimplementing pin fetching in the infra bot.

### 5.3 Passthrough Implementation in ChapterX

See Phase 5 above. The key change is in `context-fetch.ts`:

Current `HistoryRange` interface:
```typescript
export interface HistoryRange {
  first?: string  // Discord message URL
  last: string    // Discord message URL
}
```

Updated:
```typescript
export interface HistoryRange {
  first?: string
  last: string
  passthrough?: boolean
}
```

In `parseHistoryCommand()`, add `passthrough` extraction from the YAML body.

In `processHistoryCommand()`, when `passthrough` is true:
- Fetch the linked range as normal
- Instead of returning `{ messages: [...range, ...newerMessages], didClear: true }`, return a marker that tells the caller to continue fetching. One clean approach:

```typescript
// Return the range as an injection, and signal the caller to continue
return {
  messages: collectedNewer.slice().reverse(),
  didClear: false,         // <-- false means "keep fetching older messages"
  originChannelId: currentChannel.id,
  injectedMessages: rangeResult.messages,  // new field
}
```

Then in `fetchChannelMessages()`, when the result has `injectedMessages`, splice them into the final collected array at the right position.

---

## 6. Deployment & Permissions

### 6.1 Bot Permission Upgrade

Current Soma bot permissions:
- Read Messages
- Send Messages
- Embed Links
- Read Message History
- Add Reactions
- Use External Emojis

Additional permissions needed for infra:
- **Manage Webhooks** — for `/infra copy`, `/infra send`, `/infra stash`
- **Manage Messages** — for `/infra stash` (deleting originals), `/infra unset-config` (unpinning)
- **Create Public Threads** — for `/infra fork` (public forks)
- **Create Private Threads** — for `/infra fork` (private forks)
- **Send Messages in Threads** — for posting in created fork threads
- **Manage Threads** — for renaming fork threads (auto-rename handler)

**Action**: Generate new invite link with updated permissions. Re-invite the bot to all servers where infra commands are needed.

### 6.2 Environment Variables

Add to the bot's systemd service or `.env`:

```bash
# Bot map: sysname -> Discord user ID (JSON)
INFRA_BOT_MAP='{"claude":"123456789012345678","haiku45":"234567890123456789"}'

# ChapterX trace directory (read-only access)
CHAPTERX_TRACE_DIR=/opt/chapterx/logs/traces

# ChapterX EMS directory (read-only access for /get-config)
CHAPTERX_EMS_DIR=/opt/chapter2/ems

# Existing env vars remain unchanged
SOMA_DISCORD_TOKEN=...
SOMA_SERVICE_TOKENS=...
SOMA_DATABASE_PATH=...
```

### 6.3 Systemd Service

The Soma bot already runs as a systemd service on `borgs.animalabs.ai`. No service changes needed beyond updating environment variables.

If renaming from "soma" to "infra":
1. Create new service file `/etc/systemd/system/infra.service`
2. Copy from existing soma service
3. Update `Description`, `ExecStart`, environment file path
4. `systemctl enable infra && systemctl start infra`
5. `systemctl disable soma && systemctl stop soma`

### 6.4 Cutover from Chapter2

Once all infra commands are implemented and tested:

1. **Parallel running period** (1 week):
   - Both chapter2 infra and soma/infra run simultaneously
   - Register soma/infra commands to a test guild first (`SOMA_DEV_GUILD_ID`)
   - Test all commands against live data

2. **Command handoff**:
   - Unregister chapter2 infra's slash commands (remove from its command tree)
   - Register soma/infra's commands globally (remove `SOMA_DEV_GUILD_ID`)
   - Keep chapter2 infra process running but idle for rollback

3. **Decommission**:
   - After 2 weeks with no issues, stop chapter2 infra process
   - Archive the chapter2 infra codebase

---

## 7. Testing Strategy

### 7.1 Unit Tests (vitest)

Test pure functions without Discord API calls:

| Module | Tests |
|--------|-------|
| `parseMessageLink()` | Valid links, invalid strings, DM links, partial URLs |
| `compileDotCommand()` | Config with all params, with targets, empty config, history format |
| `cleanConfig()` | Nested blacklisted keys, arrays, empty objects |
| `formatRequestAsText()` | Anthropic format, tool calls, images, empty body |
| `BotRegistry.search()` | Exact match, partial match, no match, case insensitive |

### 7.2 Integration Tests (discord-qa-mcp)

Use the QA MCP server to test against a real Discord server:

#### Config Commands
1. Create test channel
2. `/infra config temperature:0.7 mute:true` -- verify `.config` message content and pin
3. `/infra config-speakers may_speak:bot1 bot2` -- verify `.config` with may_speak
4. `/infra unset-config` -- verify all `.config` pins removed
5. `/infra get-config bot:claude` -- verify YAML file attachment
6. Destroy test channel

#### History & Transcript
1. Create test channel, send 10 test messages
2. `/infra history last:{url of message 5}` -- verify `.history` message content and pin
3. `/infra transcript first_link:{msg1} last_link:{msg10} format:colon` -- verify .txt content
4. Destroy test channel

#### Loom (Fork/Mu/Stash)
1. Create test channel, send messages A, B, C, D
2. `/infra fork message_link:{B}` -- verify:
   - Index thread created on message B
   - Futures index message with B's URL
   - Anchor message with embed in channel
   - Fork thread created with `.history last:{B}`
3. `/infra fork message_link:{B}` again -- verify:
   - Reuses existing index thread
   - Futures index updated with second fork
4. `/infra mu message_link:{D}` -- verify:
   - Fork from C (parent of D)
   - `m continue @{D.author}` sent in thread
5. `/infra stash message_link:{D} max_messages:2` -- verify:
   - Messages C, D copied to new thread via webhook
   - Messages C, D deleted from channel
6. Verify fork auto-rename: post message in fork thread, check name change

#### Webhook Commands
1. Create two test channels (source, target)
2. Send message in source channel
3. `/infra copy message_link:{msg} target_channel:{target}` -- verify message appears in target with original author name
4. `/infra send target_channel:{target} content:hello username:TestUser` -- verify message appears

#### Get-Prompt
1. In a channel with a ChapterX bot, trigger the bot
2. Wait for response and trace to be written
3. `/infra get-prompt message_link:{bot_response}` -- verify .txt file content matches the actual prompt
4. `/infra get-prompt message_link:{random_message}` -- verify graceful "no trace found" message

### 7.3 Manual Testing Checklist

Before cutover from chapter2:

- [ ] All 8 slash subcommands respond within 3 seconds (via deferReply)
- [ ] All 4 context menu commands work
- [ ] Fork auto-rename fires correctly
- [ ] Autocomplete works for bot names and targets
- [ ] Error messages are clear and actionable
- [ ] Bot has all required permissions in production guilds
- [ ] Trace reading works with production trace directory
- [ ] Config reading works with production EMS directory
- [ ] No interference with existing Soma credit economy commands
- [ ] No interference with ChapterX bot operations

---

## 8. Open Questions

### Decisions Needed

1. **Rename or keep "Soma"?**
   The bot will be expanded significantly. Options:
   - Keep "Soma" as the package name, add infra as a module
   - Rename to "Infra" (or "anima-infra")
   - Keep dual identity: `/soma` for economy, `/infra` for infra tools

   **Recommendation**: Keep dual identity. No rename needed. The bot process stays "soma" internally but serves both command namespaces.

2. **Admin auth for infra commands?**
   Should infra commands use the same admin auth as Soma (admin user IDs + role IDs), or have their own auth?

   **Recommendation**: Reuse Soma's admin auth for destructive commands (`/infra send`, `/infra stash`, `/infra config`, `/infra unset-config`). Non-destructive commands (`/infra fork`, `/infra mu`, `/infra get-prompt`, `/infra transcript`, `/infra get-config`) should be available to all users with the base Discord permissions.

3. **Bot map source?**
   Chapter2 loaded bot lists from its own EMS directory at startup. Options:
   - Environment variable (`INFRA_BOT_MAP`) -- simple, requires manual updates when bots change
   - Read from EMS directory at startup (parse config.yaml files to find Discord IDs)
   - borgs-admin API (if one exists)

   **Recommendation**: Start with env var. Add EMS directory scanning later if maintenance becomes a problem. The bot list changes rarely.

4. **Stash: should it be admin-only?**
   Stash deletes messages from the channel, which is destructive. Chapter2 had it available to all users, but it was a small trusted group.

   **Recommendation**: Restrict to users with `ManageMessages` permission (Discord-level check). This naturally limits it to moderators and admins.

5. **Passthrough: priority level?**
   Adding `passthrough:` to ChapterX is a non-trivial change to the context-fetch pipeline. Should it be done before or after the main migration?

   **Recommendation**: After. The infra bot can emit `passthrough: true` in `.history` messages immediately. ChapterX will ignore it until support is added. This decouples the two work streams.

6. **Chapter2 `get_prompt` vs trace-based approach?**
   Chapter2's `/get_prompt` rebuilt the prompt live by calling its own `message_history()` and `get_prompt()` functions. The trace-based approach reads the exact prompt from disk. Trade-offs:
   - Live rebuild: always current, works for any message, but requires reimplementing the full context pipeline
   - Trace-based: shows the exact prompt that was sent, but only works for messages that actually triggered a bot

   **Decision**: Trace-based. It is far simpler, more accurate (shows exactly what was sent), and avoids reimplementing ChapterX's context pipeline in a separate codebase.

### Unknowns

7. **Cloudflare rate limits on pinning?**
   We know `fetchPins()` is rate-limited, but is `pin()` (pinning a single message) also affected? Need to verify. If so, `/infra config` and `/infra history` may need retry logic.

8. **Thread creation rate limits?**
   Fork creates threads frequently. Discord's thread creation rate limit is unclear. May need to add delays between rapid fork operations.

9. **Webhook caching?**
   `getOrCreateWebhook()` fetches webhooks on every call. Should we cache the webhook object per channel? discord.js may handle this internally via the webhook manager, but worth verifying.

10. **Trace index size on production?**
    The index.jsonl file grows indefinitely. On a busy server with many bots, it could be large. `findByMessageId()` reads the entire file. May need optimization (reverse scan with early exit, or a proper index structure) if performance is a problem.

---

## Appendix A: File Layout After Migration

```
src/
  # ── Existing Soma code (unchanged) ──
  api/
    middleware/auth.ts
    routes/*.ts
    server.ts
  bot/
    commands/
      admin.ts
      balance.ts
      costs.ts
      help.ts
      history.ts            # Soma credit history, NOT .history dot-command
      index.ts              # Updated: registers infra commands + context menus
      leaderboard.ts
      notifications.ts
      settings.ts
      transfer.ts
    embeds/builders.ts
    handlers/
      autocomplete.ts       # Updated: routes infra autocomplete
      buttons.ts
      notifications.ts
      reactions.ts
      welcome.ts
    notifications/dm.ts
    index.ts                # Updated: registers messageCreate handler for fork rename
  config.ts                 # Updated: new env vars
  db/
    connection.ts
    migrations.ts
    schema.ts
  index.ts
  services/*.ts
  types/*.ts
  utils/
    errors.ts
    logger.ts
    timezone.ts

  # ── New Infra code ──
  infra/
    shared/
      webhooks.ts           # getOrCreateWebhook, webhookSend
      messages.ts           # parseMessageLink, fetchMessageFromLink, resolveMessage, lastNormalMessage
      dot-commands.ts       # compileDotCommand
      bot-registry.ts       # BotRegistry class
      trace-reader.ts       # TraceReader class
      config-reader.ts      # ConfigReader class
      errors.ts             # InfraError hierarchy
      interaction.ts        # infraInteraction wrapper
    commands/
      index.ts              # /infra command group builder + subcommand routing
      config.ts             # /infra config, config-speakers, unset-config, get-config
      history.ts            # /infra history
      transcript.ts         # /infra transcript
      fork.ts               # /infra fork (+ forkToThread core logic)
      mu.ts                 # /infra mu
      stash.ts              # /infra stash
      copy.ts               # /infra copy
      send.ts               # /infra send
      get-prompt.ts         # /infra get-prompt
    context-menus/
      index.ts              # Context menu builders + handlers
    handlers/
      fork-rename.ts        # messageCreate handler for fork thread auto-rename
```

## Appendix B: New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `yaml` | `^2.x` | YAML parsing/serialization for dot-commands and config reading |

No other new dependencies. discord.js, pino, zod, better-sqlite3, express are already present.

## Appendix C: Discord API Considerations

### Rate Limits

| Operation | Limit | Mitigation |
|-----------|-------|------------|
| `fetchPinned()` | Cloudflare Error 1015 per-IP | Avoid in hot paths; use timeout wrapper; consider native fetch bypass |
| `pin()` | 5/channel/5s (Discord) | Should be fine for single pin operations |
| Thread creation | 50/guild/5min (approximate) | Rate unlikely to be hit in normal usage |
| Webhook creation | 10/channel | Cache webhooks per channel |
| `bulkDelete()` | Messages must be < 14 days old, max 100 | Fall back to individual delete for old messages |

### Limits

| Limit | Value | Relevance |
|-------|-------|-----------|
| Slash command subcommands | 25 per top-level command | `/infra` has 8 subcommands -- plenty of room |
| Context menu commands | 5 per bot | We use 4 -- one remaining |
| Thread name length | 100 characters | Fork names are truncated to ~50 chars |
| Embed description | 4096 characters | Fork embeds may need truncation for long messages |
| File attachment | 25 MB (Nitro) / 8 MB (standard) | Transcript and prompt files unlikely to exceed this |
| Pinned messages per channel | 50 | `/infra unset-config` should clean up old pins |

## Appendix D: Phased Timeline

| Phase | Effort | Depends On | Can Parallelize With |
|-------|--------|------------|---------------------|
| Phase 0: Setup & Shared Infra | 1-2 days | -- | -- |
| Phase 1: Config Commands | 2-3 days | Phase 0 | Phase 5 |
| Phase 2: History & Transcript | 1-2 days | Phase 0 | Phase 1, Phase 5 |
| Phase 3: Loom (Fork/Mu/Stash) | 3-4 days | Phase 0, Phase 2 | Phase 5 |
| Phase 4: Webhook & Prompt | 2-3 days | Phase 0, Phase 3 | Phase 5 |
| Phase 5: ChapterX Passthrough | 2-3 days | -- | All phases |
| Phase 6: Polish & Permissions | 1-2 days | Phases 1-4 | -- |

**Total estimated effort**: 12-19 days (2.5-4 weeks)
**Critical path**: Phase 0 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 6
