import type { AdminLogResponse } from "../../../../../gallery/types";
import { getDb } from "../../../../../db/client";
import { withDatabase } from "../../../../../db/errors";
import { readAdminLog, requireAdmin } from "../../admin";
import { galleryStore } from "../../store";

// #2331 — the admin action log, newest 200 first. Admins only. Each record
// names the admin by provider, account id and name, never by email.
// #2352 — read from the admin_log table.

async function handleGET(req: Request): Promise<Response> {
  if (!galleryStore() || !(await getDb())) {
    return Response.json({ error: "the gallery is not set up here" }, { status: 503 });
  }
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const body: AdminLogResponse = { actions: await readAdminLog() };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withDatabase(handleGET);
