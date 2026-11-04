import { shareStore } from "../../share/store";
import { checkClaim, claimCost, MAX_CLAIM_BODY_BYTES, runClaim } from "../claim";
import { limitAccount } from "../rateLimit";
import { requireSessionAuthor } from "../session";
import { galleryStore } from "../store";
import { readJsonBody } from "../validate";
import { assertSameOrigin } from "../origin";
import { withDatabase } from "../../../../db/errors";

// #2320 — bring what this browser published before sign-in into the account.
// The rules and the write order are in ../claim.ts. Signed in only; the
// response says what moved and, in plain words, what didn't and why. It never
// carries the email.

const NO_STORE = { "Cache-Control": "no-store" };

async function handlePOST(req: Request): Promise<Response> {
  const refused = assertSameOrigin(req); if (refused) return refused; // #2328 — Stave's own page only
  const store = galleryStore();
  if (!store) return Response.json({ error: "the gallery is not set up here" }, { status: 503 });

  const who = await requireSessionAuthor(req, { signedOut: "sign in to bring your shares into your account" });
  if (who instanceof Response) return who;
  // #2345 — the claim limit counts items, so the body is read (bounded by
  // MAX_CLAIM_BODY_BYTES) before the limit is charged. A body that doesn't
  // parse or check still costs one, so a malformed flood is limited too, and
  // the limit is answered before the shape error.
  const body = await readJsonBody(req, MAX_CLAIM_BODY_BYTES);
  const checked = body.ok ? checkClaim(body.value) : null;
  const limited = await limitAccount("claim", who.account.accountHash, claimCost(checked?.ok ? checked.value : null)); // #2330
  if (limited) return limited;
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });
  if (!checked || !checked.ok) return Response.json({ error: checked?.error ?? "bad claim" }, { status: checked?.status ?? 400 });

  const result = await runClaim(store, shareStore(), who, checked.value);
  return Response.json(result, { headers: NO_STORE });
}

// #2351 — a database outage anywhere in the handler answers 503 "try again shortly", never a 500.
export const POST = withDatabase(handlePOST);
