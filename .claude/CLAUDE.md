# jpOS Agent

Personal AI agent hosted on Fly.io with Telegram and HTTP API interfaces.

## Guiding Principles

### Repo vs Obsidian vault: what goes where

- **This repo (`system/`):** Durable, human-authored prompts — identity (`soul.md`), instructions (`instructions.md`), trigger-specific skills (`skills/*.md`). Version-controlled, reviewed in PRs.
- **This repo (`.claude/skills/`):** On-demand Claude Code skills — discoverable by the agent and invocable via the `Skill` tool during any conversation. Use this for reusable capabilities that aren't tied to a specific trigger.
- **This repo (`src/`):** Runtime code, tool call implementations, integrations, interfaces (Telegram, API), infrastructure.
- **Obsidian vault:** Runtime-mutable agent data — memory (`memory.md`), daily logs (`daily-log/`), voice notes (`voice-notes/`), context files (`context/`). Anything the agent writes or modifies at runtime.

### Agent-first design: expose tools, don't make assumptions

Everything we build should be exposed as **tool calls that let the agent decide** how and when to use them. Do not hardcode specific usage patterns or make assumptions about when/how a capability should be invoked. Instead:

- Provide the tool and make its availability known in the system prompt
- Let the agent decide when to call it and how to combine it with other tools
- Prefer loading minimal context by default and letting the agent fetch more on demand
- Avoid baking business logic into the runtime that should be agent-driven

### Prefer CLI + skills over MCP for new integrations

CLI tools (invoked via Bash) are more token-efficient than MCP tool definitions and avoid context window bloat. MCP servers are still used for Todoist, Linear, and App Store Connect (legacy).

## Claude Agent SDK Notes

- **Always use `permissionMode: "acceptEdits"`** - Using `"bypassPermissions"` causes the SDK to fail with exit code 1
- MCP server paths should be absolute (e.g., `/app/dist/mcp/todoist.js`)

## Architecture

- `src/agent.ts` - Agent SDK wrapper with session management + auto-recall step
- `src/prompt.ts` - Builds system prompt from repo system files + vault memory
- `src/memory.ts` - **(legacy, being phased out)** File-based reader for vault digests/daily logs
- `src/memory-store.ts` - **mem0 + Qdrant memory store.** Primary memory layer.
- `src/interfaces/telegram.ts` - Telegram bot (grammy)
- `src/interfaces/api.ts` - HTTP API (Fastify) + memory inspection endpoints
- `src/mcp/memory.ts` - Memory MCP server (`remember`, `recall`, `list_memories`, `forget`, `update_memory`)
- `src/mcp/todoist.ts` - Todoist MCP server
- `src/obsidian.ts` - Git operations for Obsidian vault

## Memory layer (mem0 + Qdrant)

The agent's long-term memory uses [mem0](https://github.com/mem0ai/mem0) backed by a self-hosted Qdrant vector store on Fly.

- **Vector store:** Qdrant — separate Fly app `jpos-qdrant`, reachable internally at `http://jpos-qdrant.internal:6333`. See `jpos-qdrant/README.md` for setup.
- **LLM (for fact extraction + dedup):** `gpt-4.1-nano` via OpenAI (cheap; ~$0.001/write). Configurable via `MEM0_LLM_MODEL`.
- **Embeddings:** `text-embedding-3-small` via OpenAI. Configurable via `MEM0_EMBEDDING_MODEL`.
- **History DB:** SQLite at `/data/mem0-history.db` on Fly (tracks add/update/delete events).
- **Single-user:** all memories written under `userId = "jp"`; use `metadata.source` (voice-note, telegram, daily-prep, etc.) to distinguish origin.

### Auto-recall

`runAgent()` does a top-K (default 5) mem0 search on the incoming user message and injects results into the system prompt under a `# Recalled Memories` section. Fail-graceful: if Qdrant is down, the agent still responds without recalled context. Opt out by passing `autoRecall: false` (used for all cron jobs — their prompts are meta-instructions, not queries).

### Inspecting memory

The HTTP API exposes (Bearer-token auth):
- `GET /memory?source=&category=&limit=` — list recent memories
- `GET /memory/search?q=...&topK=&source=&category=` — semantic search
- `GET /memory/stats` — totals + breakdown by source/category
- `GET /memory/:id` — single memory
- `POST /memory` — manual write (debugging/seeding)
- `DELETE /memory/:id` — forget

### Required env vars

- `OPENAI_API_KEY` (required) — for embeddings + mem0's extraction LLM
- `QDRANT_URL` (default `http://localhost:6333`; on Fly set to `http://jpos-qdrant.internal:6333`)
- `MEM0_LLM_MODEL` (default `gpt-4.1-nano`)
- `MEM0_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- `MEM0_HISTORY_DB_PATH` (default `./mem0-history.db`; on Fly set to `/data/mem0-history.db`)

## System Prompts (in this repo)

System prompts live in `system/` at the repo root. These are version-controlled and deployed with the app.

- `system/soul.md` — Agent identity, personality, hard rules
- `system/instructions.md` — General action guidelines (memory, GitHub Issues, Todoist, calendar, etc.)
- `system/skills/voice-note.md` — How to process voice note transcripts
- `system/skills/daily-prep.md` — Morning briefing prompt
- `system/skills/eod-checkin.md` — End-of-day check-in prompt
- `system/skills/message.md` — How to handle direct messages

### On-Demand Skills (`.claude/skills/`)

Claude Code skills that the agent can discover and invoke via the `Skill` tool during any conversation. These are NOT pre-loaded into system context — they load on demand when relevant.

- `.claude/skills/weekly-review/SKILL.md` — Weekly digest synthesis (also triggered by cron Sunday 8 PM ET)
- `.claude/skills/month-in-review/SKILL.md` — Monthly summary from weekly digests (also triggered by cron 1st of month 8 PM ET)
- `.claude/skills/memory-prune/SKILL.md` — Review and prune stale memory.md entries
- `.claude/skills/project-status/SKILL.md` — Pull project state from all available sources

### Template Variables

`{{date}}`, `{{time}}`, `{{vault_path}}`, `{{week_file}}`, `{{month_file}}`, `{{transcript}}` are replaced at load time in `src/prompt.ts`.

## Obsidian Vault Data (runtime-mutable)

The vault contains data the agent reads and writes at runtime:

- `jpOS/memory.md` — Durable memory (always loaded into system prompt)
- `jpOS/monthly-digest/` — Monthly summaries (`YYYY-MM.md`), last 3 months loaded automatically
- `jpOS/weekly-digest/` — Weekly digests (`YYYY-WXX.md`), last 4 weeks loaded automatically
- `jpOS/daily-log/` — Daily log entries (`YYYY-MM-DD.md`), last 3 days loaded automatically
- `jpOS/voice-notes/` — Daily voice note logs
- `jpOS/context/` — Stable reference files (projects, people, goals — no assumed filenames)

## State Management

- **`jpos-state.json`** (persistent, on-disk) — Small flags and config only: `lastDailyPrepDate`, `lastWeeklyReviewWeek`, `lastMonthlyReviewMonth`, feature toggles, etc.
- **Sessions** (in-memory) — 30-min TTL, ephemeral.
- **Obsidian vault** (persistent, git-backed) — Long-term memory, daily logs, voice notes, context.

## API Endpoints

- `POST /ramble/webhook` — Ramble voice transcript webhook (auth via `X-Webhook-Secret` header, secret set as `RAMBLE_WEBHOOK_SECRET` on Fly.io)
- `POST /agent` — General agent interaction with optional session persistence (Bearer token auth)
- `GET /health` — Health check (no auth)
- `GET /memory`, `/memory/search`, `/memory/stats`, `/memory/:id` — Memory inspection (Bearer token auth)
- `POST /memory`, `DELETE /memory/:id` — Manual memory write/delete (Bearer token auth)

## Deployment

- Hosted on Fly.io at `https://jpos-agent.fly.dev`
- Auto-deploys via GitHub Actions on push to main
- Persistent volume at `/data` for Obsidian vault
- **Sister app:** `jpos-qdrant` (in `jpos-qdrant/` directory) — internal-only Qdrant vector store, reachable at `http://jpos-qdrant.internal:6333`. Deploy independently with `cd jpos-qdrant && fly deploy`.

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
- **Calendar usage** documented in `system/instructions.md` and `system/skills/daily-prep.md`
