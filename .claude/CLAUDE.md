# jpOS Agent

Personal AI agent hosted on Fly.io with Telegram and HTTP API interfaces.

## Guiding Principles

### Repo vs Obsidian vault: what goes where

- **This repo (`system/`):** Durable, human-authored prompts — identity (`soul.md`), instructions (`instructions.md`), trigger-specific skills (`skills/*.md`). Version-controlled, reviewed in PRs.
- **This repo (`.claude/skills/`):** On-demand Claude Code skills — discoverable by the agent and invocable via the `Skill` tool during any conversation. Use this for reusable capabilities that aren't tied to a specific trigger.
- **This repo (`src/`):** Runtime code, tool call implementations, integrations, interfaces (Telegram, API), infrastructure.
- **Obsidian vault:** Runtime-mutable agent data — daily logs (`daily-log/`), weekly/monthly digests, voice notes (`voice-notes/`), context files (`context/`). Anything the agent writes or modifies at runtime. (Atomic durable memory lives in Qdrant, not the vault.)

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
- `src/memory.ts` - File-based reader for vault digests/daily logs (NOT durable memory — that's Qdrant)
- `src/memory-store.ts` - **Qdrant + OpenAI memory store.** Sole durable memory layer.
- `src/interfaces/telegram.ts` - Telegram bot (grammy)
- `src/interfaces/api.ts` - HTTP API (Fastify) + memory inspection endpoints
- `src/mcp/memory.ts` - Memory MCP server (`remember`, `recall`, `list_memories`, `forget`, `update_memory`)
- `src/mcp/todoist.ts` - Todoist MCP server
- `src/mcp/db.ts` - Structured-data MCP server (`db_query`, `db_tables`, `contact_save`, `contact_log_touch`)
- `src/db/` - Structured-data store: client, migrations, Zod schemas, per-table repositories
- `src/obsidian.ts` - Git operations for Obsidian vault

## Memory layer (Qdrant + OpenAI)

The agent's long-term memory is a thin wrapper (~300 LOC in `src/memory-store.ts`) over a self-hosted Qdrant vector store and OpenAI embeddings. We previously tried mem0 here but ripped it out after their JS bundle's eager-import-every-provider design forced ~150 unused transitive deps.

- **Vector store:** Qdrant — separate Fly app `jpos-qdrant`, reachable internally at `http://jpos-qdrant.internal:6333`. See `jpos-qdrant/README.md` for setup.
- **Embeddings:** `text-embedding-3-small` via OpenAI (1536 dims). Configurable via `MEMORY_EMBEDDING_MODEL`.
- **Dedup LLM:** `gpt-4.1-nano` via OpenAI — one call per `remember()` to decide ADD vs REPLACE vs NOOP against the top-K nearest existing memories (threshold 0.85 cosine). Configurable via `MEMORY_DEDUP_MODEL`.
- **No extraction:** the agent is responsible for passing clean atomic facts to `remember`; the store doesn't extract or rewrite content. See `system/instructions.md`.
- **Single-user:** all memories written under `userId = "jp"` (Qdrant payload field); use `source` (voice-note, telegram, daily-prep, etc.) and `category` payload fields to distinguish/filter.
- **No history DB:** simpler than mem0; if we want change history later we can add it as another collection.

### Auto-recall

`runAgent()` embeds the incoming user message, searches Qdrant for top-K (default 5), and injects results into the system prompt under a `# Recalled Memories` section. Fail-graceful: if Qdrant is down, the agent still responds without recalled context. Opt out by passing `autoRecall: false` (used for all cron jobs — their prompts are meta-instructions, not queries).

## Structured Data Store (SQLite/libSQL)

For **structured, reliably-queryable data about JP** — the kind you want exact SQL queries, sorting, and date math over (contacts/Rolodex, and later workouts, sleep, etc.). Complements the two existing stores: Qdrant is for fuzzy semantic recall, the vault is human-readable markdown, this is for precise queries. It's also the preferred home for sensitive structured personal data, since it's a local DB file rather than the git-backed (GitHub-hosted) vault.

- **Engine:** SQLite via `@libsql/client`. Single file at `/data/jpos.db` on the Fly volume (no separate service, unlike Qdrant). `DATABASE_URL` overrides; keeps a clean upgrade path to managed/replicated Turso (`libsql://...`) without code changes.
- **Schema source of truth lives in-repo, not in the DB:** Zod schemas in `src/db/schemas/*.ts` (shape/validation) + numbered SQL migrations in `src/db/migrations.ts` (structure). Every write is Zod-validated; reads via `db_query` are guarded to read-only single `SELECT`/`WITH`.
- **Migrations** run on startup (`initDb()` in `src/index.ts`) and idempotently from the MCP server. Tracked in a `_migrations` table.
- **Backups (Litestream):** `scripts/docker-entrypoint.sh` runs the app under Litestream when `LITESTREAM_BUCKET` is set — continuous replication of `jpos.db` to an S3-compatible bucket (Fly Tigris / Cloudflare R2) with point-in-time restore, plus auto-restore on a fresh volume. No-op when unset (local dev). Config in `litestream.yml`. Fly volume daily snapshots are a second safety net.

### Adding a new table

1. Add a Zod schema in `src/db/schemas/<table>.ts`.
2. Append a migration entry to `src/db/migrations.ts` (never edit shipped ones).
3. Add typed write helpers in `src/db/<table>.ts` (validate via the Zod schema).
4. Register a doc entry in `TABLE_DOCS` + a write tool in `src/mcp/db.ts`, and add the tool names to `allowedTools` in `src/agent.ts`.

Reads need no per-table tool — the generic `db_query` covers any table immediately.

### Required env vars

- `DATABASE_URL` (default `file:/data/jpos.db`)
- Litestream (all optional; backups disabled unless `LITESTREAM_BUCKET` is set): `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`, `LITESTREAM_REGION`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`

### Inspecting memory

The HTTP API exposes (Bearer-token auth):
- `GET /memory?source=&category=&limit=` — list recent memories
- `GET /memory/search?q=...&topK=&source=&category=` — semantic search
- `GET /memory/stats` — totals + breakdown by source/category
- `GET /memory/:id` — single memory
- `POST /memory` — manual write (debugging/seeding)
- `DELETE /memory/:id` — forget

### Required env vars

- `OPENAI_API_KEY` (required) — for embeddings and the dedup LLM
- `QDRANT_URL` (default `http://localhost:6333`; on Fly set to `http://jpos-qdrant.internal:6333`)
- `MEMORY_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- `MEMORY_DEDUP_MODEL` (default `gpt-4.1-nano`)

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
- `.claude/skills/memory-prune/SKILL.md` — Review and prune stale memory store entries
- `.claude/skills/project-status/SKILL.md` — Pull project state from all available sources

### Template Variables

`{{date}}`, `{{time}}`, `{{vault_path}}`, `{{week_file}}`, `{{month_file}}`, `{{transcript}}` are replaced at load time in `src/prompt.ts`.

## Obsidian Vault Data (runtime-mutable)

The vault contains data the agent reads and writes at runtime:

- `jpOS/monthly-digest/` — Monthly summaries (`YYYY-MM.md`), last 2 months loaded automatically
- `jpOS/weekly-digest/` — Weekly digests (`YYYY-WXX.md`), last 2 weeks loaded automatically
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

## Google Calendar (`googleapis` + thin MCP)

Google Calendar accessed via the `googleapis` npm package, exposed as an in-repo MCP server at `src/mcp/google.ts`. We tried the official `gws` CLI first; headless auth was unreliable in containers, so we switched to a refresh-token flow.

- **Auth:** One-time OAuth dance via `scripts/google-oauth-bootstrap.ts` mints a long-lived refresh token. OAuth app must be **published (In production)** in Google Cloud Console — Testing-mode refresh tokens expire after 7 days.
- **Env vars (Fly secrets):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. All three required; tools disabled if any is missing.
- **Tools:** `gcal_agenda` (read upcoming events), `gcal_create_event` (schedule).
- **Timezone:** America/New_York hardcoded in `src/mcp/google.ts`.
