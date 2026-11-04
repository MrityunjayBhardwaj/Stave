// @vitest-environment node
// #2331 — admins are signed-in accounts listed in STAVE_GALLERY_ADMINS, not a
// shared key. Every moderation route and every admin delete answers 403 to a
// non-admin session, to nobody signed in, and to the old key header; take-downs
// and dismissals need a reason and leave a record naming the admin (never the
// email). Auth.js's `auth()` is mocked so each test says who is signed in.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../auth", () => ({ auth: vi.fn(async () => fake.session) }));

import type {
  AdminLogResponse,
  GalleryCollection,
  GalleryManifest,
  GallerySessionResponse,
  ModerationReportsResponse,
  PublishResponse,
} from "../gallery/types";
import { POST as publishRoute } from "../app/api/gallery/route";
import { DELETE as deleteEntryRoute, GET as entryRoute } from "../app/api/gallery/[id]/route";
import { POST as reportRoute } from "../app/api/gallery/[id]/report/route";
import { POST as collectionPostRoute } from "../app/api/gallery/collections/route";
import { DELETE as collectionDeleteRoute, GET as collectionGetRoute } from "../app/api/gallery/collections/[id]/route";
import { GET as oldReportsRoute } from "../app/api/gallery/reports/route";
import { GET as reportsRoute } from "../app/api/gallery/admin/reports/route";
import { POST as dismissRoute } from "../app/api/gallery/admin/reports/[id]/dismiss/route";
import { GET as logRoute } from "../app/api/gallery/admin/log/route";
import { GET as meRoute } from "../app/api/gallery/me/route";
import { ADMIN_LOG_PREFIX, appendAdminLog, parseAdminList, readAdminLog } from "../app/api/gallery/admin";
import { galleryStore } from "../app/api/gallery/store";
import { getDb } from "../db/client";

// #2352 — the gallery's records are in an in-memory Postgres (PGlite) per test
// file. Starting it takes a few seconds, once; do it here, not inside the first test.
beforeAll(() => getDb(), 60_000);

const ADMIN = "mod-admin";
const ADMIN_NAME = "Mo Moderator";
const ADMIN_EMAIL = "ww.distinctive.admin+mod@example-admin-privacy.test";
const AUTHOR = "ada-admin-tests";
const AUTHOR_EMAIL = "vv.distinctive.author@example-admin-privacy.test";
const OTHER = "eve-not-admin";
const OLD_ADMIN_HEADER = "x-stave-admin-key";
const OLD_KEY = "the-old-shared-admin-key-0123";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stave-gallery-admin-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.stubEnv("STAVE_GALLERY_DEV_DIR", dir);
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
  // Spaces and a stray comma on purpose: the list is whitespace-tolerant.
  vi.stubEnv("STAVE_GALLERY_ADMINS", ` github:999 , test-login:${ADMIN},`);
  // The old key is still set, to prove its header opens nothing.
  vi.stubEnv("STAVE_GALLERY_ADMIN_KEY", OLD_KEY);
  signIn(null);
});

function signIn(id: string | null) {
  const admin = id === ADMIN;
  fake.session = id
    ? {
        user: { name: admin ? ADMIN_NAME : `Test ${id}`, email: admin ? ADMIN_EMAIL : AUTHOR_EMAIL },
        account: { provider: "test-login", providerAccountId: id, badge: "github", login: id },
        expires: "2099-01-01T00:00:00.000Z",
      }
    : null;
}

const manifest: GalleryManifest = {
  schemaVersion: 1,
  project: { name: "Song", sharedAt: 1 },
  files: [{ id: "f0", path: "song.strudel", language: "strudel", content: '$: s("bd")' }],
  fileOrder: { "": ["f0"] },
  subfolderOrder: {},
};

const json = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let n = 0;
async function publishAsAuthor(): Promise<string> {
  signIn(AUTHOR);
  const res = await publishRoute(
    json("POST", "http://x/api/gallery", { title: `Track ${++n}`, kind: "music", tags: [], manifest }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as PublishResponse).id;
}
async function reported(reason = "spam"): Promise<string> {
  const id = await publishAsAuthor();
  signIn(null);
  const res = await reportRoute(json("POST", `http://x/api/gallery/${id}/report`, { reason }), ctx(id));
  expect(res.status).toBe(202);
  return id;
}
async function collectionOfAuthor(): Promise<string> {
  signIn(AUTHOR);
  const res = await collectionPostRoute(
    json("POST", "http://x/api/gallery/collections", { title: "Album", description: "", entryIds: [] }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { collection: GalleryCollection }).collection.id;
}

/** Each admin route, called as whoever is signed in, with optional headers and body. */
const routes = {
  reports: (h: Record<string, string> = {}) => reportsRoute(json("GET", "http://x/api/gallery/admin/reports", undefined, h)),
  oldReports: (h: Record<string, string> = {}) => oldReportsRoute(json("GET", "http://x/api/gallery/reports", undefined, h)),
  log: (h: Record<string, string> = {}) => logRoute(json("GET", "http://x/api/gallery/admin/log", undefined, h)),
  dismiss: (id: string, body?: unknown, h: Record<string, string> = {}) =>
    dismissRoute(json("POST", `http://x/api/gallery/admin/reports/${id}/dismiss`, body, h), ctx(id)),
  deleteEntry: (id: string, body?: unknown, h: Record<string, string> = {}) =>
    deleteEntryRoute(json("DELETE", `http://x/api/gallery/${id}`, body, h), ctx(id)),
  deleteCollection: (id: string, body?: unknown, h: Record<string, string> = {}) =>
    collectionDeleteRoute(json("DELETE", `http://x/api/gallery/collections/${id}`, body, h), ctx(id)),
};
const entryStatus = async (id: string) => (await entryRoute(new Request(`http://x/api/gallery/${id}`), ctx(id))).status;

describe("STAVE_GALLERY_ADMINS", () => {
  it("is comma-separated, whitespace-tolerant, and drops blanks and malformed ids", () => {
    expect([...parseAdminList(" github:12345 ,google:678,, test-login:mo ")]).toEqual([
      "github:12345",
      "google:678",
      "test-login:mo",
    ]);
    expect(parseAdminList(undefined).size).toBe(0);
    expect(parseAdminList("").size).toBe(0);
    expect(parseAdminList(" , ,").size).toBe(0);
    // No provider, no id, or no colon can match no account.
    expect([...parseAdminList(":123, github:, 12345, github:1")]).toEqual(["github:1"]);
  });

  it("matches the provider AND the account id: the same id under another provider is no admin", async () => {
    const id = await reported();
    vi.stubEnv("STAVE_GALLERY_ADMINS", `github:${ADMIN}`);
    signIn(ADMIN);
    expect((await routes.reports()).status).toBe(403);
    expect((await routes.deleteEntry(id, { reason: "x" })).status).toBe(403);
    vi.stubEnv("STAVE_GALLERY_ADMINS", `test-login:${ADMIN}`);
    expect((await routes.reports()).status).toBe(200);
  });
});

describe("everyone but an admin gets 403", () => {
  it("on every moderation route and every admin delete: signed out, a non-admin, and the old key header", async () => {
    const entryId = await reported();
    const collectionId = await collectionOfAuthor();
    const old = { [OLD_ADMIN_HEADER]: OLD_KEY };
    const callers: Array<[string, string | null, Record<string, string>]> = [
      ["signed out", null, {}],
      ["a non-admin", OTHER, {}],
      ["the old key header, signed out", null, old],
      ["the old key header, as a non-admin", OTHER, old],
    ];
    const reason = { reason: "should not matter" };
    for (const [who, id, h] of callers) {
      signIn(id);
      expect((await routes.reports(h)).status, `${who}: admin/reports`).toBe(403);
      expect((await routes.oldReports(h)).status, `${who}: reports`).toBe(403);
      expect((await routes.log(h)).status, `${who}: admin/log`).toBe(403);
      expect((await routes.dismiss(entryId, reason, h)).status, `${who}: dismiss`).toBe(403);
      expect((await routes.deleteEntry(entryId, reason, h)).status, `${who}: delete entry`).toBe(403);
      expect((await routes.deleteCollection(collectionId, reason, h)).status, `${who}: delete collection`).toBe(403);
    }
    // Control: all of that changed nothing, and the admin really can.
    expect(await entryStatus(entryId)).toBe(200);
    signIn(ADMIN);
    expect((await routes.reports()).status).toBe(200);
    expect((await routes.log()).status).toBe(200);
  });

  it("with STAVE_GALLERY_ADMINS unset, nobody is an admin", async () => {
    vi.stubEnv("STAVE_GALLERY_ADMINS", "");
    signIn(ADMIN);
    expect((await routes.reports()).status).toBe(403);
    expect((await routes.log()).status).toBe(403);
  });
});

describe("taking down", () => {
  it("an entry, with a reason: 410 after, and a log record naming the admin", async () => {
    const id = await reported("hateful title");
    signIn(ADMIN);
    expect((await routes.deleteEntry(id, { reason: "  hateful title, confirmed  " })).status).toBe(204);
    expect(await entryStatus(id)).toBe(410);

    const log = (await (await routes.log()).json()) as AdminLogResponse;
    expect(log.actions[0]).toEqual({
      at: expect.any(Number),
      admin: { provider: "test-login", accountId: ADMIN, name: ADMIN_NAME },
      action: "take-down-entry",
      target: id,
      reason: "hateful title, confirmed",
    });
    const flagged = (await (await routes.reports()).json()) as ModerationReportsResponse;
    expect(flagged.flagged.map((f) => f.entryId)).not.toContain(id);
  });

  it("a collection, with a reason, and logs it", async () => {
    const id = await collectionOfAuthor();
    signIn(ADMIN);
    expect((await routes.deleteCollection(id, { reason: "spam collection" })).status).toBe(204);
    expect((await collectionGetRoute(new Request(`http://x/api/gallery/collections/${id}`), ctx(id))).status).toBe(404);
    const log = (await (await routes.log()).json()) as AdminLogResponse;
    expect(log.actions[0]).toMatchObject({ action: "take-down-collection", target: id, reason: "spam collection" });
  });

  it("refuses with 400, changing and logging nothing, when the reason is missing, blank or not JSON", async () => {
    const entryId = await reported();
    const collectionId = await collectionOfAuthor();
    signIn(ADMIN);
    const before = (await galleryStore()!.list(ADMIN_LOG_PREFIX)).length;
    for (const body of [undefined, {}, { reason: "   " }, { reason: 7 }]) {
      expect((await routes.deleteEntry(entryId, body)).status, JSON.stringify(body)).toBe(400);
      expect((await routes.deleteCollection(collectionId, body)).status, JSON.stringify(body)).toBe(400);
      expect((await routes.dismiss(entryId, body)).status, JSON.stringify(body)).toBe(400);
    }
    const notJson = await deleteEntryRoute(
      new Request(`http://x/api/gallery/${entryId}`, { method: "DELETE", body: "take it down" }),
      ctx(entryId),
    );
    expect(notJson.status).toBe(400);
    expect(await entryStatus(entryId)).toBe(200);
    expect((await galleryStore()!.list(ADMIN_LOG_PREFIX)).length).toBe(before);
  });

  it("an admin deleting their OWN entry is the author's delete: no reason needed", async () => {
    signIn(ADMIN);
    const res = await publishRoute(json("POST", "http://x/api/gallery", { title: "Mine", kind: "music", tags: [], manifest }));
    const { id } = (await res.json()) as PublishResponse;
    expect((await routes.deleteEntry(id)).status).toBe(204);
  });
});

describe("dismissing", () => {
  it("removes the entry from the flagged list, leaves it up, and logs it", async () => {
    const id = await reported("looks like spam");
    signIn(ADMIN);
    let flagged = (await (await routes.reports()).json()) as ModerationReportsResponse;
    expect(flagged.flagged.find((f) => f.entryId === id)?.reports).toEqual([
      { reason: "looks like spam", reportedAt: expect.any(Number) },
    ]);

    expect((await routes.dismiss(id, { reason: "reviewed, fine" })).status).toBe(204);
    flagged = (await (await routes.reports()).json()) as ModerationReportsResponse;
    expect(flagged.flagged.map((f) => f.entryId)).not.toContain(id);
    expect(await entryStatus(id)).toBe(200);

    const log = (await (await routes.log()).json()) as AdminLogResponse;
    expect(log.actions[0]).toMatchObject({
      action: "dismiss-report",
      target: id,
      reason: "reviewed, fine",
      admin: { provider: "test-login", accountId: ADMIN, name: ADMIN_NAME },
    });
    // Nothing left to dismiss.
    expect((await routes.dismiss(id, { reason: "again" })).status).toBe(404);
  });
});

describe("the flagged list and the log", () => {
  it("groups reports by entry, newest report first", async () => {
    const id = await reported("first");
    signIn(null);
    await reportRoute(json("POST", `http://x/api/gallery/${id}/report`, { reason: "second" }), ctx(id));
    signIn(ADMIN);
    const body = (await (await routes.reports()).json()) as ModerationReportsResponse;
    const mine = body.flagged.find((f) => f.entryId === id)!;
    expect(mine.entry?.id).toBe(id);
    expect(mine.reports.map((r) => r.reason)).toEqual(["second", "first"]);
    // The old address answers the same.
    expect(await (await routes.oldReports()).json()).toEqual(body);
  });

  it("lists the newest 200, newest first", async () => {
    const store = galleryStore()!;
    const admin = { provider: "test-login", accountId: ADMIN, name: ADMIN_NAME };
    for (let i = 0; i < 205; i++) {
      await appendAdminLog(store, { at: 1_000_000_000_000 + i, admin, action: "dismiss-report", target: `t${i}`, reason: "r" });
    }
    // Older than anything else in the log, so read the log down to them.
    const all = await readAdminLog(store, 10_000);
    // 2001 vs today: everything this test wrote, nothing the others did.
    const old = all.filter((r) => r.at < 1_100_000_000_000);
    expect(old).toHaveLength(205);
    expect(old[0].target).toBe("t204");
    expect(all.indexOf(old[0])).toBe(all.length - 205);
    // The route's view: never more than 200, newest first.
    const got = await readAdminLog(store);
    expect(got).toHaveLength(200);
    expect(got).toEqual(all.slice(0, 200));
    expect([...got].sort((a, b) => b.at - a.at)).toEqual(got);
  });

  it("names admins without their email, in the log, the flagged list and /me", async () => {
    const id = await reported();
    signIn(ADMIN);
    expect((await routes.dismiss(id, { reason: "fine" })).status).toBe(204);
    const id2 = await reported();
    signIn(ADMIN);
    expect((await routes.deleteEntry(id2, { reason: "gone" })).status).toBe(204);
    await reported();
    signIn(ADMIN);
    const bodies = {
      log: await (await routes.log()).text(),
      reports: await (await routes.reports()).text(),
      me: await (await meRoute(new Request("http://x/api/gallery/me"))).text(),
    };
    // Controls: they carry the admin and the entries, so an empty body can't pass.
    expect(bodies.log).toContain(ADMIN_NAME);
    expect(bodies.log).toContain(id2);
    expect(bodies.reports).toContain("spam");
    expect(bodies.me).toContain(`test-login:${ADMIN}`);
    for (const [label, body] of Object.entries(bodies)) {
      expect(body, label).not.toContain(ADMIN_EMAIL);
      expect(body, label).not.toContain(AUTHOR_EMAIL);
      expect(body, label).not.toContain("example-admin-privacy.test");
    }
  });
});

describe("/api/gallery/me", () => {
  const me = async () => (await (await meRoute(new Request("http://x/api/gallery/me"))).json()) as GallerySessionResponse;

  it("says isAdmin for an admin only, and shows each person their own account id", async () => {
    signIn(ADMIN);
    const admin = await me();
    expect(admin.isAdmin).toBe(true);
    expect(admin.user?.accountId).toBe(`test-login:${ADMIN}`);

    signIn(OTHER);
    const other = await me();
    expect(other.isAdmin).toBe(false);
    expect(other.user?.accountId).toBe(`test-login:${OTHER}`);

    signIn(null);
    const out = await me();
    expect(out.isAdmin).toBe(false);
    expect(out.user).toBeNull();

    // Even with the old key header, signed out.
    const withOld = (await (
      await meRoute(new Request("http://x/api/gallery/me", { headers: { [OLD_ADMIN_HEADER]: OLD_KEY } }))
    ).json()) as GallerySessionResponse;
    expect(withOld.isAdmin).toBe(false);
  });
});
