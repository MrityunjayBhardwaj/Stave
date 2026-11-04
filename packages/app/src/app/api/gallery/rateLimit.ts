import { createHash, createHmac } from "node:crypto";

import { accountHashOf, sessionClaim } from "./session";
import { galleryStore, getJson, putJson, type GalleryBlobStore } from "./store";

/*
 * #2330 — how often one account (or, signed out, one address) may write.
 *
 *   rateLimit(key, windowSeconds, max) → { ok: true, count } | { ok: false, retryAfter }
 *       Fixed windows: the window a moment falls in starts at
 *       floor(now / windowSeconds) * windowSeconds. Each call counts one; the
 *       (max + 1)th call in a window is refused, and `retryAfter` is the whole
 *       seconds until that window ends.
 *
 *   limitAccount(name, accountHash) / limitAuthor(name, authorId) / limitRequest(name, req)
 *       → the 429 Response to send, or null to go on. One line at the top of a
 *       route: `const limited = await limitAccount("publish", hash); if (limited) return limited;`
 *       limitRequest keys on the signed-in account when there is one, else on
 *       the hashed address (anonymous link creation and reports).
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 *
 * One small private record per key, in the gallery store:
 *
 *   gallery/rate-limits/<sha256(key)>.json   { windowStart, count }
 *
 * The record holds the CURRENT window only; the first call in a new window
 * overwrites it, so nothing piles up. That is one Blob read and one Blob write
 * per limited request. At the gallery's volume (a handful of writes an hour per
 * person) that is fine, and cheaper than a database we don't run yet. Blob has
 * no compare-and-set, so two requests from one account at the same instant can
 * both read the same count and the limit can be overshot by the number racing;
 * a burst wider than that is still refused. When the gallery moves to Postgres
 * (#2306's later stage), this moves with it: a row per key with an atomic
 * upsert, behind this same `rateLimit` function, and no route changes.
 *
 * When the store can't be read or written, the request is let through with a
 * warning in the log: a limiter outage should not take publishing down with it,
 * and the outer per-address Firewall rules (docs: "Limits") still apply.
 *
 * Addresses are never stored as they are: the key is an HMAC of the address
 * with AUTH_SECRET (plain SHA-256 when it isn't set), so the store can't be
 * turned back into a list of addresses by hashing every IPv4 address.
 */

type Env = Record<string, string | undefined>;

export interface RateLimitRule {
  windowSeconds: number;
  max: number;
}

/**
 * The limits, per account (or per address when signed out). Generous for a
 * person, small for a script: the point is to cap a runaway or hostile client,
 * not to ration anyone. Changing a number here is the whole change.
 *
 * In tests (and for an emergency raise) each `max` can be overridden with
 * STAVE_RATE_LIMIT_<NAME>, e.g. STAVE_RATE_LIMIT_PUBLISH=1000. Only a positive
 * whole number counts; anything else keeps the value below.
 */
export const RATE_LIMITS = {
  /** POST /api/gallery — a new entry. */
  publish: { windowSeconds: 3600, max: 10 },
  /** POST /api/gallery/<id>/report — per account, or per address signed out. */
  report: { windowSeconds: 3600, max: 20 },
  /** Profile and collection writes: PUT author, POST/PUT/DELETE collections. */
  edit: { windowSeconds: 3600, max: 60 },
  /** POST /api/share — a private short link. Per account, or per address signed out. */
  link: { windowSeconds: 3600, max: 30 },
  /** POST /api/gallery/claim — bring this browser's shares into the account. */
  claim: { windowSeconds: 3600, max: 10 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** The rule in force: the table's, with the env override applied. */
export function ruleFor(name: RateLimitName, env: Env = process.env): RateLimitRule {
  const base = RATE_LIMITS[name];
  const raw = env[`STAVE_RATE_LIMIT_${name.toUpperCase()}`];
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return { windowSeconds: base.windowSeconds, max: Number.isSafeInteger(n) && n > 0 ? n : base.max };
}

export type RateLimitResult = { ok: true; count: number } | { ok: false; retryAfter: number };

interface CounterRecord {
  /** Start of the window, seconds since epoch. */
  windowStart: number;
  count: number;
}

export const rateLimitPath = (key: string) =>
  `gallery/rate-limits/${createHash("sha256").update(key, "utf8").digest("hex")}.json`;

/** Count one call against `key`. See the header for the window and storage rules. */
export async function rateLimit(
  key: string,
  windowSeconds: number,
  max: number,
  store: GalleryBlobStore | null = galleryStore(),
): Promise<RateLimitResult> {
  if (!store) return { ok: true, count: 0 };
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const file = rateLimitPath(key);
  try {
    const held = await getJson<CounterRecord>(store, file);
    const count = held && held.windowStart === windowStart ? held.count : 0;
    if (count >= max) return { ok: false, retryAfter: Math.max(1, windowStart + windowSeconds - now) };
    await putJson(store, file, { windowStart, count: count + 1 } satisfies CounterRecord);
    return { ok: true, count: count + 1 };
  } catch (err) {
    console.warn("[stave] rate limit store unavailable; letting the request through:", err);
    return { ok: true, count: 0 };
  }
}

const WHAT: Record<RateLimitName, string> = {
  publish: "published",
  report: "sent reports",
  edit: "made changes",
  link: "made links",
  claim: "brought shares into your account",
};

/** "23 minutes", "an hour", "a minute" (anything under two minutes). */
export function waitPhrase(seconds: number): string {
  if (seconds < 60) return "a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "a minute" : `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour" : `${hours} hours`;
}

/** The 429 for a refused call: a plain message and Retry-After in seconds. */
export function tooMany(name: RateLimitName, rule: RateLimitRule, retryAfter: number): Response {
  const per = rule.windowSeconds === 3600 ? "an hour" : `${waitPhrase(rule.windowSeconds)}`;
  return Response.json(
    {
      error: `you've ${WHAT[name]} ${rule.max} times in ${per}, which is the most allowed; try again in ${waitPhrase(retryAfter)}`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}

async function limitKey(name: RateLimitName, key: string): Promise<Response | null> {
  const rule = ruleFor(name);
  const result = await rateLimit(`${name}:${key}`, rule.windowSeconds, rule.max);
  return result.ok ? null : tooMany(name, rule, result.retryAfter);
}

/** Limit by signed-in account (its account hash). */
export function limitAccount(name: RateLimitName, accountHash: string): Promise<Response | null> {
  return limitKey(name, `account:${accountHash}`);
}

/** Limit by gallery author: profile and collection edits, which an author key may also make. */
export function limitAuthor(name: RateLimitName, authorId: string): Promise<Response | null> {
  return limitKey(name, `author:${authorId}`);
}

/**
 * The address a request came from. On Vercel, `x-real-ip` and the first
 * `x-forwarded-for` hop are set by the platform, not the client. Off Vercel
 * (dev) there is usually none, and every signed-out request shares one bucket.
 */
export function clientAddress(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

export function hashedAddress(req: Request, env: Env = process.env): string {
  const address = clientAddress(req);
  const secret = env.AUTH_SECRET;
  return secret
    ? createHmac("sha256", secret).update(`rate-limit:${address}`, "utf8").digest("hex")
    : createHash("sha256").update(`rate-limit:${address}`, "utf8").digest("hex");
}

/** Limit by the signed-in account when there is one, else by the hashed address. */
export async function limitRequest(name: RateLimitName, req: Request): Promise<Response | null> {
  const signedIn = await sessionClaim();
  if (signedIn) return limitAccount(name, accountHashOf(signedIn.claim.provider, signedIn.claim.providerAccountId));
  return limitKey(name, `ip:${hashedAddress(req)}`);
}
