FROM node:20-slim

# Install git (needed for Obsidian vault operations) + the gh CLI
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/cli/cli/releases/download/v2.67.0/gh_2.67.0_linux_amd64.tar.gz \
    | tar xz -C /tmp && mv /tmp/gh_2.67.0_linux_amd64/bin/gh /usr/local/bin/gh

# Install Litestream (continuous SQLite backup; no-op unless LITESTREAM_BUCKET is set)
RUN curl -fsSL https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz \
    | tar xz -C /usr/local/bin litestream

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Claude to PATH
ENV PATH="/root/.claude/bin:${PATH}"

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build && chmod +x scripts/docker-entrypoint.sh

# Expose port
EXPOSE 3000

CMD ["sh", "scripts/docker-entrypoint.sh"]
