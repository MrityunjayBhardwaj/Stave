import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { toBase64Url } from "../../../shareCrypto";

// #2299 / #2303 — the author's manage token: handed back once at publish; the
// server keeps only its SHA-256, so a leaked store doesn't leak the tokens.
//
// The check compares SHA-256 digests with timingSafeEqual: equal-length inputs,
// so neither the length nor a matching prefix of the secret shows in the timing.
//
// #2331 — admins are no longer a shared key (STAVE_GALLERY_ADMIN_KEY is gone);
// they are signed-in accounts listed in STAVE_GALLERY_ADMINS. See admin.ts.

/** A fresh manage token: 32 random bytes, base64url (43 characters). */
export function newManageToken(): string {
  return toBase64Url(randomBytes(32));
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function sameDigest(a: string, b: string): boolean {
  const x = createHash("sha256").update(a, "utf8").digest();
  const y = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(x, y);
}

/** Does `token` match the stored hash? */
export function tokenMatches(token: string | null, storedHash: string): boolean {
  if (!token) return false;
  return sameDigest(hashToken(token), storedHash);
}
