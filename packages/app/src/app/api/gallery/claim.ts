import { SHARE_ID_PATTERN } from "../../../shareCrypto";
import {
  GALLERY_ID_PATTERN,
  MAX_CLAIM_ITEMS,
  type ClaimLinkItem,
  type ClaimRefusal,
  type ClaimRequest,
  type ClaimResponse,
} from "../../../gallery/types";
import type { Db } from "../../../db/client";
import { getAccountByAuthor, getAuthor } from "../../../db/repo/accounts";
import { mergeAuthorInto, moveEntry, type ClaimTarget } from "../../../db/repo/claim";
import { getEntryRecord } from "../../../db/repo/entries";
import { inTransaction, type Q } from "../../../db/repo/tx";
import type { ShareStore } from "../share/store";
import { tokenMatches } from "./auth";
import { accountLinkRecord, recordAccountLink } from "./accountLinks";
import { authorForKey } from "./authors";
import type { SessionAuthor } from "./session";
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
//      author (db/repo/claim.ts mergeAuthorInto);
//   2. the old profile is retired with `merged_into`, and its page answers
//      `{ movedTo }` from then on.
//
// ── One transaction (#2352) ─────────────────────────────────────────────────
//
// Everything the claim writes (the merge, each entry moved by its token, each
// link recorded on the account) happens in ONE database transaction. A claim
// that stops halfway, for any reason, leaves nothing moved, and the browser's
// retry starts from the same state. So there is no write order to keep and no
// half-moved state for readers to tolerate. Only the links' manage records are
// read outside it, first: they live in the share store (Blob), and the
// transaction should not wait on another service.
//
// Running a claim again changes nothing: the old author has nothing left and is
// already retired, moved entries are already the account's, and a link already
// on the account is not written twice.

export { MAX_CLAIM_ITEMS };
export const MAX_CLAIM_BODY_BYTES = 256 * 1024;
const MAX_TOKEN_CHARS = 200;

/**
 * #2345 — what one claim counts against the account's claim limit: one per
 * entry, one per link, one for the old profile, and at least one, so an empty
 * or malformed claim still counts.
 *
 * Why per item and not per request: the storage work is per item (an entry
 * move is several reads and writes), so a per-request limit let one account
 * buy 10 × 1,000 items of work an hour with ten requests. Charging per item,
 * with the per-request cap lowered from 500 to MAX_CLAIM_ITEMS (50 entries and
 * 50 links), bounds the work to the hourly budget (RATE_LIMITS.claim) however
 * the requests are shaped. The cap keeps any single request well under the
 * budget, so a real browser's claim is never refused for its size alone.
 */
export function claimCost(claim: ClaimRequest | null): number {
  if (!claim) return 1;
  return Math.max(1, claim.entries.length + claim.links.length + (claim.authorKey ? 1 : 0));
}

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

const ANOTHER_ACCOUNT = "it belongs to another account";

/**
 * Is `authorId` someone else's? True when it belongs to another account, or was
 * merged into an author other than the target.
 */
async function ownedElsewhere(db: Q, authorId: string, to: { authorId: string; accountHash: string }): Promise<boolean> {
  const author = await getAuthor(db, authorId);
  if (author?.mergedInto) return author.mergedInto !== to.authorId;
  const owner = await getAccountByAuthor(db, authorId);
  return owner !== null && owner.accountHash !== to.accountHash;
}

/** A link's check against the share store: the refusal reason, or null when its token is right. */
async function linkRefusal(shares: ShareStore | null, item: ClaimLinkItem): Promise<string | null> {
  if (!SHARE_ID_PATTERN.test(item.id)) return "that isn't a link id";
  if (!shares) return "short links aren't set up on this site";
  const hash = await shares.getManageHash(item.id);
  if (!hash) return "the link was revoked or no longer exists";
  if (!tokenMatches(item.manageToken, hash)) return "this browser's key for it doesn't match";
  return null;
}

export async function runClaim(
  db: Db,
  shares: ShareStore | null,
  mine: SessionAuthor,
  claim: ClaimRequest,
): Promise<ClaimResponse> {
  // Outside the transaction: the share store is another service.
  const linkChecks = await Promise.all(claim.links.map((item) => linkRefusal(shares, item)));

  return inTransaction(db, async (tx) => {
    const profile = await getAuthor(tx, mine.authorId);
    const to: ClaimTarget & { accountHash: string } = {
      authorId: mine.authorId,
      accountHash: mine.account.accountHash,
      name: profile?.name ?? "",
      email: mine.account.email,
    };
    const moved = { entries: 0, collections: 0, links: 0 };
    const refused: ClaimRefusal[] = [];

    // ── the old author ──────────────────────────────────────────────────────
    if (claim.authorKey) {
      const what = { what: "your old profile", kind: "author" as const };
      const oldId = await authorForKey(tx, claim.authorKey);
      if (!oldId) {
        refused.push({ ...what, reason: "this browser's profile key doesn't match any profile" });
      } else if (oldId !== to.authorId) {
        if (await ownedElsewhere(tx, oldId, to)) {
          refused.push({ ...what, reason: "that profile belongs to another account" });
        } else {
          const n = await mergeAuthorInto(tx, oldId, to);
          moved.entries += n.entries;
          moved.collections += n.collections;
        }
      }
    }

    // ── entries by manage token ─────────────────────────────────────────────
    for (const item of claim.entries) {
      const what = { what: `entry ${item.id}`, kind: "entry" as const, id: item.id };
      if (!GALLERY_ID_PATTERN.test(item.id)) {
        refused.push({ ...what, reason: "that isn't a gallery entry id" });
        continue;
      }
      const record = await getEntryRecord(tx, item.id);
      if (!record || record.removed || !record.manageTokenHash) {
        refused.push({ ...what, reason: "it is no longer in the gallery" });
        continue;
      }
      if (!tokenMatches(item.manageToken, record.manageTokenHash)) {
        refused.push({ ...what, reason: "this browser's key for it doesn't match" });
        continue;
      }
      const owner = record.entry.authorId;
      if (owner === to.authorId) continue; // already yours (moved with the profile, or a rerun)
      // An entry from before profiles (#2314) has no author; the token alone says it's yours.
      if (owner && (await ownedElsewhere(tx, owner, to))) {
        refused.push({ ...what, reason: ANOTHER_ACCOUNT });
        continue;
      }
      if (await moveEntry(tx, item.id, owner ?? null, to)) moved.entries++;
    }

    // ── private links by manage token ───────────────────────────────────────
    for (let i = 0; i < claim.links.length; i++) {
      const item = claim.links[i];
      const reason = linkChecks[i];
      if (reason) {
        refused.push({ what: `private link ${item.id}`, kind: "link", id: item.id, reason });
        continue;
      }
      // A link is a capability: whoever holds its token can already revoke it, so
      // a second account recording it gains nothing the token didn't give. Only
      // id, name and date are kept (#2329); the key stays in the browser.
      const link = accountLinkRecord(item.id, item.projectName, item.createdAt);
      if (await recordAccountLink(tx, to.accountHash, link)) moved.links++;
    }

    return { authorId: to.authorId, moved, refused };
  });
}
