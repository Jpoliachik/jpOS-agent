/**
 * One-time Google OAuth bootstrap.
 *
 * Run locally to mint a long-lived refresh token for the agent's Google Calendar access:
 *
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npx tsx scripts/google-oauth-bootstrap.ts
 *
 * Opens a browser to Google's consent screen, captures the auth code on a localhost
 * callback, exchanges it for tokens, and prints the refresh token. Save it as
 * GOOGLE_REFRESH_TOKEN in .env.local (for dev) and as a Fly secret (for prod).
 *
 * The OAuth app must be published ("In production"), not in Testing mode — otherwise
 * the refresh token expires after 7 days.
 */
import { config as loadEnv } from "dotenv";
import { google } from "googleapis";
import { createServer } from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";

// Load .env.local first (preferred for local-only secrets), then fall back to .env.
loadEnv({ path: ".env.local" });
loadEnv();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET in env.");
  console.error("Set them in .env.local or export them, then re-run.");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("\nOpening browser for Google consent...");
console.log("If it doesn't open, visit this URL manually:\n");
console.log(authUrl + "\n");

const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
exec(`${opener} "${authUrl}"`);

const server = createServer(async (req, res) => {
  if (!req.url) return;
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

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

  res.writeHead(200, { "Content-Type": "text/html" }).end(
    "<h1>Done.</h1><p>You can close this tab and return to your terminal.</p>"
  );
  server.close();

  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      console.error("\nNo refresh_token returned. This usually means you've consented before.");
      console.error("Revoke the app at https://myaccount.google.com/permissions and try again.");
      process.exit(1);
    }
    console.log("\n=== SUCCESS ===\n");
    console.log("Save this in .env.local:");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log("And set it as a Fly secret for production:");
    console.log(`fly secrets set GOOGLE_REFRESH_TOKEN='${tokens.refresh_token}' -a jpos-agent\n`);
    console.log("(Also set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on Fly if you haven't already.)");
    process.exit(0);
  } catch (err) {
    console.error("\nToken exchange failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on ${REDIRECT_URI} for the OAuth callback...\n`);
});
