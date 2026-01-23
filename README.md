# jpOS Agent

Personal AI agent running on Digital Ocean with Telegram chat and HTTP API interfaces.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Telegram Bot

1. Message @BotFather on Telegram
2. Send `/newbot` and follow prompts
3. Copy the bot token

### 3. Get Your Telegram User ID

1. Message @userinfobot on Telegram
2. It will reply with your user ID

### 4. Generate API Token

```bash
openssl rand -hex 32
```

### 5. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 6. Install Claude Code CLI (on droplet)

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

## Running

### Development

```bash
npm run dev
```

### Production (with PM2)

```bash
npm run build
pm2 start dist/index.js --name jpos-agent
pm2 save
pm2 startup  # Follow instructions to enable auto-start
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
Process voice journal transcripts.

```json
{
  "transcript": "I need to call mom tomorrow and finish the report by Friday",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### GET /health
Health check (no auth required).

## Telegram Commands

- `/start` - Welcome message
- `/new` - Clear session, start fresh conversation
- `/status` - Check agent status
