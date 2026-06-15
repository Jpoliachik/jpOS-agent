import { randomUUID } from "node:crypto";
import type { InValue } from "@libsql/client";
import { getDb } from "./client.js";
import { ContactInput, InteractionInput } from "./schemas/contacts.js";

/**
 * Column serializers shared by create and update. Maps an input field name to
 * the value actually stored (JSON-encoding the structured fields).
 */
function columnValue(c: ContactInput, col: string): unknown {
  switch (col) {
    case "tags":
      return c.tags === undefined ? undefined : JSON.stringify(c.tags);
    case "metadata":
      return c.metadata === undefined ? undefined : JSON.stringify(c.metadata);
    default:
      return (c as Record<string, unknown>)[col];
  }
}

const CONTACT_COLUMNS = [
  "name",
  "relationship",
  "tier",
  "cadence_days",
  "last_contacted",
  "location",
  "birthday",
  "email",
  "phone",
  "notes",
  "tags",
  "metadata",
] as const;

/**
 * Create or update a contact. Validated against the Zod schema before write —
 * bad shapes are rejected, not silently stored.
 *
 * Pass `id` to update an existing contact; only the fields you include are
 * changed (others are left untouched). Omit `id` to create — `name` is then
 * required.
 */
export async function saveContact(input: unknown): Promise<{ id: string; created: boolean }> {
  const c = ContactInput.parse(input);
  const db = getDb();
  const now = new Date().toISOString();

  if (c.id) {
    const sets: string[] = [];
    const args: InValue[] = [];
    for (const col of CONTACT_COLUMNS) {
      const value = columnValue(c, col);
      if (value === undefined) continue;
      sets.push(`${col} = ?`);
      args.push(value as InValue);
    }
    sets.push("updated_at = ?");
    args.push(now);
    args.push(c.id);

    const res = await db.execute({
      sql: `UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`,
      args,
    });
    if (res.rowsAffected === 0) {
      throw new Error(`No contact with id ${c.id}`);
    }
    return { id: c.id, created: false };
  }

  if (!c.name) {
    throw new Error("name is required to create a contact");
  }
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO contacts
            (id, name, relationship, tier, cadence_days, last_contacted, location,
             birthday, email, phone, notes, tags, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      c.name,
      c.relationship ?? null,
      c.tier ?? null,
      c.cadence_days ?? null,
      c.last_contacted ?? null,
      c.location ?? null,
      c.birthday ?? null,
      c.email ?? null,
      c.phone ?? null,
      c.notes ?? null,
      c.tags ? JSON.stringify(c.tags) : null,
      c.metadata ? JSON.stringify(c.metadata) : null,
      now,
      now,
    ],
  });

  return { id, created: true };
}

/**
 * Record a touchpoint with a contact and advance `last_contacted` if this
 * interaction is more recent than what's stored. Defaults `occurred_at` to now.
 */
export async function logTouch(
  input: unknown,
): Promise<{ id: string; contact_id: string; occurred_at: string }> {
  const t = InteractionInput.parse(input);
  const db = getDb();
  const occurredAt = t.occurred_at ?? new Date().toISOString();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.execute({
    sql: `INSERT INTO interactions (id, contact_id, occurred_at, channel, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, t.contact_id, occurredAt, t.channel ?? null, t.notes ?? null, now],
  });

  // Only move last_contacted forward, never backward.
  await db.execute({
    sql: `UPDATE contacts SET last_contacted = ?, updated_at = ?
          WHERE id = ? AND (last_contacted IS NULL OR last_contacted < ?)`,
    args: [occurredAt, now, t.contact_id, occurredAt],
  });

  return { id, contact_id: t.contact_id, occurred_at: occurredAt };
}
