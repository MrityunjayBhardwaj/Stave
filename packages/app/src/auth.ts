import NextAuth, { type Profile, type User } from "next-auth";

import { authProviders, TEST_LOGIN_PROVIDER, type TestLoginUser } from "./authProviders";
import { SESSION_MAX_AGE_SECONDS } from "./sessionLifetime";

// #2319 — Auth.js (next-auth v5) for the community gallery.
//
// - Sessions are a signed, encrypted cookie (JWT strategy): no session database.
// - Sign-in is a full-page redirect (`signIn()` from next-auth/react with its
//   default redirect), never a popup. The app sends COOP `same-origin` for
//   SharedArrayBuffer (next.config.ts), which severs window.opener between our
//   page and a provider's popup, so a popup flow could never report back.
// - Providers come from env (authProviders.ts); a provider with no env vars is
//   not offered.
// - The route handlers live at app/api/auth/[...nextauth]/route.ts.
// - #2367: a session lasts 7 days and is renewed while you're active. Auth.js
//   won't do the renewing for us: it re-issues the cookie only from its own
//   /api/auth/session route, which this app never calls, and `auth()` throws that
//   cookie away. `session.updateAge` only applies to database sessions, so it
//   isn't set. app/api/gallery/session.ts renewSessionCookie does the renewing.
//
// The gallery reads the session through app/api/gallery/session.ts, which turns
// `session.account` into the gallery author it is linked to.

/** Who signed in, as the gallery needs it. Carried in the JWT and exposed on the session. */
export interface StaveAccountClaim {
  /** Auth.js provider id: "github", "google", or "test-login". */
  provider: string;
  /** The provider's stable id for this account (GitHub user id, Google `sub`, test form id). */
  providerAccountId: string;
  /** Which badge the profile wears. */
  badge: "github" | "google";
  /** GitHub login (handle), when the provider has one. */
  login?: string;
  avatarUrl?: string;
}

declare module "next-auth" {
  interface Session {
    account?: StaveAccountClaim;
    /** #2367 — when the cookie was issued (the JWT's `iat`, in seconds), to tell whether it's due for renewal. */
    issuedAt?: number;
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** The claim for a fresh sign-in, from what the provider handed back. */
export function claimFromSignIn(
  account: { provider: string; providerAccountId: string },
  profile: Profile | undefined,
  user: User | undefined,
): StaveAccountClaim {
  const base = { provider: account.provider, providerAccountId: String(account.providerAccountId) };
  if (account.provider === "github") {
    return { ...base, badge: "github", login: str(profile?.login), avatarUrl: str(profile?.avatar_url) ?? str(user?.image) };
  }
  if (account.provider === TEST_LOGIN_PROVIDER) {
    const u = user as Partial<TestLoginUser> | undefined;
    return { ...base, badge: u?.as === "google" ? "google" : "github", login: str(u?.login) };
  }
  return { ...base, badge: "google", avatarUrl: str(profile?.picture) ?? str(user?.image) };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: authProviders(process.env),
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  callbacks: {
    jwt({ token, account, profile, user }) {
      // `account` is present only on the sign-in itself; later calls keep the claim.
      // (The JWT type is not augmented: @auth/core/jwt isn't resolvable from here.)
      if (account) (token as { account?: StaveAccountClaim }).account = claimFromSignIn(account, profile, user);
      return token;
    },
    session({ session, token }) {
      const claim = (token as { account?: StaveAccountClaim }).account;
      if (claim) session.account = claim;
      if (typeof token.iat === "number") session.issuedAt = token.iat;
      return session;
    },
  },
});
