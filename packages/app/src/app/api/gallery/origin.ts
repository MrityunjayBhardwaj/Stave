/**
 * #2328 — every gallery and share route that changes something (publish,
 * delete, revoke, report, claim, profile and collection edits) first checks
 * that the request came from Stave's own page.
 *
 * Browsers put an `Origin` header on every POST / PUT / DELETE. It is either
 * this site, another site, or `null` — what a sandboxed frame (the gallery's
 * preview player, see GalleryPreview.tsx) or a privacy-sensitive context
 * sends. Only this site passes; the others get 403 before anything else runs,
 * so code playing in the preview can't publish, delete or edit as you even if a
 * browser did send your cookie along.
 *
 * NO `Origin` header passes. Browsers always send one on these methods, so a
 * request without one isn't coming from a page at all: it's curl, a script or
 * another server, which holds no visitor's cookie to abuse (the session cookie
 * is SameSite=Lax, and the routes still check the session or manage key as
 * before). The threat this guards against is in the browser; refusing
 * header-less requests would only break tools without making anyone safer.
 *
 * "This site" is the host the request was addressed to — `x-forwarded-host`
 * behind a proxy, else `host`, else the request URL — the same rule Next.js
 * applies to Server Actions.
 */

export const CROSS_ORIGIN_REFUSED = "this can only be done from Stave's own page";

function firstValue(v: string | null): string | null {
  const first = v?.split(",")[0]?.trim();
  return first ? first.toLowerCase() : null;
}

function siteHost(req: Request): string | null {
  const forwarded = firstValue(req.headers.get("x-forwarded-host"));
  if (forwarded) return forwarded;
  const host = firstValue(req.headers.get("host"));
  if (host) return host;
  try {
    return new URL(req.url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Is this request's `Origin` absent or this site? */
export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false; // "null", or anything that isn't an origin
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = siteHost(req);
  return host !== null && parsed.host.toLowerCase() === host;
}

/** A 403 to return when the request came from another site or an opaque origin; `null` to carry on. */
export function assertSameOrigin(req: Request): Response | null {
  if (isSameOriginRequest(req)) return null;
  return Response.json({ error: CROSS_ORIGIN_REFUSED }, { status: 403 });
}
