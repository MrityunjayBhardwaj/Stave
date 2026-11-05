import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { AdminLogRecord, FlaggedEntry, GalleryReport } from "../../gallery/types";
import { adminLog, entries, reports } from "../schema";
import { toGalleryEntry } from "./entries";
import type { Q } from "./tx";

/*
 * #2303 / #2331 — reports and the admin action log.
 *
 * A report is open until an admin dismisses it or the entry is taken down
 * (both set `closed_at`; entries.ts removeEntry closes them on takedown).
 */

export const ADMIN_LOG_LIMIT = 200;

/**
 * Record one report of an entry. The entry must exist (the route checks it is live first).
 * Phase 2 caller: POST /api/gallery/[id]/report.
 */
export async function addReport(db: Q, report: GalleryReport): Promise<void> {
  await db.insert(reports).values({ entryId: report.entryId, reason: report.reason, reportedAt: report.reportedAt });
}

/**
 * Every open report, grouped by entry, the most recently reported entry first;
 * each entry's reports newest first. One query.
 * Phase 2 callers: admin.ts flaggedEntries → GET /api/gallery/admin/reports
 * (and its old address GET /api/gallery/reports).
 */
export async function flaggedEntries(db: Q): Promise<FlaggedEntry[]> {
  const rows = await db
    .select({ report: reports, entry: entries })
    .from(reports)
    .innerJoin(entries, eq(entries.id, reports.entryId))
    .where(isNull(reports.closedAt))
    .orderBy(desc(reports.reportedAt), desc(reports.id));
  const byEntry = new Map<string, FlaggedEntry>();
  for (const { report, entry } of rows) {
    let f = byEntry.get(report.entryId);
    if (!f) {
      f = { entryId: report.entryId, entry: entry.removedAt === null ? toGalleryEntry(entry) : null, reports: [] };
      byEntry.set(report.entryId, f);
    }
    f.reports.push({ reason: report.reason, reportedAt: report.reportedAt });
  }
  // Rows came newest first, so the Map's insertion order is "most recently reported entry first".
  return [...byEntry.values()];
}

/**
 * How many open reports an entry has.
 * Phase 2 caller: POST /api/gallery/admin/reports/[id]/dismiss (404 at zero).
 */
export async function openReportCount(db: Q, entryId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reports)
    .where(and(eq(reports.entryId, entryId), isNull(reports.closedAt)));
  return Number(row?.n ?? 0);
}

/**
 * Close every open report of an entry (an admin dismissed them). Returns how many.
 * Phase 2 caller: POST /api/gallery/admin/reports/[id]/dismiss.
 */
export async function closeReports(db: Q, entryId: string, at = Date.now()): Promise<number> {
  const rows = await db
    .update(reports)
    .set({ closedAt: at })
    .where(and(eq(reports.entryId, entryId), isNull(reports.closedAt)))
    .returning({ id: reports.id });
  return rows.length;
}

/**
 * Append one admin action, BEFORE the action is carried out.
 * Phase 2 caller: admin.ts adminAction (DELETE /api/gallery/[id], DELETE
 * /api/gallery/collections/[id], POST /api/gallery/admin/reports/[id]/dismiss).
 */
export async function appendAdminLog(db: Q, record: AdminLogRecord): Promise<void> {
  await db.insert(adminLog).values({
    at: record.at,
    adminProvider: record.admin.provider,
    adminAccountId: record.admin.accountId,
    adminName: record.admin.name,
    action: record.action,
    target: record.target,
    reason: record.reason,
  });
}

/**
 * The newest `limit` admin actions, newest first.
 * Phase 2 caller: admin.ts readAdminLog → GET /api/gallery/admin/log.
 */
export async function readAdminLog(db: Q, limit = ADMIN_LOG_LIMIT): Promise<AdminLogRecord[]> {
  const rows = await db.select().from(adminLog).orderBy(desc(adminLog.at), desc(adminLog.id)).limit(limit);
  return rows.map((r) => ({
    at: r.at,
    admin: { provider: r.adminProvider, accountId: r.adminAccountId, name: r.adminName },
    action: r.action,
    target: r.target,
    reason: r.reason,
  }));
}
