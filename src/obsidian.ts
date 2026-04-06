/**
 * Obsidian vault Git operations
 * Simple model: pull periodically, push after writes.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getObsidianRepoUrl(): string {
  const token = process.env.GITHUB_PAT;
  if (token) {
    return `https://${token}@github.com/Jpoliachik/obsidian.git`;
  }
  return "git@github.com:Jpoliachik/obsidian.git";
}

export const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || "/data/obsidian-vault";
export const JPOS_DIR = "jpOS";
const VOICE_NOTES_DIR = join(JPOS_DIR, "voice-notes");
const TIMEZONE = "America/New_York";
const GIT_TIMEOUT_MS = 60_000;
const PERIODIC_SYNC_INTERVAL_MS = 60 * 60_000; // 1 hour

// ---------------------------------------------------------------------------
// One-time setup
// ---------------------------------------------------------------------------

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

  const decodedKey = Buffer.from(sshKey, "base64").toString("utf-8");
  writeFileSync(keyPath, decodedKey, { mode: 0o600 });

  const knownHostsPath = join(sshDir, "known_hosts");
  await execAsync(`ssh-keyscan github.com >> ${knownHostsPath}`);

  console.log("SSH key configured");
  sshConfigured = true;
}

async function configureGit(): Promise<void> {
  await execAsync(`git config --global user.email "jpos-agent@fly.dev"`);
  await execAsync(`git config --global user.name "jpOS Agent"`);
}

/**
 * One-time vault initialization. Call at startup before accepting requests.
 */
export async function ensureVaultCloned(): Promise<void> {
  await ensureSshConfigured();
  await configureGit();

  if (!existsSync(VAULT_PATH)) {
    console.log("Cloning Obsidian vault...");
    await execAsync(`git clone ${getObsidianRepoUrl()} ${VAULT_PATH}`);
    console.log("Vault cloned successfully");
  } else {
    await pullVault();
  }

  const memoryDir = join(VAULT_PATH, JPOS_DIR, "memory");
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log("Created memory directory");
  }
}

// ---------------------------------------------------------------------------
// Pull / Push
// ---------------------------------------------------------------------------

/**
 * Pull from remote. Remote wins on any conflict (hard reset).
 */
export async function pullVault(): Promise<void> {
  console.log("Pulling vault from remote...");
  try {
    await execAsync(`git -C ${VAULT_PATH} fetch origin`, { timeout: GIT_TIMEOUT_MS });
    const { stdout: branch } = await execAsync(`git -C ${VAULT_PATH} rev-parse --abbrev-ref HEAD`, { timeout: GIT_TIMEOUT_MS });
    await execAsync(`git -C ${VAULT_PATH} reset --hard origin/${branch.trim()}`, { timeout: GIT_TIMEOUT_MS });
    console.log("Vault pulled");
  } catch (err) {
    console.warn("Vault pull failed (continuing):", err);
  }
}

/**
 * Push any local changes to remote.
 * If push is rejected, rebase (local wins on conflict) and retry once.
 */
export async function pushVaultChanges(): Promise<void> {
  const { stdout: status } = await execAsync(`git -C ${VAULT_PATH} status --porcelain`, { timeout: GIT_TIMEOUT_MS });
  if (!status.trim()) {
    return; // nothing to push
  }

  await execAsync(`git -C ${VAULT_PATH} add -A`, { timeout: GIT_TIMEOUT_MS });
  await execAsync(`git -C ${VAULT_PATH} commit -m "jpOS agent sync"`, { timeout: GIT_TIMEOUT_MS });

  try {
    await execAsync(`git -C ${VAULT_PATH} push`, { timeout: GIT_TIMEOUT_MS });
    console.log("Vault changes pushed");
  } catch {
    // Push rejected — rebase and retry (local edits win on conflict)
    console.warn("Push rejected, rebasing...");
    await execAsync(`git -C ${VAULT_PATH} pull --rebase -X ours`, { timeout: GIT_TIMEOUT_MS });
    await execAsync(`git -C ${VAULT_PATH} push`, { timeout: GIT_TIMEOUT_MS });
    console.log("Vault changes pushed (after rebase)");
  }
}

/**
 * Start background periodic sync. Pulls from remote every hour.
 * Call once at startup.
 */
export function startPeriodicSync(): void {
  setInterval(async () => {
    try {
      await pullVault();
    } catch (err) {
      console.error("Periodic vault sync failed:", err);
    }
  }, PERIODIC_SYNC_INTERVAL_MS);

  console.log("Vault periodic sync started (every 1 hour)");
}

// ---------------------------------------------------------------------------
// Voice notes
// ---------------------------------------------------------------------------

function getDateString(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
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
  source?: string;
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

/**
 * Append a voice note entry to the daily markdown file.
 * Pure file operation — call pushVaultChanges() after to persist.
 */
export function appendVoiceNote(params: AppendVoiceNoteParams): AppendVoiceNoteResult {
  const { transcript, timestamp, duration, id, createdAt, source } = params;

  const voiceNotesPath = join(VAULT_PATH, VOICE_NOTES_DIR);
  if (!existsSync(voiceNotesPath)) {
    mkdirSync(voiceNotesPath, { recursive: true });
  }

  const noteDate = createdAt ? new Date(createdAt) : new Date();
  const dateStr = getDateString(noteDate);
  const timeStr = timestamp || getTimeString(noteDate);
  const filePath = join(voiceNotesPath, `${dateStr}.md`);

  if (!existsSync(filePath)) {
    writeFileSync(filePath, `# Voice Notes - ${dateStr}\n\n`);
  }

  if (id) {
    const existingContent = readFileSync(filePath, "utf-8");
    if (existingContent.includes(`id: ${id}`)) {
      console.log(`Duplicate voice note detected: ${id}`);
      return { filePath, isDuplicate: true };
    }
  }

  let entry = `## ${timeStr}`;
  if (duration) {
    entry += ` (${formatDuration(duration)})`;
  }
  entry += `\n`;
  const metadata: string[] = [];
  if (source) metadata.push(`source: ${source}`);
  if (id) metadata.push(`id: ${id}`);
  if (metadata.length > 0) {
    entry += metadata.map((m) => `> ${m}`).join("\n") + "\n";
  }
  entry += `\n${transcript}\n\n---\n\n`;
  appendFileSync(filePath, entry);

  return { filePath, isDuplicate: false };
}
