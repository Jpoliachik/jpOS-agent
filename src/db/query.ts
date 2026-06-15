import { getDb } from "./client.js";

/**
 * Run a read-only query. Guards against writes and multi-statement input so the
 * agent can compose arbitrary SELECTs (e.g. "who am I overdue to contact") while
 * all mutations stay funneled through validated, typed helpers.
 */
export async function readQuery(
  sql: string,
): Promise<{ rows: unknown[]; columns: string[] }> {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new Error("db_query only allows read-only SELECT/WITH statements");
  }
  if (trimmed.includes(";")) {
    throw new Error("db_query allows a single statement only (no ';')");
  }

  const db = getDb();
  const result = await db.execute(trimmed);
  return { rows: result.rows, columns: result.columns };
}
