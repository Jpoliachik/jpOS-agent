#!/usr/bin/env node
/**
 * Pages MCP Server
 *
 * Exposes the read-only page rendering layer to the agent:
 *   - publish_page:   save a structured page and return a signed URL
 *   - mint_page_link: re-mint a signed URL for an existing page
 *   - list_pages:     list recent pages
 *
 * Env:
 *   PAGE_SIGNING_SECRET (required) — HMAC secret for URL tokens
 *   PUBLIC_BASE_URL     (required) — e.g. https://jpos-agent.fly.dev
 *   PAGES_DIR           (optional) — defaults to /data/pages
 */

import { savePage, loadPage, listPages } from "../pages/store.js";
import { buildPageUrl } from "../pages/sign.js";
import { validatePage, PageValidationError } from "../pages/cards.js";

const CARD_DOC = `
Every card (except "divider") shares an optional shell:
  width?: "full" | "half"   // default "full". Halves pair into a 2-col grid.
  eyebrow?: string          // SHORT uppercase label (e.g. "TODAY", "WEATHER")
  icon?: Icon               // one of: star, sun, cloud, moon, diamond, clock,
                            //   calendar, arrow-right, check, quote,
                            //   bookmark, bolt, note, heart, flame
  meta?: string             // right-aligned tag (e.g. "4 ITEMS", "FROM YESTERDAY")

Card types (closed set — there is NO markdown escape hatch):

- { type: "prose", title: string, body?: string }
    General-purpose card. Short serif title (keep <60 chars).
    Optional 1–3 line description. Use for headings + intros + standalone notes.

- { type: "list", items: ListItem[], style?: "agenda"|"bullets"|"numbered" }
    ListItem = { text: string, lead?: string, trail?: string, href?: string }
    "agenda" style uses item.lead as a left-gutter time/marker.
    Use for agendas, reminders, links, todos — anything plural.

- { type: "weather", temp: string|number, unit?: "F"|"C",
    condition?: string, high?: string|number, low?: string|number }

- { type: "quote", text: string, source?: string }

- { type: "metric", label: string, value: string|number, delta?: string, hint?: string }
    Half-width by default fits nicely.

- { type: "divider" }   // No shell. Just a horizontal rule.

All text fields are PLAIN TEXT — no markdown, no HTML, no inline formatting.
Compress info into existing card types rather than asking for new escape hatches.
`.trim();

const tools = [
  {
    name: "publish_page",
    description:
      "Publish a read-only web page composed of structured cards, and return a signed " +
      "URL the user can open. Use this whenever the user asks for a brief, digest, dashboard, " +
      "or any rich layout that doesn't fit nicely in a chat message.\n\n" +
      `${CARD_DOC}\n\n` +
      "Slugs must be lowercase a-z, 0-9, '-' or '_', starting alphanumeric (e.g. " +
      "'2026-04-monthly', 'daily-2026-05-22'). Publishing the same slug overwrites the page.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description:
            "URL-safe identifier (lowercase a-z, 0-9, '-' or '_'). Re-using a slug " +
            "overwrites the existing page.",
        },
        title: { type: "string", description: "Page title (shown as <h1>)." },
        subtitle: {
          type: "string",
          description: "Optional italic subtitle under the title.",
        },
        meta: {
          type: "string",
          description:
            "Optional right-aligned uppercase meta in the page header (e.g. \"FRI · 22 MAY 2026\").",
        },
        cards: {
          type: "array",
          description: "Ordered list of cards. See tool description for card shapes.",
          items: { type: "object" },
        },
        ttl_days: {
          type: "number",
          description: "URL validity in days. Default 30. Max 365.",
        },
      },
      required: ["slug", "title", "cards"],
    },
  },
  {
    name: "mint_page_link",
    description:
      "Generate a fresh signed URL for a page that already exists. Use when the user " +
      "lost the original link or it expired.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Slug of the existing page." },
        ttl_days: {
          type: "number",
          description: "URL validity in days. Default 30. Max 365.",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "list_pages",
    description:
      "List recently published pages (most recent first). Useful when the user asks " +
      "what briefs/digests are available.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max pages to return (default 20)." },
      },
    },
  },
];

interface ToolArgs {
  slug?: string;
  title?: string;
  subtitle?: string;
  meta?: string;
  cards?: unknown;
  ttl_days?: number;
  limit?: number;
}

function clampTtl(input: unknown): number {
  const n = typeof input === "number" && Number.isFinite(input) ? input : 30;
  return Math.max(1, Math.min(365, Math.floor(n)));
}

function publicBaseUrl(): string {
  const u = process.env.PUBLIC_BASE_URL;
  if (!u) throw new Error("PUBLIC_BASE_URL env var is not set");
  return u;
}

async function handleToolCall(name: string, args: ToolArgs): Promise<unknown> {
  switch (name) {
    case "publish_page": {
      if (!args.slug || !args.title || !Array.isArray(args.cards)) {
        throw new Error("publish_page requires slug, title, and cards[]");
      }
      const page = validatePage({
        slug: args.slug,
        title: args.title,
        subtitle: args.subtitle,
        meta: args.meta,
        cards: args.cards,
      });
      savePage(page);
      const ttl = clampTtl(args.ttl_days);
      const url = buildPageUrl(publicBaseUrl(), page.slug, ttl);
      return {
        success: true,
        slug: page.slug,
        url,
        ttl_days: ttl,
        cards: page.cards.length,
      };
    }

    case "mint_page_link": {
      if (!args.slug) throw new Error("mint_page_link requires slug");
      const page = loadPage(args.slug);
      if (!page) throw new Error(`Page not found: ${args.slug}`);
      const ttl = clampTtl(args.ttl_days);
      return {
        slug: page.slug,
        url: buildPageUrl(publicBaseUrl(), page.slug, ttl),
        ttl_days: ttl,
      };
    }

    case "list_pages": {
      const pages = listPages(args.limit ?? 20);
      return { count: pages.length, pages };
    }

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
            serverInfo: { name: "pages-mcp", version: "1.0.0" },
          };
          break;

        case "tools/list":
          response = { tools };
          break;

        case "tools/call": {
          const result = await handleToolCall(
            request.params.name,
            request.params.arguments || {},
          );
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
      const message =
        error instanceof PageValidationError
          ? `Validation: ${error.message}`
          : error instanceof Error
            ? error.message
            : "Unknown error";
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          error: { code: -32603, message },
        }),
      );
    }
  }
}

main().catch(console.error);
