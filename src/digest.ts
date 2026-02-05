/**
 * Monthly content digest generation
 * Compiles links and notes from work logs and Obsidian vault
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VAULT_PATH, ensureVaultReady } from "./obsidian.js";

const execAsync = promisify(exec);

interface DigestEntry {
  date: string;
  links: string[];
  content: string;
}

interface DigestResult {
  month: string;
  voiceNoteLinks: DigestEntry[];
  newNotes: string[];
  editedNotes: string[];
  totalLinks: number;
  filePath: string;
}

/**
 * Extract URLs from a text string
 */
function extractUrls(text: string): string[] {
  // Match http:// or https:// URLs
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches)]; // Remove duplicates
}

/**
 * Get voice notes for a specific month
 */
function getVoiceNotesForMonth(year: number, month: number): DigestEntry[] {
  const voiceNotesPath = join(VAULT_PATH, "voice-notes");
  if (!existsSync(voiceNotesPath)) {
    return [];
  }

  const entries: DigestEntry[] = [];
  const monthStr = String(month).padStart(2, "0");
  const yearMonthPrefix = `${year}-${monthStr}`;

  const files = readdirSync(voiceNotesPath).filter(
    (f) => f.startsWith(yearMonthPrefix) && f.endsWith(".md")
  );

  for (const file of files) {
    const filePath = join(voiceNotesPath, file);
    const content = readFileSync(filePath, "utf-8");
    const links = extractUrls(content);

    if (links.length > 0) {
      entries.push({
        date: file.replace(".md", ""),
        links,
        content,
      });
    }
  }

  return entries;
}

/**
 * Get notes created or modified in a specific month using git log
 */
async function getChangedNotesForMonth(year: number, month: number): Promise<{
  newNotes: string[];
  editedNotes: string[];
}> {
  const monthStr = String(month).padStart(2, "0");
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthStr = String(nextMonth).padStart(2, "0");

  const since = `${year}-${monthStr}-01`;
  const until = `${nextYear}-${nextMonthStr}-01`;

  try {
    // Get all files added in the month
    const { stdout: addedFiles } = await execAsync(
      `git -C ${VAULT_PATH} log --since="${since}" --until="${until}" --diff-filter=A --name-only --pretty=format: | sort -u`
    );

    // Get all files modified (but not added) in the month
    const { stdout: modifiedFiles } = await execAsync(
      `git -C ${VAULT_PATH} log --since="${since}" --until="${until}" --diff-filter=M --name-only --pretty=format: | sort -u`
    );

    const newNotes = addedFiles
      .split("\n")
      .filter((f) => f.trim().endsWith(".md") && !f.includes("voice-notes/"))
      .map((f) => f.trim());

    const editedNotes = modifiedFiles
      .split("\n")
      .filter((f) => f.trim().endsWith(".md") && !f.includes("voice-notes/"))
      .map((f) => f.trim());

    return { newNotes, editedNotes };
  } catch (error) {
    console.error("Error getting changed notes:", error);
    return { newNotes: [], editedNotes: [] };
  }
}

/**
 * Format the digest as markdown
 */
function formatDigest(
  year: number,
  month: number,
  voiceNoteLinks: DigestEntry[],
  newNotes: string[],
  editedNotes: string[]
): string {
  const monthName = new Date(year, month - 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  let markdown = `# Monthly Content Digest - ${monthName}\n\n`;
  markdown += `Generated: ${new Date().toISOString().split("T")[0]}\n\n`;

  // Links from voice notes
  markdown += `## Links Found\n\n`;
  if (voiceNoteLinks.length === 0) {
    markdown += `No links found this month.\n\n`;
  } else {
    const totalLinks = voiceNoteLinks.reduce((sum, entry) => sum + entry.links.length, 0);
    markdown += `Found ${totalLinks} link(s) across ${voiceNoteLinks.length} day(s):\n\n`;

    for (const entry of voiceNoteLinks) {
      markdown += `### ${entry.date}\n\n`;
      for (const link of entry.links) {
        markdown += `- ${link}\n`;
      }
      markdown += `\n`;
    }
  }

  // New notes
  markdown += `## New Notes\n\n`;
  if (newNotes.length === 0) {
    markdown += `No new notes created this month.\n\n`;
  } else {
    markdown += `Created ${newNotes.length} note(s):\n\n`;
    for (const note of newNotes) {
      markdown += `- ${note}\n`;
    }
    markdown += `\n`;
  }

  // Edited notes
  markdown += `## Edited Notes\n\n`;
  if (editedNotes.length === 0) {
    markdown += `No notes edited this month.\n\n`;
  } else {
    markdown += `Modified ${editedNotes.length} note(s):\n\n`;
    for (const note of editedNotes) {
      markdown += `- ${note}\n`;
    }
    markdown += `\n`;
  }

  return markdown;
}

/**
 * Generate monthly digest for a specific month
 */
export async function generateMonthlyDigest(year: number, month: number): Promise<DigestResult> {
  await ensureVaultReady();

  // Extract links from voice notes
  const voiceNoteLinks = getVoiceNotesForMonth(year, month);

  // Get changed notes from git
  const { newNotes, editedNotes } = await getChangedNotesForMonth(year, month);

  // Format and save
  const markdown = formatDigest(year, month, voiceNoteLinks, newNotes, editedNotes);

  const digestsPath = join(VAULT_PATH, "digests");
  if (!existsSync(digestsPath)) {
    mkdirSync(digestsPath, { recursive: true });
  }

  const monthStr = String(month).padStart(2, "0");
  const filename = `${year}-${monthStr}.md`;
  const filePath = join(digestsPath, filename);

  writeFileSync(filePath, markdown);
  console.log(`Digest saved to: ${filePath}`);

  const totalLinks = voiceNoteLinks.reduce((sum, entry) => sum + entry.links.length, 0);

  return {
    month: `${year}-${monthStr}`,
    voiceNoteLinks,
    newNotes,
    editedNotes,
    totalLinks,
    filePath,
  };
}

/**
 * Generate digest for the previous month
 */
export async function generatePreviousMonthDigest(): Promise<DigestResult> {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = lastMonth.getFullYear();
  const month = lastMonth.getMonth() + 1; // getMonth() is 0-indexed

  return generateMonthlyDigest(year, month);
}
