import type { MySharesResponse } from "../../../../../gallery/types";
import { shareStore } from "../../../share/store";
import { listAccountLinks } from "../../accountLinks";
import { authorWork } from "../../authors";
import { requireSessionAuthor } from "../../session";
import { galleryStore } from "../../store";
import { withDatabase } from "../../../../../db/errors";

// #2321 — My shares for the signed-in account, on any device: its gallery
// entries and collections (through the account's author index), and the
// private links listed on the account (id, project name, date). #2329 — never
// a link's key or full link: the store doesn't have them, and old records that
// did are stripped as they are read (accountLinks.ts).
//
// Only the account itself reaches this: the session decides whose list it is,
// and there is no id in the request to change that. Never cached anywhere. The
// email is never in it.

const NO_STORE = { "Cache-Control": "no-store, private" };

async function handleGET(req: Request): Promise<Response> {
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  const who = await requireSessionAuthor(req, { signedOut: "sign in to see your shares on every device" });
  if (who instanceof Response) return who;

  const [{ entries, collections }, links] = await Promise.all([
    authorWork(store, who.authorId),
    listAccountLinks(store, shareStore(), who.account.accountHash),
  ]);
  const body: MySharesResponse = { authorId: who.authorId, entries, collections, links };
  return Response.json(body, { headers: NO_STORE });
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const GET = withDatabase(handleGET);
