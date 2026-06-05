/**
 * One-time Strava OAuth bootstrap.
 *
 * Run locally to mint a long-lived refresh token for the agent's read-only
 * Strava access:
 *
 *   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... npx tsx scripts/strava-oauth-bootstrap.ts
 *
 * Opens a browser to Strava's authorization screen, captures the auth code on a
 * localhost callback, exchanges it for tokens, and prints the refresh token.
 * Save it as STRAVA_REFRESH_TOKEN in .env.local (for dev) and as a Fly secret
 * (for prod).
 *
 * Prereqs (one-time, at https://www.strava.com/settings/api):
 *   - Create an API application; copy the Client ID + Client Secret.
 *   - Set "Authorization Callback Domain" to: localhost
 *
 * Strava refresh tokens do not expire (and are not rotated on refresh), so this
 * only needs to run once unless you revoke access.
 */
import { config as loadEnv } from "dotenv";
import { createServer } from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";

// Load .env.local first (preferred for local-only secrets), then fall back to .env.
loadEnv({ path: ".env.local" });
loadEnv();

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const PORT = 53683;
const REDIRECT_URI = `http://localhost:${PORT}`;

// activity:read_all is needed to see all activities including private ones.
const SCOPE = "read,activity:read_all";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing STRAVA_CLIENT_ID and/or STRAVA_CLIENT_SECRET in env.");
  console.error("Set them in .env.local or export them, then re-run.");
  process.exit(1);
}

const authUrl =
  "https://www.strava.com/oauth/authorize?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    approval_prompt: "force",
    scope: SCOPE,
  }).toString();

console.log("\nOpening browser for Strava authorization...");
console.log("If it doesn't open, visit this URL manually:\n");
console.log(authUrl + "\n");

const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
exec(`${opener} "${authUrl}"`);

const server = createServer(async (req, res) => {
  if (!req.url) return;
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const scope = url.searchParams.get("scope");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`OAuth error: ${error}`);
    console.error(`\nOAuth error: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end("No code in callback.");
    return;
  }

  if (scope && !scope.includes("activity:read_all")) {
    console.warn(
      `\nWarning: granted scope is "${scope}" — without activity:read_all the agent can't read private activities.`,
    );
  }

  res.writeHead(200, { "Content-Type": "text/html" }).end(
    "<h1>Done.</h1><p>You can close this tab and return to your terminal.</p>",
  );
  server.close();

  try {
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      console.error(`\nToken exchange failed (HTTP ${tokenRes.status}):`, await tokenRes.text());
      process.exit(1);
    }
    const tokens = (await tokenRes.json()) as { refresh_token?: string };
    if (!tokens.refresh_token) {
      console.error("\nNo refresh_token returned. Try again with approval_prompt=force (already set).");
      process.exit(1);
    }
    console.log("\n=== SUCCESS ===\n");
    console.log("Save this in .env.local:");
    console.log(`STRAVA_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log("And set it as a Fly secret for production:");
    console.log(`fly secrets set STRAVA_REFRESH_TOKEN='${tokens.refresh_token}' -a jpos-agent\n`);
    console.log("(Also set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET on Fly if you haven't already.)");
    process.exit(0);
  } catch (err) {
    console.error("\nToken exchange failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on ${REDIRECT_URI} for the OAuth callback...\n`);
});
