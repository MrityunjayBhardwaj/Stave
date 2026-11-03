import { GALLERY_ID_PATTERN } from "../../../../../gallery/types";
import { galleryPaths, galleryStore } from "../../store";
import { sniffImage } from "../../validate";

// #2299 — an entry's thumbnail. Served with the type the bytes themselves say
// (checked again here, not trusted from storage) and nosniff, so the browser
// never treats it as anything but an image. Cached for 5 minutes only, so a
// taken-down entry's picture doesn't outlive it by long.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!GALLERY_ID_PATTERN.test(id)) return new Response("not found", { status: 404 });
  const store = galleryStore();
  if (!store) return new Response("the gallery is not set up here", { status: 503 });

  if (await store.get(galleryPaths.removed(id))) return new Response("not found", { status: 404 });
  const bytes = await store.get(galleryPaths.thumbnail(id));
  const type = bytes && sniffImage(bytes);
  if (!bytes || !type) return new Response("not found", { status: 404 });
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
