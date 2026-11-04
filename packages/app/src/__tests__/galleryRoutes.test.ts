// @vitest-environment node
// #2299 / #2303 — the community gallery routes against the dev folder store:
// publish, list, open, thumbnail, report, delete, the maintainer's flagged list,
// and the privacy rule that the author's email never leaves the server.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_KEY_HEADER,
  GALLERY_ID_PATTERN,
  MANAGE_TOKEN_HEADER,
  MAX_AUTHOR_NAME_CHARS,
  MAX_MANIFEST_BYTES,
  MAX_REPORT_REASON_CHARS,
  MAX_TAG_CHARS,
  MAX_TAGS,
  MAX_THUMBNAIL_BYTES,
  MAX_TITLE_CHARS,
  type GalleryEntryResponse,
  type GalleryListResponse,
  type GalleryManifest,
  type PublishResponse,
  type ReportsResponse,
} from "../gallery/types";
import { GET as listRoute, POST as publishRoute } from "../app/api/gallery/route";
import { DELETE as deleteRoute, GET as entryRoute } from "../app/api/gallery/[id]/route";
import { GET as thumbnailRoute } from "../app/api/gallery/[id]/thumbnail/route";
import { POST as reportRoute } from "../app/api/gallery/[id]/report/route";
import { GET as reportsRoute } from "../app/api/gallery/reports/route";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const WEBP_1x1 = "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";
const ADMIN_KEY = "test-admin-key-0123456789";
const EMAIL = "zz.distinctive.author+gallery@example-privacy.test";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stave-gallery-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  vi.unstubAllEnvs();
  // Never reach a real Blob store from a test, whatever the shell has set.
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.stubEnv("STAVE_GALLERY_ADMIN_KEY", ADMIN_KEY);
});

const manifest = (files = 1): GalleryManifest => ({
  schemaVersion: 1,
  project: { name: "My song", sharedAt: 1 },
  files: Array.from({ length: files }, (_, i) => ({
    id: `f${i}`,
    path: `song${i}.strudel`,
    language: "strudel",
    content: `$: s("bd sd") // ${i}`,
  })),
  fileOrder: { "": Array.from({ length: files }, (_, i) => `f${i}`) },
  subfolderOrder: {},
});

const request = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: "  Night drive  ",
  kind: "music",
  tags: [" techno ", "dark", "", "dark"],
  authorName: "  Ada  ",
  authorEmail: EMAIL,
  manifest: manifest(1),
  thumbnail: `data:image/png;base64,${PNG_1x1}`,
  ...over,
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const publish = (body: unknown) =>
  publishRoute(
    new Request("http://x/api/gallery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const list = async () => (await (await listRoute()).json()) as GalleryListResponse;
const entry = (id: string) => entryRoute(new Request(`http://x/api/gallery/${id}`), ctx(id));
const thumbnail = (id: string) => thumbnailRoute(new Request(`http://x/api/gallery/${id}/thumbnail`), ctx(id));
const report = (id: string, body: unknown) =>
  reportRoute(
    new Request(`http://x/api/gallery/${id}/report`, { method: "POST", body: JSON.stringify(body) }),
    ctx(id),
  );
const remove = (id: string, headers: Record<string, string> = {}) =>
  deleteRoute(new Request(`http://x/api/gallery/${id}`, { method: "DELETE", headers }), ctx(id));
const reports = (headers: Record<string, string> = {}) =>
  reportsRoute(new Request("http://x/api/gallery/reports", { headers }));

async function published(over: Record<string, unknown> = {}): Promise<PublishResponse> {
  const res = await publish(request(over));
  expect(res.status).toBe(201);
  return (await res.json()) as PublishResponse;
}

describe("publishing", () => {
  it("stores an entry and hands back its id and a manage token", async () => {
    const { id, manageToken } = await published();
    expect(id).toMatch(GALLERY_ID_PATTERN);
    expect(manageToken.length).toBeGreaterThanOrEqual(40);

    const res = await entry(id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as GalleryEntryResponse;
    expect(body.entry).toEqual({
      id,
      title: "Night drive",
      kind: "music",
      tags: ["techno", "dark"],
      authorName: "Ada",
      authorId: expect.stringMatching(GALLERY_ID_PATTERN),
      publishedAt: expect.any(Number),
      fileCount: 1,
      hasThumbnail: true,
    });
    expect(body.manifest).toEqual(manifest(1));
  });

  it("drops fields the manifest contract doesn't carry", async () => {
    const m = { ...manifest(2), extra: "smuggled" } as unknown as GalleryManifest;
    (m.files[0] as unknown as Record<string, unknown>).secret = "smuggled";
    const { id } = await published({ kind: "project", manifest: m });
    const body = (await (await entry(id)).json()) as GalleryEntryResponse;
    expect(JSON.stringify(body)).not.toContain("smuggled");
    expect(body.entry.fileCount).toBe(2);
  });

  it("accepts a WebP thumbnail and no thumbnail at all", async () => {
    const a = await published({ thumbnail: `data:image/webp;base64,${WEBP_1x1}` });
    const res = await thumbnail(a.id);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const b = await published({ thumbnail: undefined });
    const e = (await (await entry(b.id)).json()) as GalleryEntryResponse;
    expect(e.entry.hasThumbnail).toBe(false);
    expect((await thumbnail(b.id)).status).toBe(404);
  });

  it.each([
    ["body that isn't JSON", "{not json"],
    ["missing title", request({ title: undefined })],
    ["blank title", request({ title: "   " })],
    ["long title", request({ title: "x".repeat(MAX_TITLE_CHARS + 1) })],
    ["unknown kind", request({ kind: "video" })],
    ["tags not a list", request({ tags: "techno" })],
    ["too many tags", request({ tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`) })],
    ["long tag", request({ tags: ["x".repeat(MAX_TAG_CHARS + 1)] })],
    ["long author name", request({ authorName: "x".repeat(MAX_AUTHOR_NAME_CHARS + 1) })],
    ["blank author name", request({ authorName: " " })],
    ["email without @", request({ authorEmail: "not-an-email" })],
    ["email with spaces", request({ authorEmail: "a b@c.de" })],
    ["schemaVersion 2", request({ manifest: { ...manifest(1), schemaVersion: 2 } })],
    ["no files", request({ kind: "project", manifest: manifest(0) })],
    ["music with two files", request({ kind: "music", manifest: manifest(2) })],
    ["viz with two files", request({ kind: "viz", manifest: manifest(2) })],
    ["file without content", request({ manifest: { ...manifest(1), files: [{ id: "a", path: "a", language: "x" }] } })],
    ["thumbnail of another type", request({ thumbnail: `data:image/svg+xml;base64,${PNG_1x1}` })],
    ["thumbnail not base64", request({ thumbnail: "data:image/png;base64,<script>" })],
    ["thumbnail whose bytes aren't the declared type", request({ thumbnail: `data:image/png;base64,${WEBP_1x1}` })],
  ])("refuses a %s with 400", async (_name, body) => {
    expect((await publish(body)).status).toBe(400);
  });

  it("refuses an over-limit manifest or thumbnail with 413", async () => {
    const big = manifest(1);
    big.files[0].content = "x".repeat(MAX_MANIFEST_BYTES);
    expect((await publish(request({ manifest: big }))).status).toBe(413);

    const raw = Buffer.alloc(MAX_THUMBNAIL_BYTES + 1);
    Buffer.from(PNG_1x1, "base64").copy(raw);
    expect((await publish(request({ thumbnail: `data:image/png;base64,${raw.toString("base64")}` }))).status).toBe(413);
  });

  it("accepts a thumbnail exactly at the limit", async () => {
    const raw = Buffer.alloc(MAX_THUMBNAIL_BYTES);
    Buffer.from(PNG_1x1, "base64").copy(raw);
    expect((await publish(request({ thumbnail: `data:image/png;base64,${raw.toString("base64")}` }))).status).toBe(201);
  });
});

describe("listing and opening", () => {
  it("lists entries newest first, with a short CDN cache", async () => {
    const first = await published({ title: "first" });
    await new Promise((r) => setTimeout(r, 5));
    const second = await published({ title: "second" });
    const res = await listRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30, stale-while-revalidate=300");
    const ids = ((await res.json()) as GalleryListResponse).entries.map((e) => e.id);
    expect(ids.indexOf(second.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  });

  it("answers 404 for an unknown or malformed id", async () => {
    expect((await entry("AAAAAAAAAAA")).status).toBe(404);
    expect((await entry("../../etc/passwd")).status).toBe(404);
    expect((await thumbnail("AAAAAAAAAAA")).status).toBe(404);
    expect((await thumbnail("../x")).status).toBe(404);
  });

  it("serves the thumbnail as the image it is, with nosniff", async () => {
    const { id } = await published();
    const res = await thumbnail(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).toString("base64")).toBe(PNG_1x1);
  });
});

describe("the author's email stays on the server", () => {
  it("appears in no public response", async () => {
    const { id } = await published({ authorEmail: EMAIL });
    const bodies: string[] = [];
    bodies.push(await (await listRoute()).text());
    bodies.push(await (await entry(id)).text());
    bodies.push(Buffer.from(await (await thumbnail(id)).arrayBuffer()).toString("latin1"));
    const ack = await report(id, { reason: "testing the ack" });
    expect(ack.status).toBe(202);
    bodies.push(await ack.text());

    // The control: the entry really is in the list and the entry route really answered,
    // so an empty body can't pass this vacuously.
    expect(bodies[0]).toContain(id);
    expect(bodies[1]).toContain("Night drive");
    for (const body of bodies) {
      expect(body).not.toContain(EMAIL);
      expect(body).not.toContain("example-privacy.test");
    }
  });
});

describe("reporting", () => {
  it("records a report the maintainer can list", async () => {
    const { id } = await published();
    expect((await report(id, { reason: "  not music at all  " })).status).toBe(202);
    const res = await reports({ [ADMIN_KEY_HEADER]: ADMIN_KEY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportsResponse;
    expect(body.reports).toContainEqual({ entryId: id, reason: "not music at all", reportedAt: expect.any(Number) });
  });

  it("refuses a blank or long reason, and an unknown entry", async () => {
    const { id } = await published();
    expect((await report(id, { reason: "  " })).status).toBe(400);
    expect((await report(id, { reason: "x".repeat(MAX_REPORT_REASON_CHARS + 1) })).status).toBe(400);
    expect((await report(id, {})).status).toBe(400);
    expect((await report("AAAAAAAAAAA", { reason: "spam" })).status).toBe(404);
  });

  it("keeps the flagged list from anyone without the admin key", async () => {
    expect((await reports()).status).toBe(403);
    expect((await reports({ [ADMIN_KEY_HEADER]: "wrong" })).status).toBe(403);
    vi.stubEnv("STAVE_GALLERY_ADMIN_KEY", "");
    expect((await reports({ [ADMIN_KEY_HEADER]: "" })).status).toBe(403);
  });
});

describe("deleting", () => {
  it("refuses a wrong token, then deletes with the right one", async () => {
    const { id, manageToken } = await published();
    expect((await remove(id)).status).toBe(403);
    expect((await remove(id, { [MANAGE_TOKEN_HEADER]: "wrong" })).status).toBe(403);
    expect((await remove(id, { [MANAGE_TOKEN_HEADER]: manageToken.slice(0, -1) })).status).toBe(403);

    expect((await remove(id, { [MANAGE_TOKEN_HEADER]: manageToken })).status).toBe(204);
    expect((await list()).entries.map((e) => e.id)).not.toContain(id);
    expect((await entry(id)).status).toBe(410);
    expect((await thumbnail(id)).status).toBe(404);
    expect((await report(id, { reason: "late" })).status).toBe(410);
    // Already gone.
    expect((await remove(id, { [MANAGE_TOKEN_HEADER]: manageToken })).status).toBe(404);
  });

  it("lets the maintainer take an entry down with the admin key, clearing its reports", async () => {
    const { id } = await published();
    await report(id, { reason: "spam" });
    expect((await remove(id, { [ADMIN_KEY_HEADER]: "not the key" })).status).toBe(403);
    expect((await remove(id, { [ADMIN_KEY_HEADER]: ADMIN_KEY })).status).toBe(204);
    expect((await list()).entries.map((e) => e.id)).not.toContain(id);
    expect((await entry(id)).status).toBe(410);
    const body = (await (await reports({ [ADMIN_KEY_HEADER]: ADMIN_KEY })).json()) as ReportsResponse;
    expect(body.reports.map((r) => r.entryId)).not.toContain(id);
  });

  it("has no admin when the server has no admin key", async () => {
    vi.stubEnv("STAVE_GALLERY_ADMIN_KEY", "");
    const { id } = await published();
    expect((await remove(id, { [ADMIN_KEY_HEADER]: "" })).status).toBe(403);
    expect((await remove(id, { [ADMIN_KEY_HEADER]: "anything" })).status).toBe(403);
  });

  it("one entry's token doesn't delete another", async () => {
    const a = await published();
    const b = await published();
    expect((await remove(b.id, { [MANAGE_TOKEN_HEADER]: a.manageToken })).status).toBe(403);
    expect((await entry(b.id)).status).toBe(200);
  });

  it("answers 404 for an unknown or malformed id", async () => {
    expect((await remove("AAAAAAAAAAA", { [ADMIN_KEY_HEADER]: ADMIN_KEY })).status).toBe(404);
    expect((await remove("../x", { [ADMIN_KEY_HEADER]: ADMIN_KEY })).status).toBe(404);
  });
});

describe("a production build with no store", () => {
  it("answers 503 everywhere, so the client can say the gallery is off", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STAVE_SHARE_DEV_STORE", "");
    const id = "AAAAAAAAAAA";
    expect((await listRoute()).status).toBe(503);
    expect((await publish(request())).status).toBe(503);
    expect((await entry(id)).status).toBe(503);
    expect((await thumbnail(id)).status).toBe(503);
    expect((await report(id, { reason: "x" })).status).toBe(503);
    expect((await remove(id)).status).toBe(503);
    expect((await reports({ [ADMIN_KEY_HEADER]: ADMIN_KEY })).status).toBe(503);
  });
});
