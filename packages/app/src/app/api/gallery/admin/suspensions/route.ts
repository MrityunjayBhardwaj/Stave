import {
  GALLERY_ID_PATTERN,
  SUSPENSION_DAYS,
  type SuspensionDays,
  type SuspensionsResponse,
} from "../../../../../gallery/types";
import { getDb } from "../../../../../db/client";
import { withDatabase } from "../../../../../db/errors";
import { getAccountByAuthor } from "../../../../../db/repo/accounts";
import { entriesOfAuthor, removeEntryIn } from "../../../../../db/repo/entries";
import { activeSuspensions, upsertSuspension } from "../../../../../db/repo/suspensions";
import { inTransaction } from "../../../../../db/repo/tx";
import { adminReason, logAdminAction, requireAdmin } from "../../admin";
import { assertSameOrigin } from "../../origin";
import { galleryStore } from "../../store";

// #2400 — suspensions, for admins. GET lists those in force. POST suspends an
// author's account with a reason and a length. With `takeDownAll`, every live entry
// also goes through the normal take-down (hidden, restorable for 30 days), each with
// its own log line, and the profile and collections answer 404 while it lasts. All of
// it lands in ONE transaction with the log.

const DAY_MS = 24 * 60 * 60 * 1000;
const notSetUp = () => Response.json({ error: "the gallery is not set up here" }, { status: 503 });

async function handleGET(req: Request): Promise<Response> {
  const db = galleryStore() && (await getDb());
  if (!db) return notSetUp();
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;
  const body: SuspensionsResponse = { suspensions: await activeSuspensions(db) };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(req: Request): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const db = galleryStore() && (await getDb());
  if (!db) return notSetUp();

  // adminReason reads the body for the reason; the rest of it is read from the original.
  const gate = await adminReason(req.clone());
  if (gate instanceof Response) return gate;
  const body = (await req.json()) as { authorId?: unknown; days?: unknown; takeDownAll?: unknown };

  const { authorId, days, takeDownAll } = body;
  if (typeof authorId !== "string" || !GALLERY_ID_PATTERN.test(authorId)) {
    return Response.json({ error: "authorId is missing" }, { status: 400 });
  }
  if (!SUSPENSION_DAYS.includes(days as SuspensionDays)) {
    return Response.json({ error: "days must be 7, 30 or null" }, { status: 400 });
  }
  if (typeof takeDownAll !== "boolean") {
    return Response.json({ error: "takeDownAll must be true or false" }, { status: 400 });
  }
  const account = await getAccountByAuthor(db, authorId);
  if (!account) return Response.json({ error: "that author has no signed-in account to suspend" }, { status: 404 });

  const at = Date.now();
  await inTransaction(db, async (tx) => {
    await upsertSuspension(tx, {
      accountId: account.accountHash,
      at,
      until: days === null ? null : at + (days as number) * DAY_MS,
      reason: gate.reason,
      hideProfile: takeDownAll,
    });
    await logAdminAction(tx, gate.admin, { action: "suspend-account", target: authorId }, gate.reason, at);
    if (!takeDownAll) return;
    for (const entry of await entriesOfAuthor(tx, authorId)) {
      if (await removeEntryIn(tx, entry.id, at)) {
        await logAdminAction(tx, gate.admin, { action: "take-down-entry", target: entry.id }, gate.reason, at);
      }
    }
  });
  return new Response(null, { status: 204 });
}

export const GET = withDatabase(handleGET);
export const POST = withDatabase(handlePOST);
