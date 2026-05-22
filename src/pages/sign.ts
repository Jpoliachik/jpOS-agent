/**
 * Signed URL tokens for page access.
 *
 * Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 * Payload: { slug, exp }  (exp = unix seconds)
 *
 * The signing secret is read from PAGE_SIGNING_SECRET env var. Rotating the
 * secret invalidates every outstanding link — the cheapest revocation.
 */

import crypto from "node:crypto";

const DEFAULT_TTL_DAYS = 30;

interface Payload {
  slug: string;
  exp: number;
}

function getSecret(): string {
  const s = process.env.PAGE_SIGNING_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "PAGE_SIGNING_SECRET env var must be set and at least 16 chars",
    );
  }
  return s;
}

// Custom URL-safe base64 variant: standard base64url alphabet but with `~`
// substituted for `_`. Reason: Telegram's "Markdown" parse mode treats `_x_`
// as italics and STRIPS the underscores from the rendered text, which
// truncates tokens in DMs. `~` is RFC-3986 unreserved (URL-safe) and has no
// Markdown meaning.
function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf-8") : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "~")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const padded =
    s.replace(/-/g, "+").replace(/~/g, "/") + "==".slice((s.length + 2) % 4);
  return Buffer.from(padded, "base64");
}

function hmac(payloadB64: string): string {
  return b64urlEncode(
    crypto.createHmac("sha256", getSecret()).update(payloadB64).digest(),
  );
}

export function signToken(slug: string, ttlDays: number = DEFAULT_TTL_DAYS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;
  const payload: Payload = { slug, exp };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  return `${payloadB64}.${hmac(payloadB64)}`;
}

export interface VerifyResult {
  ok: boolean;
  /** Failure reason — only set when ok=false. */
  reason?: "malformed" | "bad-signature" | "expired" | "slug-mismatch";
  payload?: Payload;
}

/**
 * Verify a token. If `expectedSlug` is given, the payload slug must match
 * (prevents using token A on page B).
 */
export function verifyToken(token: string, expectedSlug?: string): VerifyResult {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sig] = token.split(".", 2);
  if (!payloadB64 || !sig) return { ok: false, reason: "malformed" };

  const expectedSig = hmac(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }

  let payload: Payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf-8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.slug !== "string" || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (expectedSlug && payload.slug !== expectedSlug) {
    return { ok: false, reason: "slug-mismatch" };
  }
  if (Math.floor(Date.now() / 1000) >= payload.exp) {
    return { ok: false, reason: "expired", payload };
  }
  return { ok: true, payload };
}

export function buildPageUrl(baseUrl: string, slug: string, ttlDays?: number): string {
  const token = signToken(slug, ttlDays);
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/page/${encodeURIComponent(slug)}?t=${token}`;
}
