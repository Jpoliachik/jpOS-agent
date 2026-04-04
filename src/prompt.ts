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
 *   jpOS/memory.md             — durable memory
 *   jpOS/daily-log/YYYY-MM-DD.md — daily log entries (recent days loaded automatically)
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
import { loadDurableMemory, loadRecentMemory } from "./memory.js";

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
  skillName: SkillName,
  vars?: PromptVars,
): string {
  const templateVars: Record<string, string> = {
    date: todayString(),
    time: timeString(),
    vault_path: VAULT_PATH,
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

  const durableMemory = loadDurableMemory();
  const recentMemory = loadRecentMemory();
  const skill = applyVars(loadSkill(skillName), templateVars);

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

  if (durableMemory) {
    parts.push("# Memory", "", durableMemory, "");
  }

  if (recentMemory) {
    parts.push("# Daily Log", "", recentMemory, "");
  }

  // Tell the agent where memory files live so it can look up older days on demand
  parts.push(
    `> **Daily log files** are stored at \`${join(VAULT_PATH, JPOS_DIR, "daily-log")}/YYYY-MM-DD.md\`. ` +
    "Only the last 3 days are loaded above. To recall older days, use Glob/Read to browse and read files in that directory.",
    "",
  );

  // Soft behavioral nudge — gratitude awareness across all interactions
  parts.push(
    "> **Gratitude awareness:** Look for natural moments to invite a quick gratitude " +
    "reflection — after wrapping up a topic, during check-ins, or when Justin is " +
    "processing his day. It doesn't need its own section; a simple \"what went well?\" " +
    "or noticing something positive from his recent logs is enough. " +
    "Don't shoehorn it in — skip it entirely if the moment isn't right.",
    "",
  );

  if (skill) {
    parts.push(`# Skill: ${skillName}`, "", skill, "");
  }

  return parts.join("\n");
}
