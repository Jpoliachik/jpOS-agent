/**
 * Vault sync worker.
 *
 * Single background goroutine that owns all git operations against the Obsidian
 * vault. Callers never await git — they call `requestSync()` and move on.
 *
 * Conflict policy:
 *   - Append-only paths (voice-notes/, daily-log/, conflicts/) use merge=union
 *     via .gitattributes so git auto-concatenates both sides.
 *   - All other paths are "user wins": on merge conflict the remote version is
 *     kept, the agent's proposed version is preserved to jpOS/conflicts/, and
 *     a Telegram notification is sent.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT_PATH, JPOS_DIR } from "./obsidian.js";

type Notifier = (text: string) => Promise<unknown>;

const execAsync = promisify(exec);

const GIT_CMD_TIMEOUT_MS = 45_000;
const DEBOUNCE_MS = 10_000;
const PERIODIC_SYNC_MS = 10 * 60_000;
const SHUTDOWN_DRAIN_MS = 60_000;

const CONFLICTS_DIR = "conflicts";
const GITATTRIBUTES = [
  `${JPOS_DIR}/voice-notes/** merge=union`,
  `${JPOS_DIR}/daily-log/** merge=union`,
  `${JPOS_DIR}/${CONFLICTS_DIR}/** merge=union`,
  "",
].join("\n");

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let dirty = false;
let running = false;
let debounceTimer: NodeJS.Timeout | null = null;
let periodicTimer: NodeJS.Timeout | null = null;
let stopped = false;
let notifier: Notifier | null = null;

export function requestSync(): void {
  if (stopped) return;
  dirty = true;
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSync("debounced");
  }, DEBOUNCE_MS);
}

export function startVaultSync(opts: { notifier?: Notifier } = {}): void {
  notifier = opts.notifier ?? null;
  ensureGitAttributes();
  periodicTimer = setInterval(() => {
    void runSync("periodic");
  }, PERIODIC_SYNC_MS);
  // Prime an initial pull shortly after startup.
  setTimeout(() => void runSync("startup"), 5_000);
  console.log(`Vault sync worker started (debounce ${DEBOUNCE_MS}ms, periodic ${PERIODIC_SYNC_MS}ms)`);
}

export async function stopVaultSync(): Promise<void> {
  stopped = true;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  // Flush one final sync (bounded) so local writes make it upstream.
  const drain = runSync("shutdown");
  const timer = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_MS));
  await Promise.race([drain, timer]);
}

// ---------------------------------------------------------------------------
// Core sync loop
// ---------------------------------------------------------------------------

async function runSync(trigger: string): Promise<void> {
  if (running) {
    // Another sync is active; mark dirty so we re-run afterward.
    dirty = true;
    return;
  }
  running = true;
  dirty = false;
  try {
    await syncOnce(trigger);
  } catch (err) {
    console.error(`[vault-sync:${trigger}] sync failed:`, err);
  } finally {
    running = false;
    // If new writes arrived while we were running, kick a fresh debounce cycle.
    if (dirty && !stopped) {
      if (!debounceTimer) {
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          void runSync("follow-up");
        }, DEBOUNCE_MS);
      }
    }
  }
}

async function syncOnce(trigger: string): Promise<void> {
  console.log(`[vault-sync:${trigger}] starting`);

  // 1. Commit any local changes so they participate in the merge.
  await commitLocalChanges();

  // 2. Fetch remote.
  await git("fetch origin");

  const branch = await currentBranch();
  const local = (await git(`rev-parse HEAD`)).stdout.trim();
  const remote = (await git(`rev-parse origin/${branch}`)).stdout.trim();

  if (local === remote) {
    console.log(`[vault-sync:${trigger}] in sync (no-op)`);
    return;
  }

  // 3. Merge remote into local. If diverged, handle conflicts per policy.
  const mergeOk = await tryMerge(branch);
  if (!mergeOk) {
    await resolveConflictsUserWins();
    await git(`commit --no-edit`);
  }

  // 4. Push. Retry once if remote advanced mid-push.
  try {
    await git("push");
    console.log(`[vault-sync:${trigger}] pushed`);
  } catch {
    console.warn(`[vault-sync:${trigger}] push rejected — refetching and retrying once`);
    await git("fetch origin");
    const ok = await tryMerge(branch);
    if (!ok) {
      await resolveConflictsUserWins();
      await git(`commit --no-edit`);
    }
    await git("push");
    console.log(`[vault-sync:${trigger}] pushed (after retry)`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function commitLocalChanges(): Promise<void> {
  const { stdout } = await git("status --porcelain");
  if (!stdout.trim()) return;
  await git("add -A");
  await git(`commit -m "jpos agent sync"`);
}

async function currentBranch(): Promise<string> {
  const { stdout } = await git("rev-parse --abbrev-ref HEAD");
  return stdout.trim();
}

async function tryMerge(branch: string): Promise<boolean> {
  try {
    await git(`merge --no-edit origin/${branch}`);
    return true;
  } catch (err) {
    // Merge failed — could be conflicts. Check for conflicted files.
    const { stdout } = await git("diff --name-only --diff-filter=U");
    if (stdout.trim()) return false;
    // Unknown merge failure with no conflicts — abort and rethrow.
    await git("merge --abort").catch(() => {});
    throw err;
  }
}

async function resolveConflictsUserWins(): Promise<void> {
  const { stdout } = await git("diff --name-only --diff-filter=U");
  const conflicted = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (conflicted.length === 0) return;

  const preserved: Array<{ target: string; conflictFile: string }> = [];

  for (const file of conflicted) {
    try {
      const agentVersion = (await git(`show :2:${quote(file)}`, { maxBuffer: 20 * 1024 * 1024 })).stdout;
      const remoteVersion = (await git(`show :3:${quote(file)}`, { maxBuffer: 20 * 1024 * 1024 })).stdout;
      const conflictFile = writeConflictRecord(file, agentVersion, remoteVersion);
      preserved.push({ target: file, conflictFile });
    } catch (err) {
      console.error(`[vault-sync] failed to extract conflict versions for ${file}:`, err);
    }
    // Take remote (theirs in a merge). If this fails because the remote deleted
    // the file, `rm` it instead.
    try {
      await git(`checkout --theirs -- ${quote(file)}`);
      await git(`add -- ${quote(file)}`);
    } catch {
      await git(`rm -- ${quote(file)}`).catch(() => {});
    }
  }

  if (preserved.length > 0) {
    await git("add -A");
    await notifyTelegram(preserved);
  }
}

function writeConflictRecord(targetPath: string, agentVersion: string, remoteVersion: string): string {
  const conflictsDir = join(VAULT_PATH, JPOS_DIR, CONFLICTS_DIR);
  if (!existsSync(conflictsDir)) {
    mkdirSync(conflictsDir, { recursive: true });
  }
  const slug = targetPath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${stamp}-${slug}.md`;
  const filePath = join(conflictsDir, filename);
  const relPath = join(JPOS_DIR, CONFLICTS_DIR, filename);

  const body = [
    "---",
    `target: ${targetPath}`,
    `timestamp: ${new Date().toISOString()}`,
    "type: merge-conflict",
    "---",
    "",
    "# Conflict preserved",
    "",
    `Remote version was kept in \`${targetPath}\`. The agent's proposed version is below`,
    "so you can review and merge manually.",
    "",
    "## Agent's proposed version",
    "",
    "```",
    agentVersion,
    "```",
    "",
    "## Remote version (kept)",
    "",
    "```",
    remoteVersion,
    "```",
    "",
  ].join("\n");

  writeFileSync(filePath, body);
  return relPath;
}

async function notifyTelegram(preserved: Array<{ target: string; conflictFile: string }>): Promise<void> {
  if (!notifier) return;
  const lines = preserved.map((p) => `• ${p.target} → ${p.conflictFile}`);
  const text = [
    `jpOS: vault sync hit ${preserved.length} conflict${preserved.length === 1 ? "" : "s"} — remote kept, agent version preserved:`,
    ...lines,
    "",
    "Ask me to resolve when you're ready.",
  ].join("\n");
  try {
    await notifier(text);
  } catch (err) {
    console.error("[vault-sync] notifier failed:", err);
  }
}

function ensureGitAttributes(): void {
  const path = join(VAULT_PATH, ".gitattributes");
  let existing = "";
  if (existsSync(path)) {
    existing = readFileSync(path, "utf-8");
  }
  if (existing.includes("merge=union") && existing.includes(`${JPOS_DIR}/voice-notes/`)) {
    return;
  }
  const next = existing && !existing.endsWith("\n") ? existing + "\n" + GITATTRIBUTES : existing + GITATTRIBUTES;
  writeFileSync(path, next);
  console.log("Wrote .gitattributes to vault (merge=union for append-only paths)");
  requestSync();
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function git(args: string, opts: { maxBuffer?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`git -C ${quote(VAULT_PATH)} ${args}`, {
    timeout: GIT_CMD_TIMEOUT_MS,
    maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" },
  });
}
