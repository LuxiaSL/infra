# Infra

> Discord bot for ichor economy and ChapterX infrastructure commands

**Infra** (formerly **Soma**) is a Discord bot and REST API that manages two distinct concerns:

1. **Ichor Economy** -- A credit system for AI bot interactions. Users spend ichor to trigger ChapterX bots, earn it back through regeneration and social rewards, and trade it with others.
2. **Loom and Config** -- Infrastructure commands for managing ChapterX bot channels: thread forking (loom), channel configuration, history splicing, prompt inspection, and message utilities.

Runs on the same VPS as ChapterX (`aetherawi.red`), backed by SQLite.

---

## Quick Start

Requires Node.js >= 20.

```bash
npm install
cp .env.example .env   # then edit
npm run dev             # starts API server + Discord bot with hot-reload
```

For production:

```bash
npm run build
npm start
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOMA_SERVICE_TOKENS` | Yes | -- | Comma-separated API auth tokens |
| `SOMA_DISCORD_TOKEN` | No | -- | Discord bot token |
| `SOMA_PORT` | No | `3100` | API server port |
| `SOMA_DATABASE_PATH` | No | `./data/soma.db` | SQLite database path |
| `SOMA_ADMIN_ROLES` | No | -- | Comma-separated Discord role IDs for admin access |
| `SOMA_DEV_GUILD_ID` | No | -- | Guild ID for instant command registration (dev only) |
| `SOMA_BASE_REGEN_RATE` | No | `5` | Ichor regenerated per hour |
| `SOMA_MAX_BALANCE` | No | `100` | Maximum ichor balance cap |
| `SOMA_STARTING_BALANCE` | No | `50` | Initial ichor for new users |
| `EMS_PATH` | No | `/opt/chapter2/ems` | Path to bot configs in EMS layout |
| `TRACE_DIRS` | No | `/opt/chapterx/logs/traces,...` | Comma-separated trace directories |
| `LOG_LEVEL` | No | `info` | Log level: debug, info, warn, error |

---

## Command Reference

### Ichor Economy

User-facing commands for the credit system.

| Command | Description |
|---------|-------------|
| `/balance` | Check your ichor balance and regeneration info |
| `/transfer @user <amount>` | Send ichor to another user |
| `/costs` | View bot activation costs for this server |
| `/history` | View your recent transactions |
| `/leaderboard` | Top community contributors (by tips/reactions received) |
| `/settings` | View and adjust your personal settings |
| `/notifications` | Manage DM notification preferences |
| `/help` | Overview of the ichor system |

When you mention or reply to a ChapterX bot, ichor is automatically deducted. If you lack funds, you receive a DM notification.

### Ichor Admin

Requires Administrator permission or a role listed in `SOMA_ADMIN_ROLES`.

| Command | Description |
|---------|-------------|
| `/ichor grant @user <amount>` | Grant ichor to a user |
| `/ichor revoke @user <amount>` | Remove ichor from a user |
| `/ichor set-cost @Bot <cost>` | Set a bot's activation cost |
| `/ichor set-role @Role` | Configure role regen/cost multipliers |
| `/ichor stats` | Server-wide economy statistics |
| `/ichor update-user @user` | Force refresh a user's role cache |
| `/ichor config-view` | View current server config |
| `/ichor config-rewards-emoji <emoji>` | Set reward emoji |
| `/ichor config-rewards-amount <n>` | Set ichor earned per reward reaction |
| `/ichor config-tip-emoji <emoji>` | Set tip emoji (supports custom emoji) |
| `/ichor config-tip-amount <n>` | Set ichor per tip |
| `/ichor config-reset` | Reset server config to defaults |

Note: The admin command is being renamed from `/soma` to `/ichor`.

### Loom

Thread forking with ancestry tracking. Fork threads create an explorable tree of conversation branches.

| Command | Description |
|---------|-------------|
| `/fork [message_link] [public] [title]` | Fork a new thread from a message |
| `/mu [message_link]` | Mu -- alternate continuation (fork + delete last message) |
| `/stash [message_link]` | Stash a message into a private thread |

All three are also available as **context menu commands** (right-click a message). Fork threads auto-rename based on conversation content and are tagged with a loom index tracking their ancestry.

### Config

Manage ChapterX bot configuration via pinned `.config` messages. Bots read these during config resolution.

| Command | Description |
|---------|-------------|
| `/config [targets] [options...]` | Set bot config for this channel (pins a `.config` message) |
| `/config_speakers` | Configure speaker mappings |
| `/unset_config` | Remove config keys from the active pinned config |
| `/get_config <bot>` | View effective config for a bot in this channel (base + pin overlays) |

Config options include: `continuation_model`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `max_tokens`, `recency_window`, `reply_on_random`, `mute`, `split_message`, `ignore_dotted_messages`.

### Utility

| Command | Description |
|---------|-------------|
| `/copy [message_link] [channel]` | Copy a message to another channel via webhook (preserves author) |
| `/send <content> [user] [channel]` | Send a message as a given user via webhook |
| `/history_splice [first] [last]` | Pin a `.history` message for context splicing |
| `/transcript <start> [end] [limit]` | Export message history between two points as a text file |
| `/get_prompt <message_id> [bot]` | View the LLM prompt that was sent for a message (from traces) |

---

## API

REST API at `http://localhost:3100/api/v1`. All endpoints except `/health` require `Authorization: Bearer <token>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `POST` | `/check-and-deduct` | Check balance and deduct for bot activation |
| `GET` | `/balance/:userId` | Get user balance |
| `POST` | `/transfer` | Transfer ichor between users |
| `GET` | `/costs/:serverId` | Get bot costs for a server |
| `POST` | `/reward` | Record a reaction reward |
| `POST` | `/refund` | Refund a failed activation |
| `POST` | `/track-message` | Track a bot message for reactions |
| `GET` | `/history/:userId/:serverId` | Transaction history |
| `GET` | `/leaderboard/:serverId` | Leaderboard data |
| `POST` | `/admin/grant` | Grant ichor (admin) |
| `POST` | `/admin/set-cost` | Set bot cost (admin) |
| `POST` | `/admin/set-role` | Set role multipliers (admin) |
| `POST` | `/admin/configure` | Server configuration (admin) |

---

## Architecture

```
                       ┌──────────────────┐
  ChapterX Bots ─────>│  Infra API       │<───── Infra Discord Bot
  (check-and-deduct,   │  (Express, :3100) │       (commands, reactions,
   refund, reward)     │  SQLite backend   │        notifications)
                       └──────────────────┘
```

Two components in one process:

- **API Server** (Express) -- Called by ChapterX bots to check/deduct ichor, record rewards, and track messages. Bearer token auth.
- **Discord Bot** (discord.js) -- Handles slash commands, context menus, button interactions, and reaction watching. Communicates with the API server via a shared in-process EventBus (e.g., insufficient-funds notifications trigger DMs).

Both start from a single entry point (`src/index.ts`). The bot is optional -- if `SOMA_DISCORD_TOKEN` is not set, only the API server runs.

### Project Structure

```
src/
├── api/              # Express routes and auth middleware
│   ├── routes/       # Endpoint handlers
│   └── middleware/    # Bearer token auth
├── bot/              # Discord bot
│   ├── commands/     # Slash commands
│   │   └── infra/    # Loom, config, and utility commands
│   ├── handlers/     # Reactions, buttons, autocomplete
│   ├── notifications/# DM notification helpers
│   └── embeds/       # Rich embed builders
├── infra/            # Shared infra logic (loom, webhooks, config-message)
├── db/               # SQLite connection and schema
├── services/         # Business logic (balance, tracking, roles, config)
├── types/            # TypeScript types
└── utils/            # Logger, errors
```

---

## Development

```bash
npm run dev       # Hot-reload via tsx watch
npm test          # Run tests (vitest)
npm run lint      # ESLint
npm run format    # Prettier
```

### Database

SQLite, created automatically on first run at `SOMA_DATABASE_PATH`. Key tables: `users`, `balances`, `servers`, `bot_costs`, `role_configs`, `transactions`, `tracked_messages`, `reward_claims`, `user_server_roles`.

---

## License

MIT
