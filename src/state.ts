/**
 * Persistent JSON state file at /data/jpos-state.json.
 * Survives process restarts on the Fly.io persistent volume.
 *
 * Usage:
 *   setState("lastDailyPrepDate", "2026-03-17");
 *   getState<string>("lastDailyPrepDate"); // "2026-03-17"
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const STATE_DIR = "/data";
const STATE_FILE = `${STATE_DIR}/jpos-state.json`;

type StateData = Record<string, unknown>;

function readAll(): StateData {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeAll(data: StateData): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write state file:", err);
  }
}

export function getState<T = unknown>(key: string): T | undefined {
  return readAll()[key] as T | undefined;
}

export function setState(key: string, value: unknown): void {
  const data = readAll();
  data[key] = value;
  writeAll(data);
}
