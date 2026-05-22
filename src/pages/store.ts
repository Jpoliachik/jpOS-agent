/**
 * Persistence for published pages — one JSON file per slug under
 * /data/pages/. Lives on the same Fly volume as jpos-state.json.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "./cards.js";
import { validatePage } from "./cards.js";

const PAGES_DIR = process.env.PAGES_DIR || "/data/pages";

function ensureDir(): void {
  mkdirSync(PAGES_DIR, { recursive: true });
}

function pathFor(slug: string): string {
  // Slug is validated to [a-z0-9_-]; safe to join directly.
  return join(PAGES_DIR, `${slug}.json`);
}

export function savePage(page: Page): void {
  validatePage(page);
  ensureDir();
  writeFileSync(pathFor(page.slug), JSON.stringify(page, null, 2), "utf-8");
}

export function loadPage(slug: string): Page | null {
  const p = pathFor(slug);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    return validatePage(raw);
  } catch (err) {
    console.error(`[pages] failed to load ${slug}:`, err);
    return null;
  }
}

export interface PageSummary {
  slug: string;
  title: string;
  subtitle?: string;
  updatedAt: string; // ISO
}

export function listPages(limit = 100): PageSummary[] {
  ensureDir();
  let entries: string[];
  try {
    entries = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const rows = entries
    .map((f) => {
      const full = join(PAGES_DIR, f);
      try {
        const stat = statSync(full);
        const raw = JSON.parse(readFileSync(full, "utf-8"));
        return {
          slug: raw.slug as string,
          title: (raw.title as string) || raw.slug,
          subtitle: raw.subtitle as string | undefined,
          updatedAt: stat.mtime.toISOString(),
          mtimeMs: stat.mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  return rows.map(({ mtimeMs: _mtimeMs, ...rest }) => rest);
}
