import {
  GALLERY_ID_PATTERN,
  type AuthorMovedResponse,
  type AuthorPageResponse,
} from "../../../../../gallery/types";
import { getDb } from "../../../../../db/client";
import { getAuthor, publicProfile, updateAuthorProfile } from "../../../../../db/repo/accounts";
import { authorWork } from "../../authors";
import { limitAuthor } from "../../rateLimit";
import { mayManageAuthor } from "../../session";
import { checkAuthorUpdate, MAX_AUTHOR_BODY_BYTES, readJsonBody } from "../../validate";
import { assertSameOrigin } from "../../origin";
import { withDatabase } from "../../../../../db/errors";

// #2314 — an author's profile page: read it, or edit it (signed in as its owner,
// #2319, or with the author key from before sign-in).
//
// Not cached at the CDN (`no-store`): the person who just edited their bio or
// made a collection expects to see it on the next open, and a takedown must
// leave the page at once. A profile open is one request per click (like the
// entry route), not per overlay open, so the uncached cost stays small.
//
// #2352 — the profile, its entries and its collections come from Postgres. The
// response is built only from the public profile (repo publicProfile, field by
// field) and public entries; the stored author's email never leaves the server.
// The bio is stored exactly as typed (markdown); the client escapes it when it
// renders it.

const noStore = () => Response.json({ error: "the gallery is not set up here" }, { status: 503 });
const notFound = () => Response.json({ error: "not found" }, { status: 404 });
const NO_STORE = { "Cache-Control": "no-store" };

type Ctx = { params: Promise<{ authorId: string }> };

async function handleGET(_req: Request, { params }: Ctx): Promise<Response> {
  const { authorId } = await params;
  if (!GALLERY_ID_PATTERN.test(authorId)) return notFound();
  const db = await getDb();
  if (!db) return noStore();

  const author = await getAuthor(db, authorId);
  if (!author) return notFound();
  // #2320 — merged into an account's profile by a claim: say where it went. A
  // 200 with `{ movedTo }` rather than an HTTP redirect, so the client decides
  // (it follows it and opens the new profile) and nothing caches a 301.
  if (author.mergedInto) {
    const moved: AuthorMovedResponse = { movedTo: author.mergedInto };
    return Response.json(moved, { headers: NO_STORE });
  }

  const { entries, collections } = await authorWork(db, authorId);
  const body: AuthorPageResponse = { author: publicProfile(author), entries, collections };
  return Response.json(body, { headers: NO_STORE });
}

async function handlePUT(req: Request, { params }: Ctx): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const { authorId } = await params;
  if (!GALLERY_ID_PATTERN.test(authorId)) return notFound();
  const db = await getDb();
  if (!db) return noStore();

  const author = await getAuthor(db, authorId);
  if (!author) return notFound();
  // #2320 — a merged profile is retired; edit the one it moved to.
  if (author.mergedInto) {
    return Response.json({ error: "this profile moved to an account", movedTo: author.mergedInto }, { status: 409 });
  }
  // #2319 — the signed-in owner, or the key for a profile made before sign-in.
  if (!(await mayManageAuthor(req, authorId))) {
    return Response.json({ error: "you can't edit this profile" }, { status: 403 });
  }
  const limited = await limitAuthor("edit", authorId); // #2330
  if (limited) return limited;

  const body = await readJsonBody(req, MAX_AUTHOR_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const checked = checkAuthorUpdate(body.value);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });

  // Null: merged away (or gone) since it was read above.
  const updated = await updateAuthorProfile(db, authorId, { name: checked.value.name, bio: checked.value.bio });
  if (!updated) return Response.json({ error: "this profile moved to an account" }, { status: 409 });
  return Response.json({ author: updated }, { headers: NO_STORE });
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const GET = withDatabase(handleGET);
export const PUT = withDatabase(handlePUT);
