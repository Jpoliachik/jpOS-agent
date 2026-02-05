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
  groqApiKey: requireEnv("GROQ_API_KEY"),
  port: parseInt(process.env.PORT || "3000", 10),
};
