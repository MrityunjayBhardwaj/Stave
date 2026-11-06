// @vitest-environment node
// #2404 — an email on its way into the database must not reach the server logs
// when the query fails. Every error here is the real one PGlite and drizzle raise.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { inspect } from "node:util";

import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { freshTestDb, type Db } from "../client";
import { isDatabaseUnavailable, withDatabase, withoutQueryValues } from "../errors";
import { inTransaction } from "../repo/tx";

const EMAIL = "leak.me@example-privacy.test";
let db: Db & { $client: PGlite };

/** Fails the `kind` check, so the driver's detail says "Failing row contains (…email…)". */
const failingInsert = (q: Pick<Db, "execute">) =>
  q.execute(
    sql`insert into entries (id, title, kind, author_name, published_at, file_count, has_thumbnail, author_email)
        values ('x', 't', 'bad', 'n', 1, 1, false, ${EMAIL})`,
  );

async function failedQuery(): Promise<DrizzleQueryError> {
  try {
    await failingInsert(db);
  } catch (err) {
    return err as DrizzleQueryError;
  }
  throw new Error("the query should have failed");
}

/** Everything a logger could print, `console.warn`'s own formatting included. */
const printed = (err: unknown) => inspect(err, { depth: 10, showHidden: true }) + String(err) + String((err as Error).stack);

beforeAll(async () => {
  db = await freshTestDb();
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withoutQueryValues", () => {
  it("the error really carries the email before it is scrubbed (control)", async () => {
    const err = await failedQuery();
    expect(err.message).toContain(EMAIL);
    expect(err.stack).toContain(EMAIL);
    expect(String((err.cause as { detail?: string }).detail)).toContain(EMAIL);
    expect(printed(err)).toContain(EMAIL);
  });

  it("removes it from everything a logger could print", async () => {
    const untouched = await failedQuery();
    expect(printed(withoutQueryValues(untouched))).not.toContain(EMAIL);
    // V8 builds the stack's text the first time it's read, so one already read
    // holds the old message for good.
    const alreadyRead = await failedQuery();
    expect(alreadyRead.stack).toContain(EMAIL);
    expect(printed(withoutQueryValues(alreadyRead))).not.toContain(EMAIL);
  });

  it("keeps what's needed to diagnose it: the class, the SQL, the cause and its code", async () => {
    const err = withoutQueryValues(await failedQuery());
    expect(err).toBeInstanceOf(DrizzleQueryError);
    expect(err.message).toContain("insert into entries");
    expect((err.cause as { code?: string }).code).toBe("23514");
    expect((err.cause as { constraint?: string }).constraint).toBe("entries_kind_known");
    expect(String(err.stack)).toContain("logSafety.test");
  });

  it("doesn't change whether it counts as an outage", async () => {
    const err = await failedQuery();
    expect(isDatabaseUnavailable(err)).toBe(false);
    expect(isDatabaseUnavailable(withoutQueryValues(err))).toBe(false);
  });

  it("leaves other errors and non-errors alone", () => {
    const bug = new TypeError("x is not a function");
    const { stack } = bug;
    expect(withoutQueryValues(bug)).toBe(bug);
    expect(bug.message).toBe("x is not a function");
    expect(bug.stack).toBe(stack);
    expect(withoutQueryValues(null)).toBeNull();
    expect(withoutQueryValues("text")).toBe("text");
  });
});

describe("the paths a failed query takes out of a route", () => {
  it("a bug rethrown by withDatabase, which Next then logs, carries no email", async () => {
    const route = withDatabase(async () => {
      await failingInsert(db);
      return new Response(null);
    });
    const thrown = await route().then(
      () => null,
      (err: unknown) => err,
    );
    expect(thrown).toBeInstanceOf(DrizzleQueryError);
    expect(printed(thrown)).not.toContain(EMAIL);
  });

  it("an outage logged by withDatabase carries no email, and still answers 503", async () => {
    const closed = await freshTestDb();
    await closed.$client.close();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const route = withDatabase(async () => {
      await failingInsert(closed);
      return new Response(null);
    });
    expect((await route()).status).toBe(503);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => c.map(printed).join(" ")).join("\n")).not.toContain(EMAIL);
  });

  it("a failed query inside a transaction, as the route rethrows it, carries no email", async () => {
    const route = withDatabase(async () => {
      await inTransaction(db, (tx) => failingInsert(tx));
      return new Response(null);
    });
    const thrown = await route().then(
      () => null,
      (err: unknown) => err,
    );
    expect(thrown).not.toBeNull();
    expect(printed(thrown)).not.toContain(EMAIL);
  });
});

// A list of log lines would miss the next one added, so scan for them.
describe("every server log line that prints an error scrubs it first", () => {
  const SRC = path.resolve(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) return name === "__tests__" ? [] : walk(file);
      return /\.tsx?$/.test(name) ? [file] : [];
    });

  /** The console.warn/error calls in `source` that print an error without scrubbing it. */
  const unscrubbed = (source: string): string[] =>
    [...source.matchAll(/console\.(?:warn|error)\(([\s\S]*?)\);/g)]
      .map((m) => m[1])
      .filter((args) => /\b(?:err|error)\b/.test(args.replace(/withoutQueryValues\([^)]*\)/g, "").replace(/"[^"]*"|`[^`]*`/g, "")));

  it("the scan sees a bare error, and accepts a scrubbed one (control)", () => {
    expect(unscrubbed('console.warn("[stave] oops:", err);')).toHaveLength(1);
    expect(unscrubbed('console.error(\n "x",\n ours.err,\n);')).toHaveLength(1);
    expect(unscrubbed('console.warn("[stave] oops:", withoutQueryValues(err));')).toEqual([]);
    expect(unscrubbed('console.warn("[stave] the err word in text");')).toEqual([]);
  });

  it("finds log lines to check, and none is bare", () => {
    const files = [...walk(path.join(SRC, "app/api")), ...walk(path.join(SRC, "db")), path.join(SRC, "auth.ts")];
    const sources = files.map((f) => [path.relative(SRC, f), readFileSync(f, "utf8")] as const);
    expect(sources.filter(([, s]) => s.includes("withoutQueryValues(")).length).toBeGreaterThanOrEqual(6);
    expect(sources.flatMap(([f, s]) => unscrubbed(s).map((args) => `${f}: ${args}`))).toEqual([]);
  });
});
