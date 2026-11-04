import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { toBase64Url } from "../../../shareCrypto";

// #2299 / #2303 — who may delete an entry.
//
// The author: whoever holds the manage token handed back once at publish. The
// server keeps only its SHA-256, so a leaked store doesn't leak the tokens.
// The maintainer: whoever holds `STAVE_GALLERY_ADMIN_KEY` (server env only). With
// that unset, nobody is an admin.
//
// Both checks compare SHA-256 digests with timingSafeEqual: equal-length inputs,
// so neither the length nor a matching prefix of the secret shows in the timing.

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

/** Is `key` the admin key? Always false when the server has none. */
export function isAdminKey(key: string | null): boolean {
  const admin = process.env.STAVE_GALLERY_ADMIN_KEY;
  if (!admin || !key) return false;
  return sameDigest(key, admin);
}
