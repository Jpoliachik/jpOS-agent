#!/usr/bin/env node
/**
 * Strava MCP server.
 *
 * Read-only access to Justin's Strava activities (runs, rides, etc.) via the
 * Strava V3 API. Uses a long-lived refresh token (minted once via
 * scripts/strava-oauth-bootstrap.ts) to obtain short-lived access tokens.
 *
 * Two tools:
 *   - strava_recent_activities   — the most recent N activities
 *   - strava_activities_in_range — activities within a date range
 *
 * Strava access tokens expire every ~6 hours; we mint a fresh one from the
 * refresh token on first use and cache it for the lifetime of this process.
 * Strava does NOT rotate the refresh token on a refresh_token grant, so there's
 * nothing to persist back (which is good — this container is ephemeral).
 */

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN;
const TIMEZONE = "America/New_York";
const API_BASE = "https://www.strava.com/api/v3";

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("[strava-mcp] Missing STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, or STRAVA_REFRESH_TOKEN");
  process.exit(1);
}

const tools = [
  {
    name: "strava_recent_activities",
    description:
      "List Justin's most recent Strava activities (newest first). Use for 'how were my recent runs', " +
      "'what did I do this week on Strava', or pulling the latest workout. Each activity includes name, " +
      "sport type, date, distance (miles), moving time, pace (for runs/walks), elevation gain, and average " +
      "heart rate when recorded. Defaults to the 10 most recent activities of any type.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "How many recent activities to return (default 10, max 100)." },
        activity_type: {
          type: "string",
          description:
            "Optional filter by Strava sport type, e.g. 'Run', 'Ride', 'Walk', 'Hike', 'Swim', 'WeightTraining'. " +
            "Case-insensitive. Omit to include all types.",
        },
      },
    },
  },
  {
    name: "strava_activities_in_range",
    description:
      "List Justin's Strava activities within a date range (oldest first within the range). Use for " +
      "'my runs in May', 'activities between two dates', or summarizing a training block. Provide `after` " +
      "(start of range); `before` defaults to now. Dates are ISO 8601 (e.g. '2026-05-01' or " +
      "'2026-05-01T00:00:00') interpreted in America/New_York. Same per-activity fields as " +
      "strava_recent_activities.",
    inputSchema: {
      type: "object",
      properties: {
        after: { type: "string", description: "Start of range (inclusive), ISO 8601 date or datetime. Required." },
        before: { type: "string", description: "End of range (exclusive), ISO 8601. Defaults to now." },
        activity_type: {
          type: "string",
          description: "Optional Strava sport type filter (e.g. 'Run', 'Ride'). Case-insensitive. Omit for all types.",
        },
      },
      required: ["after"],
    },
  },
];

interface RecentArgs {
  count?: number;
  activity_type?: string;
}

interface RangeArgs {
  after: string;
  before?: string;
  activity_type?: string;
}

// Strava summary activity (subset of fields we care about).
interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  total_elevation_gain: number; // meters
  start_date_local: string; // ISO, already in the athlete's local TZ
  average_speed: number; // m/s
  max_speed: number; // m/s
  average_heartrate?: number;
  max_heartrate?: number;
}

let cachedAccessToken: string | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
    }),
  });
  if (!res.ok) {
    throw new Error(`Strava token refresh failed (HTTP ${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  cachedAccessToken = data.access_token;
  return cachedAccessToken;
}

async function fetchActivitiesPage(params: URLSearchParams): Promise<StravaActivity[]> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    throw new Error(
      "Strava returned 401 Unauthorized. The refresh token may be revoked or lack the 'activity:read_all' scope. " +
        "Re-run scripts/strava-oauth-bootstrap.ts to mint a new one.",
    );
  }
  if (!res.ok) {
    throw new Error(`Strava activities request failed (HTTP ${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as StravaActivity[];
}

function metersToMiles(m: number): number {
  return m / 1609.344;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

// min/mile pace from moving time + distance. Only meaningful for foot sports.
function formatPace(movingSeconds: number, meters: number): string | null {
  const miles = metersToMiles(meters);
  if (miles < 0.01) return null;
  const secPerMile = movingSeconds / miles;
  const m = Math.floor(secPerMile / 60);
  const s = Math.round(secPerMile % 60);
  return `${m}:${s.toString().padStart(2, "0")}/mi`;
}

const FOOT_SPORTS = new Set(["Run", "TrailRun", "Walk", "Hike", "VirtualRun"]);

function formatDate(iso: string): string {
  // start_date_local is already in the athlete's local timezone but carries a 'Z';
  // strip it so we don't double-shift, then present in America/New_York.
  const d = new Date(iso.replace(/Z$/, ""));
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

function summarize(a: StravaActivity): Record<string, unknown> {
  const miles = metersToMiles(a.distance);
  const isFoot = FOOT_SPORTS.has(a.sport_type) || FOOT_SPORTS.has(a.type);
  return {
    id: a.id,
    name: a.name,
    sport_type: a.sport_type || a.type,
    date: formatDate(a.start_date_local),
    distance_mi: Math.round(miles * 100) / 100,
    moving_time: formatDuration(a.moving_time),
    ...(isFoot ? { pace: formatPace(a.moving_time, a.distance) } : {}),
    elevation_gain_ft: Math.round(a.total_elevation_gain * 3.28084),
    ...(a.average_heartrate ? { avg_hr: Math.round(a.average_heartrate) } : {}),
  };
}

function matchesType(a: StravaActivity, filter?: string): boolean {
  if (!filter) return true;
  const f = filter.toLowerCase();
  return a.sport_type?.toLowerCase() === f || a.type?.toLowerCase() === f;
}

async function recentActivities(args: RecentArgs): Promise<unknown> {
  const count = Math.min(Math.max(args.count ?? 10, 1), 100);
  const filter = args.activity_type;

  // Without a type filter we can ask Strava for exactly `count`. With a filter,
  // over-fetch a bit so filtering still yields a useful number, capped at one page.
  const perPage = filter ? Math.min(count * 5, 200) : count;
  const params = new URLSearchParams({ per_page: String(perPage), page: "1" });
  const page = await fetchActivitiesPage(params);
  const filtered = page.filter((a) => matchesType(a, filter)).slice(0, count);

  if (filtered.length === 0) {
    return { count: 0, message: filter ? `No recent '${filter}' activities found.` : "No recent activities found." };
  }
  return { count: filtered.length, activities: filtered.map(summarize) };
}

async function activitiesInRange(args: RangeArgs): Promise<unknown> {
  const afterDate = new Date(args.after.replace(/Z$/, ""));
  if (isNaN(afterDate.getTime())) {
    throw new Error(`Invalid 'after' date: ${args.after}`);
  }
  const beforeDate = args.before ? new Date(args.before.replace(/Z$/, "")) : new Date();
  if (isNaN(beforeDate.getTime())) {
    throw new Error(`Invalid 'before' date: ${args.before}`);
  }
  const after = Math.floor(afterDate.getTime() / 1000);
  const before = Math.floor(beforeDate.getTime() / 1000);
  const filter = args.activity_type;

  // Page through the range (Strava caps per_page at 200). Guard against runaway
  // loops with a hard page cap — a single date range shouldn't exceed this.
  const all: StravaActivity[] = [];
  const MAX_PAGES = 10;
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const params = new URLSearchParams({
      after: String(after),
      before: String(before),
      per_page: "200",
      page: String(pageNum),
    });
    const page = await fetchActivitiesPage(params);
    all.push(...page);
    if (page.length < 200) break;
  }

  const filtered = all.filter((a) => matchesType(a, filter));
  // Strava returns range queries newest-first; present oldest-first for a readable timeline.
  filtered.sort((a, b) => a.start_date_local.localeCompare(b.start_date_local));

  if (filtered.length === 0) {
    return {
      count: 0,
      message: `No${filter ? ` '${filter}'` : ""} activities between ${args.after} and ${args.before || "now"}.`,
    };
  }

  const totalMiles = filtered.reduce((sum, a) => sum + metersToMiles(a.distance), 0);
  return {
    count: filtered.length,
    total_distance_mi: Math.round(totalMiles * 100) / 100,
    activities: filtered.map(summarize),
  };
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "strava_recent_activities":
      return recentActivities(args as RecentArgs);
    case "strava_activities_in_range":
      return activitiesInRange(args as unknown as RangeArgs);
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
            serverInfo: { name: "strava-mcp", version: "1.0.0" },
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
