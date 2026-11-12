// #2367 — how long a gallery session lasts, on its own so the server (auth.ts,
// app/api/gallery/session.ts) and the browser (gallery/session.ts) read one
// answer. Pure: no Auth.js here, so the browser bundle can import it.

/** A session ends this long after it was last renewed: 7 days without use. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** An active session is renewed at most this often. */
export const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;

/** Should a session cookie issued at `issuedAt` (the JWT's `iat`, in seconds) be renewed now? */
export function sessionRenewalDue(issuedAt: unknown, nowMs: number = Date.now()): boolean {
  return typeof issuedAt === "number" && nowMs / 1000 - issuedAt >= SESSION_RENEW_AFTER_SECONDS;
}
