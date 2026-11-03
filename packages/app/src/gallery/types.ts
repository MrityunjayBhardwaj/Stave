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

/** Gallery ids reuse the short-share id shape (11 base64url chars). */
export { SHARE_ID_PATTERN as GALLERY_ID_PATTERN } from "../shareCrypto";
