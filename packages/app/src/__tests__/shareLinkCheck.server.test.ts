// @vitest-environment node
// #2364 — POST /api/share asks for the "are you human" check only signed out.
// Auth.js's `auth()` is mocked as in galleryRateLimit.test.ts; Cloudflare's
// siteverify is a stubbed fetch, so these say what the route does with each answer.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown, broken: false }));
vi.mock("../auth", () => ({
  auth: vi.fn(async () => {
    if (fake.broken) throw new Error("the session can't be read");
    return fake.session;
  }),
}));

import { POST } from "../app/api/share/route";
import { RATE_LIMITS } from "../app/api/gallery/rateLimit";
import { SITEVERIFY_URL } from "../app/api/gallery/turnstile";
import { getDb } from "../db/client";
import { TURNSTILE_HEADER } from "../gallery/types";
import { sealShare } from "../shareCrypto";

beforeAll(() => getDb(), 60_000);

const SECRET = "a-real-looking-secret";
const TOKEN = "a-token";

let dir = "";
let address = 0;
const verify = vi.fn();
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** What siteverify answers for a real key's token, solved on this site ("x", the test URLs' host). */
const passed = (action: string, hostname = "x") => ({ success: true, "error-codes": [], hostname, action });

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stave-share-check-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function signIn(id: string | null) {
  fake.broken = false;
  fake.session = id
    ? {
        user: { name: "Ada", email: "ada@example.test" },
        account: { provider: "test-login", providerAccountId: id, badge: "github", login: id },
        expires: "2099-01-01T00:00:00.000Z",
      }
    : null;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.stubEnv("VERCEL", "1"); // addresses count, so each test gets its own bucket
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("TURNSTILE_SECRET_KEY", SECRET);
  verify.mockReset();
  vi.stubGlobal("fetch", verify);
  signIn(null);
  address++;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function post(headers: Record<string, string> = {}): Promise<Response> {
  const { sealed } = await sealShare(new TextEncoder().encode("x"));
  return POST(
    new Request("http://x/api/share", {
      method: "POST",
      headers: { "x-real-ip": `203.0.114.${address % 250}`, ...headers },
      body: sealed as BodyInit,
    }),
  );
}
const withToken = { [TURNSTILE_HEADER]: TOKEN };

describe("POST /api/share and the check", () => {
  it("signed out without a token: 403 with a plain message, and Cloudflare isn't called", async () => {
    const res = await post();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/are you human/);
    expect(verify).not.toHaveBeenCalled();
  });

  it("signed out with a good token: the link is made, and the token went to Cloudflare once", async () => {
    verify.mockResolvedValueOnce(answer(passed("share-link")));
    const res = await post(withToken);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { id: string }).id).toBeTruthy();
    expect(verify).toHaveBeenCalledTimes(1);
    const [url, init] = verify.mock.calls[0] as [string, { body: URLSearchParams }];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.body.get("response")).toBe(TOKEN);
    expect(init.body.get("secret")).toBe(SECRET);
  });

  it("signed out with a token Cloudflare refuses: 403", async () => {
    verify.mockResolvedValueOnce(answer({ success: false, "error-codes": ["invalid-input-response"] }));
    expect((await post(withToken)).status).toBe(403);
  });

  it("refuses a passing token made for another action, or on another site", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const action of ["publish", "report"]) {
      verify.mockResolvedValueOnce(answer(passed(action)));
      expect((await post(withToken)).status, action).toBe(403);
    }
    verify.mockResolvedValueOnce(answer(passed("share-link", "evil.example")));
    expect((await post(withToken)).status).toBe(403);
    warn.mockRestore();
  });

  it("when Cloudflare can't be reached: 503, and no link", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    verify.mockRejectedValueOnce(new Error("no network"));
    expect((await post(withToken)).status).toBe(503);
    warn.mockRestore();
  });

  it("signed in: no token needed and Cloudflare isn't called", async () => {
    signIn(`share-check-${Date.now()}-${address}`);
    expect((await post()).status).toBe(201);
    expect(verify).not.toHaveBeenCalled();
  });

  it("signed in with a token anyway: it isn't checked, so it isn't spent", async () => {
    signIn(`share-check-${Date.now()}-${address}`);
    expect((await post(withToken)).status).toBe(201);
    expect(verify).not.toHaveBeenCalled();
  });

  it("no keys on this site: signed out needs nothing, as before", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect((await post()).status).toBe(201);
    expect(verify).not.toHaveBeenCalled();
  });

  it("a session that can't be read gets the check, not a pass", async () => {
    fake.broken = true;
    expect((await post()).status).toBe(403);
    verify.mockResolvedValueOnce(answer(passed("share-link")));
    expect((await post(withToken)).status).toBe(201);
  });

  it("a session with no account in it gets the check", async () => {
    fake.session = { user: { name: "Ada" }, expires: "2099-01-01T00:00:00.000Z" };
    expect((await post()).status).toBe(403);
  });

  it("a site without sign-in set up gets the check, even with a session", async () => {
    signIn("share-check-no-sign-in");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "");
    expect((await post()).status).toBe(403);
  });

  it("the limit runs first: past it, a token isn't sent to Cloudflare (so isn't spent)", async () => {
    vi.stubEnv("STAVE_RATE_LIMIT_LINK", "1");
    verify.mockResolvedValueOnce(answer(passed("share-link")));
    expect((await post(withToken)).status).toBe(201);
    expect(verify).toHaveBeenCalledTimes(1);
    expect((await post(withToken)).status).toBe(429);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it(`keeps the limit of ${RATE_LIMITS.link.max} an hour`, () => {
    expect(RATE_LIMITS.link).toEqual({ windowSeconds: 3600, max: 30 });
  });
});

describe("every door that makes a link", () => {
  const SRC = path.join(__dirname, "..");
  async function sourceFiles(at: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(at, { withFileTypes: true })) {
      const full = path.join(at, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__tests__") out.push(...(await sourceFiles(full)));
      } else if (/\.tsx?$/.test(e.name)) out.push(full);
    }
    return out;
  }
  async function filesMatching(pattern: RegExp): Promise<string[]> {
    const hits: string[] = [];
    for (const f of await sourceFiles(SRC)) {
      if (pattern.test(await readFile(f, "utf8"))) hits.push(path.relative(SRC, f));
    }
    return hits.sort();
  }

  it("the browser uploads a link from one place, and one caller reaches it", async () => {
    expect(await filesMatching(/fetch\(\s*["'`]\/api\/share["'`]/)).toEqual(["shareProject.ts"]);
    expect(await filesMatching(/\bbuildShortShareUrl\(/)).toEqual(["components/StaveApp.tsx", "shareProject.ts"]);
  });

  it("the server stores a link's bytes from one route", async () => {
    expect(await filesMatching(/\bshareStore\(\)[\s\S]*?\.put\(/)).toEqual(["app/api/share/route.ts"]);
  });
});
