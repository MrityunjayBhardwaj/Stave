import { randomBytes } from "node:crypto";

import { GALLERY_ID_PATTERN, type GalleryReport } from "../../../../../gallery/types";
import { limitRequest } from "../../rateLimit";
import { galleryPaths, galleryStore, putJson } from "../../store";
import { requireTurnstile } from "../../turnstile";
import { checkReport, MAX_REPORT_BODY_BYTES, readJsonBody } from "../../validate";
import { assertSameOrigin } from "../../origin";
import { withDatabase } from "../../../../../db/errors";

// #2303 — anyone can flag an entry with a short reason. Each report is its own
// small blob (never a shared counter), listed for admins by
// GET /api/gallery/admin/reports (#2331). The ack says nothing but that it was received.

async function handlePOST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });
  // #2330 — per account (or per address signed out), then Turnstile when set up.
  const limited = (await limitRequest("report", req)) ?? (await requireTurnstile(req));
  if (limited) return limited;

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

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const POST = withDatabase(handlePOST);
