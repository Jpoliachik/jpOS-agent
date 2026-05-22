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
    name: "gcal_list_calendars",
    description:
      "List all calendars attached to the user's Google account (owned, shared, subscribed). " +
      "Returns each calendar's id, name, primary flag, access role, and whether it's currently selected in the UI. " +
      "Call this once to discover calendar IDs, then remember them (with category=\"reference\") so future calls can target the right calendar.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "gcal_agenda",
    description:
      "List upcoming events from one or more Google Calendars. Defaults to the next 48 hours across all calendars currently selected (visible) in the user's UI. " +
      "Pass calendar_ids to target specific calendars (e.g. just work, just family). Events are prefixed with the calendar name so multi-calendar results stay legible. " +
      "Use for daily prep, conflict checks, and 'what's on my plate' questions.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_ids: {
          type: "array",
          items: { type: "string" },
          description: "Specific calendar IDs to query. Omit to use all selected calendars.",
        },
        time_min: { type: "string", description: "Lower bound (ISO 8601). Defaults to now." },
        time_max: { type: "string", description: "Upper bound (ISO 8601). Defaults to 48 hours from time_min." },
        max_results: { type: "number", description: "Max events per calendar (default 20)." },
      },
    },
  },
  {
    name: "gcal_create_event",
    description:
      "Create a new event on a specific Google Calendar. Defaults to the primary calendar; pass calendar_id to route work/family/etc. events to the right calendar. " +
      "Times should be ISO 8601 strings; naive datetimes are interpreted as America/New_York.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title." },
        start: { type: "string", description: "Start time, ISO 8601." },
        end: { type: "string", description: "End time, ISO 8601." },
        calendar_id: { type: "string", description: "Calendar ID to create the event on. Defaults to 'primary'." },
        description: { type: "string", description: "Optional details/notes." },
        location: { type: "string", description: "Optional location string." },
      },
      required: ["summary", "start", "end"],
    },
  },
];

interface AgendaArgs {
  calendar_ids?: string[];
  time_min?: string;
  time_max?: string;
  max_results?: number;
}

interface CreateEventArgs {
  summary: string;
  start: string;
  end: string;
  calendar_id?: string;
  description?: string;
  location?: string;
}

function formatEvent(e: calendar_v3.Schema$Event, calendarName: string): string {
  const start = e.start?.dateTime || e.start?.date || "?";
  const end = e.end?.dateTime || e.end?.date || "?";
  const title = e.summary || "(no title)";
  const loc = e.location ? ` @ ${e.location}` : "";
  return `- [${calendarName}] ${start} → ${end}: ${title}${loc}`;
}

async function gcalListCalendars(): Promise<unknown> {
  const res = await calendar.calendarList.list({ maxResults: 250 });
  const items = res.data.items || [];
  return items.map((c) => ({
    id: c.id,
    summary: c.summary,
    summaryOverride: c.summaryOverride,
    primary: c.primary || false,
    selected: c.selected || false,
    accessRole: c.accessRole,
    backgroundColor: c.backgroundColor,
  }));
}

async function gcalAgenda(args: AgendaArgs): Promise<string> {
  const timeMin = args.time_min || new Date().toISOString();
  const timeMax =
    args.time_max ||
    new Date(new Date(timeMin).getTime() + 48 * 60 * 60 * 1000).toISOString();
  const maxResults = args.max_results || 20;

  // Resolve target calendars: explicit list, or all currently-selected from CalendarList.
  let targets: Array<{ id: string; name: string }>;
  if (args.calendar_ids && args.calendar_ids.length > 0) {
    targets = args.calendar_ids.map((id) => ({ id, name: id }));
  } else {
    const list = await calendar.calendarList.list({ maxResults: 250 });
    targets = (list.data.items || [])
      .filter((c) => c.selected && c.id)
      .map((c) => ({ id: c.id as string, name: c.summaryOverride || c.summary || c.id as string }));
  }

  if (targets.length === 0) {
    return "No calendars to query (none selected, or none provided).";
  }

  // Fan out: one events.list per calendar, then merge + sort.
  const results = await Promise.all(
    targets.map(async (t) => {
      try {
        const res = await calendar.events.list({
          calendarId: t.id,
          timeMin,
          timeMax,
          maxResults,
          singleEvents: true,
          orderBy: "startTime",
          timeZone: TIMEZONE,
        });
        return (res.data.items || []).map((e) => ({ event: e, calendarName: t.name }));
      } catch (err) {
        console.error(`[google-mcp] events.list failed for ${t.id}:`, err instanceof Error ? err.message : err);
        return [];
      }
    }),
  );

  const merged = results.flat().sort((a, b) => {
    const aStart = a.event.start?.dateTime || a.event.start?.date || "";
    const bStart = b.event.start?.dateTime || b.event.start?.date || "";
    return aStart.localeCompare(bStart);
  });

  if (merged.length === 0) {
    return `No events between ${timeMin} and ${timeMax} across ${targets.length} calendar(s).`;
  }
  return merged.map(({ event, calendarName }) => formatEvent(event, calendarName)).join("\n");
}

async function gcalCreateEvent(args: CreateEventArgs): Promise<unknown> {
  const res = await calendar.events.insert({
    calendarId: args.calendar_id || "primary",
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
    case "gcal_list_calendars":
      return gcalListCalendars();
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
