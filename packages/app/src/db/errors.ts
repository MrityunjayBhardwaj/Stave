import { DrizzleQueryError } from "drizzle-orm/errors";

/*
 * #2351 — when the gallery's database can't be reached, writes are REFUSED with
 * 503 and a plain message, never waved through: a write the database can't
 * keep would fail one step later anyway, or half-succeed.
 *
 *   DatabaseUnavailableError       thrown by getDb() when the database can't be
 *                                  opened (PGlite folder unwritable, migrations
 *                                  failing, …).
 *   isDatabaseUnavailable(err)     true for that error, and for any error a
 *                                  query raised because the database couldn't be
 *                                  reached (no connection, closed, timed out,
 *                                  server shutting down). False for a bug: a
 *                                  constraint violation, bad SQL, a TypeError.
 *   databaseUnavailable()          the 503 to answer with: the message below and
 *                                  `Retry-After: 60`.
 *   withDatabase(handler)          wraps a route handler so a database outage
 *                                  anywhere inside it answers that 503 instead
 *                                  of a 500. Other errors pass through.
 *
 * Nothing needs resetting when the database comes back: getDb() retries on the
 * next call (client.ts), so writes work again with no manual step.
 */

export const DATABASE_UNAVAILABLE_MESSAGE = "the gallery is having trouble right now; try again in a minute";
export const DATABASE_RETRY_AFTER_SECONDS = 60;

export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("the gallery database is unavailable", { cause });
    this.name = "DatabaseUnavailableError";
  }
}

/** SQLSTATE classes that mean "couldn't reach / use the server", not "your query was wrong". */
const OUTAGE_SQLSTATE_CLASSES = new Set([
  "08", // connection exception
  "28", // invalid authorization (a wrong or rotated DATABASE_URL)
  "3D", // invalid catalog name (database doesn't exist)
  "53", // insufficient resources (too many connections, disk full)
  "57", // operator intervention (admin shutdown, crash shutdown, cannot connect now)
  "58", // system error
]);

const PROGRAMMING_ERRORS = [TypeError, RangeError, ReferenceError, SyntaxError];

function causes(err: unknown): unknown[] {
  const out: unknown[] = [];
  let e: unknown = err;
  for (let i = 0; e && i < 8; i++) {
    out.push(e);
    e = (e as { cause?: unknown }).cause;
  }
  return out;
}

const sqlState = (e: unknown): string | null => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
};

/** A programming error (a bug), unless its message says the network or the client went away. */
export function isProgrammingError(e: unknown): boolean {
  return (
    PROGRAMMING_ERRORS.some((C) => e instanceof C) &&
    !/fetch failed|WebSocket|closed|terminated|ECONN|ETIMEDOUT/i.test(String((e as Error).message))
  );
}

/**
 * Only errors that came out of the database layer count: a DatabaseUnavailableError
 * (getDb, or a transaction that couldn't start — see repo/tx.ts), or a query
 * error (drizzle wraps every query's failure in DrizzleQueryError, with the
 * driver's error as its cause). A Blob failure or a bug elsewhere stays a 500.
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  const chain = causes(err);
  if (chain.some((e) => e instanceof DatabaseUnavailableError)) return true;
  if (!chain.some((e) => e instanceof DrizzleQueryError || (e as object | null)?.constructor?.name === "DrizzleQueryError")) {
    return false;
  }
  const state = chain.map(sqlState).find((s) => s !== null) ?? null;
  if (state) return OUTAGE_SQLSTATE_CLASSES.has(state.slice(0, 2));
  // A query that got no answer from a server at all (network, a closed client,
  // a timeout) — unless the innermost error is a plain bug.
  return !isProgrammingError(chain[chain.length - 1]);
}

export function databaseUnavailable(): Response {
  return Response.json(
    { error: DATABASE_UNAVAILABLE_MESSAGE },
    {
      status: 503,
      headers: { "Retry-After": String(DATABASE_RETRY_AFTER_SECONDS), "Cache-Control": "no-store" },
    },
  );
}

/** Answer 503 (see above) when the database is down anywhere inside `handler`. */
export function withDatabase<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (!isDatabaseUnavailable(err)) throw err;
      console.warn("[stave] gallery database unavailable:", err);
      return databaseUnavailable();
    }
  };
}
