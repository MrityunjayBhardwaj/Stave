import type { AdminLogResponse } from "../../../../../gallery/types";
import { readAdminLog, requireAdmin } from "../../admin";
import { galleryStore } from "../../store";

// #2331 — the admin action log, newest 200 first. Admins only. Each record
// names the admin by provider, account id and name, never by email.

export async function GET(req: Request): Promise<Response> {
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return admin;

  const body: AdminLogResponse = { actions: await readAdminLog(store) };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
