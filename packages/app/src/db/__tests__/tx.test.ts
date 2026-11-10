// @vitest-environment node
// #2359 — inTransaction says "the database is unavailable" (→ 503) only when
// the database really couldn't be reached. What our own code throws inside a
// transaction comes out as itself (→ 500, with its stack).
//
// Every error here is the real one the driver raises: a closed PGlite, a real
// Postgres error raised with a chosen SQLSTATE, and Neon's Pool pointed at a
// refused port, an unknown host, an unroutable address and an ended pool. The
// shapes these produce (observed 2026-11-05, @neondatabase/serverless 1.2.0,
// @electric-sql/pglite 0.5.15, drizzle-orm 0.45.4, Node 25):
//
//   PGlite closed, transaction     Error "PGlite is closed" — no code, no cause
//   PGlite closed, query           DrizzleQueryError → that same Error
//   Postgres error (either)        DrizzleQueryError → DatabaseError { code: SQLSTATE }
//   Neon refused / unknown host    ErrorEvent (a DOM Event, not an Error) whose
//                                  .error is a TypeError with an empty message
//   Neon connection timeout        Error "Connection terminated due to connection
//                                  timeout" — no code — cause: that ErrorEvent
//   Neon pool after end()          Error "Cannot use a pool after calling end on the pool"
import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { DrizzleQueryError, TransactionRollbackError } from "drizzle-orm/errors";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { dbOverPglite, freshTestDb, type Db } from "../client";
import { DatabaseUnavailableError, isDatabaseUnavailable, isOutage, withDatabase } from "../errors";
import { inTransaction } from "../repo/tx";

let live: Db & { $client: PGlite };
let closed: Db;
beforeAll(async () => {
  live = await freshTestDb();
  const { PGlite } = await import("@electric-sql/pglite");
  const client = await PGlite.create();
  await client.close();
  closed = await dbOverPglite(client);
}, 60_000);
afterAll(async () => {
  await live.$client.close();
});

/** Neon's Pool, set up as client.ts sets it up, pointed at `url`. */
async function neon(url: string, connectionTimeoutMillis = 5_000) {
  const { Pool } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis, idleTimeoutMillis: 10_000 });
  pool.on("error", () => {});
  return { pool, db: drizzle({ client: pool }) as unknown as Db };
}

const caught = (p: Promise<unknown>) => p.then(
  () => { throw new Error("expected a rejection"); },
  (err: unknown) => err,
);

/** RAISE a real Postgres error with this SQLSTATE. */
const raise = (code: string) => sql.raw(`DO $$ BEGIN RAISE EXCEPTION 'raised' USING ERRCODE = '${code}'; END $$`);

describe("what our own code throws inside a transaction comes out as itself", () => {
  it("a plain Error is that Error, not 'unavailable'", async () => {
    const bug = new Error("a bug in our code");
    const err = await caught(inTransaction(live, async () => { throw bug; }));
    expect(err).toBe(bug);
    expect(isDatabaseUnavailable(err)).toBe(false);
  });

  it("so is a plain Error thrown after a query ran, and the transaction is rolled back", async () => {
    await live.execute(sql`create table if not exists t2359 (n int)`);
    const bug = new Error("a bug after a write");
    const err = await caught(
      inTransaction(live, async (tx) => {
        await tx.execute(sql`insert into t2359 values (1)`);
        throw bug;
      }),
    );
    expect(err).toBe(bug);
    const rows = await live.$client.query<{ n: number }>("select count(*)::int as n from t2359");
    expect(rows.rows[0].n).toBe(0);
  });

  it("a TypeError, a string, and tx.rollback()'s TransactionRollbackError come out as themselves", async () => {
    const type = new TypeError("x is undefined");
    expect(await caught(inTransaction(live, async () => { throw type; }))).toBe(type);
    expect(await caught(inTransaction(live, async () => { throw "a string"; }))).toBe("a string");
    const rolled = await caught(inTransaction(live, async (tx) => tx.rollback()));
    expect(rolled).toBeInstanceOf(TransactionRollbackError);
  });

  it("a query error is drizzle's own, judged by its SQLSTATE: outages are 'unavailable', mistakes are not", async () => {
    for (const code of ["08006", "53300", "57P01", "57P03"]) {
      const err = await caught(inTransaction(live, (tx) => tx.execute(raise(code))));
      expect(err, code).toBeInstanceOf(DrizzleQueryError);
      expect(isDatabaseUnavailable(err), code).toBe(true);
    }
    for (const code of ["23505", "22012", "42P01", "40001"]) {
      const err = await caught(inTransaction(live, (tx) => tx.execute(raise(code))));
      expect(err, code).toBeInstanceOf(DrizzleQueryError);
      expect(isDatabaseUnavailable(err), code).toBe(false);
    }
  });
});

describe("a transaction that fails by itself (connect, begin, commit)", () => {
  it("a closed PGlite is DatabaseUnavailableError", async () => {
    const err = await caught(inTransaction(closed, async () => "never runs"));
    expect(err).toBeInstanceOf(DatabaseUnavailableError);
    expect(((err as Error).cause as Error).message).toBe("PGlite is closed");
    // The same client through a query: drizzle's wrapper, also 'unavailable'.
    expect(isDatabaseUnavailable(await caught(closed.execute(sql`select 1`)))).toBe(true);
  });

  it("a COMMIT the server refuses for a reason that isn't an outage comes out as itself", async () => {
    await live.execute(sql`create table if not exists d2359 (n int primary key deferrable initially deferred)`);
    const err = await caught(
      inTransaction(live, async (tx) => {
        await tx.execute(sql`insert into d2359 values (1)`);
        await tx.execute(sql`insert into d2359 values (1)`);
      }),
    );
    expect(err).not.toBeInstanceOf(DatabaseUnavailableError);
    expect((err as { code?: string }).code).toBe("23505");
    expect(isDatabaseUnavailable(err)).toBe(false);
  });

  it("Neon on a refused port: the WebSocket's error event → DatabaseUnavailableError", async () => {
    const { pool, db } = await neon("postgres://u:p@127.0.0.1:1/db");
    try {
      const err = await caught(inTransaction(db, async () => "never runs"));
      expect(err).toBeInstanceOf(DatabaseUnavailableError);
      expect((err as Error).cause).toBeInstanceOf(Event);
      expect(((err as Error).cause as Event).type).toBe("error");
      // A query on the same pool: drizzle's wrapper around the same event.
      const q = await caught(db.execute(sql`select 1`));
      expect(q).toBeInstanceOf(DrizzleQueryError);
      expect(isDatabaseUnavailable(q)).toBe(true);
    } finally {
      await pool.end().catch(() => {});
    }
  }, 30_000);

  it("Neon on a host that doesn't resolve → DatabaseUnavailableError", async () => {
    const { pool, db } = await neon("postgres://u:p@no-such-host.invalid/db");
    try {
      const err = await caught(inTransaction(db, async () => "never runs"));
      expect(err).toBeInstanceOf(DatabaseUnavailableError);
    } finally {
      await pool.end().catch(() => {});
    }
  }, 30_000);

  it("Neon timing out on an address that never answers → DatabaseUnavailableError", async () => {
    // 10.255.255.1 is unroutable: here it times out ("Connection terminated due
    // to connection timeout", no code); a network that rejects it at once gives
    // the error event instead. Either way, unavailable.
    const { pool, db } = await neon("postgres://u:p@10.255.255.1/db", 300);
    try {
      const err = await caught(inTransaction(db, async () => "never runs"));
      expect(err).toBeInstanceOf(DatabaseUnavailableError);
    } finally {
      await pool.end().catch(() => {});
    }
  }, 30_000);

  it("Neon's pool after end() → DatabaseUnavailableError", async () => {
    const { pool, db } = await neon("postgres://u:p@127.0.0.1:1/db");
    await pool.end();
    const err = await caught(inTransaction(db, async () => "never runs"));
    expect(err).toBeInstanceOf(DatabaseUnavailableError);
    expect(((err as Error).cause as Error).message).toMatch(/after calling end/);
  });
});

describe("when our callback throws and the rollback that follows fails too (#2380)", () => {
  // The driver rolls back before rethrowing, and a failed ROLLBACK replaces our
  // error (drizzle-orm 0.45.4 neon-serverless/session.js transaction(); PGlite
  // 0.5.15 src/base.ts transaction()). The connection is dropped the way the
  // driver would see it: on PGlite, every message to the database fails from
  // that moment (execProtocolStream, which its ROLLBACK goes through); on
  // drizzle's Neon session, the client's query for `rollback` fails with the
  // error pg raises for a dropped connection.

  /** A fresh PGlite whose connection "drops" when `drop()` is called. */
  async function droppable() {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = await PGlite.create();
    const db = await dbOverPglite(client);
    const real = client.execProtocolStream.bind(client);
    const sent: string[] = [];
    const drop = () => {
      client.execProtocolStream = async (message) => {
        sent.push(new TextDecoder().decode(message).replace(/[^ -~]/g, ""));
        throw new Error("connection dropped");
      };
    };
    const close = async () => {
      client.execProtocolStream = real;
      await client.close();
    };
    return { db, drop, sent, close };
  }

  /** Drizzle's real Neon session over a client whose ROLLBACK fails. */
  async function neonWhoseRollbackFails() {
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const sent: string[] = [];
    const client = {
      query: async (q: { text?: string } | string) => {
        const text = typeof q === "string" ? q : (q.text ?? "");
        sent.push(text.trim());
        if (/^rollback/i.test(text.trim())) throw new Error("Connection terminated unexpectedly");
        return { rows: [], fields: [], rowCount: 0, command: "" };
      },
    };
    return { db: drizzle({ client: client as never }) as unknown as Db, sent };
  }

  /** A route the way the gallery writes them: withDatabase around a handler that runs a transaction. */
  const routeOver = (db: Db, fn: Parameters<typeof inTransaction>[1]) =>
    withDatabase(async () => {
      await inTransaction(db, fn);
      return new Response("ok");
    });

  let logged: unknown[][] = [];
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  beforeEach(() => {
    logged = [];
    spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args); });
  });
  afterEach(() => spy?.mockRestore());

  it("PGlite: our plain Error comes out (a 500), not the rollback's 'unavailable', and both are logged", async () => {
    const { db, drop, sent, close } = await droppable();
    try {
      const bug = new Error("a bug in our code");
      const route = routeOver(db, async () => {
        drop();
        throw bug;
      });
      // A route that throws is a 500; a 503 would be a Response here.
      const err = await caught(route());
      expect(sent[0]).toMatch(/ROLLBACK/); // the rollback really was tried, and failed
      expect(err).toBe(bug);
      expect(isDatabaseUnavailable(err)).toBe(false);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain(bug);
      expect(logged[0].some((x) => x instanceof Error && x.message === "connection dropped")).toBe(true);
    } finally {
      await close();
    }
  });

  it("Neon: our plain Error comes out (a 500), and the rollback's DrizzleQueryError is logged, not chained", async () => {
    const { db, sent } = await neonWhoseRollbackFails();
    const bug = new Error("a bug in our code");
    const err = await caught(routeOver(db, async () => { throw bug; })());
    expect(sent).toEqual(["begin", "rollback"]);
    expect(err).toBe(bug);
    expect((err as Error).cause).toBeUndefined();
    expect(isDatabaseUnavailable(err)).toBe(false);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(bug);
    const rollback = logged[0].find((x) => x instanceof DrizzleQueryError) as DrizzleQueryError | undefined;
    expect((rollback?.cause as Error | undefined)?.message).toBe("Connection terminated unexpectedly");
  });

  it("a TypeError (a bug) is the same: itself, a 500", async () => {
    const { db } = await neonWhoseRollbackFails();
    const bug = new TypeError("x is undefined");
    expect(await caught(routeOver(db, async () => { throw bug; })())).toBe(bug);
    expect(logged).toHaveLength(1);
  });

  it("when what failed first was itself an outage (a query that lost the server), the answer is still 503", async () => {
    const { db, drop, close } = await droppable();
    try {
      let first: unknown;
      const res = await routeOver(db, async (tx) => {
        try {
          await tx.execute(raise("08006"));
        } catch (err) {
          first = err;
          drop();
          throw err;
        }
      })();
      expect(first).toBeInstanceOf(DrizzleQueryError);
      expect(res.status).toBe(503);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain(first);
    } finally {
      await close();
    }
  });

  it("a rollback that succeeds logs nothing", async () => {
    const bug = new Error("a bug in our code");
    expect(await caught(inTransaction(live, async () => { throw bug; }))).toBe(bug);
    expect(logged).toHaveLength(0);
  });
});

describe("isOutage, the one classifier", () => {
  const systemError = (code: string, syscall: string) =>
    Object.assign(new Error(`${syscall} ${code}`), { code, errno: -32, syscall });

  it("a Node system error is a connection failure, even one whose code is five letters like a SQLSTATE", () => {
    // EPIPE / EPERM look like a SQLSTATE (five capitals) and once read as an
    // unknown SQLSTATE class, i.e. "not an outage".
    for (const code of ["EPIPE", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET"]) {
      const err = new DrizzleQueryError("select 1", [], systemError(code, "write"));
      expect(isOutage(err), code).toBe(true);
      expect(isDatabaseUnavailable(err), code).toBe(true);
    }
  });

  it("a TypeError is a bug, unless a connection failure is under it", () => {
    expect(isOutage(new TypeError("x is undefined"))).toBe(false);
    expect(isOutage(new TypeError("fetch failed", { cause: systemError("ECONNREFUSED", "connect") }))).toBe(true);
    expect(isOutage(Object.assign(new TypeError("socket"), { code: "UND_ERR_SOCKET" }))).toBe(true);
  });

  it("an error from outside the database is never 'unavailable'", () => {
    expect(isDatabaseUnavailable(new Error("blob store said no"))).toBe(false);
    expect(isDatabaseUnavailable(systemError("ECONNREFUSED", "connect"))).toBe(false);
  });
});
