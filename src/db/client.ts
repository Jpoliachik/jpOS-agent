import { createClient, type Client } from "@libsql/client";

/**
 * Single libSQL/SQLite client for the structured-data store.
 *
 * Defaults to a file on the Fly persistent volume (`/data/jpos.db`). Override
 * with `DATABASE_URL` — local dev typically uses `file:./data/jpos.db`, and a
 * future move to Turso would set `libsql://...` here without touching callers.
 *
 * The file is backed up continuously by Litestream (see docker-entrypoint.sh)
 * when `LITESTREAM_REPLICA_URL` is configured.
 */
let client: Client | null = null;

export function getDb(): Client {
  if (!client) {
    const url = process.env.DATABASE_URL || "file:/data/jpos.db";
    client = createClient({ url });
  }
  return client;
}
