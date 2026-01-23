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

## Deployment

- Hosted on Digital Ocean droplet
- Auto-deploys via GitHub Actions on push to main
- Uses PM2 for process management
