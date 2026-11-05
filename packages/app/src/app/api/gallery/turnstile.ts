import { TURNSTILE_HEADER, type TurnstileAction } from "../../../gallery/types";
import { siteHosts } from "./origin";
import { clientAddress } from "./rateLimit";

/*
 * #2330 — Cloudflare Turnstile on publish and report: a check that most people
 * pass without doing anything, and that a script can't.
 *
 *   requireTurnstile(req, action) → the Response to send instead, or null to go on.
 *       A token passes only if Cloudflare says it succeeded, was made for
 *       `action`, and was solved on this site (#2347, see answerPasses).
 *
 * Off unless TURNSTILE_SECRET_KEY is set: then every request goes through
 * untouched, so dev and tests that don't set it behave exactly as before.
 *
 * On, the browser sends the widget's token in the `cf-turnstile-response`
 * header (the name Cloudflare gives the form field). It is checked with
 * Cloudflare's siteverify endpoint; a missing or refused token is 403 with a
 * plain message. A token is good once, so the client asks the widget for a new
 * one after any failed send.
 *
 * If siteverify can't be reached or answers nonsense, the request is refused
 * with 503 and says so — "we couldn't check" is not "you failed the check", and
 * neither is let through.
 *
 * Cloudflare's published test keys (developers.cloudflare.com/turnstile/troubleshooting/testing/):
 *   sitekey 1x00000000000000000000AA + secret 1x0000000000000000000000000000000AA  always pass
 *   sitekey 2x00000000000000000000AB + secret 2x0000000000000000000000000000000AA  always fail
 * The test sitekeys hand out the dummy token XXXX.DUMMY.TOKEN.XXXX, which only the test secrets accept.
 */

type Env = Record<string, string | undefined>;

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The most a token can be (Cloudflare documents 2048 characters). */
const MAX_TOKEN_CHARS = 2048;

interface SiteverifyAnswer {
  success?: unknown;
  "error-codes"?: unknown;
  /** The hostname of the page the widget was solved on. */
  hostname?: unknown;
  /** The `action` the widget was rendered with. */
  action?: unknown;
  metadata?: { result_with_testing_key?: unknown };
}

/** The bare hostnames (no port) this request counts as this site. */
function siteHostnames(req: Request, env: Env): Set<string> {
  const names = new Set<string>();
  for (const host of siteHosts(req, env)) {
    try {
      names.add(new URL(`http://${host}`).hostname);
    } catch {
      // not a host
    }
  }
  return names;
}

/**
 * #2347 — `success` alone says the token is genuine, not that it was made on
 * this site or for this action. Cloudflare's server-side validation guide
 * says to check both. Answers to Cloudflare's published test secrets carry
 * `metadata.result_with_testing_key: true`, the fixed hostname "example.com"
 * and no action (observed 2026-11-05), so for those only `success` counts; a
 * test secret in production lets anyone through anyway, checks or not.
 */
function answerPasses(answer: SiteverifyAnswer, req: Request, action: TurnstileAction, env: Env): boolean {
  if (answer.success !== true) return false;
  if (answer.metadata?.result_with_testing_key === true) return true;
  if (answer.action !== action) {
    console.warn(`[stave] Turnstile token was made for action ${JSON.stringify(answer.action)}, not "${action}"`);
    return false;
  }
  if (typeof answer.hostname !== "string" || !siteHostnames(req, env).has(answer.hostname.toLowerCase())) {
    console.warn(`[stave] Turnstile token was made on ${JSON.stringify(answer.hostname)}, not this site`);
    return false;
  }
  return true;
}

const refused = (error: string) =>
  Response.json({ error }, { status: 403, headers: { "Cache-Control": "no-store" } });

export async function requireTurnstile(
  req: Request,
  action: TurnstileAction,
  env: Env = process.env,
): Promise<Response | null> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return null;

  const token = req.headers.get(TURNSTILE_HEADER)?.trim() ?? "";
  if (!token) return refused("please complete the \"are you human\" check, then try again");
  if (token.length > MAX_TOKEN_CHARS) return refused("the \"are you human\" check didn't pass; please try it again");

  const form = new URLSearchParams({ secret, response: token });
  const address = clientAddress(req, env);
  if (address !== "unknown") form.set("remoteip", address);

  let answer: SiteverifyAnswer;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`siteverify answered ${res.status}`);
    answer = (await res.json()) as SiteverifyAnswer;
  } catch (err) {
    console.warn("[stave] couldn't reach Turnstile siteverify:", err);
    return Response.json(
      { error: "we couldn't run the \"are you human\" check just now; please try again in a moment" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (answerPasses(answer, req, action, env)) return null;
  return refused("the \"are you human\" check didn't pass; please try it again");
}
