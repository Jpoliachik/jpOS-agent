#!/usr/bin/env node
/**
 * Google Calendar MCP server.
 *
 * Uses a long-lived refresh token (minted once via scripts/google-oauth-bootstrap.ts)
 * to talk to the Calendar API on behalf of Justin's personal Google account.
 *
 * Two tools: gcal_agenda (read), gcal_create_event (write).
 */
import { google, calendar_v3 } from "googleapis";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const TIMEZONE = "America/New_York";

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("[google-mcp] Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
const calendar = google.calendar({ version: "v3", auth: oauth2 });

const tools = [
  {
    name: "gcal_agenda",
    description:
      "List upcoming events from the user's primary Google Calendar. Defaults to the next 48 hours from now in America/New_York. " +
      "Use this to see what's on the schedule for daily prep, conflict checks, or 'what do I have coming up' questions.",
    inputSchema: {
      type: "object",
      properties: {
        time_min: {
          type: "string",
          description: "Lower bound (ISO 8601). Defaults to now.",
        },
        time_max: {
          type: "string",
          description: "Upper bound (ISO 8601). Defaults to 48 hours from time_min.",
        },
        max_results: {
          type: "number",
          description: "Max events to return (default 20).",
        },
      },
    },
  },
  {
    name: "gcal_create_event",
    description:
      "Create a new event on the user's primary Google Calendar. Use for scheduling, reminders, blocks. " +
      "Times should be ISO 8601 strings; if you pass naive datetimes they're interpreted as America/New_York.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title." },
        start: { type: "string", description: "Start time, ISO 8601." },
        end: { type: "string", description: "End time, ISO 8601." },
        description: { type: "string", description: "Optional details/notes." },
        location: { type: "string", description: "Optional location string." },
      },
      required: ["summary", "start", "end"],
    },
  },
];

interface AgendaArgs {
  time_min?: string;
  time_max?: string;
  max_results?: number;
}

interface CreateEventArgs {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
}

function formatEvent(e: calendar_v3.Schema$Event): string {
  const start = e.start?.dateTime || e.start?.date || "?";
  const end = e.end?.dateTime || e.end?.date || "?";
  const title = e.summary || "(no title)";
  const loc = e.location ? ` @ ${e.location}` : "";
  return `- ${start} → ${end}: ${title}${loc}`;
}

async function gcalAgenda(args: AgendaArgs): Promise<string> {
  const timeMin = args.time_min || new Date().toISOString();
  const timeMax =
    args.time_max ||
    new Date(new Date(timeMin).getTime() + 48 * 60 * 60 * 1000).toISOString();

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    maxResults: args.max_results || 20,
    singleEvents: true,
    orderBy: "startTime",
    timeZone: TIMEZONE,
  });

  const events = res.data.items || [];
  if (events.length === 0) {
    return `No events between ${timeMin} and ${timeMax}.`;
  }
  return events.map(formatEvent).join("\n");
}

async function gcalCreateEvent(args: CreateEventArgs): Promise<unknown> {
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: args.summary,
      description: args.description,
      location: args.location,
      start: { dateTime: args.start, timeZone: TIMEZONE },
      end: { dateTime: args.end, timeZone: TIMEZONE },
    },
  });
  return {
    id: res.data.id,
    htmlLink: res.data.htmlLink,
    summary: res.data.summary,
    start: res.data.start,
    end: res.data.end,
  };
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "gcal_agenda":
      return gcalAgenda(args as AgendaArgs);
    case "gcal_create_event":
      return gcalCreateEvent(args as unknown as CreateEventArgs);
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
            serverInfo: { name: "google-mcp", version: "1.0.0" },
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
        })
      );
    }
  }
}

main().catch(console.error);
