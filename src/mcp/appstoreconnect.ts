#!/usr/bin/env node
/**
 * App Store Connect MCP Server
 * Provides tools for querying app analytics, sales reports, and app info
 * from the App Store Connect API.
 *
 * Authentication uses JWT (ES256) with a .p8 private key.
 * Required env vars:
 *   - APP_STORE_CONNECT_KEY_ID: API Key ID
 *   - APP_STORE_CONNECT_ISSUER_ID: Issuer ID
 *   - APP_STORE_CONNECT_P8_KEY: Contents of the .p8 private key file
 *   - APP_STORE_CONNECT_VENDOR_NUMBER: Vendor number (for sales reports)
 */

import * as crypto from "node:crypto";

const KEY_ID = process.env.APP_STORE_CONNECT_KEY_ID || "";
const ISSUER_ID = process.env.APP_STORE_CONNECT_ISSUER_ID || "";
const P8_KEY = process.env.APP_STORE_CONNECT_P8_KEY || "";
const VENDOR_NUMBER = process.env.APP_STORE_CONNECT_VENDOR_NUMBER || "";
const API_BASE = "https://api.appstoreconnect.apple.com";

// --- JWT Generation ---

function generateJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: KEY_ID,
    typ: "JWT",
  };
  const payload = {
    iss: ISSUER_ID,
    iat: now,
    exp: now + 1200, // 20 minutes
    aud: "appstoreconnect-v1",
  };

  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const headerEncoded = encode(header);
  const payloadEncoded = encode(payload);
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  const sign = crypto.createSign("SHA256");
  sign.update(signingInput);
  sign.end();

  // The P8 key is a PEM-encoded PKCS#8 EC private key
  const key = P8_KEY.includes("BEGIN PRIVATE KEY")
    ? P8_KEY
    : `-----BEGIN PRIVATE KEY-----\n${P8_KEY}\n-----END PRIVATE KEY-----`;

  const signature = sign.sign(key);

  // Convert DER signature to raw r||s format for ES256
  const derToRaw = (der: Buffer): Buffer => {
    // DER structure: 0x30 [len] 0x02 [rlen] [r] 0x02 [slen] [s]
    let offset = 2; // skip 0x30 and length byte
    if (der[1]! > 0x80) offset += der[1]! - 0x80; // handle multi-byte length

    // Read r
    offset++; // skip 0x02
    const rLen = der[offset]!;
    offset++;
    let r = der.subarray(offset, offset + rLen);
    offset += rLen;

    // Read s
    offset++; // skip 0x02
    const sLen = der[offset]!;
    offset++;
    let s = der.subarray(offset, offset + sLen);

    // Strip leading zeros (DER adds padding for positive sign)
    if (r.length === 33 && r[0] === 0) r = r.subarray(1);
    if (s.length === 33 && s[0] === 0) s = s.subarray(1);

    // Pad to 32 bytes if needed
    const padded = Buffer.alloc(64);
    r.copy(padded, 32 - r.length);
    s.copy(padded, 64 - s.length);
    return padded;
  };

  const rawSig = derToRaw(signature);
  const signatureEncoded = rawSig.toString("base64url");

  return `${signingInput}.${signatureEncoded}`;
}

// --- API Request Helper ---

async function ascRequest(
  path: string,
  options: {
    accept?: string;
    rawResponse?: boolean;
  } = {}
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const token = generateJWT();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    if (options.accept) {
      headers["Accept"] = options.accept;
    }

    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `App Store Connect API error: ${response.status} ${response.statusText}\n${body}`
      );
    }

    if (options.rawResponse) {
      return await response.text();
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ascPost(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const token = generateJWT();
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const respBody = await response.text();
      throw new Error(
        `App Store Connect API error: ${response.status} ${response.statusText}\n${respBody}`
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- Gzip decompression for sales reports ---

async function decompressGzip(buffer: ArrayBuffer): Promise<string> {
  const { gunzipSync } = await import("node:zlib");
  return gunzipSync(Buffer.from(buffer)).toString("utf-8");
}

// --- Tool Definitions ---

const tools = [
  {
    name: "appstore_list_apps",
    description:
      "List all apps in your App Store Connect account. Returns app IDs, names, bundle IDs, and SKUs. Use this to get app IDs needed for other tools.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of apps to return (default 50)",
        },
      },
    },
  },
  {
    name: "appstore_get_app",
    description:
      "Get detailed info about a specific app by its App Store Connect ID.",
    inputSchema: {
      type: "object",
      properties: {
        app_id: { type: "string", description: "The App Store Connect app ID" },
      },
      required: ["app_id"],
    },
  },
  {
    name: "appstore_sales_report",
    description:
      "Download a sales and trends report. Returns data about app units sold, proceeds, in-app purchases, etc. The response is a tab-separated report with columns like Provider, Provider Country, SKU, Developer, Title, Version, Product Type Identifier, Units, Developer Proceeds, Currency, and more.",
    inputSchema: {
      type: "object",
      properties: {
        report_type: {
          type: "string",
          enum: [
            "SALES",
            "SUBSCRIPTION",
            "SUBSCRIPTION_EVENT",
            "SUBSCRIBER",
            "PRE_ORDER",
          ],
          description: "Type of report (default: SALES)",
        },
        report_sub_type: {
          type: "string",
          enum: ["SUMMARY", "DETAILED", "OPT_IN"],
          description: "Sub-type of report (default: SUMMARY)",
        },
        frequency: {
          type: "string",
          enum: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"],
          description: "Report frequency (default: DAILY)",
        },
        report_date: {
          type: "string",
          description:
            "Report date in YYYY-MM-DD format. For daily reports, specific day. For weekly, any day in that week. Defaults to most recent available.",
        },
      },
    },
  },
  {
    name: "appstore_analytics_request",
    description:
      "Create an analytics report request for an app, or list existing requests. This is the first step to access analytics data. You must create an ONGOING request once per app, then reports become available daily (first report takes 1-2 days to generate).",
    inputSchema: {
      type: "object",
      properties: {
        app_id: {
          type: "string",
          description: "The App Store Connect app ID",
        },
        action: {
          type: "string",
          enum: ["create", "list"],
          description:
            "Whether to create a new request or list existing ones (default: list)",
        },
        access_type: {
          type: "string",
          enum: ["ONGOING", "ONE_TIME_SNAPSHOT"],
          description: "Type of analytics access (default: ONGOING)",
        },
      },
      required: ["app_id"],
    },
  },
  {
    name: "appstore_analytics_reports",
    description:
      "List available analytics reports for a given report request. Reports include categories like App Store Engagement, App Store Commerce (downloads, purchases), App Usage (installs/deletions, sessions, crashes), and more.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: {
          type: "string",
          description:
            "The analytics report request ID (from appstore_analytics_request)",
        },
        category: {
          type: "string",
          enum: [
            "APP_USAGE",
            "APP_STORE_ENGAGEMENT",
            "APP_STORE_COMMERCE",
            "APP_IN_BACKGROUND_EVENTS",
            "PERFORMANCE",
            "FRAMEWORKS_STOREKIT",
          ],
          description: "Filter by report category",
        },
        name: {
          type: "string",
          description:
            'Filter by report name (e.g., "App Installations and Deletions", "App Store Commerce")',
        },
      },
      required: ["request_id"],
    },
  },
  {
    name: "appstore_analytics_instances",
    description:
      "List report instances for a specific analytics report. Each instance represents a day/week/month of data. Use this to find a specific date's data to download.",
    inputSchema: {
      type: "object",
      properties: {
        report_id: {
          type: "string",
          description:
            "The analytics report ID (from appstore_analytics_reports)",
        },
        granularity: {
          type: "string",
          enum: ["DAILY", "WEEKLY", "MONTHLY"],
          description: "Filter by time granularity (default: DAILY)",
        },
        limit: {
          type: "number",
          description:
            "Max number of instances to return (default 30, most recent first)",
        },
      },
      required: ["report_id"],
    },
  },
  {
    name: "appstore_analytics_download",
    description:
      "Download the actual analytics data for a specific report instance. Returns CSV data with the analytics metrics.",
    inputSchema: {
      type: "object",
      properties: {
        instance_id: {
          type: "string",
          description:
            "The analytics report instance ID (from appstore_analytics_instances)",
        },
      },
      required: ["instance_id"],
    },
  },
];

// --- Tool Handlers ---

async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "appstore_list_apps": {
      const limit = (args.limit as number) || 50;
      const data = await ascRequest(
        `/v1/apps?limit=${limit}&fields[apps]=name,bundleId,sku,primaryLocale`
      );
      const response = data as {
        data: Array<{
          id: string;
          attributes: { name: string; bundleId: string; sku: string };
        }>;
      };
      return response.data.map((app) => ({
        id: app.id,
        name: app.attributes.name,
        bundleId: app.attributes.bundleId,
        sku: app.attributes.sku,
      }));
    }

    case "appstore_get_app": {
      const data = await ascRequest(`/v1/apps/${args.app_id}`);
      return data;
    }

    case "appstore_sales_report": {
      const reportType = (args.report_type as string) || "SALES";
      const reportSubType = (args.report_sub_type as string) || "SUMMARY";
      const frequency = (args.frequency as string) || "DAILY";

      if (!VENDOR_NUMBER) {
        throw new Error(
          "APP_STORE_CONNECT_VENDOR_NUMBER is required for sales reports. " +
            "Find your vendor number in App Store Connect under 'Payments and Financial Reports'."
        );
      }

      let url = `/v1/salesReports?filter[reportType]=${reportType}&filter[reportSubType]=${reportSubType}&filter[frequency]=${frequency}&filter[vendorNumber]=${VENDOR_NUMBER}`;

      if (args.report_date) {
        url += `&filter[reportDate]=${args.report_date}`;
      }

      // Sales reports return gzipped data
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

      try {
        const token = generateJWT();
        const response = await fetch(`${API_BASE}${url}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/a-gzip",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `App Store Connect API error: ${response.status} ${response.statusText}\n${body}`
          );
        }

        const buffer = await response.arrayBuffer();
        const text = await decompressGzip(buffer);

        // Parse TSV into structured data
        const lines = text.trim().split("\n");
        if (lines.length < 2) {
          return { raw: text, message: "Report returned but has no data rows" };
        }

        const headers = lines[0]!.split("\t");
        const rows = lines.slice(1).map((line) => {
          const values = line.split("\t");
          const row: Record<string, string> = {};
          headers.forEach((header, i) => {
            row[header.trim()] = (values[i] || "").trim();
          });
          return row;
        });

        return {
          report_type: reportType,
          frequency,
          row_count: rows.length,
          columns: headers.map((h) => h.trim()),
          data: rows,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }

    case "appstore_analytics_request": {
      const appId = args.app_id as string;
      const action = (args.action as string) || "list";

      if (action === "create") {
        const accessType = (args.access_type as string) || "ONGOING";
        return ascPost("/v1/analyticsReportRequests", {
          data: {
            type: "analyticsReportRequests",
            attributes: {
              accessType: accessType,
            },
            relationships: {
              app: {
                data: {
                  type: "apps",
                  id: appId,
                },
              },
            },
          },
        });
      }

      // List existing requests
      const data = await ascRequest(
        `/v1/apps/${appId}/analyticsReportRequests?filter[accessType]=ONGOING`
      );
      return data;
    }

    case "appstore_analytics_reports": {
      const requestId = args.request_id as string;
      let url = `/v1/analyticsReportRequests/${requestId}/reports`;

      const params: string[] = [];
      if (args.category) {
        params.push(`filter[category]=${args.category}`);
      }
      if (args.name) {
        params.push(`filter[name]=${encodeURIComponent(args.name as string)}`);
      }
      if (params.length > 0) {
        url += `?${params.join("&")}`;
      }

      const data = await ascRequest(url);
      const response = data as {
        data: Array<{
          id: string;
          attributes: { name: string; category: string };
        }>;
      };
      return response.data.map((report) => ({
        id: report.id,
        name: report.attributes.name,
        category: report.attributes.category,
      }));
    }

    case "appstore_analytics_instances": {
      const reportId = args.report_id as string;
      const granularity = (args.granularity as string) || "DAILY";
      const limit = (args.limit as number) || 30;

      const url = `/v1/analyticsReports/${reportId}/instances?filter[granularity]=${granularity}&limit=${limit}`;
      const data = await ascRequest(url);
      const response = data as {
        data: Array<{
          id: string;
          attributes: { granularity: string; processingDate: string };
        }>;
      };
      return response.data.map((instance) => ({
        id: instance.id,
        granularity: instance.attributes.granularity,
        processingDate: instance.attributes.processingDate,
      }));
    }

    case "appstore_analytics_download": {
      const instanceId = args.instance_id as string;

      // Get segments for this instance
      const segData = await ascRequest(
        `/v1/analyticsReportInstances/${instanceId}/segments`
      );
      const segResponse = segData as {
        data: Array<{
          id: string;
          attributes: { url: string; checksum: string; sizeInBytes: number };
        }>;
      };

      if (!segResponse.data || segResponse.data.length === 0) {
        return {
          message:
            "No segments available for this instance yet. Reports may take 1-2 days to generate after the initial request.",
        };
      }

      // Download all segments and combine
      const results: string[] = [];
      for (const segment of segResponse.data) {
        const downloadUrl = segment.attributes.url;
        if (!downloadUrl) continue;

        // Segment URLs are direct download links (often gzipped CSV on AWS)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60_000);
        try {
          const response = await fetch(downloadUrl, {
            signal: controller.signal,
          });
          if (!response.ok) {
            results.push(
              `Error downloading segment ${segment.id}: ${response.status}`
            );
            continue;
          }

          const buffer = await response.arrayBuffer();
          // Try to decompress, fall back to raw text
          try {
            results.push(await decompressGzip(buffer));
          } catch {
            results.push(Buffer.from(buffer).toString("utf-8"));
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }

      return {
        segment_count: segResponse.data.length,
        data: results.join("\n"),
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- MCP Server (stdio) ---

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
            serverInfo: { name: "appstoreconnect-mcp", version: "1.0.0" },
          };
          break;

        case "tools/list":
          response = { tools };
          break;

        case "tools/call": {
          const result = await handleToolCall(
            request.params.name,
            request.params.arguments || {}
          );
          response = {
            content: [
              { type: "text", text: JSON.stringify(result, null, 2) },
            ],
          };
          break;
        }

        default:
          response = {
            error: { code: -32601, message: "Method not found" },
          };
      }

      console.log(
        JSON.stringify({ jsonrpc: "2.0", id: request.id, result: response })
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          error: {
            code: -32603,
            message:
              error instanceof Error ? error.message : "Unknown error",
          },
        })
      );
    }
  }
}

main().catch(console.error);
