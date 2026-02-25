# jpOS Agent

Personal AI agent hosted on Fly.io with Telegram and HTTP API interfaces.

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
