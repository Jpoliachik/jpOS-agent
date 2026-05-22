/**
 * Vault digest loaders — reads daily logs, weekly digests, and monthly
 * summaries from the Obsidian vault for inclusion in the system prompt.
 *
 * Atomic durable memory lives in Qdrant (see src/memory-store.ts), not here.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT_PATH, JPOS_DIR } from "./obsidian.js";

const DAILY_LOG_DIR = join(JPOS_DIR, "daily-log");
const WEEKLY_DIGEST_DIR = join(JPOS_DIR, "weekly-digest");
const MONTHLY_DIGEST_DIR = join(JPOS_DIR, "monthly-digest");

/**
 * Load the most recent weekly digest files, concatenated newest-first.
 * Files are named YYYY-WXX.md (ISO week number).
 */
export function loadWeeklyDigests(weeks: number = 4): string {
  const dir = join(VAULT_PATH, WEEKLY_DIGEST_DIR);
  if (!existsSync(dir)) return "";

  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-W\d{2}\.md$/.test(f))
    .sort()
    .reverse()
    .slice(0, weeks);

  if (files.length === 0) return "";

  const sections: string[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8").trim();
      if (content) {
        sections.push(content);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return sections.join("\n\n---\n\n");
}

/**
 * Load the most recent monthly digest files, concatenated newest-first.
 * Files are named YYYY-MM.md.
 */
export function loadMonthlyDigests(months: number = 3): string {
  const dir = join(VAULT_PATH, MONTHLY_DIGEST_DIR);
  if (!existsSync(dir)) return "";

  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()
    .slice(0, months);

  if (files.length === 0) return "";

  const sections: string[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8").trim();
      if (content) {
        sections.push(content);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return sections.join("\n\n---\n\n");
}

/**
 * Load the most recent daily memory files, concatenated newest-first.
 */
export function loadRecentMemory(days: number = 3): string {
  const dir = join(VAULT_PATH, DAILY_LOG_DIR);
  if (!existsSync(dir)) return "";

  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()
    .slice(0, days);

  if (files.length === 0) return "";

  const sections: string[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8").trim();
      if (content) {
        const date = file.replace(".md", "");
        sections.push(`## ${date}\n${content}`);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return sections.join("\n\n");
}
