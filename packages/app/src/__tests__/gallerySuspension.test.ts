// @vitest-environment node
// #2400 — a suspension stops what an account does next. It leaves what's already up
// alone, unless the admin also takes everything down.
import { mkdtemp, readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../auth", () => ({ auth: vi.fn(async () => fake.session) }));

import { AUTHOR_KEY_HEADER, MANAGE_TOKEN_HEADER, type PublishResponse, type SuspensionsResponse } from "../gallery/types";
import { hashToken } from "../app/api/gallery/auth";
import { GET as listRoute, POST as publishRoute } from "../app/api/gallery/route";
import { DELETE as deleteRoute, GET as entryRoute } from "../app/api/gallery/[id]/route";
import { POST as reportRoute } from "../app/api/gallery/[id]/report/route";
import { GET as authorRoute, PUT as editAuthorRoute } from "../app/api/gallery/authors/[authorId]/route";
import { POST as newCollectionRoute } from "../app/api/gallery/collections/route";
import { DELETE as deleteCollectionRoute, GET as collectionRoute, PUT as editCollectionRoute } from "../app/api/gallery/collections/[id]/route";
import { POST as claimRoute } from "../app/api/gallery/claim/route";
import { POST as shareRoute } from "../app/api/share/route";
import { GET as logRoute } from "../app/api/gallery/admin/log/route";
import { POST as restoreRoute } from "../app/api/gallery/admin/removed/[id]/restore/route";
import { GET as suspensionsRoute, POST as suspendRoute } from "../app/api/gallery/admin/suspensions/route";
import { DELETE as liftRoute } from "../app/api/gallery/admin/suspensions/[authorId]/route";
import { newShareId } from "../shareCrypto";
import { getDb } from "../db/client";
import * as repo from "../db/repo";

beforeAll(() => getDb(), 60_000);

const ADMIN = "mod-suspend";
const EMAIL = "zz.distinctive.suspended@example-privacy.test";

let dir = "";
beforeAll(async () => {
  dir = await promisify(mkdtemp)(path.join(os.tmpdir(), "stave-gallery-suspend-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function signIn(id: string | null) {
  fake.session = id
    ? {
        user: { name: id, email: EMAIL },
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
  for (const n of ["PUBLISH", "REPORT", "EDIT", "LINK", "CLAIM"]) vi.stubEnv(`STAVE_RATE_LIMIT_${n}`, "1000");
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("STAVE_AUTH_TEST_LOGIN", "1");
});

const json = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://x${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = <K extends string>(key: K, value: string) => ({ params: Promise.resolve({ [key]: value } as Record<K, string>) });
const MANIFEST = {
  schemaVersion: 1,
  project: { name: "My song", sharedAt: 1 },
  files: [{ id: "f0", path: "song.strudel", language: "strudel", content: 's("bd")' }],
  fileOrder: { "": ["f0"] },
  subfolderOrder: {},
};
const publish = () => publishRoute(json("POST", "/api/gallery", { title: "Night drive", kind: "music", tags: [], manifest: MANIFEST }));

/** The shape POST /api/share accepts: the format's version byte, then enough bytes. */
const sealedBytes = () => {
  const bytes = new Uint8Array(256);
  bytes[0] = 1;
  return bytes;
};

let n = 0;
/** A fresh account with one published entry and one collection. */
async function account() {
  const who = `author-${++n}-${Date.now()}`;
  signIn(who);
  const res = await publish();
  expect(res.status).toBe(201);
  const entry = (await res.json()) as PublishResponse;
  const made = await newCollectionRoute(json("POST", "/api/gallery/collections", { title: "Mine", description: "", entryIds: [entry.id] }));
  expect(made.status).toBe(201);
  const { collection } = (await made.json()) as { collection: { id: string } };
  return { who, authorId: entry.authorId as string, entryId: entry.id, manageToken: entry.manageToken, collectionId: collection.id };
}

const suspend = (authorId: string, over: Record<string, unknown> = {}) => {
  signIn(ADMIN);
  return suspendRoute(json("POST", "/api/gallery/admin/suspensions", { authorId, reason: "spam", days: 7, takeDownAll: false, ...over }));
};
const lift = (authorId: string, body: unknown = { reason: "by mistake" }) => {
  signIn(ADMIN);
  return liftRoute(json("DELETE", `/api/gallery/admin/suspensions/${authorId}`, body), ctx("authorId", authorId));
};
const profile = (authorId: string) => authorRoute(new Request(`http://x/api/gallery/authors/${authorId}`), ctx("authorId", authorId));
const collectionPage = (id: string) => collectionRoute(new Request(`http://x/api/gallery/collections/${id}`), ctx("id", id));
const entryStatus = async (id: string) => (await entryRoute(new Request(`http://x/api/gallery/${id}`), ctx("id", id))).status;
const listed = async () => ((await (await listRoute()).json()) as { entries: Array<{ id: string }> }).entries.map((e) => e.id);
const logActions = async (target: string) => {
  signIn(ADMIN);
  const body = (await (await logRoute(new Request("http://x/api/gallery/admin/log"))).json()) as {
    actions: Array<{ action: string; target: string; reason: string }>;
  };
  return body.actions.filter((a) => a.target === target).map((a) => a.action);
};

/** Every write the account may not make, each as a call that would otherwise succeed. */
const REFUSED: Array<[string, (a: Awaited<ReturnType<typeof account>>) => Promise<Response>]> = [
  ["publishing", () => publish()],
  ["reporting", (a) => reportRoute(json("POST", `/api/gallery/${a.entryId}/report`, { reason: "x" }), ctx("id", a.entryId))],
  ["editing the profile", (a) => editAuthorRoute(json("PUT", `/api/gallery/authors/${a.authorId}`, { name: "New", bio: "" }), ctx("authorId", a.authorId))],
  ["making a collection", () => newCollectionRoute(json("POST", "/api/gallery/collections", { title: "More", description: "", entryIds: [] }))],
  ["editing a collection", (a) => editCollectionRoute(json("PUT", `/api/gallery/collections/${a.collectionId}`, { title: "New", description: "", entryIds: [] }), ctx("id", a.collectionId))],
  ["bringing old shares in", () => claimRoute(json("POST", "/api/gallery/claim", { manageTokens: [], authorKey: null, links: [] }))],
];

describe("a suspended account", () => {
  it.each(REFUSED)("is refused %s, and the same call works once it's lifted", async (_name, call) => {
    const a = await account();
    expect((await suspend(a.authorId)).status).toBe(204);
    signIn(a.who);
    const refused = await call(a);
    expect(refused.status).toBe(403);
    const body = (await refused.json()) as { error: string; suspendedUntil: number };
    expect(body.error).toMatch(/suspended/);
    expect(body.error).toMatch(/until \d+ \w+ \d{4}/);
    expect(body.suspendedUntil).toBeGreaterThan(Date.now());

    expect((await lift(a.authorId)).status).toBe(204);
    signIn(a.who);
    expect((await call(a)).status).toBeLessThan(300);
  });

  it("says plainly when it's permanent, with no date", async () => {
    const a = await account();
    await suspend(a.authorId, { days: null });
    signIn(a.who);
    const body = (await (await publish()).json()) as { error: string; suspendedUntil: unknown };
    expect(body.error).toBe("This account is suspended from publishing, editing and reporting.");
    expect(body.suspendedUntil).toBeNull();
  });

  it("can still browse, make private links and delete its own work", async () => {
    const a = await account();
    await suspend(a.authorId);
    signIn(a.who);
    expect(await listed()).toContain(a.entryId);
    expect(await entryStatus(a.entryId)).toBe(200);
    const link = await shareRoute(new Request("http://x/api/share", { method: "POST", body: sealedBytes() }));
    expect(link.status).toBeLessThan(300);
    expect((await deleteCollectionRoute(json("DELETE", `/api/gallery/collections/${a.collectionId}`), ctx("id", a.collectionId))).status).toBeLessThan(300);
    expect((await deleteRoute(json("DELETE", `/api/gallery/${a.entryId}`), ctx("id", a.entryId))).status).toBe(204);
    expect(await repo.getEntryRecord((await getDb())!, a.entryId)).toBeNull();
  });

  it("another account isn't affected (control)", async () => {
    const [a, b] = [await account(), await account()];
    await suspend(a.authorId);
    signIn(b.who);
    expect((await publish()).status).toBe(201);
  });

  it("ends by itself when its date passes", async () => {
    const a = await account();
    await suspend(a.authorId, { takeDownAll: true });
    const db = (await getDb()) as unknown as { $client: { query: (q: string, p?: unknown[]) => Promise<unknown> } };
    signIn(a.who);
    expect((await publish()).status).toBe(403);
    expect((await profile(a.authorId)).status).toBe(404);
    await db.$client.query("update suspensions set until = 1 where until is not null");
    signIn(a.who);
    expect((await publish()).status).toBe(201);
    expect((await profile(a.authorId)).status).toBe(200);
    signIn(ADMIN);
    const body = (await (await suspensionsRoute(new Request("http://x/api/gallery/admin/suspensions"))).json()) as SuspensionsResponse;
    expect(body.suspensions.map((s) => s.authorId)).not.toContain(a.authorId);
  });
});

describe("a plain suspension leaves what's up alone", () => {
  it("entries, collections and the profile stay, with nothing public saying so", async () => {
    const a = await account();
    await suspend(a.authorId, { reason: "a distinctive reason" });
    signIn(null);
    expect(await listed()).toContain(a.entryId);
    expect(await entryStatus(a.entryId)).toBe(200);
    expect((await collectionPage(a.collectionId)).status).toBe(200);
    const page = await profile(a.authorId);
    expect(page.status).toBe(200);
    const text = await page.text();
    expect(text).toContain(a.entryId);
    expect(text).not.toMatch(/suspend/i);
    expect(text).not.toContain("a distinctive reason");
  });
});

describe("suspending with everything taken down", () => {
  it("hides every entry, the profile and collections, and logs a line per entry plus the suspension", async () => {
    const a = await account();
    signIn(a.who);
    const second = (await (await publish()).json()) as PublishResponse;

    expect((await suspend(a.authorId, { takeDownAll: true })).status).toBe(204);

    signIn(null);
    for (const id of [a.entryId, second.id]) expect(await entryStatus(id)).toBe(410);
    expect(await listed()).not.toContain(a.entryId);
    expect((await profile(a.authorId)).status).toBe(404);
    expect((await collectionPage(a.collectionId)).status).toBe(404);
    expect(await logActions(a.authorId)).toEqual(["suspend-account"]);
    expect(await logActions(a.entryId)).toEqual(["take-down-entry"]);
    expect(await logActions(second.id)).toEqual(["take-down-entry"]);
  });

  it("is fully undone by lifting and restoring, and restoring works while it's still suspended", async () => {
    const a = await account();
    await suspend(a.authorId, { takeDownAll: true });

    signIn(ADMIN);
    const restored = await restoreRoute(json("POST", `/api/gallery/admin/removed/${a.entryId}/restore`, { reason: "fine" }), ctx("id", a.entryId));
    expect(restored.status).toBe(204);
    expect(await entryStatus(a.entryId)).toBe(200);
    expect((await profile(a.authorId)).status).toBe(404); // Still suspended.

    expect((await lift(a.authorId)).status).toBe(204);
    expect((await profile(a.authorId)).status).toBe(200);
    expect((await collectionPage(a.collectionId)).status).toBe(200);
    signIn(a.who);
    expect((await publish()).status).toBe(201);
    expect(await logActions(a.authorId)).toEqual(["lift-suspension", "suspend-account"]);
  });

  it("lifting doesn't bring entries back by itself", async () => {
    const a = await account();
    await suspend(a.authorId, { takeDownAll: true });
    await lift(a.authorId);
    expect(await entryStatus(a.entryId)).toBe(410);
  });
});

describe("the admin routes", () => {
  it("refuse everyone but admins, and change nothing", async () => {
    const a = await account();
    for (const who of [null, "someone-else"]) {
      signIn(who);
      expect((await suspensionsRoute(new Request("http://x/api/gallery/admin/suspensions"))).status).toBe(403);
      expect((await suspendRoute(json("POST", "/api/gallery/admin/suspensions", { authorId: a.authorId, reason: "x", days: 7, takeDownAll: false }))).status).toBe(403);
      expect((await liftRoute(json("DELETE", `/api/gallery/admin/suspensions/${a.authorId}`, { reason: "x" }), ctx("authorId", a.authorId))).status).toBe(403);
    }
    signIn(a.who);
    expect((await publish()).status).toBe(201);
    expect(await logActions(a.authorId)).toEqual([]);
  });

  it("need a reason, a known length and a real account", async () => {
    const a = await account();
    expect((await suspend(a.authorId, { reason: "" })).status).toBe(400);
    expect((await suspend(a.authorId, { days: 9 })).status).toBe(400);
    expect((await suspend(a.authorId, { days: undefined })).status).toBe(400);
    expect((await suspend(a.authorId, { takeDownAll: "yes" })).status).toBe(400);
    expect((await suspend("not an id")).status).toBe(400);
    expect((await suspend(newShareId())).status).toBe(404);
    expect((await lift(a.authorId, {})).status).toBe(400);
    expect((await lift(a.authorId)).status).toBe(404); // Not suspended.
    expect(await logActions(a.authorId)).toEqual([]);
  });

  it("list who is suspended, with no email or account hash", async () => {
    const a = await account();
    await suspend(a.authorId, { reason: "listed reason", days: 30 });
    signIn(ADMIN);
    const res = await suspensionsRoute(new Request("http://x/api/gallery/admin/suspensions"));
    const text = await res.clone().text();
    const body = (await res.json()) as SuspensionsResponse;
    const row = body.suspensions.find((s) => s.authorId === a.authorId);
    expect(row).toMatchObject({ reason: "listed reason", hideProfile: false });
    expect(row!.until! - row!.at).toBe(30 * 24 * 60 * 60 * 1000);
    expect(text).not.toContain(EMAIL);
    expect(Object.keys(row!).sort()).toEqual(["at", "authorId", "hideProfile", "name", "reason", "until"]);
  });
});

describe("a suspension binds an author's key too", () => {
  it("the profile can't be edited by key, with no session, while it lasts", async () => {
    const a = await account();
    const key = `key-${Date.now()}`;
    const db = (await getDb()) as unknown as { $client: { query: (q: string, p?: unknown[]) => Promise<unknown> } };
    await db.$client.query("insert into author_keys (key_hash, author_id) values ($1, $2)", [hashToken(key), a.authorId]);
    const editByKey = () => {
      signIn(null);
      return editAuthorRoute(json("PUT", `/api/gallery/authors/${a.authorId}`, { name: "New", bio: "" }, { [AUTHOR_KEY_HEADER]: key }), ctx("authorId", a.authorId));
    };
    expect((await editByKey()).status).toBe(200); // The control: the key works.
    await suspend(a.authorId);
    expect((await editByKey()).status).toBe(403);
    await lift(a.authorId);
    expect((await editByKey()).status).toBe(200);
  });

  it("suspensionOfAuthor finds it from the author, and not for an author with no account", async () => {
    const a = await account();
    const db = (await getDb())!;
    expect(await repo.suspensionOfAuthor(db, a.authorId)).toBeNull();
    await suspend(a.authorId);
    expect(await repo.suspensionOfAuthor(db, a.authorId)).toMatchObject({ hideProfile: false });
    const keyed = (await repo.insertKeyedAuthor(db, { name: "Old", email: "", keyHash: `k${Date.now()}` }))!;
    expect(await repo.suspensionOfAuthor(db, keyed)).toBeNull();
  });
});

// A route added later has to choose a side here, or this fails.
describe("every write route says whether a suspension stops it", () => {
  const CHECKED = [
    "POST gallery/route.ts",
    "POST gallery/[id]/report/route.ts",
    "POST gallery/claim/route.ts",
    "POST gallery/collections/route.ts",
    "PUT gallery/collections/[id]/route.ts",
    "PUT gallery/authors/[authorId]/route.ts",
  ];
  /** Why each of these goes on working. */
  const NOT_CHECKED: Record<string, string> = {
    "DELETE gallery/[id]/route.ts": "an account can always delete its own work",
    "DELETE gallery/collections/[id]/route.ts": "an account can always delete its own work",
    "POST share/route.ts": "private links keep working",
    "DELETE share/[id]/route.ts": "private links keep working",
    "POST gallery/admin/reports/[id]/dismiss/route.ts": "admins only",
    "POST gallery/admin/removed/[id]/restore/route.ts": "admins only",
    "POST gallery/admin/suspensions/route.ts": "admins only",
    "DELETE gallery/admin/suspensions/[authorId]/route.ts": "admins only",
  };

  const apiRoot = path.join(__dirname, "../app/api");
  const routeFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? routeFiles(full) : e.name === "route.ts" ? [full] : [];
    });
  /** "METHOD file" → that handler's source. */
  const handlers = new Map<string, string>();
  for (const file of [...routeFiles(path.join(apiRoot, "gallery")), ...routeFiles(path.join(apiRoot, "share"))]) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/export\s+const\s+(POST|PUT|PATCH|DELETE)\b/g)) {
      const start = src.indexOf(`async function handle${m[1]}`);
      const end = src.indexOf("\nexport const ", start);
      handlers.set(`${m[1]} ${path.relative(apiRoot, file).split(path.sep).join("/")}`, src.slice(start, end));
    }
  }

  it("names every route the scan finds", () => {
    expect(handlers.size).toBeGreaterThan(5);
    expect([...CHECKED, ...Object.keys(NOT_CHECKED)].sort()).toEqual([...handlers.keys()].sort());
  });

  it("those that stop really check, and the others don't", () => {
    for (const name of CHECKED) expect([name, handlers.get(name)?.includes("suspendedRefusal(")]).toEqual([name, true]);
    for (const name of Object.keys(NOT_CHECKED)) expect([name, handlers.get(name)?.includes("suspendedRefusal(")]).toEqual([name, false]);
  });
});

describe("the manage token", () => {
  it("a suspended author's token still deletes the entry", async () => {
    const a = await account();
    await suspend(a.authorId);
    signIn(null);
    const res = await deleteRoute(json("DELETE", `/api/gallery/${a.entryId}`, undefined, { [MANAGE_TOKEN_HEADER]: a.manageToken }), ctx("id", a.entryId));
    expect(res.status).toBe(204);
  });
});
