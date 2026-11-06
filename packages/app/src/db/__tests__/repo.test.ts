// @vitest-environment node
// #2352 — the gallery's data-access layer against a real Postgres (PGlite in
// memory). Every repository function, each test on its own fresh database
// (a clone of a migrated template, so it costs milliseconds, not seconds).
import type { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GalleryEntry, GalleryVerified } from "../../gallery/types";
import { dbOverPglite, freshTestDb, getDb, useDbForTests, type Db } from "../client";
import { DatabaseUnavailableError, isDatabaseUnavailable } from "../errors";
import * as repo from "../repo";
import * as schema from "../schema";
import { rowsOf } from "../repo/tx";

let db: Db & { $client: PGlite };

beforeAll(() => freshTestDb(), 60_000); // starts the per-process template once
beforeEach(async () => {
  db = await freshTestDb();
});
afterEach(async () => {
  useDbForTests(undefined);
  await db.$client.close();
});

const GH: GalleryVerified = { provider: "github", login: "ada" };
let seq = 0;
const id11 = () => `id${String(seq++).padStart(9, "0")}`; // 11 chars, like a real id

function claim(n: string) {
  return {
    accountHash: `hash-${n}`,
    provider: "test-login",
    providerAccountId: n,
    email: `${n}@example.test`,
    verified: GH,
  };
}

function entry(over: Partial<GalleryEntry> = {}): GalleryEntry {
  return {
    id: id11(),
    title: "Song",
    kind: "music",
    tags: ["a"],
    authorName: "Ada",
    publishedAt: 1_000 + seq,
    fileCount: 1,
    hasThumbnail: false,
    ...over,
  };
}

async function count(table: string): Promise<number> {
  return Number(rowsOf<{ n: number }>(await db.execute(sql.raw(`select count(*)::int as n from ${table}`)))[0].n);
}

async function author(name = "Ada"): Promise<string> {
  const { account } = await repo.ensureAccountAuthor(db, { ...claim(`a${seq++}`), name });
  return account.authorId;
}

// ── accounts and authors ──────────────────────────────────────────────────────

describe("accounts and authors", () => {
  it("ensureAccountAuthor makes the account and its author once, then finds it", async () => {
    const first = await repo.ensureAccountAuthor(db, { ...claim("u1"), name: "Ada" });
    expect(first.created).toBe(true);
    expect(first.account).toMatchObject({ accountHash: "hash-u1", provider: "test-login", email: "u1@example.test", verified: GH });
    const again = await repo.ensureAccountAuthor(db, { ...claim("u1"), name: "Other" });
    expect(again).toEqual({ account: first.account, created: false });
    expect(await repo.getAuthor(db, first.account.authorId)).toMatchObject({ name: "Ada", bio: "", email: "u1@example.test", verified: GH });
  });

  it("#2349: 30 parallel first uses of one account make ONE author, and all 30 answer with it", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () => repo.ensureAccountAuthor(db, { ...claim("race"), name: "Ada" })),
    );
    const ids = new Set(results.map((r) => r.account.authorId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await count("authors")).toBe(1); // the losers' authors were rolled back
    expect(await count("accounts")).toBe(1);
  });

  it("#2349: the same race over two separate database handles (two servers) still makes one author", async () => {
    const [a, b] = [await dbOverPglite(db.$client), await dbOverPglite(db.$client)];
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => repo.ensureAccountAuthor(i % 2 ? a : b, { ...claim("race2"), name: "Ada" })),
    );
    expect(new Set(results.map((r) => r.account.authorId)).size).toBe(1);
    expect(await count("authors")).toBe(1);
  });

  it("getAccount / getAccountByAuthor read the account both ways", async () => {
    const { account } = await repo.ensureAccountAuthor(db, { ...claim("both"), name: "Ada" });
    expect(await repo.getAccount(db, "hash-both")).toEqual(account);
    expect(await repo.getAccountByAuthor(db, account.authorId)).toEqual(account);
    expect(await repo.getAccount(db, "nope")).toBeNull();
    expect(await repo.getAccountByAuthor(db, "nope")).toBeNull();
  });

  it("refreshAccount follows a new email and badge onto the account and its author", async () => {
    const { account } = await repo.ensureAccountAuthor(db, { ...claim("r"), name: "Ada" });
    const next = { email: "new@example.test", verified: { provider: "github", login: "renamed" } as GalleryVerified };
    const refreshed = await repo.refreshAccount(db, "hash-r", next);
    expect(refreshed).toMatchObject(next);
    expect(await repo.getAuthor(db, account.authorId)).toMatchObject(next);
    expect(await repo.refreshAccount(db, "nope", next)).toBeNull();
  });

  it("linkAccount refuses a missing author, a taken author, and an account linked elsewhere unless replacing", async () => {
    expect(await repo.linkAccount(db, claim("l1"), "nobody")).toEqual({ ok: false, reason: "no-author" });
    const keyed = (await repo.insertKeyedAuthor(db, { name: "Old", email: "old@example.test", keyHash: "k1" }))!;
    const linked = await repo.linkAccount(db, claim("l1"), keyed);
    expect(linked).toMatchObject({ ok: true, replaced: null, account: { authorId: keyed } });
    expect(await repo.getAuthor(db, keyed)).toMatchObject({ email: "l1@example.test", verified: GH });
    // another account can't take it
    expect(await repo.linkAccount(db, claim("l2"), keyed)).toEqual({ ok: false, reason: "author-taken" });
    // the account is linked: moving it needs replace
    const other = (await repo.insertKeyedAuthor(db, { name: "Other", email: "", keyHash: "k2" }))!;
    expect(await repo.linkAccount(db, claim("l1"), other)).toEqual({ ok: false, reason: "account-linked" });
    expect(await repo.linkAccount(db, claim("l1"), other, { replace: true })).toMatchObject({ ok: true, replaced: keyed });
    expect((await repo.getAccount(db, "hash-l1"))?.authorId).toBe(other);
  });

  it("insertKeyedAuthor / authorIdForKeyHash / authorKeyHash: a key finds its author and back", async () => {
    const id = (await repo.insertKeyedAuthor(db, { name: "Old", email: "old@example.test", keyHash: "khash" }))!;
    expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(await repo.authorIdForKeyHash(db, "khash")).toBe(id);
    expect(await repo.authorKeyHash(db, id)).toBe("khash");
    expect(await repo.authorIdForKeyHash(db, "other")).toBeNull();
    expect(await repo.authorKeyHash(db, await author())).toBeNull(); // an account's author has no key
  });

  it("updateAuthorProfile changes name and bio, and refuses a merged profile", async () => {
    const id = await author();
    const updated = await repo.updateAuthorProfile(db, id, { name: "Ada L", bio: "music" });
    expect(updated).toMatchObject({ authorId: id, name: "Ada L", bio: "music", verified: GH });
    expect(updated).not.toHaveProperty("email");
    const target = await author("Target");
    await repo.mergeAuthorInto(db, id, { authorId: target, name: "Target", email: "" });
    expect(await repo.updateAuthorProfile(db, id, { name: "x", bio: "" })).toBeNull();
    expect(await repo.updateAuthorProfile(db, "nope", { name: "x", bio: "" })).toBeNull();
  });

  it("publicProfile keeps only the contract's fields", () => {
    const p = repo.publicProfile({
      authorId: "a",
      name: "n",
      bio: "b",
      createdAt: 1,
      updatedAt: 2,
      verified: { provider: "github", login: "l", avatarUrl: "https://x" },
      ...({ email: "secret", mergedInto: "z" } as object),
    });
    expect(p).toEqual({ authorId: "a", name: "n", bio: "b", createdAt: 1, updatedAt: 2, verified: { provider: "github", login: "l", avatarUrl: "https://x" } });
  });
});

// ── entries and the listing ───────────────────────────────────────────────────

describe("entries and the listing", () => {
  it("insertEntry stores it; the same id again is refused", async () => {
    const authorId = await author();
    const e = entry({ authorId });
    expect(await repo.insertEntry(db, { entry: e, authorEmail: "a@x", manageTokenHash: "h" })).toBe(true);
    expect(await repo.insertEntry(db, { entry: e, authorEmail: "a@x", manageTokenHash: "h" })).toBe(false);
    expect(await repo.getEntryRecord(db, e.id)).toEqual({ entry: e, authorEmail: "a@x", manageTokenHash: "h", removed: null });
    expect(await repo.getEntryRecord(db, "nope")).toBeNull();
  });

  it("an entry from before profiles has no authorId key at all, and the key order is the publish literal's", async () => {
    const e = entry();
    await repo.insertEntry(db, { entry: e, authorEmail: "", manageTokenHash: "h" });
    const got = (await repo.liveEntry(db, e.id))!;
    expect("authorId" in got).toBe(false);
    expect(Object.keys(got)).toEqual(["id", "title", "kind", "tags", "authorName", "publishedAt", "fileCount", "hasThumbnail"]);
    const withAuthor = entry({ authorId: await author() });
    await repo.insertEntry(db, { entry: withAuthor, authorEmail: "", manageTokenHash: "h" });
    expect(Object.keys((await repo.liveEntry(db, withAuthor.id))!)).toEqual([
      "id", "title", "kind", "tags", "authorName", "authorId", "publishedAt", "fileCount", "hasThumbnail",
    ]);
  });

  it("listEntries: newest first, live only, one kind when asked, capped", async () => {
    const authorId = await author();
    const made: GalleryEntry[] = [];
    for (const [kind, at] of [["music", 10], ["viz", 30], ["music", 20], ["project", 40]] as const) {
      const e = entry({ kind, publishedAt: at, authorId });
      made.push(e);
      await repo.insertEntry(db, { entry: e, authorEmail: "", manageTokenHash: "h" });
    }
    await repo.removeEntry(db, made[3].id);
    expect((await repo.listEntries(db)).map((e) => e.publishedAt)).toEqual([30, 20, 10]);
    expect((await repo.listEntries(db, { kind: "music" })).map((e) => e.publishedAt)).toEqual([20, 10]);
    expect((await repo.listEntries(db, { limit: 2 })).map((e) => e.publishedAt)).toEqual([30, 20]);
    expect((await repo.listEntries(db, { limit: 10_000 })).length).toBe(3);
  });

  it("listEntries caps at MAX_LISTED_ENTRIES whatever is asked", async () => {
    const authorId = await author();
    const values = Array.from({ length: repo.MAX_LISTED_ENTRIES + 5 }, (_, i) =>
      sql`(${`bulk${String(i).padStart(7, "0")}`}, 'T', 'music', 'Ada', ${authorId}, ${i}, 1, false)`,
    );
    await db.execute(sql`insert into entries (id, title, kind, author_name, author_id, published_at, file_count, has_thumbnail) values ${sql.join(values, sql`, `)}`);
    const listed = await repo.listEntries(db, { limit: 10_000 });
    expect(listed).toHaveLength(repo.MAX_LISTED_ENTRIES);
    expect(listed[0].publishedAt).toBe(repo.MAX_LISTED_ENTRIES + 4);
  });

  it("the listing uses the live-newest index (one indexed query, not a scan of every entry)", async () => {
    await db.execute(sql`set enable_seqscan = off`);
    const plan = rowsOf<{ "QUERY PLAN": string }>(
      await db.execute(sql`explain select * from entries where removed_at is null and kind = 'music' order by published_at desc limit 500`),
    ).map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/entries_live_kind_newest_idx/);
  });

  it("liveEntry / liveEntries: removed ones left out, the order given kept", async () => {
    const authorId = await author();
    const [a, b, c] = [entry({ authorId }), entry({ authorId }), entry({ authorId })];
    for (const e of [a, b, c]) await repo.insertEntry(db, { entry: e, authorEmail: "", manageTokenHash: "h" });
    await repo.removeEntry(db, b.id);
    expect(await repo.liveEntry(db, b.id)).toBeNull();
    expect((await repo.liveEntries(db, [c.id, b.id, "nope", a.id])).map((e) => e.id)).toEqual([c.id, a.id]);
    expect(await repo.liveEntries(db, [])).toEqual([]);
  });

  it("entriesOfAuthor: that author's live entries, newest first", async () => {
    const [x, y] = [await author(), await author()];
    const [old, mid, other] = [entry({ authorId: x, publishedAt: 1 }), entry({ authorId: x, publishedAt: 2 }), entry({ authorId: y })];
    for (const e of [old, mid, other]) await repo.insertEntry(db, { entry: e, authorEmail: "", manageTokenHash: "h" });
    expect((await repo.entriesOfAuthor(db, x)).map((e) => e.id)).toEqual([mid.id, old.id]);
  });

  it("deleteEntryIn: no row, no collection membership and no report is left; the collection stays", async () => {
    const authorId = await author();
    const [gone, kept] = [entry({ authorId }), entry({ authorId })];
    for (const e of [gone, kept]) await repo.insertEntry(db, { entry: e, authorEmail: "secret@x", manageTokenHash: "h" });
    await repo.addReport(db, { entryId: gone.id, reason: "spam", reportedAt: 5 });
    await repo.addReport(db, { entryId: kept.id, reason: "spam", reportedAt: 5 });
    const collectionId = id11();
    await repo.insertCollection(db, { id: collectionId, authorId, title: "C", description: "", entryIds: [gone.id, kept.id], createdAt: 1, updatedAt: 1 });

    expect(await repo.deleteEntryIn(db, gone.id)).toBe(true);

    expect(await db.select().from(schema.entries).where(eq(schema.entries.id, gone.id))).toEqual([]);
    expect(await db.select().from(schema.reports).where(eq(schema.reports.entryId, gone.id))).toEqual([]);
    expect(await db.select().from(schema.collectionEntries).where(eq(schema.collectionEntries.entryId, gone.id))).toEqual([]);
    expect(await db.select().from(schema.reports).where(eq(schema.reports.entryId, kept.id))).toHaveLength(1);
    expect((await db.select().from(schema.collectionEntries).where(eq(schema.collectionEntries.collectionId, collectionId))).map((r) => r.entryId)).toEqual([kept.id]);
    expect(await repo.deleteEntryIn(db, gone.id)).toBe(false);
  });

  it("deleteEntryIn: refuses an entry an admin took down, whose row stays", async () => {
    const e = entry({ authorId: await author() });
    await repo.insertEntry(db, { entry: e, authorEmail: "", manageTokenHash: "h" });
    await repo.removeEntry(db, e.id);
    expect(await repo.deleteEntryIn(db, e.id)).toBe(false);
    expect(await repo.getEntryRecord(db, e.id)).toMatchObject({ removed: { by: "admin" } });
  });

  it("removeEntry: marks it, clears the private side, closes its reports; a second call is false", async () => {
    const e = entry({ authorId: await author() });
    await repo.insertEntry(db, { entry: e, authorEmail: "secret@x", manageTokenHash: "h" });
    await repo.addReport(db, { entryId: e.id, reason: "spam", reportedAt: 5 });
    expect(await repo.removeEntry(db, e.id, 99)).toBe(true);
    expect(await repo.getEntryRecord(db, e.id)).toMatchObject({ authorEmail: "", manageTokenHash: null, removed: { removedAt: 99, by: "admin" } });
    expect(await repo.openReportCount(db, e.id)).toBe(0);
    expect(await repo.removeEntry(db, e.id)).toBe(false);
    expect(await repo.removeEntry(db, "nope")).toBe(false);
  });
});

// ── collections ───────────────────────────────────────────────────────────────

describe("collections", () => {
  async function entries(authorId: string, n: number): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const e = entry({ authorId });
      await repo.insertEntry(db, { entry: e, authorEmail: "", manageTokenHash: "h" });
      out.push(e.id);
    }
    return out;
  }

  it("insert / get keep the entries in the order given; the same id again is refused", async () => {
    const authorId = await author();
    const ids = await entries(authorId, 3);
    const c = { id: id11(), authorId, title: "Album", description: "d", entryIds: [ids[2], ids[0], ids[1]], createdAt: 1, updatedAt: 1 };
    expect(await repo.insertCollection(db, c)).toBe(true);
    expect(await repo.insertCollection(db, c)).toBe(false);
    expect(await repo.getCollection(db, c.id)).toEqual(c);
    expect(await repo.getCollection(db, "nope")).toBeNull();
  });

  it("updateCollection replaces title, description and entries in one go", async () => {
    const authorId = await author();
    const ids = await entries(authorId, 3);
    const c = { id: id11(), authorId, title: "A", description: "", entryIds: ids, createdAt: 1, updatedAt: 1 };
    await repo.insertCollection(db, c);
    const updated = await repo.updateCollection(db, c.id, { title: "B", description: "x", entryIds: [ids[1]] }, 7);
    expect(updated).toEqual({ ...c, title: "B", description: "x", entryIds: [ids[1]], updatedAt: 7 });
    expect(await repo.getCollection(db, c.id)).toEqual(updated);
    expect(await repo.updateCollection(db, "nope", { title: "B", description: "", entryIds: [] })).toBeNull();
  });

  it("updateCollection is all or nothing: an unknown entry id changes nothing", async () => {
    const authorId = await author();
    const ids = await entries(authorId, 1);
    const c = { id: id11(), authorId, title: "A", description: "", entryIds: ids, createdAt: 1, updatedAt: 1 };
    await repo.insertCollection(db, c);
    await expect(repo.updateCollection(db, c.id, { title: "B", description: "", entryIds: ["doesnotexist"] })).rejects.toThrow();
    expect(await repo.getCollection(db, c.id)).toEqual(c);
  });

  it("deleteCollection removes it and its rows, never the entries; collectionsOfAuthor lists newest first", async () => {
    const authorId = await author();
    const ids = await entries(authorId, 2);
    const older = { id: id11(), authorId, title: "Old", description: "", entryIds: ids, createdAt: 1, updatedAt: 1 };
    const newer = { id: id11(), authorId, title: "New", description: "", entryIds: [], createdAt: 2, updatedAt: 2 };
    await repo.insertCollection(db, older);
    await repo.insertCollection(db, newer);
    expect(await repo.collectionsOfAuthor(db, authorId)).toEqual([newer, older]);
    expect(await repo.deleteCollection(db, older.id)).toBe(true);
    expect(await repo.deleteCollection(db, older.id)).toBe(false);
    expect(await count("collection_entries")).toBe(0);
    expect((await repo.liveEntries(db, ids)).length).toBe(2);
    expect(await repo.collectionsOfAuthor(db, authorId)).toEqual([newer]);
  });
});

// ── reports and the admin log ─────────────────────────────────────────────────

describe("reports and the admin log", () => {
  it("flaggedEntries groups open reports by entry, most recently reported first", async () => {
    const authorId = await author();
    const [a, b] = [entry({ authorId }), entry({ authorId })];
    for (const e of [a, b]) await repo.insertEntry(db, { entry: e, authorEmail: "", manageTokenHash: "h" });
    await repo.addReport(db, { entryId: a.id, reason: "one", reportedAt: 10 });
    await repo.addReport(db, { entryId: b.id, reason: "two", reportedAt: 20 });
    await repo.addReport(db, { entryId: a.id, reason: "three", reportedAt: 30 });
    expect(await repo.flaggedEntries(db)).toEqual([
      { entryId: a.id, entry: a, reports: [{ reason: "three", reportedAt: 30 }, { reason: "one", reportedAt: 10 }] },
      { entryId: b.id, entry: b, reports: [{ reason: "two", reportedAt: 20 }] },
    ]);
    expect(await repo.openReportCount(db, a.id)).toBe(2);
    expect(await repo.closeReports(db, a.id)).toBe(2);
    expect(await repo.closeReports(db, a.id)).toBe(0);
    expect((await repo.flaggedEntries(db)).map((f) => f.entryId)).toEqual([b.id]);
  });

  it("appendAdminLog / readAdminLog: newest first, capped, never an email", async () => {
    const admin = { provider: "github", accountId: "1", name: "Mod" };
    for (let at = 1; at <= 5; at++) {
      await repo.appendAdminLog(db, { at, admin, action: "dismiss-report", target: `t${at}`, reason: "r" });
    }
    const log = await repo.readAdminLog(db, 3);
    expect(log.map((r) => r.at)).toEqual([5, 4, 3]);
    expect(log[0]).toEqual({ at: 5, admin, action: "dismiss-report", target: "t5", reason: "r" });
  });
});

// ── account links ─────────────────────────────────────────────────────────────

describe("account links", () => {
  it("record (once), has, list newest first, forget", async () => {
    await repo.ensureAccountAuthor(db, { ...claim("links"), name: "Ada" });
    const h = "hash-links";
    expect(await repo.recordAccountLink(db, h, { id: "AAAAAAAAAAA", projectName: "One", createdAt: 1 })).toBe(true);
    expect(await repo.recordAccountLink(db, h, { id: "AAAAAAAAAAA", projectName: "Again", createdAt: 9 })).toBe(false);
    expect(await repo.recordAccountLink(db, h, { id: "BBBBBBBBBBB", projectName: "Two", createdAt: 2 })).toBe(true);
    expect(await repo.hasAccountLink(db, h, "AAAAAAAAAAA")).toBe(true);
    expect(await repo.hasAccountLink(db, "hash-other", "AAAAAAAAAAA")).toBe(false);
    expect(await repo.listAccountLinks(db, h)).toEqual([
      { id: "BBBBBBBBBBB", projectName: "Two", createdAt: 2 },
      { id: "AAAAAAAAAAA", projectName: "One", createdAt: 1 },
    ]);
    await repo.forgetAccountLink(db, h, "AAAAAAAAAAA");
    expect(await repo.hasAccountLink(db, h, "AAAAAAAAAAA")).toBe(false);
  });

  it("needs the account to exist (foreign key)", async () => {
    await expect(repo.recordAccountLink(db, "hash-nobody", { id: "AAAAAAAAAAA", projectName: "x", createdAt: 1 })).rejects.toThrow();
  });
});

// ── the claim's moves ─────────────────────────────────────────────────────────

describe("the claim's moves", () => {
  it("mergeAuthorInto moves live entries and collections, takes the bio, retires the old author; a rerun moves nothing", async () => {
    const old = (await repo.insertKeyedAuthor(db, { name: "Old", email: "old@x", keyHash: "ko" }))!;
    await repo.updateAuthorProfile(db, old, { name: "Old", bio: "old bio" });
    const to = await author("New");
    const [live, gone] = [entry({ authorId: old, authorName: "Old" }), entry({ authorId: old, authorName: "Old" })];
    for (const e of [live, gone]) await repo.insertEntry(db, { entry: e, authorEmail: "old@x", manageTokenHash: "h" });
    await repo.removeEntry(db, gone.id);
    await repo.insertCollection(db, { id: id11(), authorId: old, title: "C", description: "", entryIds: [live.id], createdAt: 1, updatedAt: 1 });

    const target = { authorId: to, name: "New", email: "new@x" };
    expect(await repo.mergeAuthorInto(db, old, target)).toEqual({ entries: 1, collections: 1 });
    expect(await repo.getEntryRecord(db, live.id)).toMatchObject({ entry: { authorId: to, authorName: "New" }, authorEmail: "new@x" });
    expect((await repo.collectionsOfAuthor(db, to)).length).toBe(1);
    expect(await repo.getAuthor(db, old)).toMatchObject({ mergedInto: to });
    expect(await repo.getAuthor(db, to)).toMatchObject({ bio: "old bio" });
    expect(await repo.mergeAuthorInto(db, old, target)).toEqual({ entries: 0, collections: 0 });
  });

  it("mergeAuthorInto keeps the target's own bio, and an entry's name when the target has none", async () => {
    const old = (await repo.insertKeyedAuthor(db, { name: "Old", email: "", keyHash: "ko2" }))!;
    await repo.updateAuthorProfile(db, old, { name: "Old", bio: "old bio" });
    const to = await author("New");
    await repo.updateAuthorProfile(db, to, { name: "New", bio: "mine" });
    const e = entry({ authorId: old, authorName: "Old" });
    await repo.insertEntry(db, { entry: e, authorEmail: "", manageTokenHash: "h" });
    await repo.mergeAuthorInto(db, old, { authorId: to, name: "", email: "" });
    expect(await repo.getAuthor(db, to)).toMatchObject({ bio: "mine" });
    expect((await repo.liveEntry(db, e.id))?.authorName).toBe("Old");
  });

  it("moveEntry moves one entry from its owner (or from no owner); not from the wrong one, not when removed", async () => {
    const [from, to] = [await author(), await author("To")];
    const target = { authorId: to, name: "To", email: "to@x" };
    const [mine, orphan, removed] = [entry({ authorId: from }), entry(), entry({ authorId: from })];
    for (const e of [mine, orphan, removed]) await repo.insertEntry(db, { entry: e, authorEmail: "", manageTokenHash: "h" });
    await repo.removeEntry(db, removed.id);
    expect(await repo.moveEntry(db, mine.id, to, target)).toBe(false); // not `to`'s yet
    expect(await repo.moveEntry(db, mine.id, from, target)).toBe(true);
    expect(await repo.moveEntry(db, mine.id, from, target)).toBe(false); // already moved
    expect(await repo.moveEntry(db, orphan.id, null, target)).toBe(true);
    expect(await repo.moveEntry(db, removed.id, from, target)).toBe(false);
    expect((await repo.entriesOfAuthor(db, to)).map((e) => e.id).sort()).toEqual([mine.id, orphan.id].sort());
  });
});

// ── rate limits ───────────────────────────────────────────────────────────────

describe("rate limits: take", () => {
  it("30 parallel takes against max 10: exactly 10 admitted, counts 1..10 each once", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => repo.take(db, "k", 1000, 1, 10)));
    const admitted = results.filter((r) => r.admitted).map((r) => r.count);
    expect(admitted.sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await repo.countFor(db, "k", 1000)).toBe(10);
  });

  it("the same, over two separate database handles (two servers) on one database", async () => {
    const [a, b] = [await dbOverPglite(db.$client), await dbOverPglite(db.$client)];
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => repo.take(i % 2 ? a : b, "k2", 1000, 1, 10)));
    expect(results.filter((r) => r.admitted)).toHaveLength(10);
    expect(await repo.countFor(db, "k2", 1000)).toBe(10);
  });

  it("charges cost; a take that would pass max writes nothing; a new window starts over", async () => {
    expect(await repo.take(db, "c", 1000, 6, 10)).toEqual({ admitted: true, count: 6 });
    expect(await repo.take(db, "c", 1000, 5, 10)).toEqual({ admitted: false, count: null });
    expect(await repo.countFor(db, "c", 1000)).toBe(6);
    expect(await repo.take(db, "c", 1000, 4, 10)).toEqual({ admitted: true, count: 10 });
    expect(await repo.take(db, "c", 2000, 3, 10)).toEqual({ admitted: true, count: 3 });
    expect(await repo.countFor(db, "c", 1000)).toBe(0); // the old window's row was reset
    expect(await repo.take(db, "big", 1000, 11, 10)).toEqual({ admitted: false, count: null });
    expect(await count("rate_limits")).toBe(1); // "big" never got a row
  });

  it("stores only the key's hash", async () => {
    await repo.take(db, "ip:203.0.113.7", 1, 1, 5);
    const keys = rowsOf<{ key: string }>(await db.execute(sql`select key from rate_limits`)).map((r) => r.key);
    expect(keys).toEqual([repo.rateLimitRowKey("ip:203.0.113.7")]);
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── when the database can't be reached ────────────────────────────────────────

describe("an unreachable database (#2351)", () => {
  // A closed PGlite: a database that can't answer. Made once (starting one takes seconds under load).
  let closed: Db;
  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = await PGlite.create();
    await client.close();
    closed = await dbOverPglite(client);
  }, 60_000);
  const closedDb = async (): Promise<Db> => closed;

  it("a query's failure reads as 'unavailable'; a transaction that can't start is DatabaseUnavailableError", async () => {
    const dead = await closedDb();
    const err = await repo.getAccount(dead, "x").catch((e: unknown) => e);
    expect(isDatabaseUnavailable(err)).toBe(true);
    const txErr = await repo.ensureAccountAuthor(dead, { ...claim("down"), name: "x" }).catch((e: unknown) => e);
    expect(isDatabaseUnavailable(txErr)).toBe(true);
    const takeErr = await repo.take(dead, "k", 1, 1, 1).catch((e: unknown) => e);
    expect(isDatabaseUnavailable(takeErr)).toBe(true);
  });

  it("a bug is not an outage: a constraint violation, a TypeError, and a non-database error stay errors", async () => {
    const authorId = await author();
    const e = entry({ authorId });
    await repo.insertEntry(db, { entry: e, authorEmail: "", manageTokenHash: "h" });
    const fk = await repo
      .insertCollection(db, { id: id11(), authorId: "nobody", title: "", description: "", entryIds: [], createdAt: 1, updatedAt: 1 })
      .catch((err: unknown) => err);
    expect(fk).toBeInstanceOf(Error);
    expect(isDatabaseUnavailable(fk)).toBe(false);
    expect(isDatabaseUnavailable(new TypeError("x is undefined"))).toBe(false);
    expect(isDatabaseUnavailable(new Error("blob store said no"))).toBe(false);
    expect(isDatabaseUnavailable(new DatabaseUnavailableError(new Error("EACCES")))).toBe(true);
  });

  it("getDb answers what the test set, and goes back to the process's database after", async () => {
    const dead = await closedDb();
    useDbForTests(dead);
    expect(await getDb()).toBe(dead);
    useDbForTests(null);
    expect(await getDb()).toBeNull();
    useDbForTests(undefined);
    expect(await getDb()).not.toBeNull();
  });
});
