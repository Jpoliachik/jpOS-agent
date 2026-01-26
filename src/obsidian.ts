/**
 * Obsidian vault Git operations
 * Manages cloning, pulling, writing notes, and pushing changes
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const execAsync = promisify(exec);

const OBSIDIAN_REPO = "git@github.com:Jpoliachik/obsidian.git";
const VAULT_PATH = "/root/obsidian-vault";
const VOICE_NOTES_DIR = "voice-notes";

export async function ensureVaultReady(): Promise<void> {
  if (!existsSync(VAULT_PATH)) {
    console.log("Cloning Obsidian vault...");
    await execAsync(`git clone ${OBSIDIAN_REPO} ${VAULT_PATH}`);
    console.log("Vault cloned successfully");
  } else {
    await pullVault();
  }
}

export async function pullVault(): Promise<void> {
  console.log("Pulling latest from Obsidian vault...");
  await execAsync(`git -C ${VAULT_PATH} pull --rebase`);
}

function getDateString(): string {
  const now = new Date();
  return now.toISOString().split("T")[0]; // YYYY-MM-DD
}

function getTimeString(): string {
  const now = new Date();
  return now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

interface AppendVoiceNoteParams {
  transcript: string;
  timestamp?: string;
}

export async function appendVoiceNote(params: AppendVoiceNoteParams): Promise<string> {
  const { transcript, timestamp } = params;

  await ensureVaultReady();

  const voiceNotesPath = join(VAULT_PATH, VOICE_NOTES_DIR);
  if (!existsSync(voiceNotesPath)) {
    mkdirSync(voiceNotesPath, { recursive: true });
  }

  const dateStr = getDateString();
  const timeStr = timestamp || getTimeString();
  const filePath = join(voiceNotesPath, `${dateStr}.md`);

  // Create file with header if it doesn't exist
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `# Voice Notes - ${dateStr}\n\n`);
  }

  // Append the transcript
  const entry = `## ${timeStr}\n\n${transcript}\n\n---\n\n`;
  appendFileSync(filePath, entry);

  return filePath;
}

export async function commitAndPush(message: string): Promise<void> {
  console.log("Committing and pushing changes...");
  await execAsync(`git -C ${VAULT_PATH} add -A`);
  await execAsync(`git -C ${VAULT_PATH} commit -m "${message}"`);
  await execAsync(`git -C ${VAULT_PATH} push`);
  console.log("Changes pushed successfully");
}
