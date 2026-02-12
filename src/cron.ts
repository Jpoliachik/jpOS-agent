import cron from "node-cron";
import { runAgent } from "./agent.js";
import { sendTelegramMessage } from "./interfaces/telegram.js";
import { buildSystemContext } from "./instructions.js";
import { withVaultSync } from "./obsidian.js";

async function runDailyPrep(): Promise<void> {
  console.log("Running daily prep job...");

  try {
    const response = await withVaultSync(async () => {
      const systemContext = buildSystemContext("daily-prep");
      return runAgent({
        prompt: "Generate the daily prep briefing as described in your instructions.",
        externalId: "cron:daily-prep",
        systemContext,
      });
    });

    if (response.result) {
      await sendTelegramMessage(response.result);
      console.log("Daily prep sent successfully");
    } else {
      console.error("Daily prep returned empty result");
      await sendTelegramMessage(
        "Daily prep job ran but returned no content. Check logs."
      );
    }
  } catch (error) {
    console.error("Daily prep job failed:", error);
    await sendTelegramMessage(
      `Daily prep failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export function startCronJobs(): void {
  // Run at 4:00 AM Eastern time every day
  cron.schedule("0 4 * * *", runDailyPrep, {
    timezone: "America/New_York",
  });

  console.log("Cron jobs started: daily prep at 4:00 AM Eastern");
}

// Export for manual testing
export { runDailyPrep };
