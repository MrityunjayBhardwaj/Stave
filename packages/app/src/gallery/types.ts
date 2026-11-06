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
 *   DELETE /api/gallery/<id>              (the author's session or MANAGE_TOKEN_HEADER; or an
 *                                          admin's session with AdminReasonRequest, #2331)
 *                                         → 204 · 400 admin without a reason · 403 · 404
 *   POST   /api/gallery/<id>/report       ← ReportRequest → 202
 *   (moderation routes: see "#2331 admins" below)
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
  /**
   * #2319 — ignored. Publishing needs a signed-in session; the author's name is
   * the profile's, and the email is the account's. Still accepted so a client
   * from before sign-in doesn't get a 400.
   */
  authorName?: string;
  /** #2319 — ignored, as `authorName`. */
  authorEmail?: string;
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
   * #2433 — the entry as the public list shows it, so the author sees it at once
   * while a cached list catches up. Absent from a deployment older than this field.
   */
  entry?: GalleryEntry;
  /**
   * #2314 — present only when a publish CREATED a key-held author. Since #2319 a
   * publish always lands on the signed-in account's author, which has no key, so
   * the server no longer sends it; kept so older stored responses still type.
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

// ── #2331 admins: moderation and the action log ───────────────────────────
//
// An admin is a signed-in account listed in STAVE_GALLERY_ADMINS
// ("provider:providerAccountId", comma-separated). Every route below answers
// 403 to anyone else, signed in or not. There is no admin key or header.
//
//   GET    /api/gallery/admin/reports                → 200 ModerationReportsResponse · 403
//   GET    /api/gallery/reports                      (the same; the route's old address)
//   POST   /api/gallery/admin/reports/<id>/dismiss   ← AdminReasonRequest → 204 · 400 · 403 · 404
//   GET    /api/gallery/admin/log                    → 200 AdminLogResponse (newest 200) · 403
//   DELETE /api/gallery/<id>                         ← AdminReasonRequest → 204 · 400 · 403 · 404
//   DELETE /api/gallery/collections/<id>             ← AdminReasonRequest → 204 · 400 · 403 · 404
//
// Each take-down and dismiss appends one AdminLogRecord before it acts.

export interface AdminReasonRequest {
  /** Why: kept in the action log. Required, at most MAX_REPORT_REASON_CHARS. */
  reason: string;
}

export type AdminAction =
  | "take-down-entry"
  | "take-down-collection"
  | "dismiss-report"
  | "restore-entry"
  | "purge-entry"
  | "suspend-account"
  | "lift-suspension";

/** #2400 — how long an admin can suspend an account for, in days. Null is permanent. */
export const SUSPENSION_DAYS = [7, 30, null] as const;
export type SuspensionDays = (typeof SUSPENSION_DAYS)[number];

export interface SuspendRequest {
  authorId: string;
  /** Why: kept in the action log. Required, at most MAX_REPORT_REASON_CHARS. */
  reason: string;
  days: SuspensionDays;
  /** Also take down everything the account has published, and hide its profile. */
  takeDownAll: boolean;
}

/** #2400 — a suspension in force, for admins. Never the email or the account hash. */
export interface ActiveSuspension {
  authorId: string;
  name: string;
  /** ms since epoch */
  at: number;
  /** ms since epoch; null is permanent. */
  until: number | null;
  reason: string;
  hideProfile: boolean;
}

export interface SuspensionsResponse {
  /** Newest first. */
  suspensions: ActiveSuspension[];
}

/** #2401 — how long an admin take-down can be undone. The clean-up deletes the files within a day after. */
export const TAKEDOWN_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** #2401 — an entry an admin took down that can still be restored. Never the email. */
export interface TakenDownEntry {
  entry: GalleryEntry;
  /** ms since epoch */
  removedAt: number;
  /** ms since epoch: Restore works until then. */
  restoreBy: number;
  /** Why it was taken down, from the action log. */
  reason: string;
}

export interface TakenDownResponse {
  /** Newest first. */
  entries: TakenDownEntry[];
}

/** Who did it. Never the email. */
export interface GalleryAdmin {
  provider: string;
  accountId: string;
  name: string;
}

export interface AdminLogRecord {
  /** ms since epoch */
  at: number;
  admin: GalleryAdmin;
  action: AdminAction;
  /** The entry or collection id. */
  target: string;
  reason: string;
}

export interface AdminLogResponse {
  /** Newest first, at most 200. */
  actions: AdminLogRecord[];
}

/** One flagged entry and every open report on it, newest report first. */
export interface FlaggedEntry {
  entryId: string;
  /** Null when the entry's listing can't be read (it is reported, but gone). */
  entry: GalleryEntry | null;
  reports: Array<Pick<GalleryReport, "reason" | "reportedAt">>;
}

export interface ModerationReportsResponse {
  /** The most recently reported first. */
  flagged: FlaggedEntry[];
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
// #2331 — ADMIN_KEY_HEADER ("x-stave-admin-key") is gone: admins are signed-in
// accounts (STAVE_GALLERY_ADMINS), and the server ignores that header.

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
//   DELETE /api/gallery/collections/<id>          (AUTHOR_KEY_HEADER, or an admin's session
//                                                 with a reason, #2331) → 204 · 400 · 403 · 404
//
// A collection may hold only its author's own entries (400 otherwise). Entries
// taken down are left out of every response. Deleting a collection never
// deletes its entries. The author routes never return the email.

/**
 * #2319 — the account a profile is signed in with, shown as a badge. Only what
 * the provider shows publicly anyway: never the email, never the provider's
 * account id. `login` is the GitHub handle (the badge links to
 * github.com/<login>); a Google account has none and shows as "Google account".
 */
export interface GalleryVerified {
  provider: "github" | "google";
  login?: string;
  avatarUrl?: string;
}

/** The public profile. `bio` is markdown, rendered client-side with raw HTML escaped. */
export interface GalleryAuthorProfile {
  authorId: string;
  name: string;
  bio: string;
  createdAt: number;
  updatedAt: number;
  /** #2319 — present once the profile belongs to a signed-in account. */
  verified?: GalleryVerified;
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

// ── #2319 sign-in ───────────────────────────────────────────────────────────
//
// Publishing needs a signed-in session (GitHub or Google, through Auth.js at
// /api/auth/*). The session's account is linked to exactly one author; the
// server finds or makes it on the account's first gallery use.
//
//   GET    /api/gallery/me                → 200 GallerySessionResponse (never cached)
//   POST   /api/gallery                   → 401 { error: "sign in to publish" } when signed out
//                                         → 503 when this deployment has no sign-in set up
//
// Editing a profile, making/changing/deleting a collection and deleting an entry
// accept the session's author, or (for things made before sign-in) the old
// AUTHOR_KEY_HEADER / MANAGE_TOKEN_HEADER.

/** A provider this deployment offers. */
export interface GallerySignInProvider {
  id: string;
  name: string;
}

export interface GallerySessionResponse {
  /** False when the deployment has no provider (or no session secret) set up. */
  signInAvailable: boolean;
  /** The providers on offer, in menu order. Empty when sign-in is unavailable. */
  providers: GallerySignInProvider[];
  /** Null when signed out. Never carries the email. */
  user: {
    name: string;
    authorId: string;
    verified: GalleryVerified;
    /**
     * #2331 — "provider:providerAccountId", the id STAVE_GALLERY_ADMINS lists.
     * Sent only to the account itself (this route is never cached).
     */
    accountId?: string;
  } | null;
  /** #2331 — true only for a signed-in admin; the overlay then shows Moderation. */
  isAdmin?: boolean;
}

// ── #2320 claim and #2321 shares that follow the account ───────────────────
//
//   POST   /api/gallery/claim     (signed in) ← ClaimRequest → 200 ClaimResponse · 400 · 401 · 503
//       Brings what this browser holds keys for into the account: the old
//       author (merged into the account's author), entries by manage token,
//       private links by manage token. Running it twice changes nothing.
//   GET    /api/gallery/me/shares (signed in) → 200 MySharesResponse · 401 · 503 (never cached)
//   GET    /api/gallery/authors/<old id>      → 200 AuthorMovedResponse once that profile
//                                               was merged into an account's profile
//   POST   /api/share  with SHARE_LINK_NAME_HEADER, signed in: also lists the link on
//       the account as an AccountLink (id, name, date; never the key or the full
//       link, #2329). Signed out, the header is ignored and nothing about the link
//       is kept beyond its sealed bytes and its manage-token hash.
//   DELETE /api/share/<id>        MANAGE_TOKEN_HEADER, or the session when the link is on the account.

export interface ClaimItem {
  id: string;
  manageToken: string;
}

/**
 * A private link to claim: the token proves it; the rest is what My shares
 * shows. #2329 — never the link itself: its key stays in this browser.
 */
export interface ClaimLinkItem extends ClaimItem {
  projectName?: string;
  createdAt?: number;
}

/**
 * #2345 — the most entries, and separately the most links, one claim may carry.
 * It was 500; each item costs several storage operations, so it is now small,
 * and the browser sends anything beyond it on a later page load (pendingClaim).
 */
export const MAX_CLAIM_ITEMS = 50;

export interface ClaimRequest {
  authorKey?: string;
  entries: ClaimItem[];
  links: ClaimLinkItem[];
}

export interface ClaimRefusal {
  /** What was refused, in words: "your old profile", "entry <id>", "private link <id>". */
  what: string;
  kind: "author" | "entry" | "link";
  /** The entry or link id (absent for the author). */
  id?: string;
  reason: string;
}

export interface ClaimResponse {
  /** The account's author, where everything now lives. */
  authorId: string;
  /** Counted only when this run changed something, so a second run is all zeros. */
  moved: { entries: number; collections: number; links: number };
  refused: ClaimRefusal[];
}

/**
 * A private link listed on an account (#2321), so My shares can show it and
 * revoke it from any device. #2329 — only these three fields, ever: never the
 * link's key and never the full link (the key lives after the `#`, in the
 * browser that made it). Copying a link again needs that browser's own copy
 * (localShares.ts LocalPrivateLink); other devices can only revoke it. Revoking
 * through the session works because the record exists on the account; the
 * manage-token hash stays beside the share, not here.
 */
export interface AccountLink {
  id: string;
  projectName: string;
  createdAt: number;
}

export interface MySharesResponse {
  authorId: string;
  /** Newest first; taken-down entries left out. */
  entries: GalleryEntry[];
  /** Newest first. */
  collections: GalleryCollection[];
  /** Newest first; revoked links left out. */
  links: AccountLink[];
}

/** The answer for a profile that was merged into another (#2320): follow `movedTo`. */
export interface AuthorMovedResponse {
  movedTo: string;
}

/**
 * The project's name, URI-encoded (headers are ASCII), sent by a signed-in
 * browser so the account's list can name the link. #2329 — there is no key
 * header any more; the server ignores one if an older browser sends it.
 */
export const SHARE_LINK_NAME_HEADER = "x-stave-share-name";

export const AUTHOR_KEY_HEADER = "x-stave-author-key";

/**
 * #2330 — the Cloudflare Turnstile token on publish and report (the name
 * Cloudflare gives the widget's form field). Checked by api/gallery/turnstile.ts
 * only when TURNSTILE_SECRET_KEY is set.
 */
export const TURNSTILE_HEADER = "cf-turnstile-response";
/**
 * #2347 — what each Turnstile widget says it is for (its `action`). The server
 * checks the token was made for the same action, so a token solved in the
 * report dialog can't be spent on a publish.
 */
export type TurnstileAction = "publish" | "report";
export const MAX_BIO_CHARS = 10_000;
export const MAX_COLLECTION_TITLE_CHARS = 80;
export const MAX_COLLECTION_DESCRIPTION_CHARS = 1_000;
export const MAX_COLLECTION_ENTRIES = 100;

/** Gallery ids reuse the short-share id shape (11 base64url chars). */
export { SHARE_ID_PATTERN as GALLERY_ID_PATTERN } from "../shareCrypto";
