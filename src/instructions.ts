/**
 * Instruction loader — reads system prompts and skills from the Obsidian vault.
 *
 * Vault layout:
 *   system/soul.md            — agent identity & hard rules
 *   system/instructions.md    — general action guidelines
 *   system/skills/<name>.md   — per-skill prompts (voice-note, daily-prep, message)
 *   context/*.md              — user context files (goals, focus, projects, etc.)
 *
 * Template variables in .md files are replaced at load time:
 *   {{date}}        — today's date (YYYY-MM-DD, America/New_York)
 *   {{time}}        — current time (e.g. "4:00 AM")
 *   {{vault_path}}  — absolute vault path
 *   {{transcript}}  — voice note transcript (only for voice-note skill)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VAULT_PATH } from "./obsidian.js";

const TIMEZONE = "America/New_York";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
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

/** Read system/soul.md from the vault. */
export function loadSoul(): string {
  const path = join(VAULT_PATH, "system", "soul.md");
  return readFileSafe(path) ?? "";
}

/** Read system/instructions.md from the vault. */
export function loadInstructions(): string {
  const path = join(VAULT_PATH, "system", "instructions.md");
  return readFileSafe(path) ?? "";
}

/** Read a named skill from system/skills/<name>.md. */
export function loadSkill(name: string): string {
  const path = join(VAULT_PATH, "system", "skills", `${name}.md`);
  return readFileSafe(path) ?? "";
}

/** Read all context/*.md files and return them concatenated. */
export function loadContext(): string {
  const dir = join(VAULT_PATH, "context");
  if (!existsSync(dir)) return "";

  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) return "";

  const sections: string[] = [];
  for (const file of files) {
    const content = readFileSafe(join(dir, file));
    if (content) {
      sections.push(`### ${file}\n${content}`);
    }
  }
  return sections.join("\n\n");
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
 * Assembles: soul + instructions + context files + skill prompt,
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
  const context = loadContext();
  const skill = applyVars(loadSkill(skillName), templateVars);

  const parts: string[] = [
    "CRITICAL: You MUST use tools for every action. NEVER fabricate responses.",
    "",
  ];

  if (soul) {
    parts.push(soul, "");
  }

  if (instructions) {
    parts.push(instructions, "");
  }

  if (context) {
    parts.push("# Current Context", "", context, "");
  }

  if (skill) {
    parts.push("# Skill: " + skillName, "", skill, "");
  }

  parts.push(
    `Today's date: ${templateVars.date}`,
    `Current time: ${templateVars.time}`,
    `Obsidian vault path: ${templateVars.vault_path}`,
  );

  return parts.join("\n");
}
