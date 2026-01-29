import cron from "node-cron";
import { runAgent } from "./agent.js";
import { sendTelegramMessage } from "./interfaces/telegram.js";
import { VAULT_PATH } from "./obsidian.js";

const DAILY_PREP_PROMPT = `You are generating a morning daily prep briefing for Justin.

Do the following:
1. Read the context files from the vault:
   - ${VAULT_PATH}/context/current-focus.md
   - ${VAULT_PATH}/context/goals.md
   - ${VAULT_PATH}/context/active-projects.md
2. List today's Todoist tasks using todoist_list_tasks with filter "today"
3. Check for overdue tasks using todoist_list_tasks with filter "overdue"

Then compose a brief, friendly morning briefing (4-6 sentences max) that includes:
- A quick "good morning" greeting
- Today's priority focus area (from context)
- Key tasks for today (personal from Todoist)
- Any overdue items that need attention
- A brief motivational nudge if appropriate

Keep it concise and actionable. Casual tone.`;

function buildDailyPrepContext(): string {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const time = new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });

  return `CRITICAL: You MUST use tools for every action. NEVER fabricate responses.

Before responding, read these files IN ORDER:
1. /app/agent-context/SOUL.md — your identity and hard rules
2. /app/agent-context/INSTRUCTIONS.md — what to do and how

Today's date: ${today}
Current time: ${time}
Obsidian vault path: ${VAULT_PATH}`;
}

async function runDailyPrep(): Promise<void> {
  console.log("Running daily prep job...");

  try {
    const systemContext = buildDailyPrepContext();

    const response = await runAgent({
      prompt: DAILY_PREP_PROMPT,
      externalId: "cron:daily-prep",
      systemContext,
    });

    if (response.result) {
      await sendTelegramMessage(response.result);
      console.log("Daily prep sent successfully");
    } else {
      console.error("Daily prep returned empty result");
      await sendTelegramMessage(
        "⚠️ Daily prep job ran but returned no content. Check logs."
      );
    }
  } catch (error) {
    console.error("Daily prep job failed:", error);
    await sendTelegramMessage(
      `⚠️ Daily prep failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export function startCronJobs(): void {
  // Run at 4:00 AM Eastern time every day
  // Cron format: minute hour day-of-month month day-of-week
  cron.schedule("0 4 * * *", runDailyPrep, {
    timezone: "America/New_York",
  });

  console.log("Cron jobs started: daily prep at 4:00 AM Eastern");
}

// Export for manual testing
export { runDailyPrep };
