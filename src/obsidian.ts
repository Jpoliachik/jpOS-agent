/**
 * Obsidian vault Git operations
 * Manages cloning, pulling, writing notes, and pushing changes
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
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
export const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || "/data/obsidian-vault";
const VOICE_NOTES_DIR = "voice-notes";

// Hardcoded timezone for date/time conversion
// TODO: Make configurable if needed for other timezones
const TIMEZONE = "America/New_York";

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

function getDateString(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: TIMEZONE }); // en-CA gives YYYY-MM-DD format
}

function getTimeString(date: Date = new Date()): string {
  return date.toLocaleTimeString("en-US", {
    timeZone: TIMEZONE,
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
  createdAt?: string;
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
  const { transcript, timestamp, duration, id, createdAt } = params;

  await ensureVaultReady();

  const voiceNotesPath = join(VAULT_PATH, VOICE_NOTES_DIR);
  if (!existsSync(voiceNotesPath)) {
    mkdirSync(voiceNotesPath, { recursive: true });
  }

  // Use createdAt date if provided, otherwise use today (in configured timezone)
  const noteDate = createdAt ? new Date(createdAt) : new Date();
  const dateStr = getDateString(noteDate);
  const timeStr = timestamp || getTimeString(noteDate);
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

export function readVaultGuide(): string | null {
  const guidePath = join(VAULT_PATH, "context", "vault-guide.md");
  try {
    return readFileSync(guidePath, "utf-8");
  } catch {
    return null;
  }
}

export function readContextFiles(): string {
  const contextDir = join(VAULT_PATH, "context");
  if (!existsSync(contextDir)) {
    return "";
  }

  const files = readdirSync(contextDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    return "";
  }

  const sections: string[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(contextDir, file), "utf-8");
      sections.push(`### ${file}\n${content}`);
    } catch {
      // Skip files that can't be read
    }
  }

  return sections.join("\n\n");
}

export async function commitAndPush(message: string): Promise<void> {
  console.log("Committing and pushing changes...");
  await execAsync(`git -C ${VAULT_PATH} add -A`);
  await execAsync(`git -C ${VAULT_PATH} commit -m "${message}"`);
  await execAsync(`git -C ${VAULT_PATH} push`);
  console.log("Changes pushed successfully");
}

export interface VaultSyncStatus {
  hasUncommittedChanges: boolean;
  hasUnpushedCommits: boolean;
  isClean: boolean;
}

export async function getVaultSyncStatus(): Promise<VaultSyncStatus> {
  const { stdout: porcelain } = await execAsync(`git -C ${VAULT_PATH} status --porcelain`);
  const hasUncommittedChanges = porcelain.trim().length > 0;

  const { stdout: unpushed } = await execAsync(`git -C ${VAULT_PATH} log @{u}..HEAD --oneline`);
  const hasUnpushedCommits = unpushed.trim().length > 0;

  return {
    hasUncommittedChanges,
    hasUnpushedCommits,
    isClean: !hasUncommittedChanges && !hasUnpushedCommits,
  };
}

export interface VaultPushResult {
  status: "already_clean" | "pushed" | "failed";
  actions?: string[];
  error?: string;
}

export async function ensureVaultPushed(): Promise<VaultPushResult> {
  try {
    const syncStatus = await getVaultSyncStatus();

    if (syncStatus.isClean) {
      return { status: "already_clean" };
    }

    const actions: string[] = [];

    if (syncStatus.hasUncommittedChanges) {
      await execAsync(`git -C ${VAULT_PATH} add -A`);
      await execAsync(
        `git -C ${VAULT_PATH} commit -m "Auto-sync: uncommitted changes from agent"`,
      );
      actions.push("committed uncommitted changes");
    }

    await execAsync(`git -C ${VAULT_PATH} push`);
    actions.push("pushed to remote");

    console.log(`Vault safety net: ${actions.join(", ")}`);
    return { status: "pushed", actions };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Vault safety net failed:", errorMsg);
    return { status: "failed", error: errorMsg };
  }
}
