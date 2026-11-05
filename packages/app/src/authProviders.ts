import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

// #2319 — which sign-in providers this deployment offers. Pure: everything comes
// from the env object passed in, so a test can hand it any environment.
//
// A provider is offered only when its env vars are set; a missing one is simply
// left out, never a crash. With none offered (or no AUTH_SECRET to sign the
// session cookie), sign-in is unavailable: the UI says so and publishing answers
// 503 with a plain reason.
//
// The test sign-in ("test-login") signs in as whoever the form names. It exists
// so unit and browser tests can sign in without GitHub or Google, and it is
// registered ONLY when STAVE_AUTH_TEST_LOGIN=1 AND NODE_ENV is not "production".
// `next build` and `next start` run with NODE_ENV=production, so a deployed build
// can never offer it, whatever the flag says. authorize() checks the same rule
// again, so even a provider list built some other way can't sign anyone in.

type Env = Record<string, string | undefined>;

/** The id of the test-only provider. Its accounts are keyed `test-login:<id>`, apart from real ones. */
export const TEST_LOGIN_PROVIDER = "test-login";

/** Is the test sign-in allowed in this environment? */
export function testLoginAllowed(env: Env): boolean {
  return env.STAVE_AUTH_TEST_LOGIN === "1" && env.NODE_ENV !== "production";
}

/** What the sign-in UI may offer: id and display name, in menu order. */
export interface OfferedProvider {
  id: string;
  name: string;
}

export function offeredProviders(env: Env): OfferedProvider[] {
  const out: OfferedProvider[] = [];
  if (env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET) out.push({ id: "github", name: "GitHub" });
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) out.push({ id: "google", name: "Google" });
  if (testLoginAllowed(env)) out.push({ id: TEST_LOGIN_PROVIDER, name: "Test account" });
  return out;
}

/** Sign-in works here: a secret to sign sessions with, and at least one provider. */
export function signInAvailable(env: Env): boolean {
  return Boolean(env.AUTH_SECRET) && offeredProviders(env).length > 0;
}

/** What the test sign-in returns as the user; the jwt callback reads `login` and `as`. */
export interface TestLoginUser {
  id: string;
  name: string;
  email: string;
  login?: string;
  /** Which badge the fake account wears, so the badge can be tested without a real provider. */
  as: "github" | "google";
}

const field = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The test sign-in's authorize(), exported so its refusal can be tested on its own. */
export function authorizeTestLogin(env: Env, credentials: Partial<Record<string, unknown>>): TestLoginUser | null {
  if (!testLoginAllowed(env)) return null;
  const id = field(credentials.id, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const login = field(credentials.login, 39);
  return {
    id,
    name: field(credentials.name, 60) || id,
    email: field(credentials.email, 254) || `${id}@test-login.invalid`,
    ...(login ? { login } : {}),
    as: credentials.as === "google" ? "google" : "github",
  };
}

/** The providers to hand Auth.js. */
export function authProviders(env: Env): Provider[] {
  const offered = new Set(offeredProviders(env).map((p) => p.id));
  const out: Provider[] = [];
  // Minimal scopes: who you are and your email, nothing else.
  if (offered.has("github")) {
    out.push(
      GitHub({
        clientId: env.AUTH_GITHUB_ID,
        clientSecret: env.AUTH_GITHUB_SECRET,
        authorization: { params: { scope: "read:user user:email" } },
      }),
    );
  }
  if (offered.has("google")) {
    out.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        authorization: { params: { scope: "openid email profile" } },
      }),
    );
  }
  if (offered.has(TEST_LOGIN_PROVIDER)) {
    out.push(
      Credentials({
        id: TEST_LOGIN_PROVIDER,
        name: "Test account",
        credentials: { id: {}, name: {}, email: {}, login: {}, as: {} },
        // Re-reads process.env at call time, not the env this list was built from.
        authorize: (c) => authorizeTestLogin(process.env, c ?? {}),
      }),
    );
  }
  return out;
}
