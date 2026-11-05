import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";

import { getDb, type Db } from "../../../db/client";
import { DATABASE_RETRY_AFTER_SECONDS, databaseUnavailable } from "../../../db/errors";
import { take } from "../../../db/repo/rateLimits";
import { accountHashOf, sessionClaim } from "./session";

/*
 * #2330 — how often one account (or, signed out, one address) may write.
 *
 *   rateLimit(key, windowSeconds, max, store?, cost = 1)
 *       → { ok: true, count } | { ok: false, retryAfter } | { ok: false, unavailable: true, retryAfter }
 *       Fixed windows: the window a moment falls in starts at
 *       floor(now / windowSeconds) * windowSeconds. Each call counts `cost`
 *       (one, unless the caller says otherwise); a call that would take the
 *       window's count past `max` is refused and not counted, and `retryAfter`
 *       is the whole seconds until that window ends.
 *
 *   limitAccount(name, accountHash, cost?) / limitAuthor(name, authorId) / limitRequest(name, req)
 *       → the 429 (or 503) Response to send, or null to go on. One line at the top of a
 *       route: `const limited = await limitAccount("publish", hash); if (limited) return limited;`
 *       limitRequest keys on the signed-in account when there is one, else on
 *       the hashed address (anonymous link creation and reports).
 *
 * ── What is guaranteed (#2345, #2352) ───────────────────────────────────────
 *
 * EXACT, across every server instance. The count lives in Postgres, one row per
 * key, and each check is ONE statement (db/repo/rateLimits.ts take):
 *
 *   INSERT … ON CONFLICT (key) DO UPDATE SET count = count + cost
 *     WHERE count + cost <= max RETURNING count
 *
 * Postgres applies concurrent updates to one row one after another, so however
 * many requests for one key arrive at once, on however many instances, exactly
 * `max` worth of cost is admitted per window. Nothing is kept in the instance.
 *
 * ── When the database can't be reached (#2351) ──────────────────────────────
 *
 * REFUSED: the limited route answers 503 with a plain message ("the gallery is
 * having trouble right now; try again in a minute") and `Retry-After`. The
 * write the limit guards would need the same database, so letting it through
 * would only fail one step later, or half-succeed. When the database is back,
 * the next request works; nothing needs resetting. A production build with no
 * database configured (no DATABASE_URL) refuses the same way.
 *
 * Addresses are never stored as they are: the key is an HMAC of the address
 * with AUTH_SECRET (plain SHA-256 when it isn't set), and the stored row key is
 * the SHA-256 of that, so the table can't be turned back into a list of
 * addresses by hashing every IPv4 address.
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
  /**
   * POST /api/gallery/claim — bring this browser's shares into the account.
   * #2345: counted in ITEMS, not requests (see claimCost in claim.ts). Each
   * item costs several storage operations, so a request-count limit let one
   * account move 10 × 1,000 items an hour. One request now carries at most
   * MAX_CLAIM_ITEMS entries + MAX_CLAIM_ITEMS links + the old profile (101), so
   * an hour's budget covers two full requests, plenty for a real browser.
   */
  claim: { windowSeconds: 3600, max: 250 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** The rule in force: the table's, with the env override applied. */
export function ruleFor(name: RateLimitName, env: Env = process.env): RateLimitRule {
  const base = RATE_LIMITS[name];
  const raw = env[`STAVE_RATE_LIMIT_${name.toUpperCase()}`];
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return { windowSeconds: base.windowSeconds, max: Number.isSafeInteger(n) && n > 0 ? n : base.max };
}

export type RateLimitResult =
  | { ok: true; count: number }
  | { ok: false; retryAfter: number; unavailable?: undefined }
  /** #2351 — the count couldn't be kept (database down or not configured): refuse with 503. */
  | { ok: false; retryAfter: number; unavailable: true };

/**
 * Where the count lives. `take` adds `cost` to the key's count for the window
 * starting at `windowStart`, unless that would pass `max`, atomically.
 */
export interface RateLimitStore {
  take(key: string, windowStart: number, cost: number, max: number): Promise<{ admitted: boolean; count: number | null }>;
}

/** The count in Postgres (db/repo/rateLimits.ts take). Exact across instances. */
export function postgresRateLimitStore(db: Db): RateLimitStore {
  return { take: (key, windowStart, cost, max) => take(db, key, windowStart, cost, max) };
}

/** This deployment's store: the gallery database's, or null when there is none. Throws when it can't be opened. */
async function defaultStore(): Promise<RateLimitStore | null> {
  const db = await getDb();
  return db ? postgresRateLimitStore(db) : null;
}

/**
 * Count `cost` against `key`. See the header for the window, storage and
 * guarantees. `store` defaults to the gallery database; pass one to test with
 * another (or `null` for "no database configured").
 */
export async function rateLimit(
  key: string,
  windowSeconds: number,
  max: number,
  store?: RateLimitStore | null,
  cost = 1,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const unavailable = { ok: false, unavailable: true, retryAfter: DATABASE_RETRY_AFTER_SECONDS } as const;
  try {
    const shared = store === undefined ? await defaultStore() : store;
    if (!shared) return unavailable;
    const taken = await shared.take(key, windowStart, cost, max);
    if (taken.admitted) return { ok: true, count: taken.count ?? cost };
    return { ok: false, retryAfter: Math.max(1, windowStart + windowSeconds - now) };
  } catch (err) {
    // #2351 — refuse: the write this guards couldn't be saved either.
    console.warn("[stave] rate limit store unavailable; refusing the write:", err);
    return unavailable;
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
  // The claim counts items, not requests (#2345), so it can't say "N times".
  const error =
    name === "claim"
      ? `you can bring at most ${rule.max} shares into your account in ${per}, and this would go past that; try again in ${waitPhrase(retryAfter)}`
      : `you've ${WHAT[name]} ${rule.max} times in ${per}, which is the most allowed; try again in ${waitPhrase(retryAfter)}`;
  return Response.json(
    { error },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}

async function limitKey(name: RateLimitName, key: string, cost = 1): Promise<Response | null> {
  const rule = ruleFor(name);
  const result = await rateLimit(`${name}:${key}`, rule.windowSeconds, rule.max, undefined, cost);
  if (result.ok) return null;
  return result.unavailable ? databaseUnavailable() : tooMany(name, rule, result.retryAfter);
}

/** Limit by signed-in account (its account hash). `cost` is how many units this call counts (default one). */
export function limitAccount(name: RateLimitName, accountHash: string, cost = 1): Promise<Response | null> {
  return limitKey(name, `account:${accountHash}`, cost);
}

/** Limit by gallery author: profile and collection edits, which an author key may also make. */
export function limitAuthor(name: RateLimitName, authorId: string): Promise<Response | null> {
  return limitKey(name, `author:${authorId}`);
}

/**
 * The address a request came from, read only where the platform vouches for it
 * (#2347).
 *
 * On Vercel (the platform sets `VERCEL=1` in every deployment), the
 * platform writes `x-forwarded-for` itself: "we currently overwrite the
 * X-Forwarded-For header and do not forward external IPs … to prevent IP
 * spoofing", and `x-real-ip` is "identical to the x-forwarded-for header"
 * (vercel.com/docs/headers/request-headers).
 *
 * Anywhere else (dev, `next start`, a self-hosted proxy) those headers are
 * whatever the client sent, so a script could rotate them and get a fresh
 * signed-out bucket each time. There the answer is "unknown": every signed-out
 * request shares one bucket, which is strict but can't be dodged.
 *
 * #2377 — unless the operator says which part to trust (off Vercel only; on
 * Vercel the settings are ignored):
 *
 *   STAVE_TRUSTED_PROXY_HOPS=<n>   n proxies you run sit in front of Stave, each
 *       appending the address it saw to X-Forwarded-For. The client is the n-th
 *       entry counted from the RIGHT; anything to its left came from the client
 *       and is ignored. This is Express's `trust proxy = n` (express 5.2.1
 *       lib/utils.js compileTrust: `(a, i) => i < n` over proxy-addr 2.0.7's
 *       [socket, ...XFF right-to-left]) and MDN's "trusted proxy count" rule.
 *       Fewer than n entries means the chain isn't what was configured: "unknown".
 *
 *   STAVE_CLIENT_IP_HEADER=<name>  a proxy you run OVERWRITES this one header with
 *       the visitor's address (x-real-ip, cf-connecting-ip, …). A value holding
 *       a list (a comma) is refused, since an overwritten header has one address.
 *       X-Forwarded-For can't be named here: it is a list, use the hop count.
 *
 * Either way the value must be a plain IP address (no port): anything else is
 * "unknown".
 *
 * A setting that can't be read (not a whole number from 1 to 20, not a header
 * name, both set at once) is logged once and the answer stays "unknown": a
 * typo never turns into trusting what the client sent.
 */
export function clientAddress(req: Request, env: Env = process.env): string {
  if (env.VERCEL) {
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || "unknown";
  }
  const trust = trustedProxySetting(env);
  if (trust.kind === "hops") {
    // Headers.get joins repeated X-Forwarded-For headers with ", ", which is
    // the single list MDN says to read.
    const entries = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim());
    if (entries.length < trust.hops) return "unknown";
    return plainIp(entries[entries.length - trust.hops]);
  }
  if (trust.kind === "header") {
    const value = req.headers.get(trust.header)?.trim();
    if (!value || value.includes(",")) return "unknown";
    return plainIp(value);
  }
  return "unknown";
}

/**
 * Only a plain IPv4 / IPv6 address counts. Some proxies write `ip:port`, and the
 * port changes with every connection, so taking it as-is would make each new
 * connection a new visitor. Anything that isn't an address is the shared bucket.
 */
function plainIp(value: string | undefined): string {
  return value && isIP(value) ? value : "unknown";
}

const MAX_TRUSTED_PROXY_HOPS = 20;
// RFC 9110 §5.6.2 token characters.
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

type TrustedProxy = { kind: "none" } | { kind: "hops"; hops: number } | { kind: "header"; header: string };

const warnedSettings = new Set<string>();
function badSetting(message: string): TrustedProxy {
  if (!warnedSettings.has(message)) {
    warnedSettings.add(message);
    console.warn(`[stave] ${message}; signed-out rate limits stay shared by all visitors`);
  }
  return { kind: "none" };
}

/** Which part of a request off Vercel the operator says to trust for the visitor's address (#2377). */
export function trustedProxySetting(env: Env = process.env): TrustedProxy {
  const hopsRaw = env.STAVE_TRUSTED_PROXY_HOPS?.trim();
  const headerRaw = env.STAVE_CLIENT_IP_HEADER?.trim();
  if (hopsRaw && headerRaw) {
    return badSetting("STAVE_TRUSTED_PROXY_HOPS and STAVE_CLIENT_IP_HEADER are both set; set only one");
  }
  if (hopsRaw) {
    const hops = /^\d+$/.test(hopsRaw) ? Number(hopsRaw) : NaN;
    if (!(hops >= 1 && hops <= MAX_TRUSTED_PROXY_HOPS)) {
      return badSetting(`STAVE_TRUSTED_PROXY_HOPS=${JSON.stringify(hopsRaw)} isn't a whole number from 1 to ${MAX_TRUSTED_PROXY_HOPS}`);
    }
    return { kind: "hops", hops };
  }
  if (headerRaw) {
    const header = headerRaw.toLowerCase();
    if (!HEADER_NAME.test(header)) {
      return badSetting(`STAVE_CLIENT_IP_HEADER=${JSON.stringify(headerRaw)} isn't a header name`);
    }
    if (header === "x-forwarded-for") {
      return badSetting("STAVE_CLIENT_IP_HEADER can't be x-forwarded-for (its left part is whatever the client sent); use STAVE_TRUSTED_PROXY_HOPS");
    }
    return { kind: "header", header };
  }
  return { kind: "none" };
}

export function hashedAddress(req: Request, env: Env = process.env): string {
  const address = clientAddress(req, env);
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
