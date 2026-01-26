# jpOS Agent

Personal AI agent running on Digital Ocean with Telegram and HTTP API interfaces.

## Claude Agent SDK Notes

- **Always use `permissionMode: "acceptEdits"`** - Using `"bypassPermissions"` causes the SDK to fail with "Claude Code process exited with code 1"
- The SDK requires Claude Code CLI installed on the host machine
- MCP server paths should be absolute (e.g., `/root/jpOS-agent/dist/mcp/todoist.js`)

## Architecture

- `src/agent.ts` - Agent SDK wrapper with session management
- `src/interfaces/telegram.ts` - Telegram bot (grammy)
- `src/interfaces/api.ts` - HTTP API (Fastify)
- `src/mcp/todoist.ts` - Todoist MCP server
- `src/obsidian.ts` - Git operations for Obsidian vault

## API Endpoints

### POST /voice-note
Webhook for voice transcription apps. Logs to Obsidian vault, analyzes for actions, sends Telegram notification.

```
POST /voice-note
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

- Hosted on Digital Ocean droplet
- Auto-deploys via GitHub Actions on push to main
- Uses PM2 for process management

## Obsidian Vault

- Repo: `git@github.com:Jpoliachik/obsidian.git`
- Cloned to `/root/obsidian-vault` on the server
- Voice notes saved to `voice-notes/YYYY-MM-DD.md`
- Requires SSH key on server for push access
