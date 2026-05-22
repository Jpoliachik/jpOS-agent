#!/usr/bin/env node
/**
 * Weather MCP server.
 *
 * Single tool: `weather_today` — current conditions, daily hi/lo, and
 * sunrise/sunset for Wilmington, NC via the free Open-Meteo API (no key).
 */

const LAT = 34.2257;
const LON = -77.9447;
const TIMEZONE = "America/New_York";

const WMO: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "heavy showers",
  82: "violent showers",
  95: "thunderstorm",
  96: "thunderstorm w/ hail",
  99: "severe thunderstorm",
};

const tools = [
  {
    name: "weather_today",
    description:
      "Get today's weather for Wilmington, NC: current temp + conditions, daily " +
      "high/low, sunrise, and sunset. No arguments. Uses Open-Meteo (no API key).",
    inputSchema: { type: "object", properties: {} },
  },
];

interface WeatherResponse {
  current: { temperature_2m: number; weather_code: number };
  daily: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise: string[];
    sunset: string[];
    weather_code: number[];
  };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

async function weatherToday(): Promise<unknown> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&current=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,weather_code` +
    `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(TIMEZONE)}&forecast_days=1`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as WeatherResponse;

  const currentTemp = Math.round(data.current.temperature_2m);
  const hi = Math.round(data.daily.temperature_2m_max[0]);
  const lo = Math.round(data.daily.temperature_2m_min[0]);
  const condition = WMO[data.daily.weather_code[0]] || "unknown";
  const sunrise = formatTime(data.daily.sunrise[0]);
  const sunset = formatTime(data.daily.sunset[0]);

  return {
    location: "Wilmington, NC",
    current_temp_f: currentTemp,
    high_f: hi,
    low_f: lo,
    conditions: condition,
    sunrise,
    sunset,
    summary: `${currentTemp}°F now, ${condition}. High ${hi}° / low ${lo}°. Sunrise ${sunrise}, sunset ${sunset}.`,
  };
}

async function handleToolCall(name: string): Promise<unknown> {
  switch (name) {
    case "weather_today":
      return weatherToday();
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
            serverInfo: { name: "weather-mcp", version: "1.0.0" },
          };
          break;

        case "tools/list":
          response = { tools };
          break;

        case "tools/call": {
          const result = await handleToolCall(request.params.name);
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
