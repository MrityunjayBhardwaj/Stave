// @vitest-environment node
// #2368 — a profile can't name itself as Stave. The trust question before gallery
// code runs says "This code was written by <name>", and the name is the person's
// own choice. The check itself, then every door that sets a name, through the
// real routes on a real (PGlite) database.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("../auth", () => ({ auth: vi.fn(async () => fake.session) }));

import { PUT as authorPutRoute } from "../app/api/gallery/authors/[authorId]/route";
import { hashToken } from "../app/api/gallery/auth";
import { createAuthor, newAuthorKey } from "../app/api/gallery/authors";
import { POST as claimRoute } from "../app/api/gallery/claim/route";
import { GET as meRoute } from "../app/api/gallery/me/route";
import { POST as publishRoute } from "../app/api/gallery/route";
import { getDb, useDbForTests, type Db } from "../db/client";
import { getAuthor, insertKeyedAuthor, updateAuthorProfile } from "../db/repo/accounts";
import { buildProfileRequest } from "../gallery/profileModel";
import { BLANK_NAME_ERROR, hasVisibleCharacter, isReservedName, RESERVED_NAME_ERROR } from "../gallery/reservedNames";
import { galleryTrustMessage } from "../gallery/safeRun";
import { AUTHOR_KEY_HEADER, MAX_AUTHOR_NAME_CHARS, type GalleryManifest, type GallerySessionResponse, type PublishResponse } from "../gallery/types";

const MUST_REFUSE = [
  // the list in the issue
  "Stave", "Stave team", "admin", "moderator",
  // case, spacing, punctuation, separators
  "STAVE", "sTaVe", "  Stave  ", "S t a v e", "s.t.a.v.e", "s-t-a-v-e", "S_T_A_V_E", "stave-team", "stave_team", "StaveTeam",
  "A D M I N", "m.o.d.e.r.a.t.o.r", "Stave!", "~Stave~", "Stave 🎵", "(admin)",
  // Unicode width and compatibility forms
  "ＳＴＡＶＥ", "ａｄｍｉｎ", "𝐒𝐭𝐚𝐯𝐞", "𝓢𝓽𝓪𝓿𝓮", "Ⓢⓣⓐⓥⓔ", "🅂🅃🄰🅅🄴", "ˢᵗᵃᵛᵉ",
  // accents and other marks
  "Stávé", "Ştàvë", "S̶t̶a̶v̶e̶", "Àdmîn",
  // invisible characters
  "St​ave", "​Stave", "St­ave", "S‍t‌a⁠v﻿e", "Stave️", "ㅤStave", "St\u{E0041}ave", "⠀Stave", "Stave Team",
  // a right-to-left override shows these as "stave"
  "‮evats", "St‮eva‬",
  // look-alike letters
  "Ѕtave", "Stаve", "Stavе", "ЅТАVЕ", "Ѕtаvе", "Staνe", "ꜱᴛᴀᴠᴇ", "аdmin", "АDМIN", "ADMΙΝ", "Мoderator", "Μοderator", "МОDЕRАТОR", "Stave Теаm",
  // digits and symbols standing in for letters
  "5tave", "St4ve", "Stav3", "$tave", "St@ve", "Adm1n", "ADMlN", "adm!n", "M0derator", "Moderat0r", "m0d3r4t0r", "Stave1", "Stave 2026",
  // letter pairs that read as one letter
  "Adrnin", "Aclmin", "rnoderator",
  // phrases that claim to be Stave
  "The Stave Team", "Team Stave", "Official Stave", "Stave Official", "The Official Stave Team", "Stave Support", "Stave Staff", "stave.live", "Stave HQ", "Stave's team", "Staves Team", "Stave Admin", "Stave Moderator", "Admin of Stave", "Moderator at Stave", "Stave Mods",
  // roles with no Stave in them
  "Admin", "Admins", "Administrator", "Administrators", "Moderators", "Mod", "Mods", "The Admin", "Site Admin", "Gallery Moderator", "Head Mod", "Admin Team", "Moderation Team", "Moderation",
];

const MUST_ALLOW = [
  // the names in the assignment
  "Stavros", "Staveley", "Adam", "Mjay", "Modest Mouse",
  // decided: a joke title, not a claim to run Stave
  "Administrator of Vibes", "Moderator of Vibes",
  // real names and acts next to the reserved words
  "Staves", "Stavely", "Stavanger", "Steve", "Dave", "Stave Jobs", "Stave Smith", "Fan of Stave", "Admiral Ackbar", "Adele", "Admira", "Moderat", "Moderato", "Modeselektor", "Modjo", "Mod Sun", "Mo Dee", "Modi", "Ad Minh", "Madmin", "Ada", "Teamster", "The Team", "Official", "Stave4Ever",
  // not misspellings: the header says how far it goes
  "Stavve", "Staue", "Staev",
  // other alphabets, used for real
  "Ставе", "Степан", "Μαρία", "李雷", "ステイヴ", "José", "Søren", "Łukasz", "Ana María", "Андрей",
  // the fallback itself
  "New artist",
];

describe("the reserved-name check", () => {
  it.each(MUST_REFUSE)("refuses %j", (name) => {
    expect(isReservedName(name)).toBe(true);
  });

  it.each(MUST_ALLOW)("allows %j", (name) => {
    expect(isReservedName(name)).toBe(false);
  });

  it("is not fooled into a slow match by a long run of reserved words", () => {
    const started = performance.now();
    expect(isReservedName("mods".repeat(15))).toBe(false);
    expect(isReservedName("thestave".repeat(7) + "x")).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("the profile form", () => {
  it("says the same as the server, in a sentence", () => {
    expect(buildProfileRequest({ name: "Ѕtave", bio: "" }, "Ada")).toEqual({ request: null, errors: [`Sorry, ${RESERVED_NAME_ERROR}.`] });
    expect(buildProfileRequest({ name: "Stavros", bio: "" }, "Ada").errors).toEqual([]);
  });

  it("lets an unchanged name through, so the bio can still be edited, but not a changed spelling of it", () => {
    expect(buildProfileRequest({ name: " Stave ", bio: "new" }, "Stave")).toEqual({ request: { name: "Stave", bio: "new" }, errors: [] });
    expect(buildProfileRequest({ name: "STAVE", bio: "new" }, "Stave").request).toBeNull();
  });
});

// ── the doors ────────────────────────────────────────────────────────────────

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) return f === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(f) ? [full] : [];
  });
}

/** Which functions contain a write that sets authors.name, read from the source. */
function nameWriters(): string[] {
  const out: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\.(?:insert\(authors\)\s*\.values|update\(authors\)\s*\.set)\(\{[^}]*\bname\b/g)) {
      const before = text.slice(0, m.index);
      const fn = [...before.matchAll(/export async function (\w+)/g)].at(-1)?.[1] ?? "?";
      out.push(`${path.relative(SRC, file)} ${fn}`);
    }
  }
  return out.sort();
}

/** Non-test files that mention `word` outside their own definition. */
const callers = (word: string, definedIn: string): string[] =>
  sourceFiles(SRC)
    .filter((f) => !f.endsWith(definedIn) && !f.endsWith("db/repo/index.ts"))
    .filter((f) => new RegExp(`\\b${word}\\(`).test(readFileSync(f, "utf8")))
    .map((f) => path.relative(SRC, f))
    .sort();

describe("every door that sets a profile's name", () => {
  it("is one of these three writes, each reached only from a checked place", () => {
    expect(nameWriters()).toEqual([
      "db/repo/accounts.ts ensureAccountAuthor",
      "db/repo/accounts.ts insertKeyedAuthor",
      "db/repo/accounts.ts updateAuthorProfile",
    ]);
    expect(callers("ensureAccountAuthor", "db/repo/accounts.ts")).toEqual(["app/api/gallery/session.ts"]);
    expect(callers("insertKeyedAuthor", "db/repo/accounts.ts")).toEqual(["app/api/gallery/authors.ts"]);
    // test-seed is test-only and its name is a fixed "Old me".
    expect(callers("createAuthor", "app/api/gallery/authors.ts")).toEqual(["app/api/test-seed/route.ts"]);
    expect(callers("updateAuthorProfile", "db/repo/accounts.ts")).toEqual([
      "app/api/gallery/authors/[authorId]/route.ts",
      "app/api/test-seed/route.ts",
    ]);
  });
});

beforeAll(() => getDb(), 60_000);
const db = async (): Promise<Db> => (await getDb())!;

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "stave-reserved-names-test-"));
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
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  vi.stubEnv("STAVE_RATE_LIMIT_EDIT", "1000");
  vi.stubEnv("STAVE_RATE_LIMIT_PUBLISH", "1000");
  fake.session = null;
});
afterEach(() => useDbForTests(undefined));

let n = 0;
const freshId = () => `reserved-${Date.now().toString(36)}-${n++}`;

function signIn(id: string, user: { name?: string; login?: string }) {
  fake.session = {
    user: { name: user.name ?? "", email: `${id}@example.test` },
    account: { provider: "test-login", providerAccountId: id, badge: "github", ...(user.login ? { login: user.login } : {}) },
    expires: "2099-01-01T00:00:00.000Z",
  };
}

const firstUse = async (): Promise<{ authorId: string; name: string }> => {
  const res = await meRoute(new Request("http://x/api/gallery/me"));
  expect(res.status).toBe(200);
  const me = (await res.json()) as GallerySessionResponse;
  return { authorId: me.user!.authorId, name: me.user!.name };
};

const putAuthor = (authorId: string, body: unknown, headers: Record<string, string> = {}) =>
  authorPutRoute(
    new Request(`http://x/api/gallery/authors/${authorId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ authorId }) },
  );

const storedName = async (authorId: string) => (await getAuthor(await db(), authorId))!.name;

/** An account that already has a profile with a safe name, signed in. */
async function account(name = "Ada"): Promise<string> {
  signIn(freshId(), { name });
  return (await firstUse()).authorId;
}

describe("door: PUT /api/gallery/authors/<id>", () => {
  it.each(["Stave", "S t a v e", "ＳＴＡＶＥ", "Ѕtave", "stave-team", "The Stave Team", "Adm1n"])("refuses renaming to %j, with the plain message, and stores nothing", async (name) => {
    const id = await account();
    const res = await putAuthor(id, { name, bio: "still here" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: RESERVED_NAME_ERROR });
    expect(await storedName(id)).toBe("Ada");
    expect((await getAuthor(await db(), id))!.bio).toBe("");
  });

  it.each(["Stavros", "Staveley", "Adam", "Administrator of Vibes", "Mjay", "Modest Mouse"])("lets a real name through: %j", async (name) => {
    const id = await account();
    const res = await putAuthor(id, { name, bio: "" });
    expect(res.status).toBe(200);
    expect(await storedName(id)).toBe(name);
  });

  it("refuses it through the old author key too", async () => {
    const database = await db();
    const key = newAuthorKey();
    const id = (await insertKeyedAuthor(database, { name: "Old Ada", email: "", keyHash: hashToken(key) }))!;
    fake.session = null;
    expect((await putAuthor(id, { name: "Stave Team", bio: "" }, { [AUTHOR_KEY_HEADER]: key })).status).toBe(400);
    expect(await storedName(id)).toBe("Old Ada");
    expect((await putAuthor(id, { name: "Ada", bio: "" }, { [AUTHOR_KEY_HEADER]: key })).status).toBe(200);
  });

  it("leaves an existing reserved name working: the bio can be edited with it unchanged, trimmed or not", async () => {
    const id = await account();
    await updateAuthorProfile(await db(), id, { name: "Stave", bio: "" }); // named before the rule existed
    const res = await putAuthor(id, { name: "Stave", bio: "a new bio" });
    expect(res.status).toBe(200);
    expect((await getAuthor(await db(), id))!).toMatchObject({ name: "Stave", bio: "a new bio" });
    expect((await putAuthor(id, { name: "  Stave ", bio: "again" })).status).toBe(200);
    expect((await getAuthor(await db(), id))!).toMatchObject({ name: "Stave", bio: "again" });
  });

  it("checks any change to that name, and once it has gone it can't come back", async () => {
    const id = await account();
    await updateAuthorProfile(await db(), id, { name: "Stave", bio: "" });
    expect((await putAuthor(id, { name: "STAVE", bio: "" })).status).toBe(400);
    expect((await putAuthor(id, { name: "Stave Team", bio: "" })).status).toBe(400);
    expect(await storedName(id)).toBe("Stave");
    expect((await putAuthor(id, { name: "Stavros", bio: "" })).status).toBe(200);
    expect((await putAuthor(id, { name: "Stave", bio: "" })).status).toBe(400);
    expect(await storedName(id)).toBe("Stavros");
  });

  it("an unchanged name doesn't excuse a bad bio or a too-long name", async () => {
    const id = await account();
    await updateAuthorProfile(await db(), id, { name: "Stave", bio: "" });
    expect((await putAuthor(id, { name: "Stave" })).status).toBe(400);
    expect((await putAuthor(id, { name: "x".repeat(MAX_AUTHOR_NAME_CHARS + 1), bio: "" })).status).toBe(400);
  });
});

describe("door: the name taken from the provider at first sign-in", () => {
  it("a GitHub account named Stave falls to its login, and the sign-in still works", async () => {
    signIn(freshId(), { name: "Stave", login: "mjay-music" });
    expect((await firstUse()).name).toBe("mjay-music");
  });

  it.each([
    ["Stave", "stave"],
    ["Ѕtave Team", "stave-team"],
    ["", "admin"],
    ["", "Moderator"],
    ["  ", ""],
  ])("name %j with login %j gets the normal fallback", async (name, login) => {
    signIn(freshId(), { name, login });
    const made = await firstUse();
    expect(made.name).toBe("New artist");
    expect(await storedName(made.authorId)).toBe("New artist");
  });

  it("a Google account (no login) named Stave gets the placeholder", async () => {
    signIn(freshId(), { name: "S t a v e" });
    expect((await firstUse()).name).toBe("New artist");
  });

  it("a real name is kept", async () => {
    signIn(freshId(), { name: "Stavros", login: "someone-else" });
    expect((await firstUse()).name).toBe("Stavros");
  });

  it("checks what gets stored, after the cut to the length limit", async () => {
    // Only the first 60 characters are kept, and those alone read as "Stave".
    signIn(freshId(), { name: `Stave${"​".repeat(MAX_AUTHOR_NAME_CHARS - 5)} of the Hills`, login: "hills" });
    expect((await firstUse()).name).toBe("hills");
  });

  it("the sign-in after that doesn't rename anyone", async () => {
    const id = freshId();
    signIn(id, { name: "Ada", login: "ada-x" });
    const first = await firstUse();
    signIn(id, { name: "Stave", login: "ada-x" });
    expect(await firstUse()).toEqual(first);
  });
});

describe("door: making a key-held profile", () => {
  it("refuses a reserved name and makes nothing", async () => {
    expect(await createAuthor(await db(), "Stave Team", "")).toBeNull();
    expect(await createAuthor(await db(), "Old Ada", "")).not.toBeNull();
  });
});

describe("not doors: what looks like one and isn't", () => {
  const manifest: GalleryManifest = {
    schemaVersion: 1,
    project: { name: "Song", sharedAt: 1 },
    files: [{ id: "f0", path: "song.strudel", language: "strudel", content: '$: s("bd")' }],
    fileOrder: { "": ["f0"] },
    subfolderOrder: {},
  };

  it("publishing ignores a name in the body: the trust question reads the profile's", async () => {
    await account("Ada");
    const res = await publishRoute(
      new Request("http://x/api/gallery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Song", kind: "music", tags: [], authorName: "Stave Team", manifest }),
      }),
    );
    expect(res.status).toBe(201);
    const { entry } = (await res.json()) as PublishResponse;
    expect(entry!.authorName).toBe("Ada");
    expect(galleryTrustMessage(entry!.authorName).description).toContain("written by Ada.");
  });

  it("claiming an old profile named Stave brings its bio, never its name", async () => {
    const database = await db();
    const key = newAuthorKey();
    const oldId = (await insertKeyedAuthor(database, { name: "Stave", email: "", keyHash: hashToken(key) }))!;
    await updateAuthorProfile(database, oldId, { name: "Stave", bio: "old bio" });
    const mine = await account("Ada");

    const res = await claimRoute(
      new Request("http://x/api/gallery/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorKey: key, entries: [], links: [] }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await getAuthor(database, mine))!).toMatchObject({ name: "Ada", bio: "old bio" });
    expect((await getAuthor(database, oldId))!.mergedInto).toBe(mine);
  });
});

// ── #2450: a name with nothing visible in it ─────────────────────────────────

/** The six in the issue, then neighbours a looser rule would miss. Escapes, so the list can be read. */
const INVISIBLE: Array<[string, string]> = [
  ["zero-width space", "​"],
  ["zero-width joiner", "‍"],
  ["word joiner", "⁠"],
  ["soft hyphen", "­"],
  ["Hangul filler", "ㅤ"],
  ["blank Braille cell", "⠀"],
  ["several mixed, padded with spaces", " ​ㅤ⠀­ "],
  ["ideographic space", "　"],
  ["halfwidth Hangul filler", "ﾠ"],
  ["accents with no letter", "́̈"],
  ["a right-to-left override and a zero-width space", "‮​"],
];

/** Names that only look unusual: each shows something. */
const VISIBLE = ["Ada", "A​", "⠀Ada", "🎵", "李雷", "कि", "한", "⠁", ".", "👩‍💻"];

describe("#2450: the visible-character check", () => {
  it.each(INVISIBLE)("finds nothing visible in a %s", (_, name) => {
    expect(hasVisibleCharacter(name)).toBe(false);
  });

  it.each(VISIBLE)("finds something visible in %j", (name) => {
    expect(hasVisibleCharacter(name)).toBe(true);
  });
});

describe("#2450: every door refuses a name with nothing visible in it", () => {
  // A name trim() empties (the ideographic space) was refused before, as empty.
  it.each(INVISIBLE)("the profile form, for a %s", (_, name) => {
    expect(buildProfileRequest({ name, bio: "" }, "Ada")).toEqual({
      request: null,
      errors: [name.trim() ? "Your name needs a letter, number or symbol you can see." : "Add your name."],
    });
  });

  it.each(INVISIBLE)("PUT /api/gallery/authors/<id>, for a %s, storing nothing", async (_, name) => {
    const id = await account();
    const res = await putAuthor(id, { name, bio: "still here" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: name.trim() ? BLANK_NAME_ERROR : "name is empty" });
    expect(await getAuthor(await db(), id)).toMatchObject({ name: "Ada", bio: "" });
  });

  it("refuses an invisible name already stored, even unchanged, until a visible one replaces it", async () => {
    const id = await account();
    await updateAuthorProfile(await db(), id, { name: "​", bio: "" }); // stored before the rule
    expect(buildProfileRequest({ name: "​", bio: "a bio" }, "​").request).toBeNull();
    expect((await putAuthor(id, { name: "​", bio: "a bio" })).status).toBe(400);
    expect((await putAuthor(id, { name: "Ada", bio: "a bio" })).status).toBe(200);
    expect(await getAuthor(await db(), id)).toMatchObject({ name: "Ada", bio: "a bio" });
  });

  it.each(INVISIBLE)("first sign-in, for a %s: the login is used instead", async (_, name) => {
    signIn(freshId(), { name, login: "ada-x" });
    expect((await firstUse()).name).toBe("ada-x");
  });

  it("first sign-in with nothing visible in the name or the login gets the placeholder", async () => {
    signIn(freshId(), { name: "ㅤ", login: "⠀" });
    const made = await firstUse();
    expect(made.name).toBe("New artist");
    expect(await storedName(made.authorId)).toBe("New artist");
  });

  it.each(INVISIBLE)("making a key-held profile, for a %s, makes nothing", async (_, name) => {
    expect(await createAuthor(await db(), name, "")).toBeNull();
  });

  it("still lets every visible name through the form and the server", async () => {
    for (const name of VISIBLE) {
      expect(buildProfileRequest({ name, bio: "" }, "Ada").errors).toEqual([]);
      const id = await account();
      expect((await putAuthor(id, { name, bio: "" })).status).toBe(200);
      expect(await storedName(id)).toBe(name.trim());
    }
  });
});

describe("#2450: the trust question", () => {
  it.each(INVISIBLE)("says someone else for a stored %s", (_, name) => {
    expect(galleryTrustMessage(name).description).toContain("written by someone else.");
  });

  it("names a visible author, trimmed", () => {
    expect(galleryTrustMessage("  Ada ").description).toContain("written by Ada.");
    expect(galleryTrustMessage("李雷").description).toContain("written by 李雷.");
  });
});
