/**
 * #2319 — the account menu's state from the gallery session. Pure, so the
 * menu's three faces (unavailable, signed out, signed in) are tested without a
 * fetch. `undefined` while the session is still loading or couldn't be read:
 * the menu bar then draws no account button rather than a wrong one.
 */
import type { AccountMenu } from "../components/menuModel";
import type { GallerySessionState } from "./session";

export function buildAccountMenu(
  state: GallerySessionState,
  on: { onSignIn: (providerId: string) => void; onSignOut: () => void; onMyProfile: (authorId: string) => void },
): AccountMenu | undefined {
  if (state.status !== "ready") return undefined;
  const s = state.session;
  if (s.user) {
    const { authorId } = s.user;
    return {
      state: "signed-in",
      name: s.user.name,
      avatarUrl: s.user.verified.avatarUrl,
      onMyProfile: () => on.onMyProfile(authorId),
      onSignOut: on.onSignOut,
    };
  }
  if (!s.signInAvailable || s.providers.length === 0) return { state: "unavailable" };
  return { state: "signed-out", providers: s.providers, onSignIn: on.onSignIn };
}
