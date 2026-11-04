import type { MySharesResponse } from "../../../../../gallery/types";
import { shareStore } from "../../../share/store";
import { listAccountLinks } from "../../accountLinks";
import { authorWork } from "../../authors";
import { requireSessionAuthor } from "../../session";
import { galleryStore } from "../../store";

// #2321 — My shares for the signed-in account, on any device: its gallery
// entries and collections (through the account's author index), and the
// private links recorded on the account, full links included.
//
// Only the account itself reaches this: the session decides whose list it is,
// and there is no id in the request to change that. Never cached anywhere. The
// email is never in it.

const NO_STORE = { "Cache-Control": "no-store, private" };

export async function GET(req: Request): Promise<Response> {
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
