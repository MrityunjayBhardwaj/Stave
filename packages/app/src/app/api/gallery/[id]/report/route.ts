import { randomBytes } from "node:crypto";

import { GALLERY_ID_PATTERN, type GalleryReport } from "../../../../../gallery/types";
import { galleryPaths, galleryStore, putJson } from "../../store";
import { checkReport, MAX_REPORT_BODY_BYTES, readJsonBody } from "../../validate";
import { assertSameOrigin } from "../../origin";

// #2303 — anyone can flag an entry with a short reason. Each report is its own
// small blob (never a shared counter), listed for the maintainer by
// GET /api/gallery/reports. The ack says nothing but that it was received.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  const body = await readJsonBody(req, MAX_REPORT_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const checked = checkReport(body.value);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });

  if (await store.get(galleryPaths.removed(id))) {
    return Response.json({ error: "this entry was removed" }, { status: 410 });
  }
  if (!(await store.get(galleryPaths.entry(id)))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const report: GalleryReport = { entryId: id, reason: checked.value.reason, reportedAt: Date.now() };
  const name = `${report.reportedAt}-${randomBytes(4).toString("hex")}`;
  await putJson(store, galleryPaths.report(id, name), report);
  return Response.json({ ok: true }, { status: 202 });
}
