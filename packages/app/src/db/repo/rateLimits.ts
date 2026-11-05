import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { rateLimits } from "../schema";
import { rowsOf, type Q } from "./tx";

/*
 * #2330 / #2345 — the write counters, exact across every server.
 *
 * Called by: src/app/api/gallery/rateLimit.ts (rateLimit → postgresRateLimitStore),
 * which every limited route reaches through limitAccount / limitAuthor /
 * limitRequest: POST /api/gallery (publish), POST /api/gallery/[id]/report,
 * PUT /api/gallery/authors/[authorId], POST /api/gallery/collections,
 * PUT and DELETE /api/gallery/collections/[id], POST /api/gallery/claim,
 * POST /api/share.
 */

/** The row key for a limiter key: its SHA-256, so no account hash or address text is stored. */
export function rateLimitRowKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * Add `cost` to `key`'s count for the window starting at `windowStart`
 * (seconds since epoch), unless that would pass `max`. ONE statement:
 *
 *   INSERT … SELECT … WHERE cost <= max
 *   ON CONFLICT (key) DO UPDATE SET …           -- same window: count + cost; a new window: cost
 *     WHERE <the new count> <= max
 *   RETURNING count
 *
 * Postgres locks the row for the update, so concurrent callers (any number of
 * them, on any number of servers) are applied one after another and each sees
 * the count the one before it left: exactly `max` worth of cost is admitted per
 * window. A row is returned only when the take was admitted; a refused take
 * writes nothing. The row holds the current window only; the first take in a
 * new window resets it.
 */
export async function take(
  db: Q,
  key: string,
  windowStart: number,
  cost: number,
  max: number,
): Promise<{ admitted: boolean; count: number | null }> {
  const rowKey = rateLimitRowKey(key);
  const next = sql`case when ${rateLimits}.window_start = excluded.window_start
                        then ${rateLimits}.count + excluded.count
                        else excluded.count end`;
  const result = await db.execute(sql`
    insert into ${rateLimits} (key, window_start, count)
    select ${rowKey}::text, ${windowStart}::bigint, ${cost}::integer
    where ${cost}::integer <= ${max}::integer
    on conflict (key) do update
      set window_start = excluded.window_start, count = ${next}
      where ${next} <= ${max}::integer
    returning count`);
  const rows = rowsOf<{ count: number }>(result);
  return rows.length > 0 ? { admitted: true, count: Number(rows[0].count) } : { admitted: false, count: null };
}

/** The stored count for `key` in the window starting at `windowStart` (0 when none). Tests and diagnostics. */
export async function countFor(db: Q, key: string, windowStart: number): Promise<number> {
  const result = await db.execute(
    sql`select count from ${rateLimits} where key = ${rateLimitRowKey(key)} and window_start = ${windowStart}::bigint`,
  );
  const rows = rowsOf<{ count: number }>(result);
  return rows.length > 0 ? Number(rows[0].count) : 0;
}
