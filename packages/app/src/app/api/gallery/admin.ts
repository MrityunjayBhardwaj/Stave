import { randomBytes } from "node:crypto";

import type {
  AdminAction,
  AdminLogRecord,
  FlaggedEntry,
  GalleryAdmin,
  GalleryEntry,
  GalleryReport,
} from "../../../gallery/types";
import { sessionClaim } from "./session";
import { galleryPaths, getJson, putJson, type GalleryBlobStore } from "./store";
import { checkReport, MAX_REPORT_BODY_BYTES, readJsonBody } from "./validate";

/*
 * #2331 — who moderates the gallery, and the record of what they did.
 *
 * ── Who is an admin ─────────────────────────────────────────────────────────
 *
 * A signed-in account whose `<provider>:<providerAccountId>` is listed in
 * `STAVE_GALLERY_ADMINS` (comma-separated, spaces around entries ignored), e.g.
 *
 *   STAVE_GALLERY_ADMINS="github:12345, google:1049…"
 *
 * The session decides; nothing a request carries (no header, no key) can make
 * someone an admin. Unset or empty, nobody is. A signed-in person finds their
 * own id as `user.accountId` in GET /api/gallery/me.
 *
 * This replaced the shared `STAVE_GALLERY_ADMIN_KEY` header: a leaked key was a
 * full takeover that left no trace of who used it.
 *
 * ── The action log ──────────────────────────────────────────────────────────
 *
 *   gallery/admin-log/<13-digit ms>-<8 hex>.json   one AdminLogRecord per action
 *
 * One private blob per action, appended BEFORE the action is carried out, so a
 * takedown that fails halfway is still on the record. The name sorts by time,
 * so the newest N are found from the listing without reading the rest. Only
 * admins read it (GET /api/gallery/admin/log). A record names the admin by
 * provider, account id and name; never the email.
 *
 * ── API ─────────────────────────────────────────────────────────────────────
 *
 *   parseAdminList(raw)          → Set of "provider:id"
 *   currentAdmin(req)            → GalleryAdmin | null
 *   isAdmin(req)                 → boolean
 *   requireAdmin(req)            → GalleryAdmin | Response (403)
 *   adminAction(req, store, { action, target }, notAdmin?)
 *       → { admin, reason } | Response
 *       The whole gate for one admin action: 403 (or `notAdmin()`) unless an
 *       admin, 400 without a reason in the JSON body, then the log record
 *       written. The caller carries out the action after.
 *   readAdminLog(store, limit)   → AdminLogRecord[], newest first
 *   flaggedEntries(store)        → FlaggedEntry[] (reports grouped by entry)
 *   openReportsOf(store, id)     → the report blobs of one entry
 */

export const ADMIN_LOG_PREFIX = "gallery/admin-log/";
export const ADMIN_LOG_LIMIT = 200;

/** The ids `STAVE_GALLERY_ADMINS` lists, as "provider:id". Blank entries are dropped. */
export function parseAdminList(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const id = part.trim();
    // "provider:id", both halves non-empty. Anything else can match no account.
    const colon = id.indexOf(":");
    if (colon > 0 && colon < id.length - 1) out.add(id);
  }
  return out;
}

/** The id an account is listed under in STAVE_GALLERY_ADMINS. */
export function adminIdOf(provider: string, providerAccountId: string): string {
  return `${provider}:${providerAccountId}`;
}

/**
 * The admin making this request, or null. `_req` is taken so callers never
 * change if reading the session moves onto the request (as session.ts).
 */
export async function currentAdmin(_req: Request): Promise<GalleryAdmin | null> {
  const admins = parseAdminList(process.env.STAVE_GALLERY_ADMINS);
  if (admins.size === 0) return null;
  const signedIn = await sessionClaim();
  if (!signedIn) return null;
  const { claim, name } = signedIn;
  if (!admins.has(adminIdOf(claim.provider, claim.providerAccountId))) return null;
  return { provider: claim.provider, accountId: claim.providerAccountId, name: name || claim.login || "" };
}

export async function isAdmin(req: Request): Promise<boolean> {
  return (await currentAdmin(req)) !== null;
}

const forbidden = () => Response.json({ error: "only gallery admins can do this" }, { status: 403 });

export async function requireAdmin(req: Request): Promise<GalleryAdmin | Response> {
  return (await currentAdmin(req)) ?? forbidden();
}

/** Append one record. Its name sorts by time; the suffix keeps two in one ms apart. */
export async function appendAdminLog(store: GalleryBlobStore, record: AdminLogRecord): Promise<void> {
  const name = `${String(record.at).padStart(13, "0")}-${randomBytes(4).toString("hex")}`;
  await putJson(store, `${ADMIN_LOG_PREFIX}${name}.json`, record);
}

/** The newest `limit` records, newest first. */
export async function readAdminLog(store: GalleryBlobStore, limit = ADMIN_LOG_LIMIT): Promise<AdminLogRecord[]> {
  const listed = await store.list(ADMIN_LOG_PREFIX);
  const newest = listed
    .map((b) => b.pathname)
    .sort()
    .reverse()
    .slice(0, limit);
  const records = await Promise.all(newest.map((p) => getJson<AdminLogRecord>(store, p).catch(() => null)));
  return records.filter((r): r is AdminLogRecord => r !== null);
}

/**
 * Every open report, grouped by entry, the most recently reported entry first.
 * Reports of an entry are deleted with it (and on dismiss), so these are open ones.
 */
export async function flaggedEntries(store: GalleryBlobStore): Promise<FlaggedEntry[]> {
  const listed = await store.list(galleryPaths.reportsPrefix);
  const reports = (
    await Promise.all(listed.map((b) => getJson<GalleryReport>(store, b.pathname).catch(() => null)))
  ).filter((r): r is GalleryReport => r !== null);

  const byEntry = new Map<string, GalleryReport[]>();
  for (const r of reports) byEntry.set(r.entryId, [...(byEntry.get(r.entryId) ?? []), r]);

  const flagged = await Promise.all(
    [...byEntry].map(async ([entryId, rs]): Promise<FlaggedEntry> => {
      rs.sort((a, b) => b.reportedAt - a.reportedAt);
      const entry = await getJson<GalleryEntry>(store, galleryPaths.entry(entryId)).catch(() => null);
      return { entryId, entry, reports: rs.map(({ reason, reportedAt }) => ({ reason, reportedAt })) };
    }),
  );
  return flagged.sort((a, b) => b.reports[0].reportedAt - a.reports[0].reportedAt);
}

/** The blob paths of an entry's open reports. */
export async function openReportsOf(store: GalleryBlobStore, entryId: string): Promise<string[]> {
  return (await store.list(galleryPaths.reportsOf(entryId))).map((b) => b.pathname);
}

/**
 * Gate one admin action: admin, reason, log record. Returns the Response to
 * send instead when any of those fails. `notAdmin` is the refusal for someone
 * who isn't an admin (a route that also serves authors keeps its own wording).
 */
export async function adminAction(
  req: Request,
  store: GalleryBlobStore,
  what: { action: AdminAction; target: string },
  notAdmin: () => Response = forbidden,
): Promise<{ admin: GalleryAdmin; reason: string } | Response> {
  const admin = await currentAdmin(req);
  if (!admin) return notAdmin();

  const body = await readJsonBody(req, MAX_REPORT_BODY_BYTES);
  const checked = body.ok ? checkReport(body.value) : body;
  if (!checked.ok) {
    // "reason is missing" / "reason is empty" / too long; a body that isn't JSON at all reads as missing.
    const error = body.ok ? checked.error : checked.status === 413 ? checked.error : "reason is missing";
    return Response.json({ error, needs: "a JSON body { reason }" }, { status: checked.status });
  }
  const reason = checked.value.reason;
  await appendAdminLog(store, { at: Date.now(), admin, action: what.action, target: what.target, reason });
  return { admin, reason };
}
