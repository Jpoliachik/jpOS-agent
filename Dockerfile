FROM node:20-slim

# Install git (needed for Obsidian vault operations)
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/cli/cli/releases/download/v2.67.0/gh_2.67.0_linux_amd64.tar.gz \
    | tar xz -C /tmp && mv /tmp/gh_2.67.0_linux_amd64/bin/gh /usr/local/bin/gh

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
RUN npm run build

# Expose port
EXPOSE 3000

CMD ["npm", "start"]
