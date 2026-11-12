// @vitest-environment node
// #2349 — a brand-new account's first requests, fired all at once, used to
// collide while each made the account's profile (12 × 500 out of 30). With the
// account in Postgres behind a unique key, they all succeed and leave ONE
// profile. #2351 — and when the database can't be reached, making the profile
// answers 503 with a plain message, never a 500.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../auth", () => ({ auth: vi.fn(async () => fake.session) }));

import type { GalleryManifest, GallerySessionResponse } from "../gallery/types";
import { POST as publishRoute } from "../app/api/gallery/route";
import { GET as meRoute } from "../app/api/gallery/me/route";
import { GET as mySharesRoute } from "../app/api/gallery/me/shares/route";
import { POST as collectionPost } from "../app/api/gallery/collections/route";
import { POST as sharePost } from "../app/api/share/route";
import { sealShare } from "../shareCrypto";
import { accountHashOf } from "../app/api/gallery/session";
import { blobKeys, recordKeys } from "./galleryBlobKeys";
import { dbOverPglite, getDb, useDbForTests, type Db } from "../db/client";
import { DATABASE_UNAVAILABLE_MESSAGE } from "../db/errors";
import { rowsOf } from "../db/repo/tx";

beforeAll(() => getDb(), 60_000);

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stave-account-race-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

let n = 0;
const fresh = () => `race-${Date.now().toString(36)}-${n++}`;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  vi.stubEnv("STAVE_RATE_LIMIT_PUBLISH", "1000");
  vi.stubEnv("STAVE_RATE_LIMIT_EDIT", "1000");
  vi.stubEnv("STAVE_RATE_LIMIT_LINK", "1000");
});
afterEach(() => useDbForTests(undefined));

function signIn(id: string) {
  fake.session = {
    user: { name: "Ada", email: "ada@example.test" },
    account: { provider: "test-login", providerAccountId: id, badge: "github", login: id },
    expires: "2099-01-01T00:00:00.000Z",
  };
}

const manifest: GalleryManifest = {
  schemaVersion: 1,
  project: { name: "Song", sharedAt: 1 },
  files: [{ id: "f0", path: "song.strudel", language: "strudel", content: '$: s("bd")' }],
  fileOrder: { "": ["f0"] },
  subfolderOrder: {},
};
const json = (method: string, url: string, body: unknown) =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const me = () => meRoute(new Request("http://x/api/gallery/me"));
const publish = () => publishRoute(json("POST", "http://x/api/gallery", { title: "T", kind: "music", tags: [], manifest }));
const collection = () => collectionPost(json("POST", "http://x/api/gallery/collections", { title: "C", description: "", entryIds: [] }));
const shares = () => mySharesRoute(new Request("http://x/api/gallery/me/shares"));
/** A private short link made signed in: it is recorded on the account, which may not exist yet. */
const link = async () => {
  const { sealed } = await sealShare(new TextEncoder().encode("song"));
  return sharePost(new Request("http://x/api/share", { method: "POST", body: sealed as BodyInit }));
};

async function authorsOf(accountId: string): Promise<string[]> {
  const db = (await getDb())!;
  const hash = accountHashOf("test-login", accountId);
  const rows = rowsOf<{ author_id: string }>(await db.execute(sql`select author_id from accounts where id = ${hash}`));
  return rows.map((r) => r.author_id);
}

async function statusCounts(responses: Response[]): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  for (const r of responses) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

describe("#2349 a new account's first requests, all at once", () => {
  it("30 parallel GET /api/gallery/me: all 200, one profile, every answer names it", async () => {
    const id = fresh();
    signIn(id);
    const answers = await Promise.all(Array.from({ length: 30 }, me));
    expect(await statusCounts(answers)).toEqual({ 200: 30 });
    const bodies = (await Promise.all(answers.map((r) => r.json()))) as GallerySessionResponse[];
    const authorIds = new Set(bodies.map((b) => b.user?.authorId));
    expect(authorIds.size).toBe(1);
    expect(await authorsOf(id)).toEqual([...authorIds]);
    const db = (await getDb())!;
    const [{ n: authors }] = rowsOf<{ n: number }>(
      await db.execute(sql`select count(*)::int as n from authors where email = 'ada@example.test' and id = ${[...authorIds][0]!}`),
    );
    expect(authors).toBe(1);
    // #2352 / #2363 — the profile lives only in the database: nothing but entry files is in Blob.
    expect(recordKeys(await blobKeys(dir))).toEqual([]);
  });

  it("30 parallel first requests of mixed kinds (me, collection, My shares, a signed-in link): no errors, one profile", async () => {
    // #2352 — POST /api/gallery is left out of this mix until it reads the
    // profile from the database too (it still reads the Blob copy, which is gone).
    const id = fresh();
    signIn(id);
    const calls = [me, collection, shares, link];
    const answers = await Promise.all(Array.from({ length: 30 }, (_, i) => calls[i % calls.length]()));
    const counts = await statusCounts(answers);
    expect(Object.keys(counts).filter((s) => Number(s) >= 500)).toEqual([]);
    expect(counts).toEqual({ 200: 8 + 7, 201: 8 + 7 }); // me + My shares; collections + links
    expect((await authorsOf(id)).length).toBe(1);
    const authorId = (await authorsOf(id))[0];
    const collectedBy = new Set(
      (await Promise.all(answers.filter((_, i) => i % 4 === 1).map((r) => r.json()))).map(
        (b) => (b as { collection: { authorId: string } }).collection.authorId,
      ),
    );
    expect([...collectedBy]).toEqual([authorId]);
    // Every signed-in link landed on the one account.
    const linked = await Promise.all(answers.filter((_, i) => i % 4 === 3).map((r) => r.json()));
    expect(linked.every((b) => (b as { onAccount: boolean }).onAccount)).toBe(true);
  });
});

describe("#2351 making the profile when the database can't be reached", () => {
  // A database that can't answer: a PGlite that was closed. Made once (starting
  // one takes seconds under a full parallel run).
  let dead: Db;
  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = await PGlite.create();
    await client.close();
    dead = await dbOverPglite(client);
  }, 60_000);

  it("publish, me, collections and My shares answer 503 with the plain message; nothing is made; it works once the database is back", async () => {
    const id = fresh();
    signIn(id);
    useDbForTests(dead);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const call of [publish, me, collection, shares]) {
      const res = await call();
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(((await res.json()) as { error: string }).error).toBe(DATABASE_UNAVAILABLE_MESSAGE);
    }
    warn.mockRestore();
    useDbForTests(undefined);
    expect(await authorsOf(id)).toEqual([]); // nothing half-made
    expect((await me()).status).toBe(200);
    expect((await authorsOf(id)).length).toBe(1);
  });
});
