import { GALLERY_ID_PATTERN } from "../../../../../../../gallery/types";
import { getDb } from "../../../../../../../db/client";
import { withDatabase } from "../../../../../../../db/errors";
import { closeReports, openReportCount } from "../../../../../../../db/repo/reports";
import { inTransaction } from "../../../../../../../db/repo/tx";
import { adminReason, logAdminAction, requireAdmin } from "../../../../admin";
import { assertSameOrigin } from "../../../../origin";
import { galleryStore } from "../../../../store";

// #2331 — an admin dismisses the reports on an entry (the entry stays up). Needs
// a reason in the JSON body. 404 when the entry has no open reports.
// #2352 — the reports are closed and the dismissal logged in ONE transaction.

const nothingOpen = () => Response.json({ error: "no open reports on that entry" }, { status: 404 });

async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return Response.json({ error: "not found" }, { status: 404 });
  const db = galleryStore() && (await getDb());
  if (!db) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  // Admin first, so a non-admin learns nothing about which entries are reported.
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  if ((await openReportCount(db, id)) === 0) return nothingOpen();

  const gate = await adminReason(req);
  if (gate instanceof Response) return gate;
  const closed = await inTransaction(db, async (tx) => {
    const n = await closeReports(tx, id);
    // Another admin got there first: nothing was dismissed, so nothing is logged.
    if (n > 0) await logAdminAction(tx, gate.admin, { action: "dismiss-report", target: id }, gate.reason);
    return n;
  });
  if (closed === 0) return nothingOpen();
  return new Response(null, { status: 204 });
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const POST = withDatabase(handlePOST);
