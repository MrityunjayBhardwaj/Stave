#!/usr/bin/env node
// #2352 — apply the gallery's SQL migrations (packages/app/drizzle/) to its database.
//
//   pnpm --filter @stave/app db:migrate                  DATABASE_URL set → that database (Neon);
//                                                         unset → dev's PGlite folder (the same
//                                                         one `next dev` uses; see src/db/client.ts devDbDir)
//   node scripts/db-migrate.mjs --if-configured          the build step: migrate when DATABASE_URL
//                                                         is set, otherwise say so and do nothing
//
// Safe to run any number of times: drizzle records each applied migration in
// drizzle.__drizzle_migrations and skips it next time. Exit code 0 on success,
// 1 on any failure (the build stops rather than deploy code ahead of its schema).

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = path.join(appDir, "drizzle");
const ifConfigured = process.argv.includes("--if-configured");

function devDbDir(env) {
  if (env.STAVE_GALLERY_DB_DIR) return env.STAVE_GALLERY_DB_DIR;
  const devDir = env.STAVE_GALLERY_DEV_DIR || path.join(os.tmpdir(), "stave-gallery-dev");
  return path.join(devDir, "pglite");
}

async function migrateNeon(url) {
  const { Pool } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "(unparsable DATABASE_URL)";
    }
  })();
  console.log(`[db:migrate] migrations applied to ${host}`);
}

async function migratePglite(dir) {
  // One process per PGlite folder (src/db/client.ts claimDevDbFolder): refuse while a dev server holds it.
  const { readFileSync } = await import("node:fs");
  let held = 0;
  try {
    held = Number(readFileSync(`${dir}.lock`, "utf8").trim());
  } catch {}
  if (held > 0 && held !== process.pid) {
    let alive = true;
    try {
      process.kill(held, 0);
    } catch (err) {
      alive = err.code === "EPERM";
    }
    if (alive) throw new Error(`a dev server (pid ${held}) is using ${dir}; stop it first (it migrates on start anyway)`);
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = await PGlite.create(dir);
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.close();
  }
  console.log(`[db:migrate] migrations applied to the dev database in ${dir}`);
}

try {
  if (process.env.DATABASE_URL) await migrateNeon(process.env.DATABASE_URL);
  else if (ifConfigured) console.log("[db:migrate] DATABASE_URL is not set: no database to migrate, skipping");
  else await migratePglite(devDbDir(process.env));
} catch (err) {
  console.error("[db:migrate] failed:", err);
  process.exit(1);
}
