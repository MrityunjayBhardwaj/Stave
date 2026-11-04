import { shareStore } from "../../share/store";
import { checkClaim, MAX_CLAIM_BODY_BYTES, runClaim } from "../claim";
import { requireSessionAuthor } from "../session";
import { galleryStore } from "../store";
import { readJsonBody } from "../validate";

// #2320 — bring what this browser published before sign-in into the account.
// The rules and the write order are in ../claim.ts. Signed in only; the
// response says what moved and, in plain words, what didn't and why. It never
// carries the email.

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request): Promise<Response> {
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  const who = await requireSessionAuthor(req, { signedOut: "sign in to bring your shares into your account" });
  if (who instanceof Response) return who;

  const body = await readJsonBody(req, MAX_CLAIM_BODY_BYTES);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  const checked = checkClaim(body.value);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: checked.status });

  const result = await runClaim(store, shareStore(), who, checked.value);
  return Response.json(result, { headers: NO_STORE });
}
