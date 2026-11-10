// @vitest-environment node
// #2367 — a session lasts 7 days and is renewed while you're active.
//
// This runs the REAL Auth.js (src/auth.ts is not mocked): real encrypted cookies,
// through the real GET /api/gallery/me. Only two things are stand-ins:
//   - the clock: vi.setSystemTime moves Date, which is all Auth.js and its JWT
//     library read, so "8 days later" is a real expiry check, not a pretend one;
//   - next/headers, which only exists inside a Next request, gets the test's request.
// Cookies are minted by Auth.js's own encode() with the clock moved to when each is
// meant to have been issued.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decode, encode } from "next-auth/jwt";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => {
  process.env.AUTH_SECRET = "session-lifetime-test-secret";
  process.env.STAVE_AUTH_TEST_LOGIN = "1";
  process.env.AUTH_TRUST_HOST = "1";
  return { headers: new Headers() };
});
vi.mock("next/headers", () => ({ headers: async () => scope.headers }));

import { GET as meRoute } from "../app/api/gallery/me/route";
import { getDb } from "../db/client";
import { SESSION_MAX_AGE_SECONDS, SESSION_RENEW_AFTER_SECONDS, sessionRenewalDue } from "../sessionLifetime";

const SECRET = "session-lifetime-test-secret";
const COOKIE = "authjs.session-token";
const SECURE_COOKIE = "__Secure-authjs.session-token";
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

const claim = { provider: "test-login", providerAccountId: "lifetime", badge: "github", login: "lifetime" };

/** A real Auth.js session cookie, issued at the clock's current time. */
const mint = (maxAge = SESSION_MAX_AGE_SECONDS, salt = COOKIE) =>
  encode({ token: { name: "Life Time", email: "lifetime@test-login.invalid", account: claim }, secret: SECRET, salt, maxAge });

/** GET /api/gallery/me as a browser holding `cookie` would make it. */
async function me(cookie: string | null, opts: { name?: string; proto?: string } = {}) {
  const { name = COOKIE, proto = "http" } = opts;
  const headers = new Headers({ host: "localhost:3442", "x-forwarded-proto": proto });
  if (cookie) headers.set("cookie", `${name}=${cookie}`);
  scope.headers = headers;
  const res = await meRoute(new Request(`${proto}://localhost:3442/api/gallery/me`, { headers }));
  const setCookies = res.headers.getSetCookie();
  const body = (await res.json()) as { user: { name: string } | null };
  return { status: res.status, cacheControl: res.headers.get("cache-control"), user: body.user, setCookies };
}

/** The renewed cookie's value and Expires. */
function parsed(setCookie: string) {
  const value = /^[^=]+=([^;]+)/.exec(setCookie)?.[1] ?? "";
  const expires = /Expires=([^;]+)/.exec(setCookie)?.[1] ?? "";
  return { value, expiresMs: Date.parse(expires) };
}

let dir = "";
beforeAll(() => getDb(), 60_000);
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "stave-session-lifetime-"));
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.useFakeTimers({ toFake: ["Date"], now: T0 });
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
afterAll(() => vi.useRealTimers());

describe("the lifetime", () => {
  it("is 7 days, renewed at most once a day", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(604800);
    expect(SESSION_RENEW_AFTER_SECONDS).toBe(86400);
  });

  it("is due from one day after the cookie was issued, and not before", () => {
    const issued = T0 / 1000;
    expect(sessionRenewalDue(issued, T0)).toBe(false);
    expect(sessionRenewalDue(issued, T0 + DAY - 1000)).toBe(false);
    expect(sessionRenewalDue(issued, T0 + DAY)).toBe(true);
    expect(sessionRenewalDue(undefined, T0 + 30 * DAY)).toBe(false);
  });
});

describe("GET /api/gallery/me with the real Auth.js cookie", () => {
  it("doesn't touch a cookie less than a day old", async () => {
    const cookie = await mint();
    vi.setSystemTime(T0 + DAY - 60_000);
    const r = await me(cookie);
    expect(r.user?.name).toBe("Life Time");
    expect(r.setCookies).toEqual([]);
  });

  it("renews a cookie a day old for another 7 days, with the same account and no caching", async () => {
    const cookie = await mint();
    vi.setSystemTime(T0 + 2 * DAY);
    const r = await me(cookie);
    expect(r.status).toBe(200);
    expect(r.cacheControl).toBe("no-store");
    expect(r.setCookies).toHaveLength(1);
    expect(r.setCookies[0]).toMatch(/^authjs\.session-token=/);
    expect(r.setCookies[0]).toMatch(/HttpOnly/);
    expect(r.setCookies[0]).toMatch(/SameSite=Lax/);
    expect(r.setCookies[0]).toMatch(/Path=\//);

    const renewed = parsed(r.setCookies[0]);
    // The browser's copy and the JWT inside it both move: the JWT is what stops a replayed copy.
    expect(renewed.expiresMs).toBe(T0 + 2 * DAY + 7 * DAY);
    const token = await decode({ token: renewed.value, secret: SECRET, salt: COOKIE });
    expect(token?.exp).toBe((T0 + 2 * DAY + 7 * DAY) / 1000);
    expect(token?.iat).toBe((T0 + 2 * DAY) / 1000);
    expect((token as { account?: unknown } | null)?.account).toEqual(claim);
  });

  it("an active person stays signed in well past 7 days; 7 days away ends it", async () => {
    let cookie = await mint();
    for (const day of [6, 12, 18, 24]) {
      vi.setSystemTime(T0 + day * DAY);
      const r = await me(cookie);
      expect(r.user?.name, `day ${day}`).toBe("Life Time");
      expect(r.setCookies, `day ${day}`).toHaveLength(1);
      cookie = parsed(r.setCookies[0]).value;
    }
    vi.setSystemTime(T0 + (24 + 7) * DAY + 60_000);
    const away = await me(cookie);
    expect(away.status).toBe(200);
    expect(away.user).toBeNull();
    expect(away.setCookies).toEqual([]);
  });

  it("a copy of the cookie nobody uses dies at 7 days, even if it's still being sent", async () => {
    const cookie = await mint();
    vi.setSystemTime(T0 + 7 * DAY - 60_000);
    expect((await me(cookie)).user?.name).toBe("Life Time");
    vi.setSystemTime(T0 + 7 * DAY + 60_000);
    const r = await me(cookie);
    expect(r.status).toBe(200);
    expect(r.user).toBeNull();
  });

  it("no cookie, or a broken one, is the plain signed-out answer", async () => {
    expect(await me(null)).toMatchObject({ status: 200, user: null, setCookies: [] });
    const broken = await me("not-a-real-cookie");
    expect(broken.status).toBe(200);
    expect(broken.user).toBeNull();
    expect(broken.setCookies).toEqual([]);
  });

  it("renews the production cookie under its own name", async () => {
    const cookie = await mint(SESSION_MAX_AGE_SECONDS, SECURE_COOKIE);
    vi.setSystemTime(T0 + 2 * DAY);
    const r = await me(cookie, { name: SECURE_COOKIE, proto: "https" });
    expect(r.user?.name).toBe("Life Time");
    expect(r.setCookies).toHaveLength(1);
    expect(r.setCookies[0]).toMatch(/^__Secure-authjs\.session-token=/);
    expect(r.setCookies[0]).toMatch(/Secure/);
  });
});

describe("a 30-day cookie issued before this change", () => {
  it("is shortened to 7 days the first time it's read a day or more after it was issued", async () => {
    const old = await mint(THIRTY_DAYS_SECONDS);
    vi.setSystemTime(T0 + 20 * DAY);
    const r = await me(old);
    expect(r.user?.name).toBe("Life Time");
    expect(parsed(r.setCookies[0]).expiresMs).toBe(T0 + 27 * DAY);
  });

  it("left unused, keeps working until its own 30 days are up, and no longer", async () => {
    const old = await mint(THIRTY_DAYS_SECONDS);
    vi.setSystemTime(T0 + 30 * DAY - 60_000);
    expect((await me(old)).user?.name).toBe("Life Time");
    vi.setSystemTime(T0 + 30 * DAY + 60_000);
    expect((await me(old)).user).toBeNull();
  });
});
