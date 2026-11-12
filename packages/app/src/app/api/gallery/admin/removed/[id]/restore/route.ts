import { GALLERY_ID_PATTERN } from "../../../../../../../gallery/types";
import { getDb } from "../../../../../../../db/client";
import { withDatabase } from "../../../../../../../db/errors";
import { restoreEntryIn } from "../../../../../../../db/repo/entries";
import { inTransaction } from "../../../../../../../db/repo/tx";
import { adminReason, logAdminAction, requireAdmin } from "../../../../admin";
import { assertSameOrigin } from "../../../../origin";
import { galleryStore } from "../../../../store";

// #2401 — an admin brings a taken-down entry back, with the same id, links and
// collections. Needs a reason in the JSON body. The entry and its log record
// change in ONE transaction. 404 when it can't be restored: not hidden, already
// purged, or past its window. The author's suspension doesn't matter here (#2400):
// restoring is the admin's explicit decision.

async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const db = galleryStore() && (await getDb());
  if (!db) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  // Admin first, so a non-admin learns nothing about what was taken down.
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const gate = await adminReason(req);
  if (gate instanceof Response) return gate;

  const at = Date.now();
  const restored = await inTransaction(db, async (tx) => {
    const done = await restoreEntryIn(tx, id, at);
    if (done) await logAdminAction(tx, gate.admin, { action: "restore-entry", target: id }, gate.reason, at);
    return done;
  });
  if (!restored) return Response.json({ error: "that entry can't be restored" }, { status: 404 });
  return new Response(null, { status: 204 });
}

export const POST = withDatabase(handlePOST);
