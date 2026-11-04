import type { MySharesResponse } from "../../../../../gallery/types";
import { shareStore } from "../../../share/store";
import { listAccountLinks } from "../../accountLinks";
import { authorWork } from "../../authors";
import { requireSessionAuthor } from "../../session";
import { getDb } from "../../../../../db/client";
import { withDatabase } from "../../../../../db/errors";

// #2321 — My shares for the signed-in account, on any device: its gallery
// entries and collections (those of the account's author), and the
// private links listed on the account (id, project name, date). #2329 — never
// a link's key or full link: the store has no place to keep one (accountLinks.ts).
// #2352 — all three come from Postgres.
//
// Only the account itself reaches this: the session decides whose list it is,
// and there is no id in the request to change that. Never cached anywhere. The
// email is never in it.

const NO_STORE = { "Cache-Control": "no-store, private" };

async function handleGET(req: Request): Promise<Response> {
  const db = await getDb();
  if (!db) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  const who = await requireSessionAuthor(req, { signedOut: "sign in to see your shares on every device" });
  if (who instanceof Response) return who;

  const [{ entries, collections }, links] = await Promise.all([
    authorWork(db, who.authorId),
    listAccountLinks(db, shareStore(), who.account.accountHash),
  ]);
  const body: MySharesResponse = { authorId: who.authorId, entries, collections, links };
  return Response.json(body, { headers: NO_STORE });
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const GET = withDatabase(handleGET);
