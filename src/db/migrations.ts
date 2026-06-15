import { getDb } from "./client.js";

/**
 * Schema migrations — the hard source of truth for the database STRUCTURE.
 * (The Zod schemas in ./schemas are the source of truth for the SHAPE used at
 * write time. Keep the two in sync when you add or change a table.)
 *
 * Rules for maintaining this over time:
 *   - Append new migrations to the END of the array. Never edit or reorder a
 *     migration that has already shipped — add a new one instead.
 *   - Use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so the
 *     runner stays idempotent even if two processes race on first boot.
 *   - Each `sql` block may contain multiple `;`-separated statements.
 *
 * Adding a new table is intentionally a three-step, low-ceremony loop:
 *   1. Add a Zod schema in ./schemas/<table>.ts
 *   2. Add a migration entry here
 *   3. Add typed write helpers + register the table doc in the db MCP server
 */
export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: "0001_contacts",
    sql: `
      CREATE TABLE IF NOT EXISTS contacts (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        relationship  TEXT,
        tier          TEXT,
        cadence_days  INTEGER,
        last_contacted TEXT,
        location      TEXT,
        birthday      TEXT,
        email         TEXT,
        phone         TEXT,
        notes         TEXT,
        tags          TEXT,
        metadata      TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS interactions (
        id          TEXT PRIMARY KEY,
        contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        occurred_at TEXT NOT NULL,
        channel     TEXT,
        notes       TEXT,
        created_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_interactions_contact ON interactions(contact_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_last_contacted ON contacts(last_contacted);
    `,
  },
];

/**
 * Apply any pending migrations. Idempotent and safe to call from more than one
 * process — `_migrations` tracks what's already applied and inserts use
 * `INSERT OR IGNORE`.
 */
export async function runMigrations(): Promise<string[]> {
  const db = getDb();
  await db.execute(
    `CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );

  const result = await db.execute(`SELECT id FROM _migrations`);
  const applied = new Set(result.rows.map((r) => String(r.id)));

  const ran: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    await db.executeMultiple(m.sql);
    await db.execute({
      sql: `INSERT OR IGNORE INTO _migrations (id, applied_at) VALUES (?, ?)`,
      args: [m.id, new Date().toISOString()],
    });
    ran.push(m.id);
  }
  return ran;
}
