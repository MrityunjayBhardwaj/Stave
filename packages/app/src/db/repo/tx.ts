import { DrizzleQueryError, TransactionRollbackError } from "drizzle-orm/errors";

import type { Db } from "../client";
import { DatabaseUnavailableError, isProgrammingError } from "../errors";

/** A transaction handle; every repo function accepts one in place of a Db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A Db or a transaction inside one. */
export type Q = Db | Tx;

/**
 * Run `fn` in one transaction. A failure to even start or commit it (the
 * connection couldn't be made, the client is closed) comes out as
 * DatabaseUnavailableError, so routes answer 503 for it (#2351); a query error
 * inside stays the DrizzleQueryError drizzle raised, and a bug stays a bug.
 */
export async function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (err) {
    if (err instanceof DrizzleQueryError || err instanceof TransactionRollbackError || isProgrammingError(err)) throw err;
    throw new DatabaseUnavailableError(err);
  }
}

/** The rows of a raw `db.execute`, on both drivers (PGlite and Neon both answer `{ rows }`). */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
