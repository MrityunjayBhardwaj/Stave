import { createHash, createHmac } from "node:crypto";

import { accountHashOf, sessionClaim } from "./session";
import { galleryStore, getJson, putJson, type GalleryBlobStore } from "./store";

/*
 * #2330 — how often one account (or, signed out, one address) may write.
 *
 *   rateLimit(key, windowSeconds, max, store?, cost = 1)
 *       → { ok: true, count } | { ok: false, retryAfter }
 *       Fixed windows: the window a moment falls in starts at
 *       floor(now / windowSeconds) * windowSeconds. Each call counts `cost`
 *       (one, unless the caller says otherwise); a call that would take the
 *       window's count past `max` is refused and not counted, and `retryAfter`
 *       is the whole seconds until that window ends.
 *
 *   limitAccount(name, accountHash, cost?) / limitAuthor(name, authorId) / limitRequest(name, req)
 *       → the 429 Response to send, or null to go on. One line at the top of a
 *       route: `const limited = await limitAccount("publish", hash); if (limited) return limited;`
 *       limitRequest keys on the signed-in account when there is one, else on
 *       the hashed address (anonymous link creation and reports).
 *
 * ── What is guaranteed (#2345) ──────────────────────────────────────────────
 *
 * There are two layers: a counter inside each server instance, and a shared
 * record in a store (today the gallery's Blob store).
 *
 *   WITHIN ONE INSTANCE (one running server process): exact. Every check for
 *   one key runs one at a time (a per-key queue), and the instance keeps its
 *   own count for the current window. However many requests for one key
 *   arrive at once, one instance admits at most `max` worth of cost per window.
 *   This holds even when the store is down, because the instance's own count
 *   doesn't depend on it.
 *
 *   ACROSS INSTANCES: best effort. Each instance also reads the shared record
 *   and counts from whichever is higher, its own count or the record's, then
 *   writes the new count back. Requests spread over time are therefore limited
 *   across all instances. But Blob has no compare-and-set, so two instances
 *   checking at the same moment can both read the same record. In the worst
 *   case a burst that lands on K instances at once is admitted up to K × max
 *   (Vercel may run several instances of a function under load; each one is
 *   capped at `max`, and the record catches up as soon as the burst ends).
 *   The per-address Firewall rules (docs: "Limits") sit in front of this.
 *
 *   The fix for the cross-instance gap is an atomic store: one Postgres row per
 *   key, `INSERT … ON CONFLICT … DO UPDATE … WHERE count + cost <= max
 *   RETURNING count`. That is what the `RateLimitStore.take` interface below is
 *   shaped for; swap `blobRateLimitStore` for it and no route changes.
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 *
 * One small private record per key, in the gallery store:
 *
 *   gallery/rate-limits/<sha256(key)>.json   { windowStart, count }
 *
 * The record holds the CURRENT window only; the first call in a new window
 * overwrites it, so nothing piles up. That is one Blob read and one Blob write
 * per admitted request; a request the instance already knows is over the limit
 * is refused without touching the store, so a flood costs no storage.
 *
 * When the store can't be read or written, the request is not refused because
 * of that (logged instead): a store outage should not take publishing down with
 * it. The instance's own count still applies, so an outage loosens the limit
 * only to "per instance", never to "no limit". Whether to refuse outright on a
 * store outage is an open decision for the gallery's owner, not changed here.
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

export type RateLimitResult = { ok: true; count: number } | { ok: false; retryAfter: number };

interface CounterRecord {
  /** Start of the window, seconds since epoch. */
  windowStart: number;
  count: number;
}

export const rateLimitPath = (key: string) =>
  `gallery/rate-limits/${createHash("sha256").update(key, "utf8").digest("hex")}.json`;

// ── the shared store (cross-instance) ────────────────────────────────────────

/**
 * Where the shared count lives. `take` adds `cost` to the key's count for the
 * window starting at `windowStart`, unless that would pass `max`. `floor` is
 * what this instance already knows the count to be; the store counts from the
 * higher of the two. Returns whether it was admitted and the count after (or,
 * refused, the count that refused it).
 *
 * An atomic store (Postgres) does this in one statement. The Blob store below
 * can't, so two instances racing may both be admitted (see the header).
 */
export interface RateLimitStore {
  take(key: string, windowStart: number, cost: number, max: number, floor: number): Promise<{ admitted: boolean; count: number }>;
}

/** The shared count in the gallery's Blob store: read, decide, write. Not atomic across instances. */
export function blobRateLimitStore(store: GalleryBlobStore): RateLimitStore {
  return {
    async take(key, windowStart, cost, max, floor) {
      const file = rateLimitPath(key);
      const held = await getJson<CounterRecord>(store, file);
      const count = Math.max(floor, held && held.windowStart === windowStart ? held.count : 0);
      if (count + cost > max) return { admitted: false, count };
      await putJson(store, file, { windowStart, count: count + cost } satisfies CounterRecord);
      return { admitted: true, count: count + cost };
    },
  };
}

const isRateLimitStore = (s: GalleryBlobStore | RateLimitStore): s is RateLimitStore =>
  typeof (s as Partial<RateLimitStore>).take === "function";

// ── this instance's own count, and the per-key queue ─────────────────────────

interface LocalCount {
  windowStart: number;
  windowEnd: number;
  count: number;
}

interface InstanceState {
  counts: Map<string, LocalCount>;
  /** The tail of each key's queue: the next check for that key waits on it. */
  tails: Map<string, Promise<void>>;
}

// On globalThis, not module scope: Next can load this module more than once in
// one process (one copy per route bundle, and again on a dev reload), and every
// copy must share one count, or the edit limit (four routes) would split four ways.
const INSTANCE = Symbol.for("stave.gallery.rateLimit.instance");
function instance(): InstanceState {
  const g = globalThis as { [INSTANCE]?: InstanceState };
  return (g[INSTANCE] ??= { counts: new Map(), tails: new Map() });
}

/** For tests: forget this instance's counts, as a fresh server process would. */
export function resetRateLimitInstanceForTests(): void {
  const s = instance();
  s.counts.clear();
  s.tails.clear();
}

const PRUNE_AT = 5000;

function localCount(key: string, windowStart: number, windowSeconds: number, nowSec: number): LocalCount {
  const { counts } = instance();
  if (counts.size > PRUNE_AT) {
    for (const [k, v] of counts) if (v.windowEnd <= nowSec) counts.delete(k);
  }
  let held = counts.get(key);
  if (!held || held.windowStart !== windowStart) {
    held = { windowStart, windowEnd: windowStart + windowSeconds, count: 0 };
    counts.set(key, held);
  }
  return held;
}

/**
 * Run `fn` after every earlier call for `key` in this instance has finished,
 * so a check's read, decision and write for one key never interleave with
 * another's. Different keys don't wait on each other.
 */
async function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const { tails } = instance();
  const before = tails.get(key) ?? Promise.resolve();
  const run = before.then(fn);
  const tail = run.then(
    () => {},
    () => {},
  );
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}

/** Count `cost` against `key`. See the header for the window, storage and guarantees. */
export async function rateLimit(
  key: string,
  windowSeconds: number,
  max: number,
  store: GalleryBlobStore | RateLimitStore | null = galleryStore(),
  cost = 1,
): Promise<RateLimitResult> {
  const shared = store ? (isRateLimitStore(store) ? store : blobRateLimitStore(store)) : null;
  return oneAtATime(key, async () => {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % windowSeconds);
    const refuse = (): RateLimitResult => ({ ok: false, retryAfter: Math.max(1, windowStart + windowSeconds - now) });
    const local = localCount(key, windowStart, windowSeconds, now);
    const known = local.count;
    // This instance's count is a floor on the real one, so over it is over: no store trip.
    if (known + cost > max) return refuse();
    if (shared) {
      try {
        const taken = await shared.take(key, windowStart, cost, max, known);
        local.count = Math.max(local.count, taken.count);
        return taken.admitted ? { ok: true, count: taken.count } : refuse();
      } catch (err) {
        // Policy (unchanged by #2345): a store failure is not a refusal. This
        // instance's own count below still holds the line.
        console.warn("[stave] rate limit store unavailable; counting in this instance only:", err);
      }
    }
    local.count = known + cost;
    return { ok: true, count: local.count };
  });
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
  const result = await rateLimit(`${name}:${key}`, rule.windowSeconds, rule.max, galleryStore(), cost);
  return result.ok ? null : tooMany(name, rule, result.retryAfter);
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
