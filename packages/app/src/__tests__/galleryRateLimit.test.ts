// @vitest-environment node
// #2330 — per-account rate limits and the Turnstile check on the gallery's write
// routes: the limiter on its own (under / over, a window rolling over, keys kept
// apart), every route's limit (the (N+1)th call is 429 with Retry-After), and
// Turnstile off / failing / passing / unreachable.
//
// Auth.js's `auth()` is mocked as in galleryRoutes.test.ts; each test signs in
// as a fresh account so the counters never leak between tests.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../auth", () => ({ auth: vi.fn(async () => fake.session) }));

import { TURNSTILE_HEADER, type GalleryManifest, type PublishResponse } from "../gallery/types";
import { POST as publishRoute } from "../app/api/gallery/route";
import { POST as reportRoute } from "../app/api/gallery/[id]/report/route";
import { PUT as authorPut } from "../app/api/gallery/authors/[authorId]/route";
import { POST as collectionPost } from "../app/api/gallery/collections/route";
import { DELETE as collectionDelete, PUT as collectionPut } from "../app/api/gallery/collections/[id]/route";
import { POST as claimRoute } from "../app/api/gallery/claim/route";
import { GET as meRoute } from "../app/api/gallery/me/route";
import { POST as shareRoute } from "../app/api/share/route";
import { sealShare } from "../shareCrypto";
import {
  RATE_LIMITS,
  clientAddress,
  hashedAddress,
  rateLimit,
  type RateLimitStore,
  ruleFor,
  waitPhrase,
} from "../app/api/gallery/rateLimit";
import { requireTurnstile, SITEVERIFY_URL } from "../app/api/gallery/turnstile";
import { galleryStore } from "../app/api/gallery/store";
import { dbOverPglite, getDb, useDbForTests, type Db } from "../db/client";
import { DATABASE_UNAVAILABLE_MESSAGE } from "../db/errors";
import { rateLimitRowKey } from "../db/repo/rateLimits";
import { rowsOf } from "../db/repo/tx";
import { sql } from "drizzle-orm";
import type { PGlite } from "@electric-sql/pglite";
import { claimCost, MAX_CLAIM_ITEMS } from "../app/api/gallery/claim";

// #2352 — the gallery's records are in an in-memory Postgres (PGlite) per test
// file. Starting it takes a few seconds, once; do it here, not inside the first test.
beforeAll(() => getDb(), 60_000);

// Cloudflare's published test keys (developers.cloudflare.com/turnstile/troubleshooting/testing/).
const PASS_SECRET = "1x0000000000000000000000000000000AA";
const FAIL_SECRET = "2x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stave-ratelimit-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

let n = 0;
const fresh = () => `rl-${Date.now().toString(36)}-${n++}`;

function stubBaseEnv() {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  stubBaseEnv();
  signIn(fresh());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function signIn(id: string | null) {
  fake.session = id
    ? {
        user: { name: "Ada", email: "ada@example.test" },
        account: { provider: "test-login", providerAccountId: id, badge: "github", login: id },
        expires: "2099-01-01T00:00:00.000Z",
      }
    : null;
}

const manifest: GalleryManifest = {
  schemaVersion: 1,
  project: { name: "Song", sharedAt: 1 },
  files: [{ id: "f0", path: "song.strudel", language: "strudel", content: '$: s("bd")' }],
  fileOrder: { "": ["f0"] },
  subfolderOrder: {},
};
const json = (method: string, url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const publish = (headers: Record<string, string> = {}) =>
  publishRoute(json("POST", "http://x/api/gallery", { title: "T", kind: "music", tags: [], manifest }, headers));
const report = (id: string, headers: Record<string, string> = {}) =>
  reportRoute(json("POST", `http://x/api/gallery/${id}/report`, { reason: "spam" }, headers), {
    params: Promise.resolve({ id }),
  });
const myAuthorId = async () => ((await (await meRoute(new Request("http://x/api/gallery/me"))).json()) as { user: { authorId: string } }).user.authorId;

/** Call `fn` `times` times and expect every answer to be `status`. */
async function expectAll(times: number, fn: () => Promise<Response>, status: number) {
  for (let i = 0; i < times; i++) {
    const res = await fn();
    if (res.status !== status) throw new Error(`call ${i + 1}: expected ${status}, got ${res.status} ${await res.text()}`);
  }
}

async function expect429(res: Response) {
  expect(res.status).toBe(429);
  const retry = Number(res.headers.get("Retry-After"));
  expect(Number.isInteger(retry)).toBe(true);
  expect(retry).toBeGreaterThan(0);
  expect(retry).toBeLessThanOrEqual(3600);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/try again in/);
  return body.error;
}

describe("rateLimit, on its own", () => {

  it("lets max calls through in a window and refuses the next, with the seconds left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T10:00:10Z"));
    const key = `unit:${fresh()}`;
    for (let i = 1; i <= 3; i++) expect(await rateLimit(key, 60, 3)).toEqual({ ok: true, count: i });
    expect(await rateLimit(key, 60, 3)).toEqual({ ok: false, retryAfter: 50 });
    // Still refused later in the same window, and the refusal is not counted.
    vi.setSystemTime(new Date("2026-11-05T10:00:59Z"));
    expect(await rateLimit(key, 60, 3)).toEqual({ ok: false, retryAfter: 1 });
  });

  it("starts over when the window rolls over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T10:59:30Z"));
    const key = `unit:${fresh()}`;
    expect((await rateLimit(key, 3600, 1)).ok).toBe(true);
    expect(await rateLimit(key, 3600, 1)).toEqual({ ok: false, retryAfter: 30 });
    vi.setSystemTime(new Date("2026-11-05T11:00:00Z"));
    expect(await rateLimit(key, 3600, 1)).toEqual({ ok: true, count: 1 });
  });

  it("keeps keys apart", async () => {
    const a = `unit:${fresh()}`;
    const b = `unit:${fresh()}`;
    expect((await rateLimit(a, 3600, 1)).ok).toBe(true);
    expect((await rateLimit(a, 3600, 1)).ok).toBe(false);
    expect((await rateLimit(b, 3600, 1)).ok).toBe(true);
  });

  it("stores one row per key, named by a hash (no key text in the table)", async () => {
    const key = `unit:ada-${fresh()}@example.test`;
    await rateLimit(key, 3600, 5);
    await rateLimit(key, 3600, 5);
    const db = (await getDb())!;
    const rows = rowsOf<{ key: string; count: number }>(await db.execute(sql`select key, count from rate_limits`));
    const mine = rows.filter((r) => r.key === rateLimitRowKey(key));
    expect(mine).toEqual([{ key: rateLimitRowKey(key), count: 2 }]);
    expect(rateLimitRowKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.some((r) => r.key.includes("ada"))).toBe(false);
  });

  it("#2351: refuses (unavailable, retry in a minute) when the store fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await rateLimit(`unit:${fresh()}`, 60, 1, brokenStore())).toEqual({ ok: false, unavailable: true, retryAfter: 60 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("#2351: refuses the same way when no database is configured", async () => {
    expect(await rateLimit(`unit:${fresh()}`, 60, 1, null)).toEqual({ ok: false, unavailable: true, retryAfter: 60 });
  });

  it("takes an env override of max, only as a positive whole number", () => {
    expect(ruleFor("publish", {})).toEqual(RATE_LIMITS.publish);
    expect(ruleFor("publish", { STAVE_RATE_LIMIT_PUBLISH: "3" }).max).toBe(3);
    for (const bad of ["0", "-1", "2.5", "lots", ""]) {
      expect(ruleFor("publish", { STAVE_RATE_LIMIT_PUBLISH: bad }).max).toBe(RATE_LIMITS.publish.max);
    }
  });

  it("hashes the address, keyed by AUTH_SECRET", () => {
    const req = (ip: string) => new Request("http://x", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
    const onVercel = (secret: string) => ({ AUTH_SECRET: secret, VERCEL: "1" });
    const a = hashedAddress(req("203.0.113.7"), onVercel("one"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203");
    expect(hashedAddress(req("203.0.113.7"), onVercel("two"))).not.toBe(a);
    expect(hashedAddress(req("203.0.113.8"), onVercel("one"))).not.toBe(a);
    // x-real-ip wins over x-forwarded-for
    const real = new Request("http://x", { headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" } });
    expect(hashedAddress(real, onVercel("one"))).toBe(a);
  });

  // #2347 — off Vercel those headers are whatever the client sent.
  it("reads the address headers only on Vercel; anywhere else every signed-out request is one address", () => {
    const req = (headers: Record<string, string>) => new Request("http://x", { headers });
    expect(clientAddress(req({ "x-real-ip": "203.0.113.7" }), { VERCEL: "1" })).toBe("203.0.113.7");
    expect(clientAddress(req({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }), { VERCEL: "1" })).toBe("198.51.100.1");
    expect(clientAddress(req({}), { VERCEL: "1" })).toBe("unknown");
    const spoofable: Array<Record<string, string>> = [{ "x-real-ip": "203.0.113.7" }, { "x-forwarded-for": "198.51.100.1" }, {}];
    for (const headers of spoofable) {
      expect(clientAddress(req(headers), {})).toBe("unknown");
    }
    const rotated = ["192.0.2.1", "192.0.2.2", "192.0.2.3"].map((ip) => hashedAddress(req({ "x-forwarded-for": ip }), { AUTH_SECRET: "s" }));
    expect(new Set(rotated).size).toBe(1);
  });

  it("says how long to wait in plain words", () => {
    expect(waitPhrase(5)).toBe("a minute");
    expect(waitPhrase(61)).toBe("2 minutes");
    expect(waitPhrase(23 * 60)).toBe("23 minutes");
    expect(waitPhrase(3600)).toBe("an hour");
  });
});

describe("each write route applies its limit", () => {
  it(`publish: ${RATE_LIMITS.publish.max} an hour per account, then 429`, async () => {
    await expectAll(RATE_LIMITS.publish.max, () => publish(), 201);
    const message = await expect429(await publish());
    expect(message).toMatch(/published 10 times in an hour/);
    // Another account is not affected.
    signIn(fresh());
    expect((await publish()).status).toBe(201);
  });

  it(`report: ${RATE_LIMITS.report.max} an hour per account, then 429`, async () => {
    const { id } = (await (await publish()).json()) as PublishResponse;
    signIn(fresh());
    await expectAll(RATE_LIMITS.report.max, () => report(id), 202);
    await expect429(await report(id));
  });

  it(`report signed out: ${RATE_LIMITS.report.max} an hour per address, addresses kept apart`, async () => {
    const { id } = (await (await publish()).json()) as PublishResponse;
    signIn(null);
    vi.stubEnv("VERCEL", "1"); // where the address headers come from the platform
    const ip = { "x-forwarded-for": `198.51.100.${n++ % 250}` };
    await expectAll(RATE_LIMITS.report.max, () => report(id, ip), 202);
    await expect429(await report(id, ip));
    expect((await report(id, { "x-forwarded-for": "192.0.2.200" })).status).toBe(202);
  });

  // #2347 — off Vercel a script can't get a fresh bucket by changing the header.
  it("report signed out, off Vercel: a rotated X-Forwarded-For is still the same address", async () => {
    const { id } = (await (await publish()).json()) as PublishResponse;
    signIn(null);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("STAVE_RATE_LIMIT_REPORT", "3");
    let k = 0;
    const rotating = () => report(id, { "x-forwarded-for": `203.0.113.${k++}`, "x-real-ip": `198.51.100.${k}` });
    await expectAll(3, rotating, 202);
    await expect429(await rotating());
  });

  it(`profile and collection edits share ${RATE_LIMITS.edit.max} an hour per author`, async () => {
    const authorId = await myAuthorId();
    const ctxA = { params: Promise.resolve({ authorId }) };
    const put = () => authorPut(json("PUT", `http://x/api/gallery/authors/${authorId}`, { name: "Ada", bio: "" }), ctxA);
    const made = await collectionPost(json("POST", "http://x/api/gallery/collections", { title: "C", description: "", entryIds: [] }));
    expect(made.status).toBe(201);
    const { collection } = (await made.json()) as { collection: { id: string } };
    const ctxC = { params: Promise.resolve({ id: collection.id }) };
    const cPut = () =>
      collectionPut(json("PUT", `http://x/api/gallery/collections/${collection.id}`, { title: "C2", description: "", entryIds: [] }), ctxC);

    await expectAll(RATE_LIMITS.edit.max - 2, put, 200);
    expect((await cPut()).status).toBe(200); // the 60th edit
    await expect429(await put());
    await expect429(await cPut());
    await expect429(await collectionPost(json("POST", "http://x/api/gallery/collections", { title: "D", description: "", entryIds: [] })));
    await expect429(await collectionDelete(new Request(`http://x/api/gallery/collections/${collection.id}`, { method: "DELETE" }), ctxC));
  }, 20_000); // 60 real writes to the folder store: 2-4 s alone, past 5 s under a full parallel suite

  it("claim: counted per item, then 429", async () => {
    vi.stubEnv("STAVE_RATE_LIMIT_CLAIM", "10");
    const claim = () => claimRoute(json("POST", "http://x/api/gallery/claim", { entries: [], links: [] }));
    await expectAll(10, claim, 200);
    expect(await expect429(await claim())).toMatch(/at most 10 shares into your account in an hour/);
  });

  it(`private links: ${RATE_LIMITS.link.max} an hour per address signed out, per account signed in`, async () => {
    const { sealed } = await sealShare(new TextEncoder().encode("x"));
    const post = (headers: Record<string, string> = {}) =>
      shareRoute(new Request("http://x/api/share", { method: "POST", headers, body: sealed as BodyInit }));
    signIn(null);
    vi.stubEnv("VERCEL", "1");
    const ip = { "x-real-ip": `203.0.113.${n++ % 250}` };
    await expectAll(RATE_LIMITS.link.max, () => post(ip), 201);
    await expect429(await post(ip));

    signIn(fresh()); // the same address, signed in: the account's own count
    await expectAll(RATE_LIMITS.link.max, () => post(ip), 201);
    await expect429(await post(ip));
  });
});

// ── #2345: bursts, item charging, and a store outage ──────────────────────────

function brokenStore(): RateLimitStore {
  return {
    take: async () => {
      throw new Error("down");
    },
  };
}

/** Fire `times` calls at once and count the answers by status. */
async function burst(times: number, fn: () => Promise<Response>): Promise<Record<number, number>> {
  const answers = await Promise.all(Array.from({ length: times }, fn));
  const counts: Record<number, number> = {};
  for (const res of answers) counts[res.status] = (counts[res.status] ?? 0) + 1;
  return counts;
}

/** A claim of `entries` + `links` items, each well-shaped but naming nothing that exists. */
const claimOf = (entries: number, links = 0) =>
  claimRoute(
    json("POST", "http://x/api/gallery/claim", {
      entries: Array.from({ length: entries }, (_, i) => ({ id: `nothere${i}`, manageToken: "t" })),
      links: Array.from({ length: links }, (_, i) => ({ id: `nothere${i}`, manageToken: "t" })),
    }),
  );

describe("a burst of parallel requests (#2345)", () => {
  it("30 parallel claims as one account against a limit of 10: exactly 10 get through", async () => {
    vi.stubEnv("STAVE_RATE_LIMIT_CLAIM", "10");
    await myAuthorId(); // the account's author exists before the burst, as after any sign-in
    const counts = await burst(30, () => claimRoute(json("POST", "http://x/api/gallery/claim", { entries: [], links: [] })));
    expect(counts).toEqual({ 200: 10, 429: 20 });
  });

  it(`30 parallel publishes as one account: exactly ${RATE_LIMITS.publish.max} get through`, async () => {
    await myAuthorId();
    const counts = await burst(30, () => publish());
    expect(counts).toEqual({ 201: RATE_LIMITS.publish.max, 429: 30 - RATE_LIMITS.publish.max });
  });

  it("30 parallel calls to the limiter itself, max 10: exactly 10 admitted, counts 1..10 each once", async () => {
    const key = `unit:${fresh()}`;
    const results = await Promise.all(Array.from({ length: 30 }, () => rateLimit(key, 3600, 10)));
    const admitted = results.filter((r) => r.ok).map((r) => (r as { count: number }).count);
    expect(admitted.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("keys don't wait on each other", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => rateLimit(`unit:${fresh()}`, 3600, 1)));
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe("the claim is charged per item (#2345)", () => {
  beforeEach(() => vi.stubEnv("STAVE_RATE_LIMIT_CLAIM", "10"));

  it("one claim of 12 items against a limit of 10 is refused, and costs nothing", async () => {
    await expect429(await claimOf(8, 4));
    expect((await claimOf(10)).status).toBe(200); // the refused 12 weren't counted
    await expect429(await claimOf(0)); // the 10 were
  });

  it("items add up across claims: 6 then 5 is refused at the second", async () => {
    expect((await claimOf(6)).status).toBe(200);
    await expect429(await claimOf(3, 2));
    expect((await claimOf(4)).status).toBe(200); // 6 + 4 = 10 still fits
  });

  it("an empty or malformed claim still costs one, and the limit answers before the shape error", async () => {
    vi.stubEnv("STAVE_RATE_LIMIT_CLAIM", "2");
    const malformed = () => claimRoute(json("POST", "http://x/api/gallery/claim", { entries: "nope" }));
    expect((await malformed()).status).toBe(400);
    expect((await claimOf(0)).status).toBe(200);
    await expect429(await malformed());
  });

  it(`the per-request cap is ${MAX_CLAIM_ITEMS} of each, and a full request fits the default hourly budget`, async () => {
    vi.unstubAllEnvs();
    stubBaseEnv();
    expect(MAX_CLAIM_ITEMS).toBe(50);
    expect((await claimOf(MAX_CLAIM_ITEMS + 1)).status).toBe(400);
    expect(claimCost({ authorKey: "k", entries: Array(MAX_CLAIM_ITEMS).fill({}), links: Array(MAX_CLAIM_ITEMS).fill({}) })).toBe(101);
    expect(2 * 101).toBeLessThanOrEqual(RATE_LIMITS.claim.max);
    expect(claimCost({ entries: [], links: [] })).toBe(1);
    expect(claimCost(null)).toBe(1);
  });
});

describe("across servers (#2345, #2352)", () => {
  // Two independent database handles over ONE database stand in for two
  // server instances: nothing is shared between them but the database. (PGlite
  // runs one statement at a time, so this proves the limiter keeps no count of
  // its own and relies on the statement alone; Postgres's row lock gives the
  // same answer under real concurrency.)
  async function twoServers(): Promise<[RateLimitStore, RateLimitStore]> {
    const client = ((await getDb()) as Db & { $client: PGlite }).$client;
    const { postgresRateLimitStore } = await import("../app/api/gallery/rateLimit");
    return [postgresRateLimitStore(await dbOverPglite(client)), postgresRateLimitStore(await dbOverPglite(client))];
  }

  it("30 parallel calls split over two servers, max 10: exactly 10 admitted", async () => {
    const [a, b] = await twoServers();
    const key = `unit:${fresh()}`;
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => rateLimit(key, 3600, 10, i % 2 ? a : b)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok && !r.unavailable)).toHaveLength(20);
  });

  it("what one server counted, the other sees: 9 on one, then a burst of 30 on the other admits 1", async () => {
    const [a, b] = await twoServers();
    const key = `unit:${fresh()}`;
    for (let i = 0; i < 9; i++) expect((await rateLimit(key, 3600, 10, a)).ok).toBe(true);
    const results = await Promise.all(Array.from({ length: 30 }, () => rateLimit(key, 3600, 10, b)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("when the database is down (#2351)", () => {
  afterEach(() => useDbForTests(undefined));
  // A database that can't answer: a PGlite that was closed. Made once (starting
  // one takes seconds under a full parallel run).
  let dead: Db;
  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = await PGlite.create();
    await client.close();
    dead = await dbOverPglite(client);
  }, 60_000);

  it("a burst against a failing store: every call refused as unavailable, none admitted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const results = await Promise.all(Array.from({ length: 30 }, () => rateLimit(`unit:${fresh()}`, 3600, 10, brokenStore())));
    expect(results.every((r) => !r.ok && r.unavailable)).toBe(true);
    warn.mockRestore();
  });

  it("a limited route answers 503 with the plain message and Retry-After, writes nothing, and works again once it is back", async () => {
    await myAuthorId(); // the account exists; only the limiter's store goes away
    const listed = async () => (await galleryStore()!.list("gallery/entries/")).length;
    const before = await listed();
    useDbForTests(dead);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const res of [
      await publish(),
      await claimRoute(json("POST", "http://x/api/gallery/claim", { entries: [], links: [] })),
      await report("AAAAAAAAAAA"),
    ]) {
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(((await res.json()) as { error: string }).error).toBe(DATABASE_UNAVAILABLE_MESSAGE);
    }
    expect(await listed()).toBe(before);
    warn.mockRestore();

    useDbForTests(undefined); // the database is back: no manual step
    expect((await publish()).status).toBe(201);
  });
});

describe("Turnstile", () => {
  const verify = vi.fn();
  beforeEach(() => {
    verify.mockReset();
    vi.stubGlobal("fetch", verify);
  });
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  /** What siteverify answers a real (non-test) key for a widget solved on this site ("x", the test URLs' host). */
  const passed = (action: string, hostname = "x") => ({ success: true, "error-codes": [], hostname, action });

  // #2347 — success alone isn't enough: the token must be for this action, made on this site.
  it("refuses a passing token made for another action, or on another site", async () => {
    const { id } = (await (await publish()).json()) as PublishResponse; // before Turnstile is on
    vi.stubEnv("TURNSTILE_SECRET_KEY", "a-real-looking-secret");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    verify.mockResolvedValueOnce(answer(passed("report")));
    expect((await publish({ [TURNSTILE_HEADER]: DUMMY_TOKEN })).status).toBe(403);
    verify.mockResolvedValueOnce(answer(passed("publish")));
    expect((await report(id, { [TURNSTILE_HEADER]: DUMMY_TOKEN })).status).toBe(403);
    verify.mockResolvedValueOnce(answer(passed("publish", "evil.example")));
    expect((await publish({ [TURNSTILE_HEADER]: DUMMY_TOKEN })).status).toBe(403);
    verify.mockResolvedValueOnce(answer({ success: true })); // no hostname or action at all
    expect((await publish({ [TURNSTILE_HEADER]: DUMMY_TOKEN })).status).toBe(403);
    verify.mockResolvedValueOnce(answer(passed("publish", "X")));
    expect((await publish({ [TURNSTILE_HEADER]: DUMMY_TOKEN })).status).toBe(201); // hostnames are case-blind
    warn.mockRestore();
  });

  it("takes the configured site's hostname (AUTH_URL) too, without its port", async () => {
    const env = { TURNSTILE_SECRET_KEY: "a-real-looking-secret", AUTH_URL: "https://stave.example:8443" };
    const behindProxy = () =>
      new Request("http://internal:3000/api/gallery", { method: "POST", headers: { host: "internal:3000", [TURNSTILE_HEADER]: DUMMY_TOKEN } });
    verify.mockResolvedValueOnce(answer(passed("publish", "stave.example")));
    expect(await requireTurnstile(behindProxy(), "publish", env)).toBeNull();
    verify.mockResolvedValueOnce(answer(passed("publish", "internal")));
    expect(await requireTurnstile(behindProxy(), "publish", env)).toBeNull();
  });

  it("lets Cloudflare's test-key answers through on success alone (they always say example.com, no action)", async () => {
    const env = { TURNSTILE_SECRET_KEY: PASS_SECRET };
    const req = () => new Request("http://localhost:3000/api/gallery", { method: "POST", headers: { [TURNSTILE_HEADER]: DUMMY_TOKEN } });
    const testKeyAnswer = { success: true, "error-codes": [], hostname: "example.com", metadata: { result_with_testing_key: true } };
    verify.mockResolvedValueOnce(answer(testKeyAnswer));
    expect(await requireTurnstile(req(), "publish", env)).toBeNull();
    verify.mockResolvedValueOnce(answer({ ...testKeyAnswer, success: false }));
    expect((await requireTurnstile(req(), "publish", env))?.status).toBe(403);
  });

  it("is skipped when TURNSTILE_SECRET_KEY is unset: no header needed, Cloudflare never called", async () => {
    expect((await publish()).status).toBe(201);
    expect(verify).not.toHaveBeenCalled();
  });

  it("with the always-fail secret: 403, and nothing is published", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", FAIL_SECRET);
    verify.mockImplementation(async () => answer({ success: false, "error-codes": ["invalid-input-response"] }));
    const listed = async () => (await galleryStore()!.list("gallery/entries/")).length;
    const before = await listed();
    const res = await publish({ [TURNSTILE_HEADER]: DUMMY_TOKEN });
    expect(res.status).toBe(403);
    expect(await listed()).toBe(before);
    expect(((await res.json()) as { error: string }).error).toMatch(/are you human/);
    const [url, init] = verify.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    const sent = new URLSearchParams(init.body as URLSearchParams);
    expect(sent.get("secret")).toBe(FAIL_SECRET);
    expect(sent.get("response")).toBe(DUMMY_TOKEN);
  });

  it("with the always-pass secret: published", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", PASS_SECRET);
    verify.mockImplementation(async () => answer(passed("publish")));
    expect((await publish({ [TURNSTILE_HEADER]: DUMMY_TOKEN })).status).toBe(201);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("on report too: missing token 403, failing 403, passing 202", async () => {
    const { id } = (await (await publish()).json()) as PublishResponse;
    vi.stubEnv("TURNSTILE_SECRET_KEY", PASS_SECRET);
    expect((await report(id)).status).toBe(403);
    expect(verify).not.toHaveBeenCalled(); // a missing token never reaches Cloudflare
    verify.mockResolvedValueOnce(answer({ success: false }));
    expect((await report(id, { [TURNSTILE_HEADER]: DUMMY_TOKEN })).status).toBe(403);
    verify.mockResolvedValueOnce(answer(passed("report")));
    expect((await report(id, { [TURNSTILE_HEADER]: DUMMY_TOKEN })).status).toBe(202);
  });

  it("when Cloudflare can't be reached: 503 that says so, never let through", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", PASS_SECRET);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    verify.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await publish({ [TURNSTILE_HEADER]: DUMMY_TOKEN });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/couldn't run/);
    verify.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    expect((await publish({ [TURNSTILE_HEADER]: DUMMY_TOKEN })).status).toBe(503);
    warn.mockRestore();
  });

  it("is checked after the rate limit, so a flood never reaches Cloudflare", async () => {
    vi.stubEnv("STAVE_RATE_LIMIT_PUBLISH", "1");
    vi.stubEnv("TURNSTILE_SECRET_KEY", PASS_SECRET);
    verify.mockImplementation(async () => answer(passed("publish")));
    expect((await publish({ [TURNSTILE_HEADER]: DUMMY_TOKEN })).status).toBe(201);
    await expect429(await publish({ [TURNSTILE_HEADER]: DUMMY_TOKEN }));
    expect(verify).toHaveBeenCalledTimes(1);
  });
});

// The real siteverify endpoint with Cloudflare's test secrets. Needs the
// network, so it runs only with STAVE_TURNSTILE_LIVE=1.
describe.runIf(process.env.STAVE_TURNSTILE_LIVE === "1")("Turnstile, live against Cloudflare", () => {
  const req = () => new Request("http://x", { method: "POST", headers: { [TURNSTILE_HEADER]: DUMMY_TOKEN } });
  it("the always-pass secret passes the dummy token", async () => {
    expect(await requireTurnstile(req(), "publish", { TURNSTILE_SECRET_KEY: PASS_SECRET })).toBeNull();
  });
  it("the always-fail secret refuses it with 403", async () => {
    const res = await requireTurnstile(req(), "publish", { TURNSTILE_SECRET_KEY: FAIL_SECRET });
    expect(res?.status).toBe(403);
  });
});
