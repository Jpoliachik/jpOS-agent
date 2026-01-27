/**
 * Obsidian vault Git operations
 * Manages cloning, pulling, writing notes, and pushing changes
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const execAsync = promisify(exec);

function getObsidianRepoUrl(): string {
  const token = process.env.GITHUB_PAT;
  if (token) {
    return `https://${token}@github.com/Jpoliachik/obsidian.git`;
  }
  return "git@github.com:Jpoliachik/obsidian.git";
}
const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || "/data/obsidian-vault";
const VOICE_NOTES_DIR = "voice-notes";

let sshConfigured = false;

async function ensureSshConfigured(): Promise<void> {
  if (sshConfigured) return;

  const sshKey = process.env.SSH_PRIVATE_KEY;
  if (!sshKey) {
    sshConfigured = true;
    return;
  }

  console.log("Configuring SSH key from environment...");
  const sshDir = join(homedir(), ".ssh");
  const keyPath = join(sshDir, "id_ed25519");

  if (!existsSync(sshDir)) {
    mkdirSync(sshDir, { mode: 0o700 });
  }

  // Decode base64 key and write
  const decodedKey = Buffer.from(sshKey, "base64").toString("utf-8");
  writeFileSync(keyPath, decodedKey, { mode: 0o600 });

  // Add GitHub to known hosts
  const knownHostsPath = join(sshDir, "known_hosts");
  await execAsync(`ssh-keyscan github.com >> ${knownHostsPath}`);

  console.log("SSH key configured");
  sshConfigured = true;
}

async function configureGit(): Promise<void> {
  await execAsync(`git config --global user.email "jpos-agent@fly.dev"`);
  await execAsync(`git config --global user.name "jpOS Agent"`);
}

export async function ensureVaultReady(): Promise<void> {
  await ensureSshConfigured();
  await configureGit();
  if (!existsSync(VAULT_PATH)) {
    console.log("Cloning Obsidian vault...");
    await execAsync(`git clone ${getObsidianRepoUrl()} ${VAULT_PATH}`);
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
  duration?: number;
  id?: string;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

interface AppendVoiceNoteResult {
  filePath: string;
  isDuplicate: boolean;
}

export async function appendVoiceNote(params: AppendVoiceNoteParams): Promise<AppendVoiceNoteResult> {
  const { transcript, timestamp, duration, id } = params;

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

  // Check for duplicate by ID
  if (id) {
    const existingContent = readFileSync(filePath, "utf-8");
    if (existingContent.includes(`id: ${id}`)) {
      console.log(`Duplicate voice note detected: ${id}`);
      return { filePath, isDuplicate: true };
    }
  }

  // Build entry with optional metadata
  let entry = `## ${timeStr}`;
  if (duration) {
    entry += ` (${formatDuration(duration)})`;
  }
  entry += `\n`;
  if (id) {
    entry += `> id: ${id}\n`;
  }
  entry += `\n${transcript}\n\n---\n\n`;
  appendFileSync(filePath, entry);

  return { filePath, isDuplicate: false };
}

export async function commitAndPush(message: string): Promise<void> {
  console.log("Committing and pushing changes...");
  await execAsync(`git -C ${VAULT_PATH} add -A`);
  await execAsync(`git -C ${VAULT_PATH} commit -m "${message}"`);
  await execAsync(`git -C ${VAULT_PATH} push`);
  console.log("Changes pushed successfully");
}
