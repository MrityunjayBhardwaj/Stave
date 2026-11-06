/**
 * #2331 — the browser side of the admin routes (types.ts "#2331 admins"). The
 * session cookie is what makes the request an admin's; nothing else is sent.
 * Every function throws an Error whose message a person can act on.
 */
import type { AdminLogResponse, ModerationReportsResponse, SuspendRequest, SuspensionsResponse, TakenDownResponse } from "./types";

async function failure(res: Response, what: string): Promise<Error> {
  if (res.status === 403) return new Error("only gallery admins can do this (your session may have ended)");
  if (res.status === 503) return new Error("the gallery isn't set up on this site");
  let detail = "";
  try {
    detail = ((await res.json()) as { error?: string })?.error ?? "";
  } catch {
    /* not JSON */
  }
  return new Error(detail || `${what} failed (${res.status})`);
}

const json = (reason: string): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ reason }),
});

export async function fetchFlagged(): Promise<ModerationReportsResponse> {
  const res = await fetch("/api/gallery/admin/reports", { cache: "no-store" });
  if (!res.ok) throw await failure(res, "loading the reports");
  return (await res.json()) as ModerationReportsResponse;
}

export async function fetchAdminLog(): Promise<AdminLogResponse> {
  const res = await fetch("/api/gallery/admin/log", { cache: "no-store" });
  if (!res.ok) throw await failure(res, "loading the log");
  return (await res.json()) as AdminLogResponse;
}

export async function fetchTakenDown(): Promise<TakenDownResponse> {
  const res = await fetch("/api/gallery/admin/removed", { cache: "no-store" });
  if (!res.ok) throw await failure(res, "loading what was taken down");
  return (await res.json()) as TakenDownResponse;
}

/** #2401 — bring a taken-down entry back. Throws when its window has passed. */
export async function restoreEntry(id: string, reason: string): Promise<void> {
  const res = await fetch(`/api/gallery/admin/removed/${encodeURIComponent(id)}/restore`, {
    method: "POST",
    ...json(reason),
  });
  if (res.status === 204) return;
  throw await failure(res, "restoring it");
}

export async function fetchSuspensions(): Promise<SuspensionsResponse> {
  const res = await fetch("/api/gallery/admin/suspensions", { cache: "no-store" });
  if (!res.ok) throw await failure(res, "loading the suspensions");
  return (await res.json()) as SuspensionsResponse;
}

/** #2400 — suspend an entry's author. Throws when the author has no signed-in account. */
export async function suspendAuthor(request: SuspendRequest): Promise<void> {
  const res = await fetch("/api/gallery/admin/suspensions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (res.status === 204) return;
  throw await failure(res, "suspending the account");
}

/** #2400 — end a suspension early. Already over (404) counts as done. */
export async function liftSuspension(authorId: string, reason: string): Promise<void> {
  const res = await fetch(`/api/gallery/admin/suspensions/${encodeURIComponent(authorId)}`, { method: "DELETE", ...json(reason) });
  if (res.status === 204 || res.status === 404) return;
  throw await failure(res, "lifting the suspension");
}

/** Take an entry down for everyone. Already gone (404 / 410) counts as done. */
export async function takeDownEntry(id: string, reason: string): Promise<void> {
  const res = await fetch(`/api/gallery/${encodeURIComponent(id)}`, { method: "DELETE", ...json(reason) });
  if (res.status === 204 || res.status === 404 || res.status === 410) return;
  throw await failure(res, "taking it down");
}

/** Dismiss every open report on an entry; it stays up. No reports left counts as done. */
export async function dismissReports(id: string, reason: string): Promise<void> {
  const res = await fetch(`/api/gallery/admin/reports/${encodeURIComponent(id)}/dismiss`, {
    method: "POST",
    ...json(reason),
  });
  if (res.status === 204 || res.status === 404) return;
  throw await failure(res, "dismissing");
}

export const ACTION_LABEL = {
  "take-down-entry": "Took down entry",
  "take-down-collection": "Took down collection",
  "dismiss-report": "Dismissed reports on",
  "restore-entry": "Restored entry",
  "purge-entry": "Deleted the files of entry",
  "suspend-account": "Suspended the account of author",
  "lift-suspension": "Lifted the suspension of author",
} as const;
