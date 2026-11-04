import { SHARE_ID_PATTERN } from "../../../shareCrypto";
import {
  GALLERY_ID_PATTERN,
  type ClaimLinkItem,
  type ClaimRefusal,
  type ClaimRequest,
  type ClaimResponse,
  type GalleryCollection,
  type GalleryEntry,
} from "../../../gallery/types";
import type { ShareStore } from "../share/store";
import { tokenMatches } from "./auth";
import { accountLinkRecord, recordAccountLink } from "./accountLinks";
import { authorForKey, indexedIds } from "./authors";
import { accountForAuthor, type SessionAuthor } from "./session";
import {
  galleryPaths,
  getJson,
  putJson,
  type GalleryBlobStore,
  type PrivateRecord,
  type StoredAuthorProfile,
} from "./store";
import type { Checked } from "./validate";

// #2320 — bring what this browser published before sign-in into the account.
//
// The browser sends the keys it holds: its old author key, the manage token of
// each gallery entry, the manage token of each private link. Each is checked
// against its stored SHA-256 with the constant-time compare (auth.ts
// tokenMatches, authors.ts authorForKey); nothing is trusted on the browser's say.
//
// By the time anyone claims, the account already has an author (opening the app
// signed in makes it), so claiming the old author is a MERGE into the account's
// author, not a link:
//   1. every entry and collection of the old author moves onto the account's
//      author (its authorId rewritten, the per-author indexes moved);
//   2. the old profile is retired with `mergedInto`, and its page answers
//      `{ movedTo }` from then on.
//
// ── Write order (crash safety) ──────────────────────────────────────────────
//
// Blob has no transactions, so a claim can stop between any two writes. The
// order makes every stopping point safe and lets running the claim again finish
// the job:
//
//   per entry:      new index marker → entry's private record (account email)
//                   → the entry JSON with the new authorId (THE FLIP) → old marker deleted
//   per collection: new index marker → the collection with the new authorId
//                   (THE FLIP) → old marker deleted
//   entries before collections, so a moved collection never names entries its
//                   new author doesn't own yet (a PUT would refuse them);
//   the old profile retired LAST.
//
// Why that is safe: every reader treats the per-author index as a hint and
// re-checks the record it points at (authors.ts authorWork), so a new marker
// written before its flip shows nothing, and an old marker left after it shows
// nothing either. Each item changes owner in exactly one write. And because the
// old profile is retired last, a claim that stopped early leaves it live, still
// holding what didn't move, with its key still working — so the next run (the
// browser retries until a claim succeeds) moves the rest. A rerun after the
// retirement sweeps the old indexes again, finds them empty, and changes nothing.

export const MAX_CLAIM_ITEMS = 500;
export const MAX_CLAIM_BODY_BYTES = 256 * 1024;
const MAX_TOKEN_CHARS = 200;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const bad = (error: string): Checked<never> => ({ ok: false, status: 400, error });

const tokenShape = (t: unknown): t is string => typeof t === "string" && t.length > 0 && t.length <= MAX_TOKEN_CHARS;

/** Shape check only; whether each key is real is the claim's job. */
export function checkClaim(v: unknown): Checked<ClaimRequest> {
  if (!isObject(v)) return bad("the claim must be a JSON object");
  const out: ClaimRequest = { entries: [], links: [] };
  if (v.authorKey !== undefined && v.authorKey !== null) {
    if (!tokenShape(v.authorKey)) return bad("authorKey is not a key");
    out.authorKey = v.authorKey;
  }
  for (const field of ["entries", "links"] as const) {
    const list = v[field] ?? [];
    if (!Array.isArray(list)) return bad(`${field} must be a list`);
    if (list.length > MAX_CLAIM_ITEMS) return bad(`at most ${MAX_CLAIM_ITEMS} ${field} at once`);
    for (const item of list) {
      if (!isObject(item) || typeof item.id !== "string" || !tokenShape(item.manageToken)) {
        return bad(`each of ${field} needs an id and a manageToken`);
      }
      if (field === "entries") {
        out.entries.push({ id: item.id, manageToken: item.manageToken });
      } else {
        // #2329 — a `url` (an older browser sent the whole link, key included)
        // is never read: the account keeps only id, name and date.
        const link: ClaimLinkItem = { id: item.id, manageToken: item.manageToken };
        if (item.projectName !== undefined) link.projectName = item.projectName as string;
        if (typeof item.createdAt === "number" && Number.isFinite(item.createdAt)) link.createdAt = item.createdAt;
        out.links.push(link);
      }
    }
  }
  return { ok: true, value: out };
}

interface Target {
  authorId: string;
  accountHash: string;
  name: string;
  email: string;
}

/**
 * Move one entry from `from` to the target, in the order the header gives. True
 * when it moved. `from` is undefined for an entry made before profiles existed.
 */
async function moveEntry(store: GalleryBlobStore, id: string, from: string | undefined, to: Target): Promise<boolean> {
  const entry = await getJson<GalleryEntry>(store, galleryPaths.entry(id)).catch(() => null);
  if (!entry || entry.authorId !== from) return false;
  if (await store.get(galleryPaths.removed(id))) return false;
  await putJson(store, galleryPaths.authorEntry(to.authorId, id), {});
  const record = await getJson<PrivateRecord>(store, galleryPaths.privateRecord(id));
  if (record && record.authorEmail !== to.email) {
    await putJson(store, galleryPaths.privateRecord(id), { ...record, authorEmail: to.email } satisfies PrivateRecord);
  }
  await putJson(store, galleryPaths.entry(id), { ...entry, authorId: to.authorId, authorName: to.name || entry.authorName } satisfies GalleryEntry);
  if (from) await store.del([galleryPaths.authorEntry(from, id)]);
  return true;
}

async function moveCollection(store: GalleryBlobStore, id: string, from: string, to: Target): Promise<boolean> {
  const c = await getJson<GalleryCollection>(store, galleryPaths.collection(id)).catch(() => null);
  if (!c || c.authorId !== from) return false;
  await putJson(store, galleryPaths.authorCollection(to.authorId, id), {});
  await putJson(store, galleryPaths.collection(id), { ...c, authorId: to.authorId } satisfies GalleryCollection);
  await store.del([galleryPaths.authorCollection(from, id)]);
  return true;
}

/** Sweep an author's indexes onto the target. Index markers left behind by a move are tidied too. */
async function moveAuthorWork(store: GalleryBlobStore, from: string, to: Target): Promise<{ entries: number; collections: number }> {
  let entries = 0;
  let collections = 0;
  for (const id of await indexedIds(store, galleryPaths.authorEntriesOf(from))) {
    if (await moveEntry(store, id, from, to)) entries++;
    else await store.del([galleryPaths.authorEntry(from, id)]); // gone, or already moved: tidy the hint
  }
  for (const id of await indexedIds(store, galleryPaths.authorCollectionsOf(from))) {
    if (await moveCollection(store, id, from, to)) collections++;
    else await store.del([galleryPaths.authorCollection(from, id)]);
  }
  return { entries, collections };
}

/**
 * Is `authorId` someone else's? True when it belongs to another account, or was
 * merged into an author other than the target.
 */
async function ownedElsewhere(store: GalleryBlobStore, authorId: string, to: Target): Promise<boolean> {
  const profile = await getJson<StoredAuthorProfile>(store, galleryPaths.author(authorId));
  if (profile?.mergedInto) return profile.mergedInto !== to.authorId;
  const owner = await accountForAuthor(store, authorId);
  return owner !== null && owner.accountHash !== to.accountHash;
}

const ANOTHER_ACCOUNT = "it belongs to another account";

export async function runClaim(
  store: GalleryBlobStore,
  shares: ShareStore | null,
  mine: SessionAuthor,
  claim: ClaimRequest,
): Promise<ClaimResponse> {
  const profile = await getJson<StoredAuthorProfile>(store, galleryPaths.author(mine.authorId));
  const to: Target = {
    authorId: mine.authorId,
    accountHash: mine.account.accountHash,
    name: profile?.name ?? "",
    email: mine.account.email,
  };
  const moved = { entries: 0, collections: 0, links: 0 };
  const refused: ClaimRefusal[] = [];

  // ── the old author ────────────────────────────────────────────────────────
  if (claim.authorKey) {
    const what = { what: "your old profile", kind: "author" as const };
    const oldId = await authorForKey(store, claim.authorKey);
    if (!oldId) {
      refused.push({ ...what, reason: "this browser's profile key doesn't match any profile" });
    } else if (oldId !== to.authorId) {
      if (await ownedElsewhere(store, oldId, to)) {
        refused.push({ ...what, reason: "that profile belongs to another account" });
      } else {
        const n = await moveAuthorWork(store, oldId, to);
        moved.entries += n.entries;
        moved.collections += n.collections;
        const old = await getJson<StoredAuthorProfile>(store, galleryPaths.author(oldId));
        if (old && !old.mergedInto) {
          // The bio comes along when the account's profile has none yet.
          if (profile && !profile.bio && old.bio) {
            await putJson(store, galleryPaths.author(to.authorId), { ...profile, bio: old.bio, updatedAt: Date.now() });
          }
          // LAST: retire the old profile (see the header for why).
          await putJson(store, galleryPaths.author(oldId), { ...old, mergedInto: to.authorId, updatedAt: Date.now() });
        }
      }
    }
  }

  // ── entries by manage token ─────────────────────────────────────────────────
  for (const item of claim.entries) {
    const what = { what: `entry ${item.id}`, kind: "entry" as const, id: item.id };
    if (!GALLERY_ID_PATTERN.test(item.id)) {
      refused.push({ ...what, reason: "that isn't a gallery entry id" });
      continue;
    }
    const [record, removed, entry] = await Promise.all([
      getJson<PrivateRecord>(store, galleryPaths.privateRecord(item.id)),
      store.get(galleryPaths.removed(item.id)),
      getJson<GalleryEntry>(store, galleryPaths.entry(item.id)).catch(() => null),
    ]);
    if (!record || removed || !entry) {
      refused.push({ ...what, reason: "it is no longer in the gallery" });
      continue;
    }
    if (!tokenMatches(item.manageToken, record.manageTokenHash)) {
      refused.push({ ...what, reason: "this browser's key for it doesn't match" });
      continue;
    }
    if (entry.authorId === to.authorId) continue; // already yours (moved with the profile, or a rerun)
    // An entry from before profiles (#2314) has no author; the token alone says it's yours.
    if (entry.authorId && (await ownedElsewhere(store, entry.authorId, to))) {
      refused.push({ ...what, reason: ANOTHER_ACCOUNT });
      continue;
    }
    if (await moveEntry(store, item.id, entry.authorId, to)) moved.entries++;
  }

  // ── private links by manage token ─────────────────────────────────────────
  for (const item of claim.links) {
    const what = { what: `private link ${item.id}`, kind: "link" as const, id: item.id };
    if (!SHARE_ID_PATTERN.test(item.id)) {
      refused.push({ ...what, reason: "that isn't a link id" });
      continue;
    }
    if (!shares) {
      refused.push({ ...what, reason: "short links aren't set up on this site" });
      continue;
    }
    const hash = await shares.getManageHash(item.id);
    if (!hash) {
      refused.push({ ...what, reason: "the link was revoked or no longer exists" });
      continue;
    }
    if (!tokenMatches(item.manageToken, hash)) {
      refused.push({ ...what, reason: "this browser's key for it doesn't match" });
      continue;
    }
    // A link is a capability: whoever holds its token can already revoke it, so
    // a second account recording it gains nothing the token didn't give. Only
    // id, name and date are kept (#2329); the key stays in the browser.
    const link = accountLinkRecord(item.id, item.projectName, item.createdAt);
    if (await recordAccountLink(store, to.accountHash, link)) moved.links++;
  }

  return { authorId: to.authorId, moved, refused };
}
