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

// Google Workspace CLI: generate client_secret.json from Fly secrets on startup.
// gws uses this file + an encrypted credentials store (credentials.enc) for auth.
// The client_secret.json is regenerated every boot from env vars; credentials.enc
// lives on the persistent /data volume after a one-time `gws auth login`.
const gwsClientId = process.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID;
const gwsClientSecret = process.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET;

if (gwsClientId && gwsClientSecret) {
  const gwsConfigDir = "/data/gws-config";
  const clientSecretPath = `${gwsConfigDir}/client_secret.json`;
  try {
    mkdirSync(gwsConfigDir, { recursive: true });
    writeFileSync(clientSecretPath, JSON.stringify({
      installed: {
        client_id: gwsClientId,
        client_secret: gwsClientSecret,
        project_id: "jp-personalprojects",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        redirect_uris: ["http://localhost"],
      },
    }, null, 2));
    // Point gws at our config directory
    process.env.GWS_CONFIG_DIR = gwsConfigDir;
    console.log("Google Workspace CLI client_secret.json generated from secrets");
  } catch (err) {
    console.warn("Failed to write GWS client secret file:", err);
  }
}

// Use file-based keyring backend since OS keyring is unavailable in containers.
process.env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND = process.env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND || "file";

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
  googleWorkspaceClientId: process.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID || "",
  googleWorkspaceClientSecret: process.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET || "",
};
