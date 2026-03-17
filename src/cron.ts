import cron from "node-cron";
import { runAgent } from "./agent.js";
import { sendTelegramMessage } from "./interfaces/telegram.js";
import { buildSystemContext } from "./instructions.js";
import { pushVaultChanges } from "./obsidian.js";
import { getState, setState } from "./state.js";

const TIMEZONE = "America/New_York";
const CRON_HOUR = 6;
const CRON_MINUTE = 30;
const DAILY_PREP_TIMEOUT_MS = 5 * 60_000; // 5 minutes

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function getCurrentHourMinuteET(): { hour: number; minute: number } {
  const parts = new Date().toLocaleTimeString("en-US", {
    timeZone: TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).split(":");
  return { hour: parseInt(parts[0], 10), minute: parseInt(parts[1], 10) };
}

async function runDailyPrep(): Promise<void> {
  console.log("Running daily prep job...");

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Daily prep timed out after 5 minutes")), DAILY_PREP_TIMEOUT_MS)
    );

    const systemContext = buildSystemContext("daily-prep");
    const response = await Promise.race([
      runAgent({
        prompt: "Generate the daily prep briefing as described in your instructions.",
        externalId: "cron:daily-prep",
        systemContext,
      }),
      timeoutPromise,
    ]);

    await pushVaultChanges();

    if (response.result) {
      const sent = await sendTelegramMessage(response.result);
      if (sent) {
        setState("lastDailyPrepDate", getTodayET());
        console.log("Daily prep sent successfully");
      } else {
        console.error("Daily prep generated but Telegram send FAILED");
      }
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
  // Run at 6:30 AM Eastern time every day
  cron.schedule(`${CRON_MINUTE} ${CRON_HOUR} * * *`, runDailyPrep, {
    timezone: TIMEZONE,
  });

  console.log("Cron jobs started: daily prep at 6:30 AM Eastern");

  // Check if we missed today's daily prep (e.g., process restarted after 6:30 AM)
  const { hour, minute } = getCurrentHourMinuteET();
  const isPastCronTime = hour > CRON_HOUR || (hour === CRON_HOUR && minute > CRON_MINUTE);
  if (isPastCronTime && getState<string>("lastDailyPrepDate") !== getTodayET()) {
    console.log("Missed today's daily prep — running now");
    // Small delay to let the bot finish initializing
    setTimeout(() => {
      runDailyPrep().catch((err) => console.error("Makeup daily prep failed:", err));
    }, 5_000);
  }
}

// Export for manual testing
export { runDailyPrep };
