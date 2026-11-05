import type { ModerationReportsResponse } from "../../../../../gallery/types";
import { getDb } from "../../../../../db/client";
import { withDatabase } from "../../../../../db/errors";
import { flaggedEntries, requireAdmin } from "../../admin";
import { galleryStore } from "../../store";

// #2331 — the flagged list for admins: every reported entry with its open
// reports, the most recently reported first. 403 for anyone who isn't a signed-in
// admin (STAVE_GALLERY_ADMINS). Also answers at its old address, /api/gallery/reports.
// #2352 — one query over the reports table (open reports only).

async function handleGET(req: Request): Promise<Response> {
  if (!galleryStore() || !(await getDb())) {
    return Response.json({ error: "the gallery is not set up here" }, { status: 503 });
  }
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const body: ModerationReportsResponse = { flagged: await flaggedEntries() };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withDatabase(handleGET);
