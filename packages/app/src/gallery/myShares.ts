/**
 * Community gallery (#2302) — My shares: what this browser published, and
 * taking one down. The steps are injectable so the flow is unit-tested without
 * a dialog host or a server.
 */
import { deleteFromGallery } from "./client";
import { removeLocalShare, type LocalShare } from "./localShares";
import type { GalleryEntry } from "./types";

export interface DeleteDeps {
  confirm: (share: LocalShare) => Promise<boolean>;
  remove: (id: string, token: string) => Promise<void>;
  forget: (id: string) => void;
}

export const defaultDeleteDeps = (confirm: DeleteDeps["confirm"]): DeleteDeps => ({
  confirm,
  remove: deleteFromGallery,
  forget: removeLocalShare,
});

/**
 * Ask, delete on the server with this browser's manage token, then forget it
 * locally. The local record is dropped only once the server agreed (an entry
 * already gone counts — the client treats 404/410 as done), so a failed delete
 * leaves the token here to try again; the error propagates to be shown.
 */
export async function deleteMyShare(share: LocalShare, deps: DeleteDeps): Promise<"deleted" | "cancelled"> {
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
export function shareStatus(share: LocalShare, listed: readonly GalleryEntry[] | null): ShareStatus {
  if (!listed) return "unknown";
  return listed.some((e) => e.id === share.id) ? "listed" : "missing";
}
