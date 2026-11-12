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
 * "This site" is (#2347):
 *   - the `Host` header: the host the browser addressed. A page on another
 *     site can't change it; the browser sets it from the URL it is fetching.
 *     On Vercel it is "the domain name as it was accessed by the client"
 *     (vercel.com/docs/headers/request-headers, `host`), so preview URLs,
 *     branch URLs and custom domains all name themselves;
 *   - the request URL's host when there is no `Host` header (tests);
 *   - and the configured site, `AUTH_URL` (or `NEXTAUTH_URL`), when set: the
 *     address a self-hosted Stave behind a proxy that rewrites `Host` has to
 *     set anyway, because Auth.js needs it too.
 *
 * `X-Forwarded-Host` is NOT read. Any client can send it, and Next.js keeps
 * whatever came in (next/dist/server/base-server.js only fills it in when it
 * is missing), so `Origin: https://evil.com` + `X-Forwarded-Host: evil.com`
 * used to pass. On Vercel it adds nothing: the platform documents it as
 * "identical to the host header".
 */

export const CROSS_ORIGIN_REFUSED = "this can only be done from Stave's own page";

type Env = Record<string, string | undefined>;

function firstValue(v: string | null): string | null {
  const first = v?.split(",")[0]?.trim();
  return first ? first.toLowerCase() : null;
}

/** The hosts that count as this site for `req`, lower-case `host[:port]`. The Turnstile check reuses it. */
export function siteHosts(req: Request, env: Env = process.env): Set<string> {
  const hosts = new Set<string>();
  const host = firstValue(req.headers.get("host"));
  if (host) hosts.add(host);
  else {
    try {
      hosts.add(new URL(req.url).host.toLowerCase());
    } catch {
      // no usable URL either
    }
  }
  const configured = env.AUTH_URL || env.NEXTAUTH_URL;
  if (configured) {
    try {
      hosts.add(new URL(configured).host.toLowerCase());
    } catch {
      // a malformed AUTH_URL adds nothing
    }
  }
  return hosts;
}

/** Is this request's `Origin` absent or this site? */
export function isSameOriginRequest(req: Request, env: Env = process.env): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false; // "null", or anything that isn't an origin
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  return siteHosts(req, env).has(parsed.host.toLowerCase());
}

/** A 403 to return when the request came from another site or an opaque origin; `null` to carry on. */
export function assertSameOrigin(req: Request, env: Env = process.env): Response | null {
  if (isSameOriginRequest(req, env)) return null;
  return Response.json({ error: CROSS_ORIGIN_REFUSED }, { status: 403 });
}
