/**
 * Memory system — reads daily memory files from the Obsidian vault.
 *
 * Memory files live at jpOS/memory/YYYY-MM-DD.md and are written by the agent
 * during interactions. This module handles loading recent memory for context.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT_PATH, JPOS_DIR } from "./obsidian.js";

const MEMORY_DIR = join(JPOS_DIR, "memory");

/**
 * Load the most recent daily memory files, concatenated newest-first.
 * Returns empty string if no memory files exist.
 */
export function loadRecentMemory(days: number = 5): string {
  const dir = join(VAULT_PATH, MEMORY_DIR);
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
