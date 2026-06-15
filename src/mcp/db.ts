#!/usr/bin/env node
/**
 * Structured-data MCP server (SQLite/libSQL).
 *
 * Reads are open and composable via `db_query` (SELECT/WITH only); writes go
 * through typed, Zod-validated tools so every table keeps a clean shape. This
 * is the home for reliable, queryable structured data about Justin — starting
 * with the contacts Rolodex.
 *
 * Adding a new table later: add its Zod schema + migration + typed write
 * helper, then register a doc entry in TABLE_DOCS and a write tool below.
 */
import { runMigrations } from "../db/migrations.js";
import { saveContact, logTouch } from "../db/contacts.js";
import { readQuery } from "../db/query.js";
import { CONTACT_TIERS } from "../db/schemas/contacts.js";

/** Human/agent-facing description of each queryable table. */
const TABLE_DOCS = [
  {
    table: "contacts",
    description:
      "People Justin wants to stay in touch with. Query last_contacted against " +
      "cadence_days to find overdue relationships.",
    columns: {
      id: "TEXT primary key (uuid)",
      name: "TEXT",
      relationship: "TEXT — how he knows them",
      tier: `TEXT — one of ${CONTACT_TIERS.join(", ")}`,
      cadence_days: "INTEGER — target days between touches (null = no goal)",
      last_contacted: "TEXT — ISO date of last connection",
      location: "TEXT",
      birthday: "TEXT — ISO date or MM-DD",
      email: "TEXT",
      phone: "TEXT",
      notes: "TEXT — freeform context",
      tags: "TEXT — JSON array",
      metadata: "TEXT — JSON object, arbitrary extra fields",
      created_at: "TEXT — ISO",
      updated_at: "TEXT — ISO",
    },
  },
  {
    table: "interactions",
    description: "Logged touchpoints with contacts. One row per interaction.",
    columns: {
      id: "TEXT primary key (uuid)",
      contact_id: "TEXT — FK to contacts.id",
      occurred_at: "TEXT — ISO datetime of the interaction",
      channel: "TEXT — call, text, in-person, email, dm, ...",
      notes: "TEXT",
      created_at: "TEXT — ISO",
    },
  },
];

const tools = [
  {
    name: "db_query",
    description:
      "Run a read-only SQL query (SELECT or WITH only, single statement) against " +
      "the structured-data store and get rows back. Use this to answer questions " +
      "about structured data — e.g. who Justin is overdue to contact: " +
      "SELECT name, last_contacted, cadence_days FROM contacts WHERE cadence_days IS NOT NULL " +
      "AND (last_contacted IS NULL OR julianday('now') - julianday(last_contacted) >= cadence_days) " +
      "ORDER BY last_contacted. Call db_tables first if unsure of the schema.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT/WITH statement." },
      },
      required: ["sql"],
    },
  },
  {
    name: "db_tables",
    description:
      "List the available tables and their columns so you know what you can query. No arguments.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "contact_save",
    description:
      "Create or update a contact in the Rolodex. Omit `id` to create a new contact; " +
      "pass an existing `id` to update one (find it first with db_query). Set " +
      "`cadence_days` to track how often Justin wants to reach out.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Existing contact id to update; omit to create." },
        name: { type: "string" },
        relationship: { type: "string", description: "How Justin knows them." },
        tier: { type: "string", enum: [...CONTACT_TIERS] },
        cadence_days: { type: "number", description: "Target days between touches." },
        last_contacted: { type: "string", description: "ISO date of last connection." },
        location: { type: "string" },
        birthday: { type: "string", description: "ISO date or MM-DD." },
        email: { type: "string" },
        phone: { type: "string" },
        notes: { type: "string", description: "Freeform context." },
        tags: { type: "array", items: { type: "string" } },
        metadata: { type: "object", description: "Arbitrary extra fields." },
      },
      required: ["name"],
    },
  },
  {
    name: "contact_log_touch",
    description:
      "Record a touchpoint with a contact (call, text, in-person, etc.). Advances " +
      "the contact's last_contacted automatically. Defaults the time to now.",
    inputSchema: {
      type: "object",
      properties: {
        contact_id: { type: "string" },
        occurred_at: { type: "string", description: "ISO datetime; defaults to now." },
        channel: { type: "string", description: "call, text, in-person, email, dm, ..." },
        notes: { type: "string" },
      },
      required: ["contact_id"],
    },
  },
];

type ToolArgs = Record<string, unknown>;

async function handleToolCall(name: string, args: ToolArgs): Promise<unknown> {
  switch (name) {
    case "db_query": {
      if (typeof args.sql !== "string") throw new Error("db_query requires 'sql'");
      return readQuery(args.sql);
    }
    case "db_tables":
      return { tables: TABLE_DOCS };
    case "contact_save":
      return saveContact(args);
    case "contact_log_touch":
      return logTouch(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main() {
  // Idempotent — ensures the schema exists even if this server is reached
  // before the main process finished its own startup migration.
  await runMigrations();

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    let requestId: unknown = null;
    try {
      const request = JSON.parse(line);
      requestId = request.id;
      let response: unknown;

      switch (request.method) {
        case "initialize":
          response = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "db-mcp", version: "1.0.0" },
          };
          break;

        case "tools/list":
          response = { tools };
          break;

        case "tools/call": {
          const result = await handleToolCall(request.params.name, request.params.arguments || {});
          response = {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
          break;
        }

        default:
          response = { error: { code: -32601, message: "Method not found" } };
      }

      console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: response }));
    } catch (error) {
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Unknown error",
          },
        }),
      );
    }
  }
}

main().catch(console.error);
