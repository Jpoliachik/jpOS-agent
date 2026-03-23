# jpOS Agent

Personal AI agent hosted on Fly.io with Telegram and HTTP API interfaces.

## Integration Philosophy

- **Prefer CLI + skills over MCP** for new integrations. CLI tools (invoked via Bash) are more token-efficient than MCP tool definitions and avoid context window bloat.
- MCP servers are still used for Todoist, Linear, and App Store Connect (legacy).

## Claude Agent SDK Notes

- **Always use `permissionMode: "acceptEdits"`** - Using `"bypassPermissions"` causes the SDK to fail with exit code 1
- MCP server paths should be absolute (e.g., `/app/dist/mcp/todoist.js`)

## Architecture

- `src/agent.ts` - Agent SDK wrapper with session management
- `src/instructions.ts` - Loads system prompts, skills, and memory from Obsidian vault
- `src/memory.ts` - Daily memory file reader (loads recent N days)
- `src/interfaces/telegram.ts` - Telegram bot (grammy)
- `src/interfaces/api.ts` - HTTP API (Fastify)
- `src/mcp/todoist.ts` - Todoist MCP server
- `src/obsidian.ts` - Git operations for Obsidian vault

## System Instructions (Obsidian vault — NOT in this repo)

All agent prompts, skills, and personality live in the Obsidian vault, not this repo. This repo contains only the runtime code. If `soul.md` or `instructions.md` are missing from the vault, the agent will error on startup with a message to Telegram.

**Required vault files** (under `jpOS/system/` in the Obsidian vault):
- `soul.md` — Agent identity, personality, hard rules
- `instructions.md` — General action guidelines (memory, GitHub Issues, Todoist, calendar, etc.)

**Skills** (under `jpOS/system/skills/`):
- `voice-note.md` — How to process voice note transcripts
- `daily-prep.md` — Morning briefing prompt
- `message.md` — How to handle direct messages

**Other vault data:**
- `jpOS/context/` — Stable reference files (projects, people, goals — no assumed filenames)
- `jpOS/memory/` — Daily memory entries (`YYYY-MM-DD.md`)
- `jpOS/voice-notes/` — Daily voice note logs

### Template Variables

`{{date}}`, `{{time}}`, `{{vault_path}}`, `{{transcript}}` are replaced at load time in `src/instructions.ts`.

## State Management

- **`jpos-state.json`** (persistent, on-disk) — Small flags and config only: `lastDailyPrepDate`, feature toggles, etc.
- **Sessions** (in-memory) — 30-min TTL, ephemeral.
- **Ramble jobs** (in-memory) — Short-lived, actively mutated during processing.
- **Obsidian vault** (persistent, git-backed) — Long-term knowledge, system instructions, memory.

## API Endpoints

- `POST /voice-note` — Webhook for voice transcription apps (auth required)
- `POST /agent` — General agent interaction with optional session persistence
- `GET /health` — Health check (no auth)

## Deployment

- Hosted on Fly.io at `https://jpos-agent.fly.dev`
- Auto-deploys via GitHub Actions on push to main
- Persistent volume at `/data` for Obsidian vault

## Obsidian Vault

- Repo: `github.com/Jpoliachik/obsidian`
- Cloned to `/data/obsidian-vault` on the container
- Uses GitHub PAT (GITHUB_PAT secret) for push access
- **Timezone: `America/New_York`** — hardcoded in `src/obsidian.ts`

## Google Workspace CLI (`gws`)

Google Calendar accessed via `gws` CLI, not MCP.

- **Package:** `@googleworkspace/cli` (installed globally in Docker image)
- **Auth:** Headless via env vars — `GOOGLE_WORKSPACE_CLI_TOKEN` or `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE`
- **Keyring:** File backend (`GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file`) in containers
- **Calendar commands:** `gws calendar +agenda`, `gws calendar +insert`, `gws calendar events list/delete`
- **Calendar usage** documented in vault files: `jpOS/system/instructions.md` and `jpOS/system/skills/daily-prep.md`
