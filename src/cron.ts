import cron from "node-cron";
import { runAgent } from "./agent.js";
import { sendTelegramMessage } from "./interfaces/telegram.js";
import { buildSystemContext } from "./prompt.js";
import { pushVaultChanges } from "./obsidian.js";
import { getState, setState } from "./state.js";

const TIMEZONE = "America/New_York";
const CRON_HOUR = 6;
const CRON_MINUTE = 30;
const EOD_CRON_HOUR = 21;
const EOD_CRON_MINUTE = 0;
const DAILY_PREP_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const EOD_CHECKIN_TIMEOUT_MS = 5 * 60_000; // 5 minutes

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
      const text = response.messages.length > 0
        ? response.messages.join("\n\n")
        : response.result;
      const sent = await sendTelegramMessage(text);
      if (sent) {
        setState("lastDailyPrepDate", getTodayET());
        console.log("Daily prep sent successfully");
      } else {
        console.error("Daily prep generated but Telegram send FAILED");
      }
    } else {
      console.error("Daily prep returned empty result");
      await sendTelegramMessage(
        "jpOS: Daily prep job ran but returned no content. Check logs."
      );
    }
  } catch (error) {
    console.error("Daily prep job failed:", error);
    await sendTelegramMessage(
      `jpOS: Daily prep failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

async function runEodCheckin(): Promise<void> {
  console.log("Running EOD check-in job...");

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("EOD check-in timed out after 5 minutes")), EOD_CHECKIN_TIMEOUT_MS)
    );

    const systemContext = buildSystemContext("eod-checkin");
    const response = await Promise.race([
      runAgent({
        prompt: "Send the end-of-day check-in as described in your instructions.",
        externalId: "cron:eod-checkin",
        systemContext,
      }),
      timeoutPromise,
    ]);

    await pushVaultChanges();

    if (response.result) {
      const text = response.messages.length > 0
        ? response.messages.join("\n\n")
        : response.result;
      const sent = await sendTelegramMessage(text);
      if (sent) {
        setState("lastEodCheckinDate", getTodayET());
        console.log("EOD check-in sent successfully");
      } else {
        console.error("EOD check-in generated but Telegram send FAILED");
      }
    } else {
      console.error("EOD check-in returned empty result");
      await sendTelegramMessage(
        "jpOS: EOD check-in job ran but returned no content. Check logs."
      );
    }
  } catch (error) {
    console.error("EOD check-in job failed:", error);
    await sendTelegramMessage(
      `jpOS: EOD check-in failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export function startCronJobs(): void {
  // Run at 6:30 AM Eastern time every day
  cron.schedule(`${CRON_MINUTE} ${CRON_HOUR} * * *`, runDailyPrep, {
    timezone: TIMEZONE,
  });

  // Run at 9:00 PM Eastern time every day
  cron.schedule(`${EOD_CRON_MINUTE} ${EOD_CRON_HOUR} * * *`, runEodCheckin, {
    timezone: TIMEZONE,
  });

  console.log("Cron jobs started: daily prep at 6:30 AM Eastern, EOD check-in at 9:00 PM Eastern");

  // Check if we missed today's jobs (e.g., process restarted)
  const { hour, minute } = getCurrentHourMinuteET();

  const isPastDailyPrep = hour > CRON_HOUR || (hour === CRON_HOUR && minute > CRON_MINUTE);
  if (isPastDailyPrep && getState<string>("lastDailyPrepDate") !== getTodayET()) {
    console.log("Missed today's daily prep — running now");
    setTimeout(() => {
      runDailyPrep().catch((err) => console.error("Makeup daily prep failed:", err));
    }, 5_000);
  }

  const isPastEodCheckin = hour > EOD_CRON_HOUR || (hour === EOD_CRON_HOUR && minute > EOD_CRON_MINUTE);
  if (isPastEodCheckin && getState<string>("lastEodCheckinDate") !== getTodayET()) {
    console.log("Missed today's EOD check-in — running now");
    setTimeout(() => {
      runEodCheckin().catch((err) => console.error("Makeup EOD check-in failed:", err));
    }, 10_000);
  }
}

// Export for manual testing
export { runDailyPrep, runEodCheckin };
