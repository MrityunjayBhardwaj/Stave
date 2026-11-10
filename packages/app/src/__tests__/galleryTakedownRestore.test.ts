// @vitest-environment node
// #2401 — an admin take-down hides an entry and can be undone for 30 days. Then the
// clean-up deletes its files and private columns. An author's own delete stays final.
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../auth", () => ({ auth: vi.fn(async () => fake.session) }));

import { MANAGE_TOKEN_HEADER, TAKEDOWN_KEEP_MS, type GalleryListResponse, type PublishResponse, type TakenDownResponse } from "../gallery/types";
import { GET as listRoute, POST as publishRoute } from "../app/api/gallery/route";
import { DELETE as deleteRoute, GET as entryRoute } from "../app/api/gallery/[id]/route";
import { GET as thumbnailRoute } from "../app/api/gallery/[id]/thumbnail/route";
import { POST as reportRoute } from "../app/api/gallery/[id]/report/route";
import { GET as authorRoute } from "../app/api/gallery/authors/[authorId]/route";
import { GET as logRoute } from "../app/api/gallery/admin/log/route";
import { GET as takenDownRoute } from "../app/api/gallery/admin/removed/route";
import { POST as restoreRoute } from "../app/api/gallery/admin/removed/[id]/restore/route";
import { GET as purgeRoute } from "../app/api/gallery/cron/purge/route";
import { getDb } from "../db/client";
import * as repo from "../db/repo";

beforeAll(() => getDb(), 60_000);

const ADMIN = "mod-restore";
const SECRET = "cron-secret-for-tests";
const EMAIL = "zz.distinctive.author+restore@example-privacy.test";
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stave-gallery-restore-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function signIn(id: string | null) {
  fake.session = id
    ? {
        user: { name: "Ada", email: EMAIL },
        account: { provider: "test-login", providerAccountId: id, badge: "github", login: id },
        expires: "2099-01-01T00:00:00.000Z",
      }
    : null;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.stubEnv("STAVE_GALLERY_ADMINS", `test-login:${ADMIN}`);
  vi.stubEnv("STAVE_RATE_LIMIT_PUBLISH", "1000");
  vi.stubEnv("STAVE_RATE_LIMIT_REPORT", "1000");
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
  vi.stubEnv("CRON_SECRET", SECRET);
  signIn("ada-restore");
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function published(): Promise<PublishResponse> {
  signIn("ada-restore");
  const res = await publishRoute(
    new Request("http://x/api/gallery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Night drive",
        kind: "music",
        tags: ["dark"],
        manifest: {
          schemaVersion: 1,
          project: { name: "My song", sharedAt: 1 },
          files: [{ id: "f0", path: "song.strudel", language: "strudel", content: 's("bd")' }],
          fileOrder: { "": ["f0"] },
          subfolderOrder: {},
        },
        thumbnail: `data:image/png;base64,${PNG_1x1}`,
      }),
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as PublishResponse;
}

const asAdmin = () => signIn(ADMIN);
const takeDown = (id: string, reason = "spam, checked") => {
  asAdmin();
  return deleteRoute(new Request(`http://x/api/gallery/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }), ctx(id));
};
const restore = (id: string, body: unknown = { reason: "taken down by mistake" }) =>
  restoreRoute(new Request(`http://x/api/gallery/admin/removed/${id}/restore`, { method: "POST", body: JSON.stringify(body) }), ctx(id));
const purge = (auth: string | null = `Bearer ${SECRET}`) =>
  purgeRoute(new Request("http://x/api/gallery/cron/purge", auth ? { headers: { authorization: auth } } : {}));
const entry = (id: string) => entryRoute(new Request(`http://x/api/gallery/${id}`), ctx(id));
const thumbnail = (id: string) => thumbnailRoute(new Request(`http://x/api/gallery/${id}/thumbnail`), ctx(id));
const list = async () => (await (await listRoute()).json()) as GalleryListResponse;
const listedIds = async () => (await list()).entries.map((e) => e.id);
const takenDown = async () => {
  asAdmin();
  return (await (await takenDownRoute(new Request("http://x/api/gallery/admin/removed"))).json()) as TakenDownResponse;
};
const logFor = async (id: string) => {
  asAdmin();
  const body = (await (await logRoute(new Request("http://x/api/gallery/admin/log"))).json()) as {
    actions: Array<{ action: string; target: string; reason: string; admin: { provider: string } }>;
  };
  return body.actions.filter((a) => a.target === id);
};
const files = (id: string) => [path.join(dir, "gallery", "manifests", `${id}.json`), path.join(dir, "gallery", "thumbnails", id)];
const exists = (f: string) => stat(f).then(() => true, () => false);
const database = async () => (await getDb())!;
/** Move a take-down `ms` into the past, as the passing of time would. */
const age = async (id: string, ms: number) => {
  const db = (await database()) as unknown as { $client: { query: (q: string, p: unknown[]) => Promise<unknown> } };
  await db.$client.query("update entries set removed_at = removed_at - $1::bigint where id = $2", [ms, id]);
};

describe("a take-down hides the entry and keeps what a restore needs", () => {
  it("answers as removed on every public route, with its files and email still held", async () => {
    const { id, authorId } = await published();
    expect((await takeDown(id)).status).toBe(204);

    expect(await listedIds()).not.toContain(id);
    expect((await entry(id)).status).toBe(410);
    expect((await thumbnail(id)).status).toBe(404);
    signIn(null);
    const reported = await reportRoute(new Request(`http://x/api/gallery/${id}/report`, { method: "POST", body: JSON.stringify({ reason: "late" }) }), ctx(id));
    expect(reported.status).toBe(410);
    const author = await (await authorRoute(new Request(`http://x/api/gallery/authors/${authorId}`), { params: Promise.resolve({ authorId }) })).text();
    expect(author).not.toContain(id);
    expect(author).not.toContain(EMAIL);

    for (const f of files(id)) expect(await exists(f)).toBe(true);
    const record = await repo.getEntryRecord(await database(), id);
    expect(record?.authorEmail).toBe(EMAIL);
    expect(record?.manageTokenHash).not.toBeNull();
  });

  it("a manage token can't touch a hidden entry", async () => {
    const { id, manageToken } = await published();
    await takeDown(id);
    signIn(null);
    const res = await deleteRoute(new Request(`http://x/api/gallery/${id}`, { method: "DELETE", headers: { [MANAGE_TOKEN_HEADER]: manageToken } }), ctx(id));
    expect(res.status).toBe(404);
    for (const f of files(id)) expect(await exists(f)).toBe(true);
  });

  it("only admins can list it, and the list carries no email or token", async () => {
    const { id, manageToken } = await published();
    await takeDown(id, "looks like spam");
    signIn("someone-else");
    expect((await takenDownRoute(new Request("http://x/api/gallery/admin/removed"))).status).toBe(403);
    signIn(null);
    expect((await takenDownRoute(new Request("http://x/api/gallery/admin/removed"))).status).toBe(403);

    const body = await takenDown();
    const row = body.entries.find((e) => e.entry.id === id);
    expect(row).toMatchObject({ reason: "looks like spam", entry: { title: "Night drive" } });
    expect(row!.restoreBy - row!.removedAt).toBe(TAKEDOWN_KEEP_MS);
    const text = JSON.stringify(body);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(manageToken);
  });
});

describe("restoring", () => {
  it("brings it back with the same id, files, token and collection, and logs it", async () => {
    const { id, manageToken, authorId } = await published();
    const db = await database();
    const collectionId = "colRESTORE1";
    await repo.insertCollection(db, { id: collectionId, authorId, title: "C", description: "", entryIds: [id], createdAt: 1, updatedAt: 1 });
    await takeDown(id);
    expect((await repo.liveEntries(db, [id])).length).toBe(0);

    asAdmin();
    expect((await restore(id)).status).toBe(204);

    expect((await entry(id)).status).toBe(200);
    expect((await thumbnail(id)).status).toBe(200);
    expect(await listedIds()).toContain(id);
    expect((await repo.getCollection(db, collectionId))?.entryIds).toEqual([id]);
    expect((await repo.liveEntries(db, [id])).length).toBe(1);
    expect((await takenDown()).entries.map((e) => e.entry.id)).not.toContain(id);
    expect((await logFor(id)).map((a) => [a.action, a.reason])).toEqual([
      ["restore-entry", "taken down by mistake"],
      ["take-down-entry", "spam, checked"],
    ]);

    // Its author can still manage it, and that delete is final.
    signIn(null);
    const del = await deleteRoute(new Request(`http://x/api/gallery/${id}`, { method: "DELETE", headers: { [MANAGE_TOKEN_HEADER]: manageToken } }), ctx(id));
    expect(del.status).toBe(204);
    expect(await repo.getEntryRecord(db, id)).toBeNull();
  });

  it("needs an admin and a reason, and logs nothing when refused", async () => {
    const { id } = await published();
    await takeDown(id);
    signIn("someone-else");
    expect((await restore(id)).status).toBe(403);
    signIn(null);
    expect((await restore(id)).status).toBe(403);
    asAdmin();
    expect((await restore(id, {})).status).toBe(400);
    expect((await entry(id)).status).toBe(410);
    expect((await logFor(id)).map((a) => a.action)).toEqual(["take-down-entry"]);
  });

  it("refuses a live entry, an unknown one and an author's deleted one", async () => {
    const { id, manageToken } = await published();
    asAdmin();
    expect((await restore(id)).status).toBe(404);
    expect((await restore("nosuchentry")).status).toBe(404);
    signIn(null);
    await deleteRoute(new Request(`http://x/api/gallery/${id}`, { method: "DELETE", headers: { [MANAGE_TOKEN_HEADER]: manageToken } }), ctx(id));
    asAdmin();
    expect((await restore(id)).status).toBe(404);
  });

  it("works just inside the window, and is refused at its end", async () => {
    const [inside, outside] = [await published(), await published()];
    await takeDown(inside.id);
    await takeDown(outside.id);
    await age(inside.id, TAKEDOWN_KEEP_MS - 60_000);
    await age(outside.id, TAKEDOWN_KEEP_MS);
    asAdmin();
    expect((await restore(inside.id)).status).toBe(204);
    expect((await restore(outside.id)).status).toBe(404);
    expect((await entry(outside.id)).status).toBe(410);
  });
});

describe("the clean-up", () => {
  it("refuses without the secret, and refuses everyone when none is set", async () => {
    const { id } = await published();
    await takeDown(id);
    await age(id, TAKEDOWN_KEEP_MS + 1);
    expect((await purge(null)).status).toBe(403);
    expect((await purge("Bearer wrong")).status).toBe(403);
    expect((await purge(`Bearer ${SECRET}x`)).status).toBe(403);
    vi.stubEnv("CRON_SECRET", "");
    expect((await purge("Bearer ")).status).toBe(403);
    expect((await purge(`Bearer ${SECRET}`)).status).toBe(403);
    for (const f of files(id)) expect(await exists(f)).toBe(true);
  });

  it("after the window: files deleted, email and token cleared, logged, and no way back", async () => {
    const { id } = await published();
    await takeDown(id);
    await age(id, TAKEDOWN_KEEP_MS + 1);

    const res = await purge();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { purged: number }).purged).toBeGreaterThanOrEqual(1);

    for (const f of files(id)) expect(await exists(f)).toBe(false);
    const record = await repo.getEntryRecord(await database(), id);
    expect(record).toMatchObject({ authorEmail: "", manageTokenHash: null, removed: { by: "admin" } });
    expect((await entry(id)).status).toBe(410);
    const [last] = await logFor(id);
    expect(last).toMatchObject({ action: "purge-entry", admin: { provider: "system" } });

    asAdmin();
    expect((await restore(id)).status).toBe(404);
    expect((await takenDown()).entries.map((e) => e.entry.id)).not.toContain(id);
    // A second run has nothing to do and logs nothing more.
    const before = (await logFor(id)).length;
    expect((await purge()).status).toBe(200);
    expect((await logFor(id)).length).toBe(before);
  });

  it("leaves an entry inside its window, and a live one, alone", async () => {
    const { id } = await published();
    const live = await published();
    await takeDown(id);
    await age(id, TAKEDOWN_KEEP_MS - 60_000);
    expect((await purge()).status).toBe(200);
    for (const f of [...files(id), ...files(live.id)]) expect(await exists(f)).toBe(true);
    expect((await repo.getEntryRecord(await database(), id))?.authorEmail).toBe(EMAIL);
    asAdmin();
    expect((await restore(id)).status).toBe(204);
  });

  it("a failed file delete leaves the entry hidden with its email, says so, and the next run finishes", async () => {
    const { id } = await published();
    await takeDown(id);
    await age(id, TAKEDOWN_KEEP_MS + 1);
    // A folder where the manifest file was makes the store's delete throw.
    const manifest = files(id)[0];
    const bytes = await readFile(manifest);
    await rm(manifest);
    await mkdir(manifest);

    const failed = await purge();
    expect(failed.status).toBe(500);
    expect(((await failed.json()) as { failed: number }).failed).toBe(1);
    expect((await repo.getEntryRecord(await database(), id))?.authorEmail).toBe(EMAIL);
    expect((await logFor(id)).map((a) => a.action)).toEqual(["take-down-entry"]);

    await rm(manifest, { recursive: true });
    await writeFile(manifest, bytes);
    expect((await purge()).status).toBe(200);
    expect((await repo.getEntryRecord(await database(), id))?.authorEmail).toBe("");
  });
});

describe("an author's own delete is untouched", () => {
  it("removes everything at once, with no window and no way back", async () => {
    const { id, manageToken } = await published();
    signIn(null);
    const res = await deleteRoute(new Request(`http://x/api/gallery/${id}`, { method: "DELETE", headers: { [MANAGE_TOKEN_HEADER]: manageToken } }), ctx(id));
    expect(res.status).toBe(204);
    expect(await repo.getEntryRecord(await database(), id)).toBeNull();
    for (const f of files(id)) expect(await exists(f)).toBe(false);
    expect((await takenDown()).entries.map((e) => e.entry.id)).not.toContain(id);
  });
});

describe("the migration", () => {
  it("marks entries removed before it as purged, since their files are already gone", async () => {
    const sql = await readFile(path.join(__dirname, "../../drizzle/0001_silly_prodigy.sql"), "utf8");
    expect(sql).toContain('ADD COLUMN "purged_at"');
    expect(sql).toContain('UPDATE "entries" SET "purged_at" = "removed_at" WHERE "removed_at" IS NOT NULL');
  });
});
