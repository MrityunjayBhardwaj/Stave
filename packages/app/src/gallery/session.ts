"use client";

/**
 * #2319 — who is signed in, on the browser side.
 *
 * The app is not wrapped in Auth.js's <SessionProvider>, and doesn't need to be:
 * one small store here fetches `/api/gallery/me` (types.ts GallerySessionResponse)
 * once per page load, and the menu bar, phone drawer, publish dialog and profile
 * all read it through `useGallerySession()`. That route answers in one request
 * whether sign-in exists here, which providers to offer and which author is
 * yours, and never sends the email to the page. A SessionProvider would add a
 * context at the root, poll `/api/auth/session` on focus, and still need a
 * second request for the author.
 *
 * Sign-in and sign-out are full-page redirects (`signIn`/`signOut` from
 * next-auth/react, default `redirect: true`): the app's COOP `same-origin`
 * header cuts a popup off from its opener, so a popup flow can't work here. A
 * redirect reloads the page, so the store never needs to be told it changed.
 */
import { useEffect, useSyncExternalStore } from "react";
import { signIn, signOut } from "next-auth/react";

import type { GallerySessionResponse } from "./types";

export type GallerySessionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; session: GallerySessionResponse };

/** The fragment that reopens the Publish dialog after the sign-in redirect comes back. */
export const PUBLISH_HASH = "#publish";

/** The test-only provider's id (authProviders.ts TEST_LOGIN_PROVIDER). */
const TEST_LOGIN = "test-login";

let state: GallerySessionState = { status: "loading" };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: GallerySessionState): void {
  state = next;
  for (const l of listeners) l();
}

/** Fetch (or re-fetch) who is signed in. Concurrent calls share one request. */
export function loadGallerySession(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/gallery/me", { cache: "no-store" });
      if (!res.ok) throw new Error(`checking sign-in failed (${res.status})`);
      set({ status: "ready", session: (await res.json()) as GallerySessionResponse });
    } catch (err) {
      set({ status: "error", message: (err as Error)?.message || "checking sign-in failed" });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => state;
const serverSnapshot = (): GallerySessionState => ({ status: "loading" });

/** The current session, loaded on first use. */
export function useGallerySession(): GallerySessionState {
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    if (state.status === "loading" && !inflight) void loadGallerySession();
  }, []);
  return s;
}

/** For tests: forget what was loaded. */
export function resetGallerySessionForTests(next: GallerySessionState = { status: "loading" }): void {
  inflight = null;
  set(next);
}

/** Where to come back to: this page, and (for the publish dialog) reopen it. */
export function returnUrl(reopenPublish: boolean): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${reopenPublish ? PUBLISH_HASH : ""}`;
}

/**
 * Sign in with `providerId`: a full-page redirect to the provider, then back to
 * this page (with `#publish` when the publish dialog asked).
 *
 * The test-only provider (offered only in development with
 * STAVE_AUTH_TEST_LOGIN=1) asks for an account id and signs straight in.
 */
export async function gallerySignIn(providerId: string, opts: { reopenPublish?: boolean } = {}): Promise<void> {
  const redirectTo = returnUrl(Boolean(opts.reopenPublish));
  if (providerId === TEST_LOGIN) {
    const id = window.prompt("Test account id (letters, digits, - and _)", "tester")?.trim();
    if (!id) return;
    await signIn(TEST_LOGIN, { redirectTo, id, name: `Test ${id}`, login: id, email: `${id}@test-login.invalid`, as: "github" });
    return;
  }
  await signIn(providerId, { redirectTo });
}

/** Sign out: a full-page redirect back to this page, signed out. */
export async function gallerySignOut(): Promise<void> {
  await signOut({ redirectTo: returnUrl(false) });
}
