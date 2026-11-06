// @vitest-environment node
// #2363 — Blob holds only an entry's CONTENT. Publishing writes the manifest and
// the thumbnail and nothing else; taking the entry down (by its manage token, by
// its signed-in author, or by an admin) removes them and writes nothing else.
// The records (the entry, its email and token hash, the removed state, reports,
// the admin log, the author) are in Postgres, and no copy of them lands in Blob.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../auth", () => ({ auth: vi.fn(async () => fake.session) }));

import { MANAGE_TOKEN_HEADER, type GalleryManifest, type PublishResponse } from "../gallery/types";
import { POST as publishRoute } from "../app/api/gallery/route";
import { DELETE as deleteRoute, GET as entryRoute } from "../app/api/gallery/[id]/route";
import { POST as reportRoute } from "../app/api/gallery/[id]/report/route";
import { getDb } from "../db/client";
import { getEntryRecord } from "../db/repo/entries";
import { blobKeys, recordKeys } from "./galleryBlobKeys";

beforeAll(() => getDb(), 60_000);

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const ADMIN = "mod-blob-keys";

let root = "";
let dir = "";
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "stave-gallery-blob-keys-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  // A fresh, empty folder store per test, so "what is in it" is exactly what this test wrote.
  dir = await mkdtemp(path.join(root, "t-"));
  vi.unstubAllEnvs();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.stubEnv("STAVE_GALLERY_ADMINS", `test-login:${ADMIN}`);
  vi.stubEnv("STAVE_RATE_LIMIT_PUBLISH", "1000");
  vi.stubEnv("STAVE_RATE_LIMIT_REPORT", "1000");
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
  signIn("ada-blob-keys");
});

function signIn(id: string | null) {
  fake.session = id
    ? {
        user: { name: "Ada", email: "ada.blob.keys@example.test" },
        account: { provider: "test-login", providerAccountId: id, badge: "github", login: id },
        expires: "2099-01-01T00:00:00.000Z",
      }
    : null;
}

const manifest: GalleryManifest = {
  schemaVersion: 1,
  project: { name: "Keys", sharedAt: 1 },
  files: [{ id: "f0", path: "song.strudel", language: "strudel", content: '$: s("bd sd")' }],
  fileOrder: { "": ["f0"] },
  subfolderOrder: {},
};

async function publish(thumbnail = true): Promise<PublishResponse> {
  const res = await publishRoute(
    new Request("http://x/api/gallery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Keys",
        kind: "music",
        tags: ["keys"],
        manifest,
        ...(thumbnail ? { thumbnail: `data:image/png;base64,${PNG_1x1}` } : {}),
      }),
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as PublishResponse;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const remove = (id: string, headers: Record<string, string> = {}, body?: unknown) =>
  deleteRoute(
    new Request(`http://x/api/gallery/${id}`, {
      method: "DELETE",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    ctx(id),
  );
const content = (id: string) => [`gallery/manifests/${id}.json`, `gallery/thumbnails/${id}`];

describe("#2363 Blob holds only the entry's manifest and thumbnail", () => {
  it("publish writes exactly the manifest and thumbnail; a take-down by token leaves nothing", async () => {
    expect(await blobKeys(dir)).toEqual([]);

    const { id, manageToken } = await publish();
    expect(await blobKeys(dir)).toEqual(content(id));
    // The record is in the database, not Blob.
    expect((await getEntryRecord((await getDb())!, id))?.entry.id).toBe(id);
    expect((await entryRoute(new Request(`http://x/api/gallery/${id}`), ctx(id))).status).toBe(200);

    // A report is a record too: Postgres only.
    const reported = await reportRoute(
      new Request(`http://x/api/gallery/${id}/report`, { method: "POST", body: JSON.stringify({ reason: "spam" }) }),
      ctx(id),
    );
    expect(reported.status).toBe(202);
    expect(await blobKeys(dir)).toEqual(content(id));

    signIn(null);
    expect((await remove(id, { [MANAGE_TOKEN_HEADER]: manageToken })).status).toBe(204);
    expect(await blobKeys(dir)).toEqual([]);
    expect(await getEntryRecord((await getDb())!, id)).toBeNull(); // #2403 — nothing is kept.
  });

  it("without a thumbnail, publish writes only the manifest", async () => {
    const { id } = await publish(false);
    expect(await blobKeys(dir)).toEqual([`gallery/manifests/${id}.json`]);
  });

  it("an author's delete removes only that entry's files, and an admin's take-down keeps them (#2401); neither writes a record", async () => {
    const mine = await publish();
    const other = await publish();
    const theirs = await publish();
    expect(recordKeys(await blobKeys(dir))).toEqual([]);

    // The signed-in author: no token needed.
    expect((await remove(mine.id)).status).toBe(204);
    expect(await blobKeys(dir)).toEqual([...content(other.id), ...content(theirs.id)].sort());

    // An admin, with a reason (the admin log row is in the database): only hidden, so it can be restored.
    signIn(ADMIN);
    expect((await remove(theirs.id, {}, { reason: "checked" })).status).toBe(204);
    expect(await blobKeys(dir)).toEqual([...content(other.id), ...content(theirs.id)].sort());
  });
});
