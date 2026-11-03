import { ADMIN_KEY_HEADER, type GalleryReport, type ReportsResponse } from "../../../../gallery/types";
import { isAdminKey } from "../auth";
import { galleryPaths, galleryStore, getJson } from "../store";

// #2303 — the maintainer's flagged list, newest first. Needs the admin key
// (`STAVE_GALLERY_ADMIN_KEY`); with none set on the server, nobody can read it.
// Reports of an entry are deleted with the entry, so this lists open ones only.

export async function GET(req: Request): Promise<Response> {
  if (!isAdminKey(req.headers.get(ADMIN_KEY_HEADER))) {
    return Response.json({ error: "admin key required" }, { status: 403 });
  }
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  const listed = await store.list(galleryPaths.reportsPrefix);
  const reports = (
    await Promise.all(listed.map((b) => getJson<GalleryReport>(store, b.pathname).catch(() => null)))
  ).filter((r): r is GalleryReport => r !== null);
  reports.sort((a, b) => b.reportedAt - a.reportedAt);

  const body: ReportsResponse = { reports };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
