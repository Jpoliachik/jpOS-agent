/**
 * Instruction loader — reads system prompts and skills from the repo,
 * and memory/daily-log from the Obsidian vault.
 *
 * Repo layout (system/ at repo root):
 *   system/soul.md            — agent identity & hard rules
 *   system/instructions.md    — general action guidelines
 *   system/skills/<name>.md   — per-skill prompts (voice-note, daily-prep, message, eod-checkin)
 *
 * Vault layout (runtime-mutable, under jpOS/ in the vault):
 *   jpOS/daily-log/YYYY-MM-DD.md — daily log entries (recent days loaded automatically)
 *   jpOS/weekly-digest/YYYY-WXX.md — weekly digests (last 4 loaded)
 *   jpOS/monthly-digest/YYYY-MM.md — monthly summaries (last 3 loaded)
 *
 * Durable atomic memory lives in the Qdrant store (see src/memory-store.ts) and
 * is injected per-message via auto-recall in agent.ts, not loaded here.
 *
 * Template variables in .md files are replaced at load time:
 *   {{date}}        — today's date (YYYY-MM-DD, America/New_York)
 *   {{time}}        — current time (e.g. "4:00 AM")
 *   {{vault_path}}  — absolute vault path
 *   {{transcript}}  — voice note transcript (only for voice-note skill)
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VAULT_PATH, JPOS_DIR } from "./obsidian.js";
import { loadRecentMemory, loadWeeklyDigests, loadMonthlyDigests } from "./memory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to system/ directory at repo root (contains soul.md, instructions.md, skills/) */
const SYSTEM_DIR = join(__dirname, "..", "system");

const TIMEZONE = "America/New_York";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayString(): string {
  const d = new Date();
  const date = d.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  const day = d.toLocaleDateString("en-US", { timeZone: TIMEZONE, weekday: "long" });
  return `${date} (${day})`;
}

function timeString(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Return the ISO week filename for the current week: YYYY-WXX.md
 */
function weekFileString(): string {
  const d = new Date();
  // Shift to ET for consistency with the rest of the system
  const et = new Date(d.toLocaleString("en-US", { timeZone: TIMEZONE }));
  const jan1 = new Date(et.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((et.getTime() - jan1.getTime()) / 86_400_000) + 1;
  const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
  return `${et.getFullYear()}-W${String(weekNum).padStart(2, "0")}.md`;
}

/**
 * Return the month filename for the current month: YYYY-MM.md
 */
function monthFileString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE }).slice(0, 7) + ".md";
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Replace `{{key}}` placeholders in text with values from the vars map.
 */
function applyVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
}

// ---------------------------------------------------------------------------
// Core loaders
// ---------------------------------------------------------------------------

// Cache static system files at module load — they don't change at runtime
const SOUL_CONTENT = readFileSafe(join(SYSTEM_DIR, "soul.md")) ?? "";
const INSTRUCTIONS_CONTENT = readFileSafe(join(SYSTEM_DIR, "instructions.md")) ?? "";

/** Read a named skill from system/skills/<name>.md in the repo. */
export function loadSkill(name: string): string {
  const path = join(SYSTEM_DIR, "skills", `${name}.md`);
  return readFileSafe(path) ?? "";
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export type SkillName = "voice-note" | "daily-prep" | "eod-checkin" | "message";

interface PromptVars {
  transcript?: string;
  [key: string]: string | undefined;
}

/**
 * Build the full system context for a given skill.
 *
 * Assembles: soul + instructions + recent memory + skill prompt,
 * with all template variables resolved.
 */
export function buildSystemContext(
  skillName?: SkillName,
  vars?: PromptVars,
): string {
  const templateVars: Record<string, string> = {
    date: todayString(),
    time: timeString(),
    vault_path: VAULT_PATH,
    week_file: weekFileString(),
    month_file: monthFileString(),
    ...Object.fromEntries(
      Object.entries(vars ?? {}).filter(([, v]) => v != null) as [string, string][],
    ),
  };

  const soul = applyVars(SOUL_CONTENT, templateVars);
  const instructions = applyVars(INSTRUCTIONS_CONTENT, templateVars);

  if (!soul && !instructions) {
    throw new Error(
      "Missing system files: soul.md and instructions.md not found. " +
      `Ensure system/soul.md and system/instructions.md exist in the repo (looked in ${SYSTEM_DIR}).`
    );
  }

  const monthlyDigests = loadMonthlyDigests();
  const weeklyDigests = loadWeeklyDigests();
  const recentMemory = loadRecentMemory();
  const skill = skillName ? applyVars(loadSkill(skillName), templateVars) : "";

  const parts: string[] = [
    `**Current date:** ${templateVars.date}`,
    `**Current time:** ${templateVars.time} (America/New_York)`,
    "",
  ];

  if (soul) {
    parts.push(soul, "");
  }

  if (instructions) {
    parts.push(instructions, "");
  }

  if (monthlyDigests) {
    parts.push("# Monthly Summaries", "", monthlyDigests, "");
  }

  if (weeklyDigests) {
    parts.push("# Weekly Digests", "", weeklyDigests, "");
  }

  if (recentMemory) {
    parts.push("# Daily Log", "", recentMemory, "");
  }

  // Tell the agent where memory files live so it can look up older ones on demand
  parts.push(
    `> **Daily log files** are stored at \`${join(VAULT_PATH, JPOS_DIR, "daily-log")}/YYYY-MM-DD.md\`. ` +
    "Only the last 3 days are loaded above. To recall older days, use Glob/Read to browse and read files in that directory.",
    "",
    `> **Weekly digests** are stored at \`${join(VAULT_PATH, JPOS_DIR, "weekly-digest")}/YYYY-WXX.md\`. ` +
    "Only the last 4 weeks are loaded above. To recall older weeks, use Glob/Read to browse that directory.",
    "",
    `> **Monthly summaries** are stored at \`${join(VAULT_PATH, JPOS_DIR, "monthly-digest")}/YYYY-MM.md\`. ` +
    "Only the last 3 months are loaded above. To recall older months, use Glob/Read to browse that directory.",
    "",
  );

  if (skill && skillName) {
    parts.push(`# Skill: ${skillName}`, "", skill, "");
  }

  return parts.join("\n");
}
