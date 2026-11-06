import os from "node:os";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { DatabaseUnavailableError, withoutQueryValues } from "./errors";
import * as schema from "./schema";

/*
 * #2352 — the gallery's database. Server-only.
 *
 *   getDb() → Promise<Db | null>
 *
 *   DATABASE_URL set          Neon, through @neondatabase/serverless's Pool
 *                             (WebSockets, so interactive transactions work; Node
 *                             22+ has a global WebSocket, which the driver uses
 *                             when none is configured). Migrations are NOT run
 *                             here: `pnpm db:migrate` runs them (scripts/db-migrate.mjs).
 *   tests (VITEST)            PGlite in memory, migrated once per test process
 *                             from a template; freshTestDb() clones the template,
 *                             so a test that wants its own empty database gets
 *                             one in milliseconds.
 *   dev (`next dev`)          PGlite in a folder, so data survives a restart:
 *                             STAVE_GALLERY_DB_DIR, else `pglite/` under the
 *                             gallery's dev folder (STAVE_GALLERY_DEV_DIR, else
 *                             `stave-gallery-dev` under the OS temp dir — the
 *                             same folder the Blob stand-in uses). Migrated
 *                             automatically on first use.
 *   production, no URL        null: routes answer 503, as with no Blob store.
 *
 * Opening fails (PGlite's folder unwritable, migrations failing) → getDb()
 * throws DatabaseUnavailableError, and the NEXT call tries again from scratch,
 * so the gallery recovers by itself once the cause is gone (#2351).
 *
 * One database per process, kept on globalThis: Next can load this module once
 * per route bundle, and two PGlite instances on one folder would corrupt it.
 */

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type Env = Record<string, string | undefined>;

interface DbState {
  opening?: Promise<Db | null>;
  /** Tests: the database getDb() answers with (null = "no database configured"). */
  override?: Db | null;
  template?: Promise<PGlite>;
}

const STATE = Symbol.for("stave.gallery.db");
function state(): DbState {
  const g = globalThis as { [STATE]?: DbState };
  return (g[STATE] ??= {});
}

/** Where the SQL migrations live (packages/app/drizzle). */
export function migrationsFolder(env: Env = process.env): string {
  return env.STAVE_DB_MIGRATIONS_DIR || path.join(process.cwd(), "drizzle");
}

/** The folder dev's PGlite keeps its data in. */
export function devDbDir(env: Env = process.env): string {
  if (env.STAVE_GALLERY_DB_DIR) return env.STAVE_GALLERY_DB_DIR;
  const devDir = env.STAVE_GALLERY_DEV_DIR || path.join(os.tmpdir(), "stave-gallery-dev");
  return path.join(devDir, "pglite");
}

/** Which database this process uses. */
export function dbKind(env: Env = process.env): "neon" | "pglite-memory" | "pglite-folder" | null {
  if (env.DATABASE_URL) return "neon";
  if (env.VITEST) return "pglite-memory";
  if (env.NODE_ENV !== "production" || env.STAVE_SHARE_DEV_STORE === "1") return "pglite-folder";
  return null;
}

/** Drizzle over a PGlite client (no migrating). Two calls over one client are two independent handles. */
export async function dbOverPglite(client: PGlite): Promise<Db> {
  const { drizzle } = await import("drizzle-orm/pglite");
  return drizzle({ client, schema }) as unknown as Db;
}

/** Open PGlite (in memory when `dataDir` is undefined), migrated to the latest schema. */
export async function openPglite(dataDir?: string): Promise<{ db: Db; client: PGlite }> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return { db: db as unknown as Db, client };
}

async function openNeon(url: string): Promise<Db> {
  const { Pool } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000 });
  // An idle connection the server dropped must not crash the process; the
  // pool replaces it on the next query.
  pool.on("error", (err: unknown) => console.warn("[stave] gallery database connection dropped:", withoutQueryValues(err)));
  return drizzle({ client: pool, schema }) as unknown as Db;
}

/** A fresh, migrated, empty in-memory database: a clone of a per-process template. */
export async function freshTestDb(): Promise<Db & { $client: PGlite }> {
  const s = state();
  s.template ??= openPglite().then((t) => t.client);
  const client = (await (await s.template).clone()) as PGlite;
  const db = await dbOverPglite(client);
  return Object.assign(db, { $client: client });
}

/**
 * PGlite is one process per folder: two dev servers (another worktree, another
 * port) opening the same folder would corrupt it. The first process to open it
 * writes its pid to `<dir>.lock`; another process refuses (so its gallery
 * answers 503 and the log says why) until that pid has exited. Set
 * STAVE_GALLERY_DB_DIR to give a second server its own folder.
 */
export async function claimDevDbFolder(dir: string): Promise<void> {
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const lock = `${dir}.lock`;
  const held = Number((await readFile(lock, "utf8").catch(() => "")).trim());
  if (Number.isInteger(held) && held > 0 && held !== process.pid) {
    let alive = true;
    try {
      process.kill(held, 0);
    } catch (err) {
      alive = (err as NodeJS.ErrnoException).code === "EPERM";
    }
    if (alive) {
      throw new Error(
        `another process (pid ${held}) is using the dev gallery database at ${dir}; ` +
          "stop it, or set STAVE_GALLERY_DB_DIR to give this server its own folder",
      );
    }
  }
  await mkdir(path.dirname(lock), { recursive: true });
  await writeFile(lock, String(process.pid));
}

async function open(env: Env): Promise<Db | null> {
  switch (dbKind(env)) {
    case "neon":
      return openNeon(env.DATABASE_URL!);
    case "pglite-memory":
      return freshTestDb();
    case "pglite-folder": {
      const dir = devDbDir(env);
      await claimDevDbFolder(dir);
      return (await openPglite(dir)).db;
    }
    default:
      return null;
  }
}

/** The gallery's database, or null when a production build has none. See the header. */
export async function getDb(): Promise<Db | null> {
  const s = state();
  if (s.override !== undefined) return s.override;
  if (!s.opening) {
    const opening = open(process.env).catch((err: unknown) => {
      // Forget the failure, so the next call tries again.
      if (state().opening === opening) state().opening = undefined;
      console.warn("[stave] couldn't open the gallery database:", withoutQueryValues(err));
      throw new DatabaseUnavailableError(err);
    });
    s.opening = opening;
  }
  return s.opening;
}

/**
 * Tests: make getDb() answer `db` (null = no database configured). `undefined`
 * goes back to the default (this process's own in-memory database).
 */
export function useDbForTests(db: Db | null | undefined): void {
  state().override = db;
}
