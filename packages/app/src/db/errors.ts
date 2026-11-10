import { DrizzleQueryError } from "drizzle-orm/errors";

/*
 * #2351 — when the gallery's database can't be reached, writes are REFUSED with
 * 503 and a plain message, never waved through: a write the database can't
 * keep would fail one step later anyway, or half-succeed.
 *
 *   DatabaseUnavailableError       thrown by getDb() when the database can't be
 *                                  opened (PGlite folder unwritable, migrations
 *                                  failing, …).
 *   isOutage(err)                  the one classifier: for an error the
 *                                  database layer raised, does it mean the
 *                                  database couldn't be reached? (#2359)
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

/** A Node system error (EPIPE, ECONNREFUSED, …): it carries `syscall` or a numeric `errno`. */
const isSystemError = (e: unknown): boolean => {
  const x = e as { syscall?: unknown; errno?: unknown } | null;
  return typeof x?.syscall === "string" || typeof x?.errno === "number";
};

/** The server's SQLSTATE, if this error carries one. A 5-letter Node code (EPIPE, EPERM) is not one (#2369). */
const sqlState = (e: unknown): string | null => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && !isSystemError(e) ? code : null;
};

/**
 * A sign the connection itself failed: a Node system error (ECONNREFUSED,
 * ENOTFOUND, ETIMEDOUT, EPIPE, …), an undici socket error (UND_ERR_*), or the
 * WebSocket's error event the Neon driver rejects with when it can't connect
 * (an Event, not an Error — observed for a refused port and an unknown host).
 */
function isConnectionSignal(e: unknown): boolean {
  if (typeof Event !== "undefined" && e instanceof Event) return true;
  if (isSystemError(e)) return true;
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("UND_ERR_");
}

/** A programming error (a bug): a TypeError and its kin, unless the chain shows the connection failed. */
function isProgrammingError(e: unknown): boolean {
  return PROGRAMMING_ERRORS.some((C) => e instanceof C) && !causes(e).some(isConnectionSignal);
}

/**
 * THE classifier (#2359), for an error the DATABASE LAYER raised (a query's
 * failure, or a failure to connect / begin / commit a transaction): does it
 * mean the database couldn't be reached or used?
 *
 *   a SQLSTATE in the chain   by its class: connection exception, too many
 *                             connections, shutting down, … → true; a
 *                             constraint, bad SQL, a serialization failure → false
 *   no SQLSTATE at all        the server never answered: a refused or unknown
 *                             host, a timeout, a closed client, a pool that
 *                             couldn't hand out a connection → true — unless the
 *                             innermost error is a bug (a TypeError with no
 *                             connection failure under it)
 *
 * Decided by types and codes, never by message text. The driver's plain-Error
 * failures (PGlite "is closed", the pool's connection timeout) carry no code at
 * all, which is why this is only asked of errors the database layer raised:
 * DrizzleQueryError's cause (below), and inTransaction's connect / begin /
 * commit (repo/tx.ts) — never an error our own code threw inside a transaction.
 */
export function isOutage(err: unknown): boolean {
  const chain = causes(err);
  const state = chain.map(sqlState).find((s) => s !== null) ?? null;
  if (state) return OUTAGE_SQLSTATE_CLASSES.has(state.slice(0, 2));
  return !isProgrammingError(chain[chain.length - 1]);
}

/**
 * Only errors that came out of the database layer count: a DatabaseUnavailableError
 * (getDb, or a transaction that couldn't start — see repo/tx.ts), or a query
 * error (drizzle wraps every query's failure in DrizzleQueryError, with the
 * driver's error as its cause), judged by isOutage. A Blob failure or a bug
 * elsewhere stays a 500.
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  const chain = causes(err);
  if (chain.some((e) => e instanceof DatabaseUnavailableError)) return true;
  if (!chain.some((e) => e instanceof DrizzleQueryError || (e as object | null)?.constructor?.name === "DrizzleQueryError")) {
    return false;
  }
  return isOutage(err);
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

/**
 * #2404 — the same error, with the values its query carried removed, so it can be
 * logged. A failed query holds them in five places: drizzle's message, its stack
 * and its `params`, and the driver's `params` and `detail` ("Failing row contains
 * (…)"). An email on its way into the database would land in the server logs.
 * Changes the error in place and keeps its class, its cause and its SQL (with
 * placeholders), so it can still be judged by isOutage and diagnosed.
 */
export function withoutQueryValues<E>(err: E): E {
  for (const link of causes(err)) {
    if (typeof link !== "object" || link === null) continue;
    const e = link as { message: string; stack?: string; query?: unknown; params?: unknown; detail?: unknown };
    if (link instanceof DrizzleQueryError) {
      const before = e.message;
      e.message = `Failed query: ${link.query}`;
      if (e.stack) e.stack = e.stack.replace(before, e.message);
    }
    if (Array.isArray(e.params)) e.params = [];
    if (typeof e.detail === "string") e.detail = undefined;
  }
  return err;
}

/** Answer 503 (see above) when the database is down anywhere inside `handler`. */
export function withDatabase<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      // Rethrown too: Next logs what a route throws.
      if (!isDatabaseUnavailable(err)) throw withoutQueryValues(err);
      console.warn("[stave] gallery database unavailable:", withoutQueryValues(err));
      return databaseUnavailable();
    }
  };
}
