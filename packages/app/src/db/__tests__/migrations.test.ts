// @vitest-environment node
// #2352 — the migrations: they apply cleanly to an empty database, the database
// they make has exactly the tables and columns src/db/schema.ts declares, and
// drizzle-kit agrees the committed SQL is up to date with the schema (nothing
// left to generate) and consistent (`drizzle-kit check`).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { claimDevDbFolder, devDbDir, dbKind, migrationsFolder, openPglite } from "../client";
import { rowsOf } from "../repo/tx";
import * as schema from "../schema";

const appDir = path.resolve(__dirname, "../../..");
const drizzleKit = path.join(appDir, "node_modules/.bin/drizzle-kit");

const tables = (Object.values(schema) as unknown[]).filter(
  (v): v is PgTable => typeof v === "object" && v !== null && Symbol.for("drizzle:IsDrizzleTable") in v,
);

describe("migrations", () => {
  it("apply cleanly to an empty database, and make exactly the schema's tables and columns", async () => {
    const { db, client } = await openPglite();
    try {
      const cols = rowsOf<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
        await db.execute(sql`select table_name, column_name, data_type, is_nullable from information_schema.columns
                              where table_schema = 'public' order by table_name, ordinal_position`),
      );
      const actual = new Map<string, string[]>();
      for (const c of cols) actual.set(c.table_name, [...(actual.get(c.table_name) ?? []), `${c.column_name}${c.is_nullable === "NO" ? "!" : "?"}`]);

      const expected = new Map<string, string[]>();
      for (const t of tables) {
        const cfg = getTableConfig(t);
        expected.set(cfg.name, cfg.columns.map((c) => `${c.name}${c.notNull ? "!" : "?"}`));
      }
      expect(tables.length).toBe(10);
      expect(Object.fromEntries([...actual].sort())).toEqual(Object.fromEntries([...expected].sort()));

      // Running them again is a no-op (drizzle records what it applied).
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      await migrate(db as never, { migrationsFolder: migrationsFolder() });
    } finally {
      await client.close();
    }
  }, 60_000);

  it("are up to date with schema.ts: drizzle-kit has nothing to generate, and check passes", () => {
    // Inside the package (not the OS temp dir, whose /var → /private/var link
    // breaks the relative schema path drizzle-kit needs).
    const cache = path.join(appDir, "node_modules/.cache");
    mkdirSync(cache, { recursive: true });
    const tmp = mkdtempSync(path.join(cache, "stave-drizzle-check-"));
    try {
      cpSync(path.join(appDir, "drizzle"), path.join(tmp, "drizzle"), { recursive: true });
      const config = path.join(tmp, "drizzle.config.json");
      writeFileSync(
        config,
        // drizzle-kit reads `out` relative to its working directory (it prefixes "./").
        JSON.stringify({ dialect: "postgresql", schema: path.relative(tmp, path.join(appDir, "src/db/schema.ts")), out: "./drizzle" }),
      );
      const before = readdirSync(path.join(tmp, "drizzle")).sort();
      const out = execFileSync(drizzleKit, ["generate", `--config=${config}`], { cwd: tmp, encoding: "utf8" });
      expect(out).toMatch(/No schema changes, nothing to migrate/);
      expect(readdirSync(path.join(tmp, "drizzle")).sort()).toEqual(before);
      execFileSync(drizzleKit, ["check", `--config=${config}`], { cwd: tmp, encoding: "utf8" }); // throws on a non-zero exit
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it("pick the right database for the environment", () => {
    expect(dbKind({ DATABASE_URL: "postgres://x", VITEST: "true" })).toBe("neon");
    expect(dbKind({ VITEST: "true" })).toBe("pglite-memory");
    expect(dbKind({ NODE_ENV: "development" })).toBe("pglite-folder");
    expect(dbKind({ NODE_ENV: "production" })).toBeNull();
    expect(dbKind({ NODE_ENV: "production", STAVE_SHARE_DEV_STORE: "1" })).toBe("pglite-folder");
    expect(devDbDir({ STAVE_GALLERY_DEV_DIR: "/tmp/g" })).toBe(path.join("/tmp/g", "pglite"));
    expect(devDbDir({ STAVE_GALLERY_DB_DIR: "/tmp/db", STAVE_GALLERY_DEV_DIR: "/tmp/g" })).toBe("/tmp/db");
  });

  it("one process per dev database folder: a live other holder is refused, a dead one is taken over", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "stave-db-lock-"));
    const dir = path.join(tmp, "pglite");
    try {
      writeFileSync(`${dir}.lock`, String(process.ppid)); // a live process that isn't us
      await expect(claimDevDbFolder(dir)).rejects.toThrow(/another process \(pid \d+\) is using the dev gallery database/);
      writeFileSync(`${dir}.lock`, "2147483646"); // no such process
      await claimDevDbFolder(dir);
      expect(readFileSync(`${dir}.lock`, "utf8")).toBe(String(process.pid));
      await claimDevDbFolder(dir); // our own lock: fine
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
