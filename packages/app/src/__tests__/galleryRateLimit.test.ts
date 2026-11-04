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
  hashedAddress,
  rateLimit,
  rateLimitPath,
  ruleFor,
  waitPhrase,
} from "../app/api/gallery/rateLimit";
import { requireTurnstile, SITEVERIFY_URL } from "../app/api/gallery/turnstile";
import { galleryStore } from "../app/api/gallery/store";

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

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
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
  const store = () => galleryStore()!;

  it("lets max calls through in a window and refuses the next, with the seconds left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T10:00:10Z"));
    const key = `unit:${fresh()}`;
    for (let i = 1; i <= 3; i++) expect(await rateLimit(key, 60, 3, store())).toEqual({ ok: true, count: i });
    expect(await rateLimit(key, 60, 3, store())).toEqual({ ok: false, retryAfter: 50 });
    // Still refused later in the same window, and the refusal is not counted.
    vi.setSystemTime(new Date("2026-11-05T10:00:59Z"));
    expect(await rateLimit(key, 60, 3, store())).toEqual({ ok: false, retryAfter: 1 });
  });

  it("starts over when the window rolls over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T10:59:30Z"));
    const key = `unit:${fresh()}`;
    expect((await rateLimit(key, 3600, 1, store())).ok).toBe(true);
    expect(await rateLimit(key, 3600, 1, store())).toEqual({ ok: false, retryAfter: 30 });
    vi.setSystemTime(new Date("2026-11-05T11:00:00Z"));
    expect(await rateLimit(key, 3600, 1, store())).toEqual({ ok: true, count: 1 });
  });

  it("keeps keys apart", async () => {
    const a = `unit:${fresh()}`;
    const b = `unit:${fresh()}`;
    expect((await rateLimit(a, 3600, 1, store())).ok).toBe(true);
    expect((await rateLimit(a, 3600, 1, store())).ok).toBe(false);
    expect((await rateLimit(b, 3600, 1, store())).ok).toBe(true);
  });

  it("stores one record per key, named by a hash (no key text in the path)", async () => {
    const key = `unit:ada@example.test`;
    await rateLimit(key, 3600, 5, store());
    expect(rateLimitPath(key)).toMatch(/^gallery\/rate-limits\/[0-9a-f]{64}\.json$/);
    expect(await store().get(rateLimitPath(key))).not.toBeNull();
  });

  it("lets the request through when the store fails", async () => {
    const broken = {
      put: async () => {
        throw new Error("down");
      },
      get: async () => {
        throw new Error("down");
      },
      del: async () => {},
      list: async () => [],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await rateLimit("unit:x", 60, 1, broken)).toEqual({ ok: true, count: 0 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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
    const a = hashedAddress(req("203.0.113.7"), { AUTH_SECRET: "one" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203");
    expect(hashedAddress(req("203.0.113.7"), { AUTH_SECRET: "two" })).not.toBe(a);
    expect(hashedAddress(req("203.0.113.8"), { AUTH_SECRET: "one" })).not.toBe(a);
    // x-real-ip wins over x-forwarded-for
    const real = new Request("http://x", { headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" } });
    expect(hashedAddress(real, { AUTH_SECRET: "one" })).toBe(a);
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
    const ip = { "x-forwarded-for": `198.51.100.${n++ % 250}` };
    await expectAll(RATE_LIMITS.report.max, () => report(id, ip), 202);
    await expect429(await report(id, ip));
    expect((await report(id, { "x-forwarded-for": "192.0.2.200" })).status).toBe(202);
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
  });

  it(`claim: ${RATE_LIMITS.claim.max} an hour per account, then 429`, async () => {
    const claim = () => claimRoute(json("POST", "http://x/api/gallery/claim", { entries: [], links: [] }));
    await expectAll(RATE_LIMITS.claim.max, claim, 200);
    await expect429(await claim());
  });

  it(`private links: ${RATE_LIMITS.link.max} an hour per address signed out, per account signed in`, async () => {
    const { sealed } = await sealShare(new TextEncoder().encode("x"));
    const post = (headers: Record<string, string> = {}) =>
      shareRoute(new Request("http://x/api/share", { method: "POST", headers, body: sealed as BodyInit }));
    signIn(null);
    const ip = { "x-real-ip": `203.0.113.${n++ % 250}` };
    await expectAll(RATE_LIMITS.link.max, () => post(ip), 201);
    await expect429(await post(ip));

    signIn(fresh()); // the same address, signed in: the account's own count
    await expectAll(RATE_LIMITS.link.max, () => post(ip), 201);
    await expect429(await post(ip));
  });
});

describe("Turnstile", () => {
  const verify = vi.fn();
  beforeEach(() => {
    verify.mockReset();
    vi.stubGlobal("fetch", verify);
  });
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

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
    verify.mockImplementation(async () => answer({ success: true, "error-codes": [] }));
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
    verify.mockResolvedValueOnce(answer({ success: true }));
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
    verify.mockImplementation(async () => answer({ success: true }));
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
    expect(await requireTurnstile(req(), { TURNSTILE_SECRET_KEY: PASS_SECRET })).toBeNull();
  });
  it("the always-fail secret refuses it with 403", async () => {
    const res = await requireTurnstile(req(), { TURNSTILE_SECRET_KEY: FAIL_SECRET });
    expect(res?.status).toBe(403);
  });
});
