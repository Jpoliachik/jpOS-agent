import { config } from "dotenv";
import { writeFileSync, mkdirSync } from "fs";

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

// Google Workspace CLI: generate credentials file from Fly secrets on startup.
// This makes auth robust across restarts — Fly secrets are the source of truth,
// and the credentials file is regenerated every time the app boots.
const gwsRefreshToken = process.env.GOOGLE_WORKSPACE_CLI_REFRESH_TOKEN;
const gwsClientId = process.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID;
const gwsClientSecret = process.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET;

if (gwsRefreshToken && gwsClientId && gwsClientSecret) {
  const credentialsPath = "/data/gws-credentials.json";
  try {
    mkdirSync("/data", { recursive: true });
    writeFileSync(credentialsPath, JSON.stringify({
      client_id: gwsClientId,
      client_secret: gwsClientSecret,
      refresh_token: gwsRefreshToken,
      token_type: "authorized_user",
    }));
    process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = credentialsPath;
    console.log("Google Workspace CLI credentials file generated from secrets");
  } catch (err) {
    console.warn("Failed to write GWS credentials file:", err);
  }
}

// Use file-based keyring backend since OS keyring is unavailable in containers.
if (process.env.GOOGLE_WORKSPACE_CLI_TOKEN || process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE) {
  process.env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND = process.env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND || "file";
}

export const env = {
  anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
  telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
  allowedTelegramUserId: parseInt(requireEnv("ALLOWED_TELEGRAM_USER_ID"), 10),
  apiBearerToken: requireEnv("API_BEARER_TOKEN"),
  todoistApiToken: requireEnv("TODOIST_API_TOKEN"),
  linearApiKeys: requireEnv("LINEAR_API_KEYS"),
  groqApiKey: requireEnv("GROQ_API_KEY"),
  port: parseInt(process.env.PORT || "3000", 10),
  // App Store Connect (optional - tools disabled if not set)
  appStoreConnectKeyId: process.env.APP_STORE_CONNECT_KEY_ID || "",
  appStoreConnectIssuerId: process.env.APP_STORE_CONNECT_ISSUER_ID || "",
  appStoreConnectP8Key: process.env.APP_STORE_CONNECT_P8_KEY || "",
  appStoreConnectVendorNumber: process.env.APP_STORE_CONNECT_VENDOR_NUMBER || "",
  // Google Workspace CLI (optional - gws calendar/gmail/drive commands available when set)
  googleWorkspaceToken: process.env.GOOGLE_WORKSPACE_CLI_TOKEN || "",
  googleWorkspaceCredentialsFile: process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE || "",
  googleWorkspaceClientId: process.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID || "",
  googleWorkspaceClientSecret: process.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET || "",
  googleWorkspaceRefreshToken: process.env.GOOGLE_WORKSPACE_CLI_REFRESH_TOKEN || "",
};
