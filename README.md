# jpOS Agent

Personal AI agent with Telegram chat and HTTP API interfaces. Deployable to Fly.io or Digital Ocean.

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

## Fly.io Setup (Recommended)

Fly.io provides automatic HTTPS and easy deployments.

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

### 5. Set Up SSH Key for Obsidian Vault

Generate a deploy key and add it to your Obsidian GitHub repo:

```bash
# Generate key locally
ssh-keygen -t ed25519 -f ~/.ssh/jpos-obsidian -C "jpos-obsidian" -N ""

# Add public key to GitHub repo as deploy key (with write access)
cat ~/.ssh/jpos-obsidian.pub

# Set private key as Fly secret (base64 encoded)
fly secrets set SSH_PRIVATE_KEY="$(cat ~/.ssh/jpos-obsidian | base64)"
```

### 6. Deploy

```bash
fly deploy
```

Your app is now live at `https://jpos-agent.fly.dev`

### Fly.io Commands

```bash
fly status              # App status
fly logs                # View logs
fly ssh console         # SSH into container
fly deploy              # Deploy changes
```

---

## Digital Ocean Droplet Setup (Alternative)

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
Process voice transcriptions with Obsidian logging and Telegram notifications.

**Flow:**
1. Pulls Obsidian vault from GitHub
2. Appends transcript to daily note (`voice-notes/YYYY-MM-DD.md`)
3. Commits and pushes to GitHub
4. Runs agent to analyze for actionable items
5. Sends Telegram message with summary and suggested actions

```json
{
  "transcript": "I need to call mom tomorrow and finish the report by Friday",
  "timestamp": "10:30 AM"
}
```

**Response:**
```json
{
  "result": "Agent's analysis and suggestions",
  "sessionId": "...",
  "logged": true
}
```

### GET /health
Health check (no auth required).

## Telegram Commands

- `/start` - Welcome message
- `/new` - Clear session, start fresh conversation
- `/status` - Check agent status
