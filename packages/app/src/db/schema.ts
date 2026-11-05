import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import type { AdminAction, GalleryKind, GalleryVerified } from "../gallery/types";

/*
 * #2352 — the gallery's records, in Postgres (Neon in production, PGlite in dev
 * and tests; see client.ts). Blob keeps only the heavy files: an entry's
 * manifest (`gallery/manifests/<id>.json`) and thumbnail
 * (`gallery/thumbnails/<id>`), found by the entry's id, and the sealed share
 * bytes (`shares/<id>`).
 *
 * Every time is milliseconds since the epoch, a `bigint` read back as a JS
 * number — the same numbers the public contract (src/gallery/types.ts) carries,
 * so a row maps to a response without converting.
 *
 * Private columns (never in any response) are marked PRIVATE.
 *
 * Room left for what comes next, not built: likes, follows, comments and
 * events are each their own table keyed on `entries.id` / `authors.id`
 * (e.g. `likes (entry_id, author_id) primary key`), so none of them needs a
 * column added here.
 *
 * After changing this file: `pnpm --filter @stave/app db:generate` writes the
 * next SQL migration into packages/app/drizzle/; commit it with the change.
 */

const ms = (name: string) => bigint(name, { mode: "number" });

/** A gallery profile. Made on an account's first gallery use, or (before sign-in) with an author key. */
export const authors = pgTable(
  "authors",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    bio: text("bio").notNull().default(""),
    /** The public badge (provider, GitHub login, avatar); null for a key-held profile. */
    verified: jsonb("verified").$type<GalleryVerified>(),
    /** PRIVATE. The account's email, or the email given when a key-held profile was made. */
    email: text("email").notNull().default(""),
    /** #2320 — retired by a claim: everything it had now lives on this author. */
    mergedInto: text("merged_into").references((): AnyPgColumn => authors.id),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [check("authors_not_merged_into_self", sql`${t.mergedInto} is distinct from ${t.id}`)],
);

/** #2314 — an author key's SHA-256 → the author it manages. PRIVATE. At most one key per author. */
export const authorKeys = pgTable("author_keys", {
  keyHash: text("key_hash").primaryKey(),
  authorId: text("author_id")
    .notNull()
    .unique("author_keys_author_id_key")
    .references(() => authors.id, { onDelete: "cascade" }),
});

/**
 * #2319 — a signed-in account and the author it is linked to. PRIVATE, all of it.
 * `id` is sha256("<provider>:<providerAccountId>"), hex — the account hash the
 * rate limits and account links are keyed on. One account per (provider, id);
 * one account per author (`author-taken`).
 */
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => authors.id),
    email: text("email").notNull(),
    verified: jsonb("verified").$type<GalleryVerified>().notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    unique("accounts_provider_account_key").on(t.provider, t.providerAccountId),
    unique("accounts_author_id_key").on(t.authorId),
  ],
);

/**
 * A published entry: the public listing fields (GalleryEntry), plus the private
 * ones. A taken-down entry keeps its row with `removed_at` set (the entry
 * route answers 410), and its private columns are cleared.
 */
export const entries = pgTable(
  "entries",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    kind: text("kind").$type<GalleryKind>().notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    authorName: text("author_name").notNull(),
    /** Null for an entry made before profiles existed (#2314). */
    authorId: text("author_id").references(() => authors.id),
    publishedAt: ms("published_at").notNull(),
    fileCount: integer("file_count").notNull(),
    hasThumbnail: boolean("has_thumbnail").notNull(),
    /** PRIVATE. Cleared on removal. */
    authorEmail: text("author_email").notNull().default(""),
    /** PRIVATE. SHA-256 of the manage token, hex. Null once removed. */
    manageTokenHash: text("manage_token_hash"),
    removedAt: ms("removed_at"),
    removedBy: text("removed_by").$type<"author" | "admin">(),
  },
  (t) => [
    check("entries_kind_known", sql`${t.kind} in ('project', 'music', 'viz')`),
    check("entries_removed_by_known", sql`${t.removedBy} is null or ${t.removedBy} in ('author', 'admin')`),
    // The listing: newest first, live only, optionally one kind.
    index("entries_live_newest_idx").on(t.publishedAt.desc()).where(sql`${t.removedAt} is null`),
    index("entries_live_kind_newest_idx").on(t.kind, t.publishedAt.desc()).where(sql`${t.removedAt} is null`),
    // An author's page and My shares.
    index("entries_author_newest_idx").on(t.authorId, t.publishedAt.desc()),
  ],
);

/** #2315 — a collection of one author's entries. */
export const collections = pgTable(
  "collections",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => authors.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("collections_author_newest_idx").on(t.authorId, t.createdAt.desc())],
);

/** A collection's entries, in order (`position` 0, 1, 2…). An entry appears once per collection. */
export const collectionEntries = pgTable(
  "collection_entries",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.entryId] }),
    unique("collection_entries_position_key").on(t.collectionId, t.position),
    index("collection_entries_entry_idx").on(t.entryId),
  ],
);

/** #2303 — one report of an entry. Open until dismissed or the entry is taken down (`closed_at`). */
export const reports = pgTable(
  "reports",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    reportedAt: ms("reported_at").notNull(),
    closedAt: ms("closed_at"),
  },
  (t) => [index("reports_open_idx").on(t.entryId, t.reportedAt.desc()).where(sql`${t.closedAt} is null`)],
);

/**
 * #2321 / #2329 — a private link listed on an account: id, name and date only,
 * never the link's key or the full link. PRIVATE (served to the account only).
 */
export const accountLinks = pgTable(
  "account_links",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    shareId: text("share_id").notNull(),
    projectName: text("project_name").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.shareId] })],
);

/** #2331 — one row per admin action, written before the action. Admins only; never an email. */
export const adminLog = pgTable(
  "admin_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ms("at").notNull(),
    adminProvider: text("admin_provider").notNull(),
    adminAccountId: text("admin_account_id").notNull(),
    adminName: text("admin_name").notNull(),
    action: text("action").$type<AdminAction>().notNull(),
    target: text("target").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [index("admin_log_newest_idx").on(t.at.desc(), t.id.desc())],
);

/**
 * #2330 / #2345 — write counters. One row per key holding the CURRENT window:
 * the first take in a new window resets it, so rows never pile up per window.
 * `key` is sha256 of the limiter key (no address or account text). PRIVATE.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  /** Start of the window, seconds since epoch. */
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: integer("count").notNull(),
});
