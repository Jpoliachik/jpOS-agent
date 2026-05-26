#!/usr/bin/env node
/**
 * Ramble Analytics MCP server.
 *
 * Thin wrapper over Cloudflare Analytics Engine SQL API for the `ramble_usage`
 * dataset. Read-only by virtue of the API itself (Analytics Engine exposes no
 * write SQL). The agent calls `ramble_analytics_schema` to learn the column
 * mapping, then writes its own SQL against `ramble_analytics_query`.
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_ANALYTICS_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("[ramble-mcp] Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_ANALYTICS_TOKEN");
  process.exit(1);
}

const SCHEMA_DOC = `# Ramble Analytics Schema

Cloudflare Analytics Engine dataset: \`ramble_usage\`

One row is written per transcription request by the Ramble iOS app's Cloudflare
Worker proxy. No PII — device IDs are SHA-256 hashed.

## Columns

| Column     | Meaning                                                          |
|------------|------------------------------------------------------------------|
| timestamp  | Event time (UTC)                                                 |
| index1     | Hashed device ID (use for unique-user counts)                    |
| blob1      | Model name (e.g. "whisper-large-v3-turbo", "openai-gpt-4o-mini") |
| blob2      | Provider — "groq" | "deepgram" | "openai"                        |
| blob3      | Outcome — "success" | "error"                                    |
| blob4      | Error detail (empty string on success)                           |
| double1    | Audio file size in bytes                                         |
| double2    | Transcript character length (0 on error)                         |
| double3    | Processing duration in ms                                        |
| _sample_interval | Sampling rate (multiply counts by this for true totals)    |

## SQL Notes

- Analytics Engine SQL is a ClickHouse-flavored dialect, read-only.
- Time filters: \`WHERE timestamp > now() - INTERVAL '7' DAY\`.
- For accurate totals always multiply by \`_sample_interval\`:
  \`SUM(_sample_interval)\` instead of \`count()\`.
- Always include a time range — unbounded queries are slow/expensive.
- Default \`LIMIT 100\` if not specified.

## Example queries

### Active users in the last 7 days
\`\`\`sql
SELECT count(DISTINCT index1) AS unique_users
FROM ramble_usage
WHERE timestamp > now() - INTERVAL '7' DAY
\`\`\`

### Requests per day, last 30 days
\`\`\`sql
SELECT
  toDate(timestamp) AS day,
  SUM(_sample_interval) AS requests
FROM ramble_usage
WHERE timestamp > now() - INTERVAL '30' DAY
GROUP BY day
ORDER BY day
\`\`\`

### Provider breakdown (last 7 days)
\`\`\`sql
SELECT
  blob2 AS provider,
  SUM(_sample_interval) AS requests,
  count(DISTINCT index1) AS unique_users
FROM ramble_usage
WHERE timestamp > now() - INTERVAL '7' DAY
GROUP BY provider
ORDER BY requests DESC
\`\`\`

### Latency (p50/p95) and avg transcript length by model (last 7 days)
\`\`\`sql
SELECT
  blob1 AS model,
  quantile(0.5)(double3) AS p50_ms,
  quantile(0.95)(double3) AS p95_ms,
  avg(double2) AS avg_chars,
  SUM(_sample_interval) AS requests
FROM ramble_usage
WHERE timestamp > now() - INTERVAL '7' DAY AND blob3 = 'success'
GROUP BY model
ORDER BY requests DESC
\`\`\`

### Error rate by provider (last 7 days)
\`\`\`sql
SELECT
  blob2 AS provider,
  countIf(blob3 = 'error') / count() AS error_rate,
  SUM(_sample_interval) AS requests
FROM ramble_usage
WHERE timestamp > now() - INTERVAL '7' DAY
GROUP BY provider
\`\`\`
`;

const tools = [
  {
    name: "ramble_analytics_schema",
    description:
      "Return the schema for the `ramble_usage` Cloudflare Analytics Engine dataset — column meanings, " +
      "SQL dialect notes, and example queries. Call this FIRST before writing any ramble_analytics_query, " +
      "and whenever you're unsure what blob1/blob2/double1 etc. mean.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ramble_analytics_query",
    description:
      "Execute a read-only SQL query against the Ramble Cloudflare Analytics Engine dataset (`ramble_usage`). " +
      "Returns JSON rows. The API is intrinsically read-only — there is no INSERT/UPDATE/DELETE. " +
      "Always include a `WHERE timestamp > ...` clause to bound the query. Call ramble_analytics_schema first " +
      "if you don't know the column layout.",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "ClickHouse-flavored SQL. The FROM table is `ramble_usage`.",
        },
      },
      required: ["sql"],
    },
  },
];

interface QueryArgs {
  sql: string;
}

interface AnalyticsResult {
  meta?: Array<{ name: string; type: string }>;
  data?: Array<Record<string, unknown>>;
  rows?: number;
  rows_before_limit_at_least?: number;
}

async function rambleQuery(args: QueryArgs): Promise<unknown> {
  if (!args.sql || typeof args.sql !== "string") {
    throw new Error("`sql` is required");
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "text/plain",
    },
    body: args.sql,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Cloudflare Analytics Engine HTTP ${res.status}: ${text}`);
  }

  // Response is ClickHouse-style JSON: { meta, data, rows, ... }
  let parsed: AnalyticsResult;
  try {
    parsed = JSON.parse(text) as AnalyticsResult;
  } catch {
    return { raw: text };
  }
  return {
    rows: parsed.rows ?? parsed.data?.length ?? 0,
    columns: parsed.meta?.map((m) => m.name) ?? [],
    data: parsed.data ?? [],
  };
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "ramble_analytics_schema":
      return SCHEMA_DOC;
    case "ramble_analytics_query":
      return rambleQuery(args as unknown as QueryArgs);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main() {
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
            serverInfo: { name: "ramble-mcp", version: "1.0.0" },
          };
          break;

        case "tools/list":
          response = { tools };
          break;

        case "tools/call": {
          const result = await handleToolCall(request.params.name, request.params.arguments || {});
          response = {
            content: [
              { type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) },
            ],
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
          error: { code: -32603, message: error instanceof Error ? error.message : "Unknown error" },
        }),
      );
    }
  }
}

main().catch(console.error);
