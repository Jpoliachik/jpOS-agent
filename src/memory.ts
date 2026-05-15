/**
 * Temporal memory readers — file-based, vault-backed.
 *
 * This module ONLY handles temporal context (daily logs + weekly digests).
 * Durable semantic memory lives in `src/memory-store.ts` (Qdrant).
 *
 * Loaded into the system prompt by `src/prompt.ts`:
 *   jpOS/daily-log/YYYY-MM-DD.md  — last 3 days
 *   jpOS/weekly-digest/YYYY-WXX.md — last 4 weeks
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT_PATH, JPOS_DIR } from "./obsidian.js";

const DAILY_LOG_DIR = join(JPOS_DIR, "daily-log");
const WEEKLY_DIGEST_DIR = join(JPOS_DIR, "weekly-digest");

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
 * Load the most recent daily log files, concatenated newest-first.
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
