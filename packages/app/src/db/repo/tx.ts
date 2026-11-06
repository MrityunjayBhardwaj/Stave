import type { Db } from "../client";
import { DatabaseUnavailableError, isOutage } from "../errors";

/** A transaction handle; every repo function accepts one in place of a Db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A Db or a transaction inside one. */
export type Q = Db | Tx;

/**
 * Run `fn` in one transaction.
 *
 * What `fn` throws comes out as itself (#2359): a bug in our own code is a 500
 * with its stack, a query error is the DrizzleQueryError drizzle raised (which
 * withDatabase judges, so a query that lost the server is still a 503), and
 * tx.rollback()'s TransactionRollbackError stays that.
 *
 * Anything else was raised by the transaction itself — connecting, BEGIN,
 * COMMIT, ROLLBACK — and is judged by the one classifier, isOutage (../errors):
 * the database couldn't be reached (a refused or unknown host, a timeout, a
 * closed client, too many connections) → DatabaseUnavailableError, so routes
 * answer 503 (#2351); anything else (a serialization failure at COMMIT, say)
 * comes out as itself.
 *
 * When `fn` throws, the driver rolls back before rethrowing — and if that
 * ROLLBACK fails too (the connection dropped, say), the driver throws the
 * rollback's error INSTEAD of ours (#2380; drizzle-orm 0.45.4
 * neon-serverless/session.js `catch (error) { await tx.execute(sql\`rollback\`);
 * throw error; }`, and PGlite's own transaction(), which drizzle's pglite
 * session hands the callback to, does the same). So the rollback's failure is
 * logged, and what `fn` threw still comes out as itself, judged as above: our
 * bug stays a 500 with its own stack; a query that lost the server stays a 503.
 * The rollback's failure is deliberately NOT attached as the error's `cause`:
 * isDatabaseUnavailable walks the cause chain, and a dropped connection there
 * would turn our bug back into a 503.
 */
export async function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const ours: { err?: unknown; set: boolean } = { set: false };
  try {
    return await db.transaction(async (tx) => {
      try {
        return await fn(tx);
      } catch (err) {
        ours.err = err;
        ours.set = true;
        throw err;
      }
    });
  } catch (err) {
    if (ours.set) {
      if (ours.err !== err) {
        console.error(
          "[stave] a gallery transaction failed, and rolling it back failed too.\n  what failed first:",
          ours.err,
          "\n  the rollback's failure:",
          err,
        );
      }
      throw ours.err;
    }
    if (isOutage(err)) throw new DatabaseUnavailableError(err);
    throw err;
  }
}

/** The rows of a raw `db.execute`, on both drivers (PGlite and Neon both answer `{ rows }`). */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
