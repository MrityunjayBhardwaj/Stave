import type { AdminAction, AdminLogRecord, FlaggedEntry, GalleryAdmin } from "../../../gallery/types";
import { getDb } from "../../../db/client";
import { DatabaseUnavailableError } from "../../../db/errors";
import * as reportsRepo from "../../../db/repo/reports";
import type { Q } from "../../../db/repo/tx";
import { sessionClaim } from "./session";
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
 * #2352 — the `admin_log` table (db/repo/reports.ts), one row per action. A
 * take-down and a dismissal write their row IN THE SAME TRANSACTION as the
 * action itself, so the log and what happened can't disagree: either both
 * land or neither does. Only admins read it (GET /api/gallery/admin/log). A
 * record names the admin by provider, account id and name; never the email.
 *
 * ── API ─────────────────────────────────────────────────────────────────────
 *
 *   parseAdminList(raw)          → Set of "provider:id"
 *   currentAdmin(req)            → GalleryAdmin | null
 *   isAdmin(req)                 → boolean
 *   requireAdmin(req)            → GalleryAdmin | Response (403)
 *   adminReason(req, notAdmin?)  → { admin, reason } | Response
 *       The gate for one admin action: 403 (or `notAdmin()`) unless an admin,
 *       400 without a reason in the JSON body. Logs nothing: the caller writes
 *       the log row with logAdminAction inside the action's own transaction.
 *   logAdminAction(q, admin, what, reason)   one admin_log row (q: a transaction)
 *   adminAction(req, store, { action, target }, notAdmin?)
 *       adminReason, then the log row written on its own, BEFORE the caller
 *       acts. For an action whose records aren't in the database yet
 *       (collections, until they move); `store` is no longer used.
 *   readAdminLog(limit?)         → AdminLogRecord[], newest first
 *   flaggedEntries()             → FlaggedEntry[] (open reports grouped by entry)
 */

export const ADMIN_LOG_LIMIT = reportsRepo.ADMIN_LOG_LIMIT;

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

/** The database, or DatabaseUnavailableError (withDatabase turns it into a 503). */
async function db() {
  const d = await getDb();
  if (!d) throw new DatabaseUnavailableError(new Error("no gallery database is configured"));
  return d;
}

/** Write one admin_log row. Pass the transaction the action itself runs in. */
export async function logAdminAction(
  q: Q,
  admin: GalleryAdmin,
  what: { action: AdminAction; target: string },
  reason: string,
  at = Date.now(),
): Promise<void> {
  await reportsRepo.appendAdminLog(q, { at, admin, action: what.action, target: what.target, reason });
}

/** The newest `limit` records, newest first. */
export async function readAdminLog(limit = ADMIN_LOG_LIMIT): Promise<AdminLogRecord[]> {
  return reportsRepo.readAdminLog(await db(), limit);
}

/** Every open report, grouped by entry, the most recently reported entry first. One query. */
export async function flaggedEntries(): Promise<FlaggedEntry[]> {
  return reportsRepo.flaggedEntries(await db());
}

/**
 * Gate one admin action: admin, then a reason. Returns the Response to send
 * instead when either fails. `notAdmin` is the refusal for someone who isn't
 * an admin (a route that also serves authors keeps its own wording).
 */
export async function adminReason(
  req: Request,
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
  return { admin, reason: checked.value.reason };
}

/**
 * adminReason, then the log row written on its own, BEFORE the caller acts (so
 * an action that fails halfway is still on the record). For an action that
 * can't share a transaction with its log yet. `_store` is no longer read; it
 * stays so existing callers keep compiling.
 */
export async function adminAction(
  req: Request,
  _store: unknown,
  what: { action: AdminAction; target: string },
  notAdmin: () => Response = forbidden,
): Promise<{ admin: GalleryAdmin; reason: string } | Response> {
  const gate = await adminReason(req, notAdmin);
  if (gate instanceof Response) return gate;
  await logAdminAction(await db(), gate.admin, what, gate.reason);
  return gate;
}
