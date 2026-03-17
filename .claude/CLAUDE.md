# jpOS Agent

Personal AI agent hosted on Fly.io with Telegram and HTTP API interfaces.

## Integration Philosophy

- **Prefer CLI + skills over MCP** for new integrations. CLI tools (invoked via Bash) are more token-efficient than MCP tool definitions and avoid context window bloat. Add usage instructions to the system prompt (skills) rather than registering MCP tool schemas.
- MCP servers are still used for Todoist, Linear, and App Store Connect (legacy).

## Claude Agent SDK Notes

- **Always use `permissionMode: "acceptEdits"`** - Using `"bypassPermissions"` causes the SDK to fail with "Claude Code process exited with code 1"
- The SDK requires Claude Code CLI installed on the host machine
- MCP server paths should be absolute (e.g., `/app/dist/mcp/todoist.js`)

## Architecture

- `src/agent.ts` - Agent SDK wrapper with session management
- `src/instructions.ts` - Loads system prompts, skills, and memory from Obsidian vault
- `src/memory.ts` - Daily memory file reader (loads recent N days)
- `src/interfaces/telegram.ts` - Telegram bot (grammy)
- `src/interfaces/api.ts` - HTTP API (Fastify)
- `src/mcp/todoist.ts` - Todoist MCP server
- `src/obsidian.ts` - Git operations for Obsidian vault

## System Instructions (Obsidian-driven)

All jpOS data lives under `jpOS/` in the Obsidian vault:

- `jpOS/system/soul.md` — Agent identity, personality, hard rules
- `jpOS/system/instructions.md` — General action guidelines (GitHub Issues, Todoist, vault notes, memory, etc.)
- `jpOS/system/skills/voice-note.md` — How to process voice note transcripts
- `jpOS/system/skills/daily-prep.md` — Morning briefing prompt
- `jpOS/system/skills/message.md` — How to handle direct messages
- `jpOS/context/` — Stable reference files (projects, people, goals — no assumed filenames)
- `jpOS/memory/` — Daily memory entries (`YYYY-MM-DD.md`), last 5 days loaded automatically
- `jpOS/voice-notes/` — Daily voice note logs

### Memory System

The agent writes timestamped entries to `jpOS/memory/YYYY-MM-DD.md` after each interaction.
`src/memory.ts` loads the most recent 5 days of memory files into the system prompt as "Recent Memory".
This replaces the need for a `current-focus.md` file — current focus is whatever's in recent memory.

Stable, slow-changing info (projects, people, goals) stays in `jpOS/context/` as reference files.
The code does not assume any specific context files exist — it loads whatever is present.

### Template Variables

`{{date}}`, `{{time}}`, `{{vault_path}}`, `{{transcript}}` are replaced at load time.

Default versions of system files ship in `system-defaults/` and are seeded into the vault on first run (won't overwrite edits made in Obsidian). No context files are seeded — those are created organically by the agent or the user.

## API Endpoints

### POST /voice-note
Webhook for voice transcription apps. Logs to Obsidian vault, analyzes for actions, sends Telegram notification.

```
POST https://jpos-agent.fly.dev/voice-note
Authorization: Bearer <API_BEARER_TOKEN>
Content-Type: application/json

{
  "transcript": "Your transcribed text",
  "timestamp": "10:30 AM"  // optional
}
```

### POST /agent
General agent interaction with optional session persistence.

### GET /health
Health check (no auth).

## Deployment

- Hosted on Fly.io at `https://jpos-agent.fly.dev`
- Auto-deploys via GitHub Actions on push to main
- Persistent volume at `/data` for Obsidian vault

## Obsidian Vault

- Repo: `github.com/Jpoliachik/obsidian`
- Cloned to `/data/obsidian-vault` on the container
- All jpOS data under `jpOS/` directory (voice-notes, context, system instructions)
- Voice notes saved to `jpOS/voice-notes/YYYY-MM-DD.md`
- Uses GitHub PAT (GITHUB_PAT secret) for push access
- **Timezone: `America/New_York`** - hardcoded in `src/obsidian.ts` for date/time conversion

## Google Workspace CLI (`gws`)

Google Calendar (and other Workspace APIs) are accessed via the `gws` CLI, not MCP. The agent calls `gws` commands through the Bash tool.

- **Package:** `@googleworkspace/cli` (installed globally in Docker image)
- **Auth:** Two-part setup. `config.ts` generates `client_secret.json` at `/data/gws-config/` from `GOOGLE_WORKSPACE_CLI_CLIENT_ID` + `CLIENT_SECRET` Fly secrets on every boot. Then a one-time `gws auth login` on the container stores `credentials.enc` on the persistent `/data` volume.
- **Keyring:** Uses file backend (`GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file`) in containers
- **Calendar commands:** `gws calendar +agenda`, `gws calendar +insert`, `gws calendar events list/delete`
- **Skills/instructions:** Calendar usage documented in `system-defaults/instructions.md` and `system-defaults/skills/daily-prep.md`
- **Setup on Fly.io:**
  1. `fly secrets set GOOGLE_WORKSPACE_CLI_CLIENT_ID=... GOOGLE_WORKSPACE_CLI_CLIENT_SECRET=...`
  2. Deploy, then `fly ssh console` and run `gws auth login` once (stores encrypted token on /data volume)
