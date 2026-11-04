/**
 * Community gallery (#2306) — the contract shared by the server routes
 * (`app/api/gallery/`), the publish dialog, and the browse overlay.
 *
 * Changing a shape here changes all three; keep it the single definition.
 *
 * Routes (all under `/api/gallery`):
 *
 *   GET    /api/gallery                   → 200 GalleryListResponse (newest first)
 *   POST   /api/gallery                   ← PublishRequest (JSON)
 *                                         → 201 PublishResponse
 *                                         → 400 bad shape · 413 too large · 429 rate limited · 503 no store
 *   GET    /api/gallery/<id>              → 200 GalleryEntryResponse · 404 · 410 removed
 *   GET    /api/gallery/<id>/thumbnail    → 200 image bytes · 404
 *   DELETE /api/gallery/<id>              (header MANAGE_TOKEN_HEADER or ADMIN_KEY_HEADER)
 *                                         → 204 · 403 wrong token · 404
 *   POST   /api/gallery/<id>/report       ← ReportRequest → 202
 *   GET    /api/gallery/reports           (header ADMIN_KEY_HEADER) → 200 ReportsResponse · 403
 *
 * Privacy rule: `authorEmail` is stored server-side only. No public response
 * (list, entry, thumbnail, report ack) may ever contain it.
 */

/** What an entry is. A project is the whole manifest; music and viz are one file each. */
export type GalleryKind = "project" | "music" | "viz";
export const GALLERY_KINDS: readonly GalleryKind[] = ["project", "music", "viz"];

/** The public listing of one entry. Safe to show anyone. */
export interface GalleryEntry {
  id: string;
  title: string;
  kind: GalleryKind;
  tags: string[];
  authorName: string;
  /** #2314 — the author's profile id. Absent on entries published before profiles existed. */
  authorId?: string;
  /** ms since epoch */
  publishedAt: number;
  fileCount: number;
  hasThumbnail: boolean;
}

/** The project payload — the same manifest short share links carry (shareProject.ts). */
export interface GalleryManifest {
  schemaVersion: 1;
  project: { name: string; sharedAt: number };
  files: Array<{ id: string; path: string; language: string; content: string }>;
  fileOrder: Record<string, string[]>;
  subfolderOrder: Record<string, string[]>;
}

export interface PublishRequest {
  title: string;
  kind: GalleryKind;
  tags: string[];
  authorName: string;
  authorEmail: string;
  manifest: GalleryManifest;
  /** Optional `data:image/webp;base64,…` or `data:image/png;base64,…`, at most MAX_THUMBNAIL_BYTES decoded. */
  thumbnail?: string;
}

export interface PublishResponse {
  id: string;
  /** Shown once. The browser keeps it (localShares.ts); the server keeps only its hash. */
  manageToken: string;
  /** #2314 — the author this entry landed on. */
  authorId: string;
  /**
   * #2314 — present only when this publish CREATED the author (the request had no
   * valid AUTHOR_KEY_HEADER). Shown once; the browser keeps it (localShares.ts).
   */
  authorKey?: string;
}

export interface GalleryListResponse {
  entries: GalleryEntry[];
}

export interface GalleryEntryResponse {
  entry: GalleryEntry;
  manifest: GalleryManifest;
}

export interface ReportRequest {
  reason: string;
}

export interface GalleryReport {
  entryId: string;
  reason: string;
  reportedAt: number;
}

export interface ReportsResponse {
  reports: GalleryReport[];
}

/** Limits — enforced by the server, mirrored by the dialog so it can say so before uploading. */
export const MAX_TITLE_CHARS = 80;
export const MAX_AUTHOR_NAME_CHARS = 60;
export const MAX_TAGS = 8;
export const MAX_TAG_CHARS = 24;
export const MAX_REPORT_REASON_CHARS = 500;
/** Raw JSON size of the manifest. */
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 200 * 1024;

export const MANAGE_TOKEN_HEADER = "x-stave-manage-token";
export const ADMIN_KEY_HEADER = "x-stave-admin-key";

// ── #2314 authors (profiles) and #2315 collections ─────────────────────────
//
// An author is created on a person's first publish: the publish response then
// carries `authorId` + `authorKey` (the key shown once; the server keeps its
// SHA-256 beside the author's email). Later publishes send AUTHOR_KEY_HEADER and
// land on the same author. The key — never the name or email — is what lets a
// browser edit a profile or its collections.
//
//   GET    /api/gallery/authors/<authorId>        → 200 AuthorPageResponse · 404
//   PUT    /api/gallery/authors/<authorId>        (AUTHOR_KEY_HEADER) ← AuthorUpdateRequest
//                                                 → 200 { author: GalleryAuthorProfile } · 400 · 403 · 404
//   POST   /api/gallery/collections               (AUTHOR_KEY_HEADER) ← CollectionWriteRequest
//                                                 → 201 { collection: GalleryCollection } · 400 · 403
//   GET    /api/gallery/collections/<id>          → 200 CollectionPageResponse · 404
//   PUT    /api/gallery/collections/<id>          (AUTHOR_KEY_HEADER) ← CollectionWriteRequest
//                                                 → 200 { collection: GalleryCollection } · 400 · 403 · 404
//   DELETE /api/gallery/collections/<id>          (AUTHOR_KEY_HEADER or ADMIN_KEY_HEADER) → 204 · 403 · 404
//
// A collection may hold only its author's own entries (400 otherwise). Entries
// taken down are left out of every response. Deleting a collection never
// deletes its entries. The author routes never return the email.

/** The public profile. `bio` is markdown, rendered client-side with raw HTML escaped. */
export interface GalleryAuthorProfile {
  authorId: string;
  name: string;
  bio: string;
  createdAt: number;
  updatedAt: number;
}

export interface GalleryCollection {
  id: string;
  authorId: string;
  title: string;
  /** Plain text (not markdown). */
  description: string;
  /** Ordered. */
  entryIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AuthorPageResponse {
  author: GalleryAuthorProfile;
  /** Newest first; taken-down entries left out. */
  entries: GalleryEntry[];
  /** Newest first, each with taken-down ids already dropped. */
  collections: GalleryCollection[];
}

export interface AuthorUpdateRequest {
  name: string;
  bio: string;
}

export interface CollectionWriteRequest {
  title: string;
  description: string;
  entryIds: string[];
}

export interface CollectionPageResponse {
  collection: GalleryCollection;
  author: Pick<GalleryAuthorProfile, "authorId" | "name">;
  /** In collection order; taken-down entries left out. */
  entries: GalleryEntry[];
}

export const AUTHOR_KEY_HEADER = "x-stave-author-key";
export const MAX_BIO_CHARS = 10_000;
export const MAX_COLLECTION_TITLE_CHARS = 80;
export const MAX_COLLECTION_DESCRIPTION_CHARS = 1_000;
export const MAX_COLLECTION_ENTRIES = 100;

/** Gallery ids reuse the short-share id shape (11 base64url chars). */
export { SHARE_ID_PATTERN as GALLERY_ID_PATTERN } from "../shareCrypto";
