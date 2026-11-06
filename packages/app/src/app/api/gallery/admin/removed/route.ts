import { TAKEDOWN_KEEP_MS, type TakenDownResponse } from "../../../../../gallery/types";
import { getDb } from "../../../../../db/client";
import { withDatabase } from "../../../../../db/errors";
import { hiddenEntries } from "../../../../../db/repo/entries";
import { takeDownReasons } from "../../../../../db/repo/reports";
import { requireAdmin } from "../../admin";
import { galleryStore } from "../../store";

// #2401 — what an admin took down and has not been purged yet. Admins only, and
// never the email or the token: only the public fields, the dates and the reason.

async function handleGET(req: Request): Promise<Response> {
  const db = galleryStore() && (await getDb());
  if (!db) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const hidden = await hiddenEntries(db);
  const reasons = await takeDownReasons(db, hidden.map((h) => h.entry.id));
  const body: TakenDownResponse = {
    entries: hidden.map(({ entry, removedAt }) => ({
      entry,
      removedAt,
      restoreBy: removedAt + TAKEDOWN_KEEP_MS,
      reason: reasons.get(entry.id) ?? "",
    })),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withDatabase(handleGET);
