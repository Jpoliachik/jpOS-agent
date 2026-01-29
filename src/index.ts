import { env } from "./config.js";
import { createTelegramBot } from "./interfaces/telegram.js";
import { createApiServer } from "./interfaces/api.js";
import { startCronJobs } from "./cron.js";

async function main() {
  console.log("Starting jpOS Agent...");

  // Start Telegram bot
  const bot = createTelegramBot();
  bot.start({
    onStart: (botInfo) => {
      console.log(`Telegram bot started: @${botInfo.username}`);
    },
  });

  // Start API server
  const server = await createApiServer();
  await server.listen({ port: env.port, host: "0.0.0.0" });
  console.log(`API server listening on port ${env.port}`);

  // Start scheduled jobs
  startCronJobs();

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down...");
    await bot.stop();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
