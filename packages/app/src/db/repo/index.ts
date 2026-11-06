/*
 * #2352 — the gallery's data-access layer. Every route reads and writes
 * records through these functions, never through the database (or Blob) directly.
 *
 *   accounts.ts      accounts and authors (incl. #2349 race-safe first use)
 *   entries.ts       published entries and the listing (#2346: one query)
 *   collections.ts   collections and their ordered entries
 *   reports.ts       reports and the admin action log
 *   links.ts         private links listed on an account (id, name, date only)
 *   claim.ts         the claim's moves (the whole claim is one transaction)
 *   rateLimits.ts    the write counters (#2345: one atomic upsert)
 *   tx.ts            inTransaction, the Tx / Q types
 *
 * Every function takes the database first (`getDb()` from ../client, or a
 * transaction) and says in its header which route(s) call it.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  PHASE 2 — moving the remaining routes off Blob, as two parallel groups
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Done in phase 1 (do not redo): the rate limiter (rateLimit.ts → rateLimits.ts),
 * account → author creation and linking (session.ts → accounts.ts), and the
 * `withDatabase` wrapper (../errors.ts) on every write route plus GET me and
 * GET me/shares, so an outage answers 503.
 *
 * Paths below are under packages/app/src/app/api/. Each group edits ONLY its
 * own files, so the two can run at once without touching the same file.
 *
 * GROUP A — entries, listing, reports, admin
 *   gallery/route.ts                         GET (listEntries; ignore the query
 *                                            string so the CDN caches one listing,
 *                                            #2346) and POST (insertEntry; manifest
 *                                            and thumbnail to Blob first). The new
 *                                            entry's author name: getAuthor (read-only
 *                                            use of accounts.ts).
 *   gallery/[id]/route.ts                    GET (getEntryRecord + manifest from
 *                                            Blob), DELETE (author: deleteEntryIn and
 *                                            the Blob files in one transaction; admin:
 *                                            removeEntryIn, then the Blob files)
 *   gallery/[id]/thumbnail/route.ts          getEntryRecord (removed → 404), bytes from Blob
 *   gallery/[id]/report/route.ts             getEntryRecord + addReport
 *   gallery/reports/route.ts                 (re-export; nothing to change)
 *   gallery/admin.ts                         appendAdminLog, readAdminLog, flaggedEntries,
 *                                            openReportCount / closeReports (replaces openReportsOf)
 *   gallery/admin/log/route.ts
 *   gallery/admin/reports/route.ts
 *   gallery/admin/reports/[id]/dismiss/route.ts
 *   gallery/rateLimit.ts                     (already moved; group A owns any follow-up)
 *   repo: entries.ts, reports.ts, rateLimits.ts
 *   tests: src/__tests__/galleryAdmin.test.ts, galleryRoutes.test.ts,
 *          galleryRateLimit.test.ts, galleryOrigin.test.ts
 *
 * GROUP B — accounts, authors, collections, claim, account links
 *   gallery/session.ts                       delete the Blob mirror (mirrorAuthor,
 *                                            mirrorBadge, the import in
 *                                            attachAuthorToAccount); actingAuthor's
 *                                            mergedInto check → getAuthor
 *   gallery/authors.ts                       authorForKey / keyOwnsAuthor →
 *                                            authorIdForKeyHash / authorKeyHash;
 *                                            createAuthor → insertKeyedAuthor;
 *                                            liveEntry / liveEntries / authorWork /
 *                                            servedCollection / foreignEntry → entries.ts
 *                                            and collections.ts (read-only use of entries.ts)
 *   gallery/authors/[authorId]/route.ts      getAuthor, updateAuthorProfile
 *   gallery/collections/route.ts             insertCollection
 *   gallery/collections/[id]/route.ts        getCollection, updateCollection, deleteCollection
 *   gallery/claim.ts + claim/route.ts        mergeAuthorInto, moveEntry, getEntryRecord
 *                                            (read-only), recordAccountLink
 *   gallery/accountLinks.ts                  links.ts (the #2329 rewrite-on-read goes:
 *                                            the table can't hold extra fields)
 *   gallery/me/route.ts, me/shares/route.ts  getAuthor, entriesOfAuthor, collectionsOfAuthor,
 *                                            listAccountLinks
 *   share/route.ts, share/[id]/route.ts      recordAccountLink (call sessionAuthor first:
 *                                            account_links has a foreign key to accounts),
 *                                            hasAccountLink, forgetAccountLink
 *   repo: accounts.ts, collections.ts, links.ts, claim.ts
 *   tests: src/__tests__/galleryAuthors.test.ts, galleryClaim.test.ts,
 *          galleryAccountRace.test.ts, shareShortLink.test.ts, gallerySignIn.test.ts
 *
 * SHARED — files both groups may need, and who owns which part
 *   db/schema.ts + packages/app/drizzle/     FROZEN in phase 2. Both groups' needs
 *                                            are already in it. If one truly needs a
 *                                            change, land it as its own small PR first
 *                                            (`pnpm db:generate`), and the other
 *                                            rebases: two parallel migrations would
 *                                            collide in drizzle/meta/_journal.json.
 *   gallery/store.ts                         NEITHER group edits it. When both have
 *                                            merged, one follow-up deletes every path
 *                                            except manifest/thumbnail and the header's
 *                                            record list.
 *   src/db/client.ts, src/db/errors.ts,      Frozen too (phase 1's); a fix goes in its own
 *   src/db/repo/tx.ts                         small PR first.
 *   repo/*.ts                                Each file belongs to the group listed
 *                                            above; the other group may CALL it
 *                                            (read-only use) but not change it. A
 *                                            missing query is added by the owner.
 *   src/__tests__/galleryRoutes.test.ts      Group A owns it. It also exercises
 *                                            profiles and collections; group B only
 *                                            changes it if a group-B route's behaviour
 *                                            changes, in its own describe blocks.
 *   docs (packages/docs/…gallery…)           Group A writes the "Neon and migrations"
 *                                            section; group B touches only account text.
 */

export * from "./accounts";
export * from "./claim";
export * from "./collections";
export * from "./entries";
export * from "./links";
export * from "./rateLimits";
export * from "./reports";
export * from "./suspensions";
export { inTransaction, type Q, type Tx } from "./tx";
