import { GALLERY_ID_PATTERN } from "../../../../../../../gallery/types";
import { adminAction, openReportsOf, requireAdmin } from "../../../../admin";
import { galleryStore } from "../../../../store";

// #2331 — an admin dismisses the reports on an entry (the entry stays up). Needs
// a reason in the JSON body; the dismissal is logged before the reports go.
// 404 when the entry has no open reports.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  // Admin first, so a non-admin learns nothing about which entries are reported.
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const reports = await openReportsOf(store, id);
  if (reports.length === 0) return Response.json({ error: "no open reports on that entry" }, { status: 404 });

  const done = await adminAction(req, store, { action: "dismiss-report", target: id });
  if (done instanceof Response) return done;
  await store.del(reports);
  return new Response(null, { status: 204 });
}
