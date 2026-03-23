/**
 * Memory system — reads memory from the Obsidian vault.
 *
 * Two sources:
 *   jpOS/memory.md              — durable memory (always loaded)
 *   jpOS/daily-log/YYYY-MM-DD.md — daily log entries (recent N days loaded)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT_PATH, JPOS_DIR } from "./obsidian.js";

const MEMORY_FILE = join(JPOS_DIR, "memory.md");
const DAILY_LOG_DIR = join(JPOS_DIR, "daily-log");

/**
 * Load the durable memory file (jpOS/memory.md).
 */
export function loadDurableMemory(): string {
  const path = join(VAULT_PATH, MEMORY_FILE);
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return "";
  }
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
