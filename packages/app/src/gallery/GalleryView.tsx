"use client";

/**
 * Community gallery (#2300, #2302, #2304) — the gallery itself, apart from what
 * holds it (#2472). GalleryOverlay holds it today; a workspace tab will (#2470).
 *
 * Browse what people published (All / Projects / Music / Visuals, #2486),
 * search it and sort it, read an entry's code,
 * and open it — as a new project, or (music / viz) as a file in this one. My
 * shares lists what you published, with delete: signed out, from this
 * browser; signed in (#2321), from your account, plus anything this browser
 * holds that isn't on the account yet.
 *
 * Safe-run (#2304): nothing here evaluates code. Cards show a static thumbnail
 * or a generated card; the detail view shows the files as plain text. Opening
 * hands the files to the host, which holds them (safeRun.ts) so they run only
 * after the person presses Play.
 *
 * Preview (#2328): the detail view can play the file it shows, but only inside
 * a sandboxed frame with an opaque origin (GalleryPreview.tsx) — never here.
 *
 * Where you are (view, filter, sort, search, lists, entry, Back stack, scroll) lives in a
 * GalleryStore (galleryStore.ts), so the view can be unmounted and drawn again
 * without losing your place. The container decides the rest: whether there is
 * a close button, what happens once an entry has been opened, and when a fresh
 * open (`store.open`) happens.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { galleryEntryLink, reportGalleryEntry } from "./client";
import { AuthorName, Card, CARD_CSS } from "./GalleryCards";
import { CollectionView, PROFILE_CSS, ProfileView } from "./GalleryProfile";
import { MODERATION_CSS, ModerationView } from "./GalleryModeration";
import { MARKDOWN_CSS } from "./markdown";
import { LOCAL_SHARES_CHANGED } from "./localShares";
import { type GalleryEntry, type GalleryEntryResponse, type GalleryKind } from "./types";
import { GALLERY_FILTERS, GALLERY_SORTS, browseEntries, countByFilter, type GalleryFilter, type GalleryTab } from "./galleryModel";
import {
  defaultDeleteDeps,
  defaultRevokeDeps,
  deleteMyShare,
  myRows,
  revokeMyLink,
  type LinkRow,
  type MyRows,
  type ShareRow,
} from "./myShares";
import { BAR_CSS, GalleryBar } from "./GalleryBar";
import { MINE_CSS, MyShares } from "./GalleryMyShares";
import { useGallerySession } from "./session";
import { showConfirm, showToast } from "../dialogs/host";
import { REPORT_CSS, ReportDialog } from "./ReportDialog";
import { ENTRY_CSS, EntryPage } from "./GalleryEntry";
import { scrollKey, useGalleryStore, type GalleryStore } from "./galleryStore";

export interface GalleryViewProps {
  /** Where you are; whoever holds the store decides how long that lasts. */
  store: GalleryStore;
  /** The header's × — only shown when the container can close. */
  onClose?: () => void;
  /** Resolve true when the entry was opened. */
  onOpenAsProject: (entry: GalleryEntry, manifest: GalleryEntryResponse["manifest"]) => Promise<boolean>;
  onAddToProject: (entry: GalleryEntry, manifest: GalleryEntryResponse["manifest"]) => Promise<boolean>;
  /** After Open as new project / Add to this project resolved true (the overlay closes). */
  onOpened?: () => void;
  /** #2312 — the header's Publish yours; absent where there's nowhere to publish. */
  onPublish?: () => void;
  /** The Report dialog opened or closed: while it is open it owns Esc. */
  onReportOpenChange?: (open: boolean) => void;
}

async function copyLink(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(galleryEntryLink(id));
    showToast("Gallery link copied.", "info");
  } catch {
    showToast("Couldn't copy the link — your browser blocked the clipboard.", "error");
  }
}

async function copyPrivateLink(link: { url: string | null }): Promise<void> {
  // #2329 — only a link this browser made has its key here; the button isn't shown otherwise.
  if (!link.url) return;
  try {
    await navigator.clipboard.writeText(link.url);
    showToast("Private link copied.", "info");
  } catch {
    showToast("Couldn't copy the link — your browser blocked the clipboard.", "error");
  }
}

/** How many frames a remount keeps trying to put the scroll back while the content grows. */
const SCROLL_RESTORE_FRAMES = 60;

export function GalleryView({
  store,
  onClose,
  onOpenAsProject,
  onAddToProject,
  onOpened,
  onPublish,
  onReportOpenChange,
}: GalleryViewProps) {
  const { tab: chosenTab, filter, sort, query, list, detail, stack, myAuthorId, mine, links, account } = useGalleryStore(store);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState<GalleryEntry | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const session = useGallerySession();
  const accountAuthorId = session.status === "ready" ? (session.session.user?.authorId ?? null) : null;
  // #2331 — only an admin's session says so; the routes check again on every call.
  const isAdmin = session.status === "ready" && session.session.isAdmin === true;
  // Moderation chosen, then no longer an admin (the session changed): back to browsing.
  const tab: GalleryTab = chosenTab === "moderation" && !isAdmin ? "browse" : chosenTab;

  // Drawn (again): what this browser holds may have changed while nothing listened.
  useEffect(() => store.refreshLocal(), [store]);

  // #2321 — signed in: the account's shares, when drawn and whenever sign-in resolves.
  useEffect(() => store.loadAccount(accountAuthorId), [store, accountAuthorId]);

  useEffect(() => {
    const refresh = () => {
      store.refreshLocal();
      // A claim just landed, or something was deleted: the account's list changed too.
      store.loadAccount(accountAuthorId);
    };
    window.addEventListener(LOCAL_SHARES_CHANGED, refresh);
    return () => window.removeEventListener(LOCAL_SHARES_CHANGED, refresh);
  }, [store, accountAuthorId]);

  // The container's Esc must not close the gallery from under the Report dialog.
  const reportChange = useRef(onReportOpenChange);
  reportChange.current = onReportOpenChange;
  const reportOpen = reporting !== null;
  useEffect(() => {
    if (!reportOpen) return;
    reportChange.current?.(true);
    return () => reportChange.current?.(false);
  }, [reportOpen]);

  // Scroll: remember the view's offset, and put it back when drawn again on the same view.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el?.classList?.contains("sg-body")) store.saveScroll(scrollKey(store.getState().stack), el.scrollTop);
    };
    root.addEventListener("scroll", onScroll, true);
    let frame = 0;
    let tries = 0;
    const saved = store.savedScroll();
    const restore = () => {
      const s = store.getState();
      const body = root.querySelector<HTMLElement>(".sg-body");
      if (!saved || store.savedScroll() !== saved || saved.key !== scrollKey(s.stack) || !body) return;
      // The content may still be arriving (a profile refetches): wait until it is tall enough.
      if (body.scrollHeight - body.clientHeight >= saved.top || ++tries >= SCROLL_RESTORE_FRAMES) {
        body.scrollTop = saved.top;
        return;
      }
      frame = requestAnimationFrame(restore);
    };
    if (saved && saved.top > 0) restore();
    return () => {
      root.removeEventListener("scroll", onScroll, true);
      cancelAnimationFrame(frame);
    };
  }, [store]);

  const entries = list.status === "ready" ? list.entries : null;
  const counts = useMemo(() => countByFilter(entries ?? [], query), [entries, query]);
  const shown = useMemo(
    () => (entries && tab === "browse" ? browseEntries(entries, filter, query, sort) : []),
    [entries, tab, filter, query, sort],
  );

  // #2486, #2492, #2493 — the browse grid, My shares and a profile each have a search.
  const browsing =
    ((tab === "browse" || tab === "mine") && stack.length === 0) || stack[stack.length - 1]?.kind === "author";
  // #2486 — "/" goes to the search, as on most sites, unless you are typing somewhere.
  useEffect(() => {
    if (!browsing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // Somewhere else on the page has focus (the editor, a dialog): not ours to take.
      if (t && t !== document.body && !rootRef.current?.contains(t)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [browsing]);

  const rows: MyRows = useMemo(
    () => myRows(account.status === "ready" ? account.data : null, mine, links),
    [account, mine, links],
  );

  const top = stack[stack.length - 1] ?? null;
  const backLabel = stack.length > 1 ? "← Back" : "← Back to the gallery";
  const back = () => store.back();
  const openAuthor = (id: string) => store.push({ kind: "author", id });
  const openOne = (id: string) => store.push({ kind: "entry", id });
  const loadAccount = () => store.loadAccount(accountAuthorId);

  const runAction = async (fn: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    try {
      if (await fn()) onOpened?.();
    } catch (err) {
      showToast(`Couldn't open it — ${(err as Error).message ?? "see console"}`, "error");
      console.error("[stave] gallery open failed:", err);
    } finally {
      setBusy(false);
    }
  };

  // #2330 — its own dialog (ReportDialog), so the Turnstile check can sit in it.
  const report = (entry: GalleryEntry) => setReporting(entry);
  const sendReport = async (reason: string, turnstileToken: string | null) => {
    if (!reporting) return;
    await reportGalleryEntry(reporting.id, reason, turnstileToken);
    showToast("Thanks — the report was sent.", "info");
  };

  // `removed`: it is already out of the gallery (#2492's Forget) — only this browser's record goes.
  const deleteShare = async (share: ShareRow, removed = false) => {
    try {
      const outcome = await deleteMyShare(
        share,
        defaultDeleteDeps((s) =>
          showConfirm(
            removed
              ? {
                  title: "Forget this share?",
                  description: `"${s.title}" is no longer in the gallery. Forgetting it takes it off this list.`,
                  confirmLabel: "Forget",
                }
              : {
                  title: "Delete from the gallery?",
                  description: `"${s.title}" will be taken down for everyone. This can't be undone.`,
                  confirmLabel: "Delete",
                  danger: true,
                },
          ),
        ),
      );
      if (outcome === "deleted") {
        showToast(removed ? `Forgot "${share.title}".` : `Deleted "${share.title}" from the gallery.`, "info");
        loadAccount();
      }
    } catch (err) {
      showToast(`Couldn't delete it — ${(err as Error).message}`, "error");
    }
  };

  const revokeLink = async (link: LinkRow) => {
    try {
      const outcome = await revokeMyLink(
        link,
        defaultRevokeDeps((l) =>
          showConfirm({
            title: "Revoke this link?",
            description: `The link to "${l.projectName}" will stop working for everyone who has it. This can't be undone.`,
            confirmLabel: "Revoke",
            danger: true,
          }),
        ),
      );
      if (outcome === "revoked") {
        showToast(`Revoked the link to "${link.projectName}".`, "info");
        loadAccount();
      }
    } catch (err) {
      showToast(`Couldn't revoke it — ${(err as Error).message}`, "error");
    }
  };

  const myCount = rows.entries.length + rows.links.length;
  const mineView = tab === "mine" && !top;

  return (
    <div className="sg-view" data-gallery-view ref={rootRef}>
      <style>{CSS + BAR_CSS + CARD_CSS + PROFILE_CSS + MARKDOWN_CSS + MODERATION_CSS + REPORT_CSS + ENTRY_CSS + MINE_CSS}</style>
      {/* #2491, #2492, #2493 — an entry's page, My shares and a profile have a breadcrumb bar in place of the header. */}
      {top?.kind !== "entry" && top?.kind !== "author" && !mineView && (
      <div className={tab === "browse" && !top ? "sg-header" : "sg-header sg-header-ruled"}>
        <div className="sg-headline">
          <h2 className="sg-title">Community Gallery</h2>
          <p className="sg-promise">Patterns, songs and visuals made in Stave. Nothing runs until you press Play.</p>
        </div>
        <div className="sg-header-actions">
          <button
            className={tab === "mine" && !top ? "sg-btn sg-headbtn sg-headbtn-on" : "sg-btn sg-headbtn"}
            data-gallery-tab="mine"
            aria-current={tab === "mine" && !top ? "page" : undefined}
            onClick={() => store.setTab("mine")}
          >
            My shares
            {myCount > 0 ? <span className="sg-count">{myCount}</span> : null}
          </button>
          {isAdmin && (
            <button
              className={tab === "moderation" && !top ? "sg-btn sg-headbtn sg-headbtn-on" : "sg-btn sg-headbtn"}
              data-gallery-tab="moderation"
              aria-current={tab === "moderation" && !top ? "page" : undefined}
              onClick={() => store.setTab("moderation")}
            >
              Moderation
            </button>
          )}
          {onPublish && (
            <button className="sg-btn sg-primary" data-gallery-publish onClick={onPublish}>
              Publish yours
            </button>
          )}
          {onClose && (
            <button className="sg-close" aria-label="Close gallery" onClick={onClose}>
              ×
            </button>
          )}
        </div>
      </div>
      )}

      {top?.kind === "author" ? (
        <ProfileView
          key={`a:${top.id}:${stack.length}`}
          authorId={top.id}
          store={store}
          depth={stack.length}
          backLabel={stack.length > 1 ? "← Back" : null}
          onBack={back}
          onHome={() => store.setTab("browse")}
          onClose={onClose}
          onOpenEntry={openOne}
          searchRef={searchRef}
        />
      ) : top?.kind === "collection" ? (
        <CollectionView
          key={`c:${top.id}:${stack.length}`}
          collectionId={top.id}
          backLabel={backLabel}
          onBack={back}
          onOpenEntry={openOne}
          onOpenAuthor={openAuthor}
          onDeleted={back}
        />
      ) : mineView ? (
        <MyShares
          store={store}
          rows={rows}
          account={account}
          listed={entries}
          listFull={list.status === "ready" && list.full}
          user={session.status === "ready" ? (session.session.user ?? null) : null}
          myAuthorId={accountAuthorId ?? myAuthorId}
          searchRef={searchRef}
          onBrowse={() => store.setTab("browse")}
          onClose={onClose}
          onPublish={onPublish}
          onMyProfile={openAuthor}
          onRetryAccount={loadAccount}
          onOpen={openOne}
          onCopy={copyLink}
          onDelete={deleteShare}
          onCopyPrivate={copyPrivateLink}
          onRevoke={revokeLink}
        />
      ) : top?.kind === "entry" && detail ? (
        <EntryPage
          detail={detail}
          busy={busy}
          backLabel={stack.length > 1 ? "← Back" : null}
          onBack={back}
          onHome={() => store.setTab("browse")}
          onKind={(kind) => {
            store.setFilter(kind);
            store.setTab("browse");
          }}
          onAuthor={openAuthor}
          onRetry={() => store.openEntry(detail.id)}
          onOpenAsProject={(e, m) => runAction(() => onOpenAsProject(e, m))}
          onAddToProject={(e, m) => runAction(() => onAddToProject(e, m))}
          onCopyLink={(id) => void copyLink(id)}
          onReport={report}
          listed={entries}
          onOpenEntry={openOne}
          onClose={onClose}
        />
      ) : (
        <>
          {tab === "browse" && (
            <GalleryBar
              barHook="data-gallery-browsebar"
              filterHook="data-gallery-filter"
              sortHook="data-gallery-sort"
              searchRef={searchRef}
              placeholder="Search titles, tags and artists"
              searchLabel="Search the gallery"
              query={query}
              onQuery={store.setQuery}
              filters={GALLERY_FILTERS}
              filter={filter}
              onFilter={store.setFilter}
              counts={entries ? counts : null}
              sorts={GALLERY_SORTS}
              sort={sort}
              onSort={store.setSort}
            />
          )}

          <div className="sg-body">
            {tab === "moderation" && (
              <button className="sg-btn sg-back" data-gallery-browse onClick={() => store.setTab("browse")}>
                ← Back to the gallery
              </button>
            )}
            {tab === "moderation" && isAdmin ? (
              <ModerationView onOpen={openOne} />
            ) : list.status === "loading" ? (
              <div className="sg-state" data-gallery-state="loading">Loading the gallery…</div>
            ) : list.status === "error" ? (
              <div className="sg-state" data-gallery-state="error">
                <p>Couldn&apos;t load the gallery: {list.message}.</p>
                <button className="sg-btn" onClick={() => store.loadList()}>Try again</button>
              </div>
            ) : shown.length === 0 ? (
              <div className="sg-state" data-gallery-state="empty">
                {emptyMessage(filter, query, (entries ?? []).length)}
              </div>
            ) : (
              <div className="sg-grid">
                {shown.map((e) => (
                  <Card key={e.id} entry={e} onOpen={() => openOne(e.id)} onAuthor={openAuthor} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {reporting && <ReportDialog entry={reporting} send={sendReport} onClose={() => setReporting(null)} />}
    </div>
  );
}

/** What an empty grid says: why it is empty, in the words of the filter and search chosen. */
function emptyMessage(filter: GalleryFilter, query: string, total: number): string {
  const q = query.trim();
  const label = GALLERY_FILTERS.find((f) => f.id === filter)?.label ?? "";
  if (q) return filter === "all" ? `Nothing in the gallery matches "${q}".` : `Nothing in ${label} matches "${q}".`;
  if (total === 0 || filter === "all") return "Nothing has been published yet.";
  return filter === "music" ? "No music has been published yet." : `No ${label.toLowerCase()} have been published yet.`;
}

const CSS = `
.sg-view { display: contents; }
.sg-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px 16px; padding: 16px 20px 12px; }
.sg-header-ruled { border-bottom: 1px solid var(--border-subtle); }
.sg-headline { display: grid; gap: 2px; min-width: 0; flex: 1 1 260px; }
.sg-title { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; color: var(--text-primary); }
.sg-promise { margin: 0; font-size: 12.5px; color: var(--text-muted, var(--text-chrome)); }
.sg-header-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.sg-close { background: none; border: none; color: var(--text-icon); font-size: 24px; cursor: pointer; padding: 0 6px; line-height: 1; }
.sg-headbtn { display: inline-flex; align-items: center; gap: 6px; background: none; }
.sg-headbtn-on { background: var(--bg-hover, rgba(255,255,255,.08)); }
.sg-count { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 400; opacity: .7; }
.sg-body { flex: 1; overflow: auto; padding: 16px 18px; min-height: 0; }
.sg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 22px 18px; }
.sg-thumb { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; display: block; background: #111; }
.sg-thumb-gen { position: relative; display: flex; align-items: center; justify-content: center; }
.sg-initials { font-size: 30px; font-weight: 700; color: rgba(255,255,255,.88); letter-spacing: 1px; }
.sg-kind-tag { position: absolute; left: 8px; bottom: 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: rgba(255,255,255,.75); }
.sg-card-text { padding: 9px 11px 11px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.sg-card-title { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-card-meta { font-size: 12px; color: var(--text-muted, var(--text-chrome)); opacity: .85; }
.sg-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.sg-tag { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: var(--bg-hover, rgba(255,255,255,.08)); }
.sg-state { padding: 40px 12px; text-align: center; font-size: 14px; color: var(--text-chrome); }
.sg-state p { margin: 0 0 10px; }
.sg-muted { opacity: .75; font-size: 13px; max-width: 460px; margin: 0 auto !important; line-height: 1.5; }
.sg-btn { background: var(--bg-hover, rgba(255,255,255,.06)); border: 1px solid var(--border-strong); color: var(--text-primary); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; white-space: nowrap; }
.sg-btn:disabled { opacity: .5; cursor: default; }
.sg-primary { background: var(--accent, #4a6cf7); border-color: var(--accent, #4a6cf7); color: #fff; }
.sg-danger { color: var(--danger-fg); }
.sg-quiet { opacity: .8; }
.sg-back { align-self: flex-start; margin-bottom: 12px; background: none; border-color: transparent; padding-left: 0; }
.sg-detail-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
.sg-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.sg-section { margin: 4px 0 2px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-primary); }
.sg-section-note { margin: 0 0 8px; font-size: 12px; opacity: .75; }
.sg-state-small { padding: 14px 12px; }
@media (max-width: 640px) {
  .sg-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .sg-body { padding: 12px; }
  .sg-header { padding: 12px 12px 10px; }
  .sg-btn { padding: 8px 12px; }
}
`;
