import type { ModerationReportsResponse } from "../../../../../gallery/types";
import { flaggedEntries, requireAdmin } from "../../admin";
import { galleryStore } from "../../store";

// #2331 — the flagged list for admins: every reported entry with its reports,
// the most recently reported first. 403 for anyone who isn't a signed-in admin
// (STAVE_GALLERY_ADMINS). Also answers at its old address, /api/gallery/reports.

export async function GET(req: Request): Promise<Response> {
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const body: ModerationReportsResponse = { flagged: await flaggedEntries(store) };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
