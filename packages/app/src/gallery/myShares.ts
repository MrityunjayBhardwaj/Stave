/**
 * Community gallery (#2302) — My shares: what you published, and taking one
 * down. The steps are injectable so the flow is unit-tested without a dialog
 * host or a server.
 *
 * #2321 — signed in, My shares is the account's list (from
 * /api/gallery/me/shares) plus whatever this browser holds that isn't on the
 * account yet, marked "only in this browser". Signed out it is this browser's
 * list, as before. Both become the same rows (ShareRow, LinkRow); a row with
 * no manage token is managed through the session.
 */
import { deleteFromGallery, revokeShareLink } from "./client";
import { removeLocalShare, removePrivateLink, type LocalPrivateLink, type LocalShare } from "./localShares";
import type { AccountLink, ClaimResponse, GalleryCollection, GalleryEntry, GalleryKind, MySharesResponse } from "./types";

/** Where a row lives: on the signed-in account, or only in this browser's storage. */
export type RowHome = "account" | "browser";

export interface ShareRow {
  id: string;
  title: string;
  kind: GalleryKind;
  publishedAt: number;
  /** This browser's key, when it holds one. Null: the session manages it. */
  manageToken: string | null;
  home: RowHome;
}

export interface LinkRow {
  id: string;
  /**
   * #2329 — the whole link, only when this browser holds it (it made the link).
   * Null for a link made on another device: the account never has the key, so
   * that row can be revoked here but not copied.
   */
  url: string | null;
  projectName: string;
  createdAt: number;
  manageToken: string | null;
  home: RowHome;
}

export interface MyRows {
  entries: ShareRow[];
  links: LinkRow[];
  collections: GalleryCollection[];
}

const fromLocalShare = (s: LocalShare): ShareRow => ({
  id: s.id, title: s.title, kind: s.kind, publishedAt: s.publishedAt, manageToken: s.manageToken, home: "browser",
});
const fromLocalLink = (l: LocalPrivateLink): LinkRow => ({
  id: l.id, url: l.url, projectName: l.projectName, createdAt: l.createdAt, manageToken: l.manageToken, home: "browser",
});

/**
 * The rows My shares shows. Without an account list (signed out), this
 * browser's own. With one, the account's first, then the local items the
 * account doesn't have and never took (not claimed yet, or refused), marked
 * as only in this browser. A local item the account took (#2320 claimedBy) but
 * no longer lists was deleted or revoked from another device: the account is
 * the truth, so it isn't shown again from this browser's stale copy.
 */
export function myRows(account: MySharesResponse | null, local: LocalShare[], localLinks: LocalPrivateLink[]): MyRows {
  if (!account) {
    return { entries: local.map(fromLocalShare), links: localLinks.map(fromLocalLink), collections: [] };
  }
  const notTaken = (x: { claimedBy?: string }) => x.claimedBy !== account.authorId;
  const onAccount = new Set(account.entries.map((e) => e.id));
  const linksOnAccount = new Set(account.links.map((l) => l.id));
  const entries: ShareRow[] = [
    ...account.entries.map((e: GalleryEntry): ShareRow => ({
      id: e.id, title: e.title, kind: e.kind, publishedAt: e.publishedAt, manageToken: null, home: "account",
    })),
    ...local.filter((s) => !onAccount.has(s.id) && notTaken(s)).map(fromLocalShare),
  ].sort((a, b) => b.publishedAt - a.publishedAt);
  // #2329 — the account's list has no keys; Copy again comes from this browser's copy, when it has one.
  const localUrl = new Map(localLinks.map((l) => [l.id, l.url]));
  const links: LinkRow[] = [
    ...account.links.map(
      (l: AccountLink): LinkRow => ({
        id: l.id,
        url: localUrl.get(l.id) ?? null,
        projectName: l.projectName,
        createdAt: l.createdAt,
        manageToken: null,
        home: "account",
      }),
    ),
    ...localLinks.filter((l) => !linksOnAccount.has(l.id) && notTaken(l)).map(fromLocalLink),
  ].sort((a, b) => b.createdAt - a.createdAt);
  return { entries, links, collections: account.collections };
}

export interface DeleteDeps {
  confirm: (share: ShareRow | LocalShare) => Promise<boolean>;
  remove: (id: string, token: string | null) => Promise<void>;
  forget: (id: string) => void;
}

export const defaultDeleteDeps = (confirm: DeleteDeps["confirm"]): DeleteDeps => ({
  confirm,
  remove: deleteFromGallery,
  forget: removeLocalShare,
});

/**
 * Ask, delete on the server (with this browser's manage token, or through the
 * session for an account row), then forget it locally. The local record is
 * dropped only once the server agreed (an entry already gone counts — the
 * client treats 404/410 as done), so a failed delete leaves the token here to
 * try again; the error propagates to be shown.
 */
export async function deleteMyShare(
  share: ShareRow | LocalShare,
  deps: DeleteDeps,
): Promise<"deleted" | "cancelled"> {
  if (!(await deps.confirm(share))) return "cancelled";
  await deps.remove(share.id, share.manageToken);
  deps.forget(share.id);
  return "deleted";
}

export type ShareStatus = "listed" | "missing" | "unknown";

/**
 * Is a share still in the public list? `unknown` while the list hasn't loaded
 * (or failed), so a load error is never shown as "removed".
 */
export function shareStatus(share: { id: string }, listed: readonly GalleryEntry[] | null): ShareStatus {
  if (!listed) return "unknown";
  return listed.some((e) => e.id === share.id) ? "listed" : "missing";
}

/** #2311 — the same flow for a private short link: ask, revoke on the server, then forget. */
export interface RevokeDeps {
  confirm: (link: LinkRow | LocalPrivateLink) => Promise<boolean>;
  revoke: (id: string, token: string | null) => Promise<void>;
  forget: (id: string) => void;
}

export const defaultRevokeDeps = (confirm: RevokeDeps["confirm"]): RevokeDeps => ({
  confirm,
  revoke: revokeShareLink,
  forget: removePrivateLink,
});

/** Forgotten locally only once the server agreed (already gone counts), so a failure leaves the key to retry. */
export async function revokeMyLink(link: LinkRow | LocalPrivateLink, deps: RevokeDeps): Promise<"revoked" | "cancelled"> {
  if (!(await deps.confirm(link))) return "cancelled";
  await deps.revoke(link.id, link.manageToken);
  deps.forget(link.id);
  return "revoked";
}

// ── #2320 what a claim says ────────────────────────────────────────────────

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 entries, 1 collection and 2 private links", the parts that are not zero; "" when all are. */
export function movedPhrase(moved: ClaimResponse["moved"]): string {
  const parts = [
    moved.entries ? counted(moved.entries, "entry", "entries") : "",
    moved.collections ? counted(moved.collections, "collection", "collections") : "",
    moved.links ? counted(moved.links, "private link", "private links") : "",
  ].filter(Boolean);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The toasts a claim's answer earns: what came in, and what didn't (with the first reason). */
export function claimToasts(res: ClaimResponse): Array<{ text: string; kind: "info" | "error" }> {
  const out: Array<{ text: string; kind: "info" | "error" }> = [];
  const phrase = movedPhrase(res.moved);
  if (phrase) out.push({ text: `Brought ${phrase} into your account.`, kind: "info" });
  if (res.refused.length) {
    const first = res.refused[0];
    const more = res.refused.length > 1 ? ` (and ${res.refused.length - 1} more)` : "";
    out.push({
      text: `Couldn't bring ${first.what} into your account: ${first.reason}${more}. It stays in this browser.`,
      kind: "error",
    });
  }
  return out;
}
