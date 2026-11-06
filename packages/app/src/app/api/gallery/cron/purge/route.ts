import { timingSafeEqual } from "node:crypto";

import { getDb } from "../../../../../db/client";
import { withDatabase } from "../../../../../db/errors";
import { expiredEntryIds, purgeEntryIn } from "../../../../../db/repo/entries";
import { inTransaction } from "../../../../../db/repo/tx";
import { CLEAN_UP, logAdminAction } from "../../admin";
import { deleteEntryFiles } from "../../entryFiles";
import { galleryStore } from "../../store";

// #2401 — the daily clean-up (vercel.json `crons`): every entry an admin took down
// whose window has passed loses its files and private columns, and the action log
// says so. Each entry is its own transaction with its file delete, so one failure
// leaves that entry hidden for the next run and doesn't stop the rest.
//
// Vercel sends `Authorization: Bearer $CRON_SECRET`. With no CRON_SECRET set this
// refuses everyone, so a missing setting can't open it. A run with failures answers
// 500, so it shows as failed in Vercel's cron logs.

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const sent = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

async function handleGET(req: Request): Promise<Response> {
  if (!authorized(req)) return Response.json({ error: "not allowed" }, { status: 403 });
  const store = galleryStore();
  const db = store && (await getDb());
  if (!store || !db) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  const at = Date.now();
  let purged = 0;
  let failed = 0;
  for (const id of await expiredEntryIds(db, at)) {
    try {
      await inTransaction(db, async (tx) => {
        // Restored meanwhile: nothing to do, and nothing to log.
        if (!(await purgeEntryIn(tx, id, at))) return;
        await logAdminAction(tx, CLEAN_UP, { action: "purge-entry", target: id }, "the 30 days to restore it ended", at);
        await deleteEntryFiles(store, id);
        purged++;
      });
    } catch (err) {
      failed++;
      // The name and code only: a query's error carries its values.
      const { name, code } = err as { name?: string; code?: string };
      console.warn(`[stave] couldn't clean up gallery entry ${id}: ${name ?? "unknown"} ${code ?? ""}`);
    }
  }
  return Response.json({ purged, failed }, { status: failed ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}

export const GET = withDatabase(handleGET);
