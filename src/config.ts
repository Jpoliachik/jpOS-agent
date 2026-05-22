import { config } from "dotenv";

config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Expose GITHUB_PAT as GITHUB_TOKEN for gh CLI (inherited by child processes)
if (process.env.GITHUB_PAT) {
  process.env.GITHUB_TOKEN = process.env.GITHUB_PAT;
}

export const env = {
  anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
  telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
  allowedTelegramUserId: parseInt(requireEnv("ALLOWED_TELEGRAM_USER_ID"), 10),
  apiBearerToken: requireEnv("API_BEARER_TOKEN"),
  todoistApiToken: requireEnv("TODOIST_API_TOKEN"),
  linearApiKeys: requireEnv("LINEAR_API_KEYS"),
  groqApiKey: requireEnv("GROQ_API_KEY"),
  rambleWebhookSecret: process.env.RAMBLE_WEBHOOK_SECRET || "",
  port: parseInt(process.env.PORT || "3000", 10),
  // Memory layer (Qdrant vector store + OpenAI embeddings + dedup LLM)
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
  memoryEmbeddingModel: process.env.MEMORY_EMBEDDING_MODEL || "text-embedding-3-small",
  memoryDedupModel: process.env.MEMORY_DEDUP_MODEL || "gpt-4.1-nano",
  // App Store Connect (optional - tools disabled if not set)
  appStoreConnectKeyId: process.env.APP_STORE_CONNECT_KEY_ID || "",
  appStoreConnectIssuerId: process.env.APP_STORE_CONNECT_ISSUER_ID || "",
  appStoreConnectP8Key: process.env.APP_STORE_CONNECT_P8_KEY || "",
  appStoreConnectVendorNumber: process.env.APP_STORE_CONNECT_VENDOR_NUMBER || "",
  // Google OAuth (optional — Calendar MCP tools enabled when all three are set)
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || "",
  // Pages layer (read-only HTML pages the agent publishes)
  pageSigningSecret: process.env.PAGE_SIGNING_SECRET || "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "https://jpos-agent.fly.dev",
};
