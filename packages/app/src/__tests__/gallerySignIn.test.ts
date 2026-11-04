// @vitest-environment node
// #2319 — sign-in for the gallery: which providers are offered, the test-only
// provider refused in production (by the list AND by the real Auth.js routes),
// what a sign-in turns into (the account claim and the public badge), and the
// account menu's three faces.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authorizeTestLogin,
  authProviders,
  offeredProviders,
  signInAvailable,
  testLoginAllowed,
} from "../authProviders";
import { verifiedOf } from "../app/api/gallery/session";
import { buildAccountMenu } from "../gallery/accountMenu";

// A provider object keeps the options it was called with in `options`; Auth.js
// merges them over the defaults when it starts (so `options.id` wins over `id`).
type Built = { id: string; options?: { id?: string; authorization?: { params?: { scope?: string } } } };
const built = (env: Record<string, string>) =>
  authProviders(env).map((p) => (typeof p === "function" ? p() : p) as unknown as Built);
const ids = (env: Record<string, string>) => built(env).map((p) => p.options?.id ?? p.id);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("which providers are offered", () => {
  const github = { AUTH_GITHUB_ID: "gh-id", AUTH_GITHUB_SECRET: "gh-secret" };
  const google = { AUTH_GOOGLE_ID: "go-id", AUTH_GOOGLE_SECRET: "go-secret" };

  it("each real provider only when both its id and secret are set; none is no crash", () => {
    expect(ids({})).toEqual([]);
    expect(ids({ AUTH_GITHUB_ID: "only-id" })).toEqual([]);
    expect(ids({ AUTH_GOOGLE_SECRET: "only-secret" })).toEqual([]);
    expect(ids(github)).toEqual(["github"]);
    expect(ids({ ...github, ...google })).toEqual(["github", "google"]);
    expect(offeredProviders({ ...github, ...google })).toEqual([
      { id: "github", name: "GitHub" },
      { id: "google", name: "Google" },
    ]);
  });

  it("asks for the minimal scopes", () => {
    const [gh, go] = built({ ...github, ...google });
    expect(gh.options?.authorization?.params?.scope).toBe("read:user user:email");
    expect(go.options?.authorization?.params?.scope).toBe("openid email profile");
  });

  it("sign-in is available only with a secret and at least one provider", () => {
    expect(signInAvailable({ ...github })).toBe(false);
    expect(signInAvailable({ AUTH_SECRET: "s" })).toBe(false);
    expect(signInAvailable({ AUTH_SECRET: "s", ...google })).toBe(true);
  });
});

describe("the test-only sign-in", () => {
  it("is registered in development with the flag", () => {
    const env = { NODE_ENV: "development", STAVE_AUTH_TEST_LOGIN: "1" };
    expect(testLoginAllowed(env)).toBe(true);
    expect(ids(env)).toEqual(["test-login"]);
    expect(authorizeTestLogin(env, { id: "ada", name: "Ada", login: "ada" })).toMatchObject({ id: "ada", name: "Ada", as: "github" });
  });

  it("is NOT registered in a production build, even with the flag set", () => {
    const env = { NODE_ENV: "production", STAVE_AUTH_TEST_LOGIN: "1", AUTH_SECRET: "s" };
    expect(testLoginAllowed(env)).toBe(false);
    expect(ids(env)).toEqual([]);
    expect(signInAvailable(env)).toBe(false);
    // and its authorize() refuses on its own, whatever list it ended up in
    expect(authorizeTestLogin(env, { id: "ada" })).toBeNull();
  });

  it("is not registered without the flag, or with a flag other than 1", () => {
    expect(ids({ NODE_ENV: "development" })).toEqual([]);
    expect(ids({ NODE_ENV: "development", STAVE_AUTH_TEST_LOGIN: "true" })).toEqual([]);
  });

  it("refuses an id that isn't letters, digits, - and _", () => {
    const env = { NODE_ENV: "development", STAVE_AUTH_TEST_LOGIN: "1" };
    expect(authorizeTestLogin(env, { id: "" })).toBeNull();
    expect(authorizeTestLogin(env, { id: "../x" })).toBeNull();
    expect(authorizeTestLogin(env, { id: "a b" })).toBeNull();
  });

  // The real Auth.js routes, built from the real config (src/auth.ts) under each NODE_ENV.
  async function providersRoute(env: Record<string, string>): Promise<Record<string, unknown>> {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    const { NextRequest } = await import("next/server");
    const { handlers } = await import("../auth");
    const res = await handlers.GET(new NextRequest("http://localhost:3000/api/auth/providers"));
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  }

  it("the real /api/auth/providers offers it in development and not in production", async () => {
    const base = { AUTH_SECRET: "test-secret", STAVE_AUTH_TEST_LOGIN: "1", AUTH_TRUST_HOST: "1" };
    expect(Object.keys(await providersRoute({ ...base, NODE_ENV: "development" }))).toEqual(["test-login"]);
    expect(Object.keys(await providersRoute({ ...base, NODE_ENV: "production" }))).toEqual([]);
  });
});

describe("the public badge", () => {
  it("GitHub: provider, login and an https avatar — nothing else", () => {
    expect(
      verifiedOf({
        provider: "github",
        providerAccountId: "123",
        badge: "github",
        login: "ada",
        avatarUrl: "https://avatars.githubusercontent.com/u/123?v=4",
      }),
    ).toEqual({ provider: "github", login: "ada", avatarUrl: "https://avatars.githubusercontent.com/u/123?v=4" });
  });

  it("Google: no login even if one is passed, and a non-https avatar is dropped", () => {
    expect(
      verifiedOf({ provider: "google", providerAccountId: "s", badge: "google", login: "x", avatarUrl: "http://a/b.png" }),
    ).toEqual({ provider: "google" });
  });
});

describe("what a sign-in becomes (the JWT's account claim)", () => {
  it("takes GitHub's login and avatar, Google's picture, the test form's login and badge", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    const { claimFromSignIn } = await import("../auth");
    expect(
      claimFromSignIn({ provider: "github", providerAccountId: "42" }, { login: "ada", avatar_url: "https://a/x" }, undefined),
    ).toEqual({ provider: "github", providerAccountId: "42", badge: "github", login: "ada", avatarUrl: "https://a/x" });
    expect(claimFromSignIn({ provider: "google", providerAccountId: "sub-1" }, { picture: "https://g/p" }, undefined)).toEqual({
      provider: "google",
      providerAccountId: "sub-1",
      badge: "google",
      avatarUrl: "https://g/p",
    });
    expect(
      claimFromSignIn({ provider: "test-login", providerAccountId: "t1" }, undefined, { id: "t1", login: "t1", as: "google" } as never),
    ).toEqual({ provider: "test-login", providerAccountId: "t1", badge: "google", login: "t1" });
  });
});

describe("the account menu", () => {
  const on = { onSignIn: vi.fn(), onSignOut: vi.fn(), onMyProfile: vi.fn() };

  it("draws nothing until the session is known", () => {
    expect(buildAccountMenu({ status: "loading" }, on)).toBeUndefined();
    expect(buildAccountMenu({ status: "error", message: "x" }, on)).toBeUndefined();
  });

  it("unavailable, signed out with the configured providers, signed in with name and avatar", () => {
    expect(
      buildAccountMenu({ status: "ready", session: { signInAvailable: false, providers: [], user: null } }, on),
    ).toEqual({ state: "unavailable" });

    const out = buildAccountMenu(
      { status: "ready", session: { signInAvailable: true, providers: [{ id: "github", name: "GitHub" }], user: null } },
      on,
    );
    expect(out).toMatchObject({ state: "signed-out", providers: [{ id: "github", name: "GitHub" }] });

    const inn = buildAccountMenu(
      {
        status: "ready",
        session: {
          signInAvailable: true,
          providers: [],
          user: { name: "Ada", authorId: "auth1", verified: { provider: "github", login: "ada", avatarUrl: "https://a/x" } },
        },
      },
      on,
    );
    expect(inn).toMatchObject({ state: "signed-in", name: "Ada", avatarUrl: "https://a/x" });
    if (inn?.state === "signed-in") inn.onMyProfile();
    expect(on.onMyProfile).toHaveBeenCalledWith("auth1");
  });
});

// #2352 — the browser specs' seed route (it makes a pre-sign-in profile in the
// dev database) lives by the same rule as the test sign-in.
describe("the test-only seed route", () => {
  const seed = async (env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    const route = await import("../app/api/test-seed/route");
    const post = await route.POST(new Request("http://x/api/test-seed", { method: "POST", body: "{}" }));
    const get = await route.GET();
    return [post.status, get.status];
  };

  it("is refused (404) in a production build, even with the flag set", async () => {
    expect(await seed({ NODE_ENV: "production", STAVE_AUTH_TEST_LOGIN: "1", STAVE_SHARE_DEV_STORE: "1" })).toEqual([404, 404]);
  });

  it("is refused (404) without the flag", async () => {
    expect(await seed({ NODE_ENV: "development", STAVE_AUTH_TEST_LOGIN: "" })).toEqual([404, 404]);
  });

  it("refuses another site's page with 403, like every write route", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
    vi.resetModules();
    const route = await import("../app/api/test-seed/route");
    const res = await route.POST(
      new Request("http://x/api/test-seed", { method: "POST", body: "{}", headers: { origin: "https://evil.example" } }),
    );
    expect(res.status).toBe(403);
  });

  it("makes the profile, entry and collection in development with the flag (control)", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(os.tmpdir(), "stave-test-seed-"));
    try {
      expect(await seed({ NODE_ENV: "development", STAVE_AUTH_TEST_LOGIN: "1", BLOB_READ_WRITE_TOKEN: "", BLOB_STORE_ID: "", STAVE_GALLERY_DEV_DIR: dir })).toEqual([201, 200]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
