import { GALLERY_ID_PATTERN } from "../../../../../../gallery/types";
import { getDb } from "../../../../../../db/client";
import { withDatabase } from "../../../../../../db/errors";
import { getAccountByAuthor } from "../../../../../../db/repo/accounts";
import { liftSuspensionOf } from "../../../../../../db/repo/suspensions";
import { inTransaction } from "../../../../../../db/repo/tx";
import { adminReason, logAdminAction, requireAdmin } from "../../../admin";
import { assertSameOrigin } from "../../../origin";
import { galleryStore } from "../../../store";

// #2400 — an admin ends a suspension early, with a reason, logged in the same
// transaction. The profile and collections come back with it. Entries taken down
// with it stay down: each is restored from the Moderation tab within its window.

const notSuspended = () => Response.json({ error: "that account isn't suspended" }, { status: 404 });

async function handleDELETE(req: Request, { params }: { params: Promise<{ authorId: string }> }): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const { authorId } = await params;
  if (!GALLERY_ID_PATTERN.test(authorId)) return notSuspended();
  const db = galleryStore() && (await getDb());
  if (!db) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  // Admin first, so a non-admin learns nothing about who is suspended.
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const gate = await adminReason(req);
  if (gate instanceof Response) return gate;

  const account = await getAccountByAuthor(db, authorId);
  if (!account) return notSuspended();
  const lifted = await inTransaction(db, async (tx) => {
    const done = await liftSuspensionOf(tx, account.accountHash);
    if (done) await logAdminAction(tx, gate.admin, { action: "lift-suspension", target: authorId }, gate.reason);
    return done;
  });
  return lifted ? new Response(null, { status: 204 }) : notSuspended();
}

export const DELETE = withDatabase(handleDELETE);
