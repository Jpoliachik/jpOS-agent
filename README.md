# jpOS Agent

Personal AI agent running on Digital Ocean with Telegram chat and HTTP API interfaces.

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

## Digital Ocean Droplet Setup

Run these commands on a fresh Ubuntu droplet:

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2 (process manager)
npm install -g pm2

# Install Claude Code CLI (required runtime for Agent SDK)
curl -fsSL https://claude.ai/install.sh | bash

# Clone the repo
git clone git@github.com:Jpoliachik/jpOS-agent.git ~/jpOS
cd ~/jpOS

# Configure environment
cp .env.example .env
nano .env  # Add your secrets

# Install dependencies and build
npm install
npm run build

# Start with PM2
pm2 start dist/index.js --name jpos-agent
pm2 save
pm2 startup  # Follow the printed instructions to enable auto-start on reboot
```

## GitHub Actions Auto-Deploy

### 1. Create a deploy SSH key (on your local machine)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/jpos-deploy -C "jpos-deploy"
```

### 2. Add public key to droplet

```bash
ssh root@YOUR_DROPLET_IP "echo '$(cat ~/.ssh/jpos-deploy.pub)' >> ~/.ssh/authorized_keys"
```

### 3. Add GitHub Secrets

Go to GitHub repo → Settings → Secrets → Actions, add:

- `DROPLET_HOST` - Your droplet's IP address
- `DROPLET_USER` - `root` (or your username)
- `DROPLET_SSH_KEY` - Contents of `~/.ssh/jpos-deploy` (include BEGIN/END lines)

Now every push to `main` auto-deploys.

## PM2 Commands

```bash
pm2 status                 # See running apps
pm2 logs jpos-agent        # View logs
pm2 restart jpos-agent     # Restart app
pm2 stop jpos-agent        # Stop app
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
