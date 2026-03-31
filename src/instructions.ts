/**
 * Instruction loader — reads system prompts and skills from the Obsidian vault.
 *
 * Vault layout (all under jpOS/ in the vault):
 *   jpOS/system/soul.md            — agent identity & hard rules
 *   jpOS/system/instructions.md    — general action guidelines
 *   jpOS/system/skills/<name>.md   — per-skill prompts (voice-note, daily-prep, message)
 *   jpOS/daily-log/YYYY-MM-DD.md   — daily log entries (recent days loaded automatically)
 *
 * Template variables in .md files are replaced at load time:
 *   {{date}}        — today's date (YYYY-MM-DD, America/New_York)
 *   {{time}}        — current time (e.g. "4:00 AM")
 *   {{vault_path}}  — absolute vault path
 *   {{transcript}}  — voice note transcript (only for voice-note skill)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT_PATH, JPOS_DIR } from "./obsidian.js";
import { loadDurableMemory, loadRecentMemory } from "./memory.js";

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

/** Read jpOS/system/soul.md from the vault. */
export function loadSoul(): string {
  const path = join(VAULT_PATH, JPOS_DIR, "system", "soul.md");
  return readFileSafe(path) ?? "";
}

/** Read jpOS/system/instructions.md from the vault. */
export function loadInstructions(): string {
  const path = join(VAULT_PATH, JPOS_DIR, "system", "instructions.md");
  return readFileSafe(path) ?? "";
}

/** Read a named skill from jpOS/system/skills/<name>.md. */
export function loadSkill(name: string): string {
  const path = join(VAULT_PATH, JPOS_DIR, "system", "skills", `${name}.md`);
  return readFileSafe(path) ?? "";
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

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
  skillName: string,
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

  const soul = applyVars(loadSoul(), templateVars);
  const instructions = applyVars(loadInstructions(), templateVars);

  if (!soul && !instructions) {
    throw new Error(
      "Missing system files: soul.md and instructions.md not found in vault. " +
      "Ensure jpOS/system/soul.md and jpOS/system/instructions.md exist in the Obsidian vault."
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

  if (skill) {
    parts.push("# Skill: " + skillName, "", skill, "");
  }

  return parts.join("\n");
}
