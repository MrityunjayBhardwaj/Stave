// @vitest-environment node
// #2328 — the gallery and share routes that change something answer 403 to a
// request from another site or from an opaque origin (`Origin: null`, what the
// sandboxed preview frame sends), and carry on for this site or no Origin.
import { describe, expect, it, vi } from "vitest";

// The routes import Auth.js; never reach it — the origin check runs first.
const fake = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../auth", () => ({
  auth: vi.fn(async () => {
    fake.calls++;
    return null;
  }),
}));

import { assertSameOrigin, CROSS_ORIGIN_REFUSED, isSameOriginRequest } from "../app/api/gallery/origin";
import { POST as publish } from "../app/api/gallery/route";
import { DELETE as deleteEntry } from "../app/api/gallery/[id]/route";
import { POST as report } from "../app/api/gallery/[id]/report/route";
import { POST as createCollection } from "../app/api/gallery/collections/route";
import { DELETE as deleteCollection, PUT as editCollection } from "../app/api/gallery/collections/[id]/route";
import { POST as claim } from "../app/api/gallery/claim/route";
import { PUT as editProfile } from "../app/api/gallery/authors/[authorId]/route";
import { POST as createShare } from "../app/api/share/route";
import { DELETE as revokeShare } from "../app/api/share/[id]/route";

const SITE = "https://stave.example";

function req(method: string, origin: string | undefined, extra: Record<string, string> = {}, url = `${SITE}/api/gallery`): Request {
  const headers: Record<string, string> = { host: "stave.example", "content-type": "application/json", ...extra };
  if (origin !== undefined) headers.origin = origin;
  return new Request(url, { method, headers, body: method === "GET" ? undefined : "{}" });
}

describe("assertSameOrigin", () => {
  it("lets this site through", () => {
    expect(assertSameOrigin(req("POST", SITE))).toBeNull();
    expect(isSameOriginRequest(req("POST", "https://STAVE.example"))).toBe(true);
  });

  it("refuses Origin: null with 403", async () => {
    const r = assertSameOrigin(req("POST", "null"));
    expect(r?.status).toBe(403);
    expect(await r!.json()).toEqual({ error: CROSS_ORIGIN_REFUSED });
  });

  it("refuses another site with 403", () => {
    expect(assertSameOrigin(req("POST", "https://evil.example"))?.status).toBe(403);
    // same host name, other port: another origin
    expect(assertSameOrigin(req("POST", "https://stave.example:8443"))?.status).toBe(403);
    // a look-alike that only starts with this host
    expect(assertSameOrigin(req("POST", "https://stave.example.evil.example"))?.status).toBe(403);
    // not an http(s) origin at all
    expect(assertSameOrigin(req("POST", "chrome-extension://abc"))?.status).toBe(403);
    expect(assertSameOrigin(req("POST", "garbage"))?.status).toBe(403);
  });

  it("lets a request with no Origin through (curl, servers)", () => {
    expect(assertSameOrigin(req("POST", undefined))).toBeNull();
  });

  it("names this site by x-forwarded-host behind a proxy, then host, then the URL", () => {
    const proxied = req("POST", "https://stave.example", { host: "internal:3000", "x-forwarded-host": "stave.example" });
    expect(isSameOriginRequest(proxied)).toBe(true);
    const proxiedOther = req("POST", "https://internal:3000", { host: "internal:3000", "x-forwarded-host": "stave.example" });
    expect(isSameOriginRequest(proxiedOther)).toBe(false);
    const noHost = new Request("http://localhost:3351/api/share", { method: "POST", headers: { origin: "http://localhost:3351" }, body: "{}" });
    expect(isSameOriginRequest(noHost)).toBe(true);
  });
});

type Handler = (r: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ID = "abcdEFGH1234";
const WRITE_ROUTES: Array<[string, string, Handler, Record<string, string>]> = [
  ["POST /api/gallery (publish)", "POST", publish as Handler, {}],
  ["DELETE /api/gallery/:id", "DELETE", deleteEntry as Handler, { id: ID }],
  ["POST /api/gallery/:id/report", "POST", report as Handler, { id: ID }],
  ["POST /api/gallery/collections", "POST", createCollection as Handler, {}],
  ["PUT /api/gallery/collections/:id", "PUT", editCollection as Handler, { id: ID }],
  ["DELETE /api/gallery/collections/:id", "DELETE", deleteCollection as Handler, { id: ID }],
  ["POST /api/gallery/claim", "POST", claim as Handler, {}],
  ["PUT /api/gallery/authors/:authorId", "PUT", editProfile as Handler, { authorId: ID }],
  ["POST /api/share", "POST", createShare as Handler, {}],
  ["DELETE /api/share/:id", "DELETE", revokeShare as Handler, { id: ID }],
];

describe("every gallery / share write route", () => {
  it.each(WRITE_ROUTES)("%s refuses Origin: null with 403, before anything else", async (_name, method, handler, params) => {
    const before = fake.calls;
    const res = await handler(req(method, "null"), { params: Promise.resolve(params) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CROSS_ORIGIN_REFUSED });
    expect(fake.calls).toBe(before); // never asked who is signed in
  });

  it.each(WRITE_ROUTES)("%s refuses another site with 403", async (_name, method, handler, params) => {
    const res = await handler(req(method, "https://evil.example"), { params: Promise.resolve(params) });
    expect(res.status).toBe(403);
    // the origin refusal itself, not some later 403 (signed out, wrong key)
    expect(await res.json()).toEqual({ error: CROSS_ORIGIN_REFUSED });
  });

  it.each(WRITE_ROUTES)("%s carries on past the check for this site", async (_name, method, handler, params) => {
    const res = await handler(req(method, SITE), { params: Promise.resolve(params) });
    // whatever it answers next (no store here, signed out, bad body), it isn't the origin refusal
    const body = await res.clone().text();
    expect(body).not.toContain(CROSS_ORIGIN_REFUSED);
  });
});
