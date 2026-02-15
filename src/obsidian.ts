/**
 * Obsidian vault Git operations
 * Manages cloning, syncing, writing notes, and pushing changes
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Mutex — serializes all vault git operations
// ---------------------------------------------------------------------------

class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

const vaultMutex = new Mutex();

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
 * Seed system/ directory in the vault with defaults from system-defaults/
 * if they don't already exist.
 */
function seedSystemDefaults(): void {
  const defaultsDir = join(process.env.AGENT_CWD || "/app", "system-defaults");
  if (!existsSync(defaultsDir)) return;

  const systemDir = join(VAULT_PATH, JPOS_DIR, "system");
  const skillsDir = join(systemDir, "skills");

  if (!existsSync(systemDir)) mkdirSync(systemDir, { recursive: true });
  if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });

  const seedFile = (relativePath: string) => {
    const src = join(defaultsDir, relativePath);
    const dest = join(systemDir, relativePath);
    if (!existsSync(dest) && existsSync(src)) {
      const destDir = join(dest, "..");
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      cpSync(src, dest);
      console.log(`Seeded default: system/${relativePath}`);
    }
  };

  for (const file of readdirSync(defaultsDir).filter(f => f.endsWith(".md"))) {
    seedFile(file);
  }

  const skillsDefaultsDir = join(defaultsDir, "skills");
  if (existsSync(skillsDefaultsDir)) {
    for (const file of readdirSync(skillsDefaultsDir).filter(f => f.endsWith(".md"))) {
      seedFile(join("skills", file));
    }
  }
}

/**
 * One-time vault initialization. Call at startup before accepting requests.
 * Clones the vault if needed, cleans up any broken git state from previous crashes,
 * and seeds default system files.
 */
export async function ensureVaultCloned(): Promise<void> {
  await ensureSshConfigured();
  await configureGit();

  if (!existsSync(VAULT_PATH)) {
    console.log("Cloning Obsidian vault...");
    await execAsync(`git clone ${getObsidianRepoUrl()} ${VAULT_PATH}`);
    console.log("Vault cloned successfully");
  } else {
    // Hard-reset to remote to clean up any broken state from a previous crash
    try {
      await execAsync(`git -C ${VAULT_PATH} fetch origin`);
      const { stdout: branch } = await execAsync(`git -C ${VAULT_PATH} rev-parse --abbrev-ref HEAD`);
      await execAsync(`git -C ${VAULT_PATH} reset --hard origin/${branch.trim()}`);
    } catch (err) {
      console.warn("Startup vault reset failed (will retry on first sync):", err);
    }
  }

  seedSystemDefaults();
}

// ---------------------------------------------------------------------------
// Internal git operations
// ---------------------------------------------------------------------------

const GIT_OP_TIMEOUT_MS = 60_000; // 60s per git operation

async function gitExec(cmd: string): Promise<string> {
  const { stdout } = await execAsync(cmd, { timeout: GIT_OP_TIMEOUT_MS });
  return stdout;
}

/**
 * Hard-sync local vault to remote. Git (remote) is source of truth.
 * Any dirty local state from a previous crash is discarded.
 */
async function pull(): Promise<void> {
  console.log("Syncing vault from remote...");
  await gitExec(`git -C ${VAULT_PATH} fetch origin`);
  const branch = (await gitExec(`git -C ${VAULT_PATH} rev-parse --abbrev-ref HEAD`)).trim();
  await gitExec(`git -C ${VAULT_PATH} reset --hard origin/${branch}`);
  console.log("Vault synced to remote");
}

async function commitAndPush(): Promise<void> {
  const status = (await gitExec(`git -C ${VAULT_PATH} status --porcelain`)).trim();
  if (!status) {
    console.log("No vault changes to push");
    return;
  }

  await gitExec(`git -C ${VAULT_PATH} add -A`);
  await gitExec(`git -C ${VAULT_PATH} commit -m "jpOS agent sync"`);
  await gitExec(`git -C ${VAULT_PATH} push`);
  console.log("Vault changes pushed");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pull → run fn → commit + push, all serialized behind a mutex.
 *
 * Only git operations are time-bounded (60s each). The wrapped function
 * (typically an agent run) is allowed to take as long as it needs — the
 * previous 5-minute blanket timeout was the cause of daily-prep failures.
 */
export async function withVaultSync<T>(fn: () => Promise<T>): Promise<T> {
  await vaultMutex.acquire();
  try {
    await pull();
    const result = await fn();
    await commitAndPush();
    return result;
  } catch (error) {
    console.error("withVaultSync error:", error);
    // Reset to remote so the working tree is clean for the next operation.
    try {
      const branch = (await gitExec(`git -C ${VAULT_PATH} rev-parse --abbrev-ref HEAD`)).trim();
      await gitExec(`git -C ${VAULT_PATH} reset --hard origin/${branch}`);
    } catch (cleanupErr) {
      console.error("Error during cleanup:", cleanupErr);
    }
    throw error;
  } finally {
    vaultMutex.release();
  }
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
 * Pure file operation — must be called inside withVaultSync().
 */
export function appendVoiceNote(params: AppendVoiceNoteParams): AppendVoiceNoteResult {
  const { transcript, timestamp, duration, id, createdAt } = params;

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

  // Check for duplicate by ID
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
  if (id) {
    entry += `> id: ${id}\n`;
  }
  entry += `\n${transcript}\n\n---\n\n`;
  appendFileSync(filePath, entry);

  return { filePath, isDuplicate: false };
}

// ---------------------------------------------------------------------------
// Vault readers
// ---------------------------------------------------------------------------

export function readVaultGuide(): string | null {
  const guidePath = join(VAULT_PATH, JPOS_DIR, "context", "vault-guide.md");
  try {
    return readFileSync(guidePath, "utf-8");
  } catch {
    return null;
  }
}

export function readContextFiles(): string {
  const contextDir = join(VAULT_PATH, JPOS_DIR, "context");
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
