/**
 * #2320 — run the claim once after sign-in, when this browser holds anything
 * the account doesn't have yet (pendingClaim).
 *
 * Once per page load per account: sign-in reloads the page, so "once after
 * sign-in" is the first load that sees the account. A claim that fails (offline,
 * server error) marks nothing, so the next load tries again; one the server
 * answered marks what it was sent as claimed, so it isn't sent on every load.
 */
import { claimIntoAccount } from "./client";
import { markClaimed, pendingClaim } from "./localShares";
import { claimToasts } from "./myShares";
import type { ClaimRequest, ClaimResponse } from "./types";

export interface ClaimRunDeps {
  claim: (req: ClaimRequest) => Promise<ClaimResponse>;
  toast: (text: string, kind: "info" | "error") => void;
}

let ranFor: string | null = null;

export async function runClaimOnce(
  authorId: string,
  deps: ClaimRunDeps = { claim: claimIntoAccount, toast: () => {} },
): Promise<ClaimResponse | null> {
  if (ranFor === authorId) return null;
  ranFor = authorId;
  const req = pendingClaim(authorId);
  if (!req) return null;
  try {
    const res = await deps.claim(req);
    markClaimed(authorId, req, res.refused);
    for (const t of claimToasts(res)) deps.toast(t.text, t.kind);
    if (res.refused.length) console.info("[stave] claim: kept in this browser:", res.refused);
    return res;
  } catch (err) {
    console.warn("[stave] couldn't bring this browser's shares into your account:", err);
    return null;
  }
}

/** For tests: forget that the claim ran. */
export function resetClaimRunForTests(): void {
  ranFor = null;
}
