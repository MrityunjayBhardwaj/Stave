"use client";

import { Analytics, type BeforeSend } from "@vercel/analytics/next";

/**
 * #2407 — the address a page view reports, with everything after the path removed.
 *
 * Vercel's script sends `location.href` as it is, `#` part included. A private
 * link's key lives there, and a long link's whole project, and the app clears the
 * address only after the first page view has gone. The query string goes too:
 * nothing we count needs it, and it can carry anything a visitor was linked with.
 */
export function withoutPrivateParts(address: string): string {
  const url = new URL(address);
  url.hash = "";
  url.search = "";
  return url.href;
}

const beforeSend: BeforeSend = (event) => ({ ...event, url: withoutPrivateParts(event.url) });

/**
 * Page views for the project's Vercel Analytics tab (#2055): no cookies, nothing
 * from the editor. A client component because `beforeSend` is a function, which a
 * server layout can't pass down.
 */
export function SiteAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
