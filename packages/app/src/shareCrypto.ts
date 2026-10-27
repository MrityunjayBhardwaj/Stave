/**
 * Short share links (#2248) — the sealed form of a shared project.
 *
 * A short link is `/s/<id>#<key>`. The browser encrypts the project with a fresh
 * random AES-GCM key and uploads only the sealed bytes; the server stores them under
 * `<id>` and never sees the key, because a URL's `#` part is never sent. So the
 * promise the long `#share=` link makes — the server never holds a readable
 * project — still holds.
 *
 * Sealed layout: `[version=1][iv: 12 bytes][ciphertext + 16-byte tag]`. The server
 * checks only the version byte and the length (it cannot read the rest).
 *
 * Pure apart from WebCrypto, so the node routes and the unit tests share it.
 */

export const SEALED_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** version + iv + tag + at least one byte of ciphertext */
export const MIN_SEALED_BYTES = 1 + IV_BYTES + TAG_BYTES + 1;
/** The largest sealed project the store accepts. A 2 MB project gzips well under it. */
export const MAX_SEALED_BYTES = 1024 * 1024;

/** 8 random bytes, base64url: 11 characters. */
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
/** A 128-bit key, base64url: 22 characters. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SHORT_PATH = /^\/s\/([A-Za-z0-9_-]{11})\/?$/;

// base64url: replace `+/` with `-_` and strip `=` padding.
export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A fresh share id: 8 random bytes, 11 characters. */
export function newShareId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(8)));
}

/** Seal `plain` with a fresh key. Returns the sealed bytes and the key for the link. */
export async function sealShare(plain: Uint8Array): Promise<{ sealed: Uint8Array; key: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource),
  );
  const sealed = new Uint8Array(1 + IV_BYTES + ct.byteLength);
  sealed[0] = SEALED_VERSION;
  sealed.set(iv, 1);
  sealed.set(ct, 1 + IV_BYTES);
  return { sealed, key: toBase64Url(raw) };
}

/** Open sealed bytes with the link's key. Throws when the key is wrong or the bytes were changed. */
export async function openShare(sealed: Uint8Array, keyText: string): Promise<Uint8Array> {
  if (!KEY_PATTERN.test(keyText)) throw new Error("the link's key is incomplete");
  if (!isSealedShape(sealed)) throw new Error("the shared project is damaged");
  const key = await crypto.subtle.importKey(
    "raw", fromBase64Url(keyText) as BufferSource, "AES-GCM", false, ["decrypt"],
  );
  const iv = sealed.slice(1, 1 + IV_BYTES);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv }, key, sealed.slice(1 + IV_BYTES) as BufferSource,
      ),
    );
  } catch {
    throw new Error("the link's key doesn't open this project");
  }
}

/** What the server can check without the key: the version byte and the length. */
export function isSealedShape(bytes: Uint8Array): boolean {
  return bytes.byteLength >= MIN_SEALED_BYTES &&
    bytes.byteLength <= MAX_SEALED_BYTES &&
    bytes[0] === SEALED_VERSION;
}

/**
 * Read a short link from a location: `/s/<id>` with the key after `#`. Returns null
 * for any other path. A short path with a missing or malformed key still returns
 * `{ id, key: null }` so the caller can say the link is incomplete rather than
 * silently opening an empty Stave.
 */
export function parseShortShare(
  pathname: string,
  hash: string,
): { id: string; key: string | null } | null {
  const m = SHORT_PATH.exec(pathname);
  if (!m) return null;
  const key = hash.startsWith("#") ? hash.slice(1) : hash;
  return { id: m[1], key: KEY_PATTERN.test(key) ? key : null };
}
