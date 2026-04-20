import cron from "node-cron";
import { runAgent } from "./agent.js";
import { sendTelegramMessage } from "./interfaces/telegram.js";
import { buildSystemContext } from "./prompt.js";
import { requestSync } from "./vault-sync.js";
import { getState, setState } from "./state.js";

const TIMEZONE = "America/New_York";
const CRON_HOUR = 6;
const CRON_MINUTE = 30;
const EOD_CRON_HOUR = 21;
const EOD_CRON_MINUTE = 0;
const WEEKLY_REVIEW_HOUR = 20;
const WEEKLY_REVIEW_MINUTE = 0;
const DAILY_PREP_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const EOD_CHECKIN_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const WEEKLY_REVIEW_TIMEOUT_MS = 10 * 60_000; // 10 minutes (reads 7 daily logs)
const MONTHLY_REVIEW_HOUR = 20;
const MONTHLY_REVIEW_MINUTE = 0;
const MONTHLY_REVIEW_TIMEOUT_MS = 10 * 60_000; // 10 minutes

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

    requestSync();

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

    requestSync();

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

function getWeekKeyET(): string {
  const d = new Date();
  const et = new Date(d.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const jan1 = new Date(et.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((et.getTime() - jan1.getTime()) / 86_400_000) + 1;
  const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
  return `${et.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

async function runWeeklyReview(): Promise<void> {
  console.log("Running weekly review job...");

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Weekly review timed out after 10 minutes")), WEEKLY_REVIEW_TIMEOUT_MS)
    );

    const systemContext = buildSystemContext();
    const response = await Promise.race([
      runAgent({
        prompt: "Run the weekly-review skill: synthesize the past 7 daily logs into a weekly digest and promote anything durable to memory.md.",
        externalId: "cron:weekly-review",
        systemContext,
      }),
      timeoutPromise,
    ]);

    requestSync();

    if (response.result) {
      setState("lastWeeklyReviewWeek", getWeekKeyET());
      console.log("Weekly review completed successfully");
    } else {
      console.error("Weekly review returned empty result");
    }
  } catch (error) {
    console.error("Weekly review job failed:", error);
    await sendTelegramMessage(
      `jpOS: Weekly review failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

function getMonthKeyET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE }).slice(0, 7);
}

async function runMonthlyReview(): Promise<void> {
  console.log("Running monthly review job...");

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Monthly review timed out after 10 minutes")), MONTHLY_REVIEW_TIMEOUT_MS)
    );

    const systemContext = buildSystemContext();
    const response = await Promise.race([
      runAgent({
        prompt: "Run the month-in-review skill: compress the past month's weekly digests into a monthly summary and promote anything durable to memory.md.",
        externalId: "cron:monthly-review",
        systemContext,
      }),
      timeoutPromise,
    ]);

    requestSync();

    if (response.result) {
      setState("lastMonthlyReviewMonth", getMonthKeyET());
      console.log("Monthly review completed successfully");
    } else {
      console.error("Monthly review returned empty result");
    }
  } catch (error) {
    console.error("Monthly review job failed:", error);
    await sendTelegramMessage(
      `jpOS: Monthly review failed: ${error instanceof Error ? error.message : "Unknown error"}`
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

  // Run at 8:00 PM Eastern time every Sunday
  cron.schedule(`${WEEKLY_REVIEW_MINUTE} ${WEEKLY_REVIEW_HOUR} * * 0`, runWeeklyReview, {
    timezone: TIMEZONE,
  });

  // Run at 8:00 PM Eastern time on the 1st of each month
  cron.schedule(`${MONTHLY_REVIEW_MINUTE} ${MONTHLY_REVIEW_HOUR} 1 * *`, runMonthlyReview, {
    timezone: TIMEZONE,
  });

  console.log("Cron jobs started: daily prep 6:30 AM, EOD check-in 9:00 PM, weekly review Sun 8:00 PM, monthly review 1st 8:00 PM (all Eastern)");

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

  // Check if we missed this week's weekly review (Sunday only)
  const dayOfWeek = new Date().toLocaleDateString("en-US", { timeZone: TIMEZONE, weekday: "short" });
  const isPastWeeklyReview = dayOfWeek === "Sun" && (hour > WEEKLY_REVIEW_HOUR || (hour === WEEKLY_REVIEW_HOUR && minute > WEEKLY_REVIEW_MINUTE));
  if (isPastWeeklyReview && getState<string>("lastWeeklyReviewWeek") !== getWeekKeyET()) {
    console.log("Missed this week's weekly review — running now");
    setTimeout(() => {
      runWeeklyReview().catch((err) => console.error("Makeup weekly review failed:", err));
    }, 15_000);
  }
  // Check if we missed this month's monthly review (1st only)
  const dayOfMonth = new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE })).getDate();
  const isPastMonthlyReview = dayOfMonth === 1 && (hour > MONTHLY_REVIEW_HOUR || (hour === MONTHLY_REVIEW_HOUR && minute > MONTHLY_REVIEW_MINUTE));
  if (isPastMonthlyReview && getState<string>("lastMonthlyReviewMonth") !== getMonthKeyET()) {
    console.log("Missed this month's monthly review — running now");
    setTimeout(() => {
      runMonthlyReview().catch((err) => console.error("Makeup monthly review failed:", err));
    }, 20_000);
  }
}

// Export for manual testing
export { runDailyPrep, runEodCheckin, runWeeklyReview, runMonthlyReview };
