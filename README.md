# jpOS Agent

Personal AI agent with Telegram chat and HTTP API interfaces. Hosted on Fly.io.

## Prerequisites

### 1. Create Telegram Bot

1. Message @BotFather on Telegram
2. Send `/newbot` and follow prompts
3. Copy the bot token

### 2. Get Your Telegram User ID

1. Message @userinfobot on Telegram
2. It will reply with your user ID

### 3. Generate API Token

```bash
openssl rand -hex 32
```

## Fly.io Setup

### 1. Install Fly CLI

```bash
# macOS
brew install flyctl

# Or via script
curl -L https://fly.io/install.sh | sh
```

### 2. Login and Create App

```bash
fly auth login
fly apps create jpos-agent
```

### 3. Create Persistent Volume

```bash
fly volumes create jpos_data --region ord --size 1
```

### 4. Set Secrets

```bash
fly secrets set \
  ANTHROPIC_API_KEY="your-key" \
  TELEGRAM_BOT_TOKEN="your-token" \
  ALLOWED_TELEGRAM_USER_ID="your-user-id" \
  API_BEARER_TOKEN="your-api-token" \
  TODOIST_API_TOKEN="your-todoist-token"
```

### 5. GitHub PAT for Obsidian Vault

Create a fine-grained PAT at https://github.com/settings/personal-access-tokens/new:
- Repository access: Select your Obsidian repo
- Permissions: Contents → Read and write

```bash
fly secrets set GITHUB_PAT="github_pat_..."
```

### 6. Deploy

```bash
fly deploy
```

Your app is now live at `https://jpos-agent.fly.dev`

## GitHub Actions Auto-Deploy

### 1. Create Fly API Token

```bash
fly tokens create deploy -x 999999h
```

### 2. Add to GitHub Secrets

Go to GitHub repo → Settings → Secrets → Actions, add:
- `FLY_API_TOKEN` - The token from step 1

Now every push to `main` auto-deploys.

## Fly.io Commands

```bash
fly status              # App status
fly logs                # View logs
fly ssh console         # SSH into container
fly deploy              # Deploy changes
```

## Local Development

```bash
npm install
cp .env.example .env       # Configure your local .env
npm run dev                # Runs with hot reload
```

## API Endpoints

All endpoints (except /health) require Bearer token auth:
```
Authorization: Bearer YOUR_API_TOKEN
```

### POST /agent
General agent interaction.

```json
{
  "prompt": "What tasks do I have today?",
  "clientId": "my-app",
  "context": "Optional system context"
}
```

### POST /voice-note
Process voice transcriptions with Obsidian logging and Telegram notifications.

**Flow:**
1. Pulls Obsidian vault from GitHub
2. Appends transcript to daily note (`voice-notes/YYYY-MM-DD.md`) based on `createdAt`
3. Commits and pushes to GitHub
4. Returns immediately, then async: runs agent and sends Telegram summary

**Note:** Timezone is hardcoded to `America/New_York` in `src/obsidian.ts`.

```json
{
  "id": "uuid-string",
  "createdAt": "2024-01-15T10:30:00Z",
  "duration": 125.5,
  "transcript": "I need to call mom tomorrow and finish the report by Friday"
}
```

**Response:**
```json
{
  "logged": true
}
```

Returns `{"duplicate": true}` if the same `id` was already logged.

### GET /health
Health check (no auth required).

## Telegram Commands

- `/start` - Welcome message
- `/new` - Clear session, start fresh conversation
- `/status` - Check agent status
