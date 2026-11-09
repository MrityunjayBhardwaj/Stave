import { sql } from "drizzle-orm";

import { newShareId } from "../../../shareCrypto";
import { testLoginAllowed } from "../../../authProviders";
import type { GalleryEntry, GalleryManifest } from "../../../gallery/types";
import { getDb } from "../../../db/client";
import { rowsOf } from "../../../db/repo/tx";
import { updateAuthorProfile } from "../../../db/repo/accounts";
import { insertCollection } from "../../../db/repo/collections";
import { insertEntry } from "../../../db/repo/entries";
import { hashToken, newManageToken } from "../gallery/auth";
import { createAuthor } from "../gallery/authors";
import { assertSameOrigin } from "../gallery/origin";
import { galleryPaths, galleryStore, putJson } from "../gallery/store";

// #2352 — TEST ONLY. Makes what a browser published BEFORE sign-in: a key-held
// profile with a bio, one entry (with its manage token) and one collection of
// it, so the browser spec for the claim (tests/gallery-account.spec.ts) has
// something to bring into an account. Publishing makes none of these any more,
// and the spec can't write the dev database itself: PGlite is one process per
// folder, and the dev server holds it.
//
// Answers 404 unless the test sign-in is allowed (STAVE_AUTH_TEST_LOGIN=1 and
// NODE_ENV not "production"; authProviders.ts testLoginAllowed), the same rule
// that keeps the test sign-in out of every deployed build: `next build` and
// `next start` run with NODE_ENV=production, so a deployment never has it.
//
// It lives outside /api/gallery on purpose: it is not part of the gallery's
// API, and the gallery's write-route inventory (galleryOrigin.test.ts) lists
// only real routes. It still refuses another site's page, like every write route.
//
// POST { title?, collectionTitle?, authorName? } → 201 { authorId, authorKey, entryId, manageToken, collectionId, title }
// GET → { accountLinks: [...] }, every stored account-link row, every column as
//   stored, so the spec can check what the real server kept (#2329: id, name and
//   date only, never a link's key).

const notFound = () => new Response("not found", { status: 404 });

export async function POST(req: Request): Promise<Response> {
  if (!testLoginAllowed(process.env)) return notFound();
  const refused = assertSameOrigin(req);
  if (refused) return refused;
  const db = await getDb();
  const store = galleryStore();
  if (!db || !store) return notFound();

  const body = (await req.json().catch(() => ({}))) as { title?: unknown; collectionTitle?: unknown; authorName?: unknown };
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v ? v.slice(0, 100) : fallback);
  const title = text(body.title, "Before sign-in");
  const email = "seeded-before-sign-in@example.invalid";
  // #2465 — a name stored before a rule refused it (no door can write one now),
  // set straight on the row, so the spec can see how it is shown.
  const authorName = text(body.authorName, "Old me");

  const made = await createAuthor(db, "Old me", email);
  if (!made) return Response.json({ error: "could not make the profile" }, { status: 500 });
  await updateAuthorProfile(db, made.authorId, { name: authorName, bio: "Made before sign-in." });

  const now = Date.now();
  const entryId = newShareId();
  const manageToken = newManageToken();
  const manifest: GalleryManifest = {
    schemaVersion: 1,
    project: { name: title, sharedAt: now },
    files: [{ id: "f0", path: "song.strudel", language: "strudel", content: '$: s("bd sd")' }],
    fileOrder: { "": ["f0"] },
    subfolderOrder: {},
  };
  await putJson(store, galleryPaths.manifest(entryId), manifest);
  const entry: GalleryEntry = {
    id: entryId, title, kind: "music", tags: [], authorName, authorId: made.authorId,
    publishedAt: now, fileCount: 1, hasThumbnail: false,
  };
  await insertEntry(db, { entry, authorEmail: email, manageTokenHash: hashToken(manageToken) });

  const collectionId = newShareId();
  await insertCollection(db, {
    id: collectionId, authorId: made.authorId, title: text(body.collectionTitle, "Old EP"), description: "", entryIds: [entryId],
    createdAt: now, updatedAt: now,
  });

  return Response.json(
    { authorId: made.authorId, authorKey: made.authorKey, entryId, manageToken, collectionId, title },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(): Promise<Response> {
  if (!testLoginAllowed(process.env)) return notFound();
  const db = await getDb();
  if (!db) return notFound();
  const accountLinks = rowsOf<Record<string, unknown>>(await db.execute(sql`select * from account_links`));
  return Response.json({ accountLinks }, { headers: { "Cache-Control": "no-store" } });
}
