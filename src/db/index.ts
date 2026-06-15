export { getDb } from "./client.js";
export { runMigrations } from "./migrations.js";
export { saveContact, logTouch } from "./contacts.js";
export { readQuery } from "./query.js";
export * from "./schemas/contacts.js";

import { runMigrations } from "./migrations.js";

/**
 * Bring the database up to date. Call once on startup before serving requests.
 */
export async function initDb(): Promise<void> {
  const ran = await runMigrations();
  if (ran.length > 0) {
    console.log(`[db] applied migrations: ${ran.join(", ")}`);
  }
}
