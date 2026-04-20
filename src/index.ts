import { env } from "./config.js";
import { createTelegramBot, sendTelegramMessage } from "./interfaces/telegram.js";
import { createApiServer } from "./interfaces/api.js";
import { startCronJobs } from "./cron.js";
import { ensureVaultCloned } from "./obsidian.js";
import { startVaultSync, stopVaultSync } from "./vault-sync.js";

async function main() {
  console.log("Starting jpOS Agent...");

  // Clone/init vault before accepting any requests
  await ensureVaultCloned();

  // Start Telegram bot
  const bot = createTelegramBot();
  bot.start({
    onStart: (botInfo) => {
      console.log(`Telegram bot started: @${botInfo.username}`);
    },
  }).catch((error) => {
    console.error("Telegram bot polling error:", error);
    // Exit so Fly.io restarts us cleanly instead of running without a bot
    process.exit(1);
  });

  // Start API server
  const server = await createApiServer();
  await server.listen({ port: env.port, host: "0.0.0.0" });
  console.log(`API server listening on port ${env.port}`);

  // Start scheduled jobs
  startCronJobs();

  // Start vault sync worker (debounced push + periodic pull, off the hot path)
  startVaultSync({ notifier: sendTelegramMessage });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down...");
    await bot.stop();
    await server.close();
    await stopVaultSync();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
