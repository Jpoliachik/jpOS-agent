/**
 * One-time helper: list all Google Calendars on Justin's account and print a
 * markdown table ready to paste into system/instructions.md.
 *
 * Run:
 *
 *   npx tsx scripts/google-list-calendars.ts
 *
 * Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN from
 * .env.local (then .env). Calendar IDs are stable, so this is a setup utility,
 * not something the agent calls at runtime.
 */
import { config as loadEnv } from "dotenv";
import { google } from "googleapis";

loadEnv({ path: ".env.local" });
loadEnv();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN in .env.local");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
const calendar = google.calendar({ version: "v3", auth: oauth2 });

function escapePipes(s: string | null | undefined): string {
  return (s || "").replace(/\|/g, "\\|");
}

function deriveAlias(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "calendar";
}

async function main() {
  const res = await calendar.calendarList.list({ maxResults: 250 });
  const items = res.data.items || [];

  if (items.length === 0) {
    console.log("No calendars found.");
    return;
  }

  // Sort: primary first, then owners, then readers/subscribers
  items.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    const roleRank: Record<string, number> = { owner: 0, writer: 1, reader: 2, freeBusyReader: 3 };
    return (roleRank[a.accessRole || ""] || 9) - (roleRank[b.accessRole || ""] || 9);
  });

  console.log("\n=== Calendar inventory ===\n");
  console.log("Paste the relevant rows into system/instructions.md under '### Calendars'.");
  console.log("Tweak the alias and Purpose columns to match how you actually use each calendar.\n");

  console.log("| Alias | Purpose | Access | ID |");
  console.log("|-------|---------|--------|----|");
  for (const c of items) {
    const name = c.summaryOverride || c.summary || "(unnamed)";
    const alias = c.primary ? "primary" : deriveAlias(name);
    const id = c.primary ? "primary" : c.id || "";
    const access = c.accessRole || "";
    const purpose = escapePipes(name);
    console.log(`| ${alias} | ${purpose} | ${access} | \`${id}\` |`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
