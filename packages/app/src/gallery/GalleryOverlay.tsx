"use client";

/**
 * Community gallery overlay (#2300, #2302, #2304).
 *
 * Browse what people published (Projects / Music / Viz), read an entry's code,
 * and open it — as a new project, or (music / viz) as a file in this one. My
 * shares lists what you published, with delete: signed out, from this
 * browser; signed in (#2321), from your account, plus anything this browser
 * holds that isn't on the account yet.
 *
 * Safe-run (#2304): nothing here evaluates code. Cards show a static thumbnail
 * or a generated card; the detail view shows the files as plain text. Opening
 * hands the files to the host, which holds them (safeRun.ts) so they run only
 * after the person presses Play.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAccountShares,
  fetchGalleryEntry,
  fetchGalleryList,
  galleryEntryLink,
  reportGalleryEntry,
  GalleryEntryRemoved,
} from "./client";
import { AuthorName, Card, CARD_CSS } from "./GalleryCards";
import { CollectionView, PROFILE_CSS, ProfileView } from "./GalleryProfile";
import { MODERATION_CSS, ModerationView } from "./GalleryModeration";
import { MARKDOWN_CSS } from "./markdown";
import {
  loadAuthor,
  listLocalShares,
  listPrivateLinks,
  LOCAL_SHARES_CHANGED,
  type LocalPrivateLink,
  type LocalShare,
} from "./localShares";
import {
  MAX_REPORT_REASON_CHARS,
  type GalleryEntry,
  type GalleryEntryResponse,
  type GalleryKind,
  type MySharesResponse,
} from "./types";
import {
  KIND_LABEL,
  countByKind,
  entriesForTab,
  formatGalleryDate,
  galleryTabs,
  isKindTab,
  type GalleryLinkTarget,
  type GalleryTab,
} from "./galleryModel";
import {
  defaultDeleteDeps,
  defaultRevokeDeps,
  deleteMyShare,
  myRows,
  revokeMyLink,
  shareStatus,
  type LinkRow,
  type MyRows,
  type ShareRow,
} from "./myShares";
import { useGallerySession } from "./session";
import { getDialog, showConfirm, showPrompt, showToast } from "../dialogs/host";

export interface GalleryOverlayProps {
  open: boolean;
  /** Open straight on this entry (a `#gallery=<id>` link). */
  initialEntryId: string | null;
  /**
   * #2314 / #2315 — open straight on an entry, a profile or a collection
   * (`#gallery-author=<id>`, `#gallery-collection=<id>`). Wins over initialEntryId.
   */
  initialView?: GalleryLinkTarget | null;
  onClose: () => void;
  /** Resolve true when the entry was opened (the overlay then closes). */
  onOpenAsProject: (entry: GalleryEntry, manifest: GalleryEntryResponse["manifest"]) => Promise<boolean>;
  onAddToProject: (entry: GalleryEntry, manifest: GalleryEntryResponse["manifest"]) => Promise<boolean>;
  /** #2312 — open the Publish dialog from the gallery's header; absent where there's nowhere to publish. */
  onPublish?: () => void;
}

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: GalleryEntry[] };

/** #2321 — the signed-in account's shares; "off" when signed out. */
type AccountState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: MySharesResponse };

type DetailState =
  | { status: "loading"; id: string }
  | { status: "removed"; id: string }
  | { status: "error"; id: string; message: string }
  | { status: "ready"; id: string; data: GalleryEntryResponse };

async function copyLink(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(galleryEntryLink(id));
    showToast("Gallery link copied.", "info");
  } catch {
    showToast("Couldn't copy the link — your browser blocked the clipboard.", "error");
  }
}

async function copyPrivateLink(link: { url: string }): Promise<void> {
  try {
    await navigator.clipboard.writeText(link.url);
    showToast("Private link copied.", "info");
  } catch {
    showToast("Couldn't copy the link — your browser blocked the clipboard.", "error");
  }
}

export function GalleryOverlay({
  open,
  initialEntryId,
  initialView,
  onClose,
  onOpenAsProject,
  onAddToProject,
  onPublish,
}: GalleryOverlayProps) {
  const [chosenTab, setTab] = useState<GalleryTab>("project");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [detail, setDetail] = useState<DetailState | null>(null);
  /** What is open on top of the browse grid, innermost last; Back pops one. */
  const [stack, setStack] = useState<GalleryLinkTarget[]>([]);
  const [myAuthorId, setMyAuthorId] = useState<string | null>(null);
  const [mine, setMine] = useState<LocalShare[]>([]);
  const [links, setLinks] = useState<LocalPrivateLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<AccountState>({ status: "off" });
  const session = useGallerySession();
  const accountAuthorId = session.status === "ready" ? (session.session.user?.authorId ?? null) : null;
  // #2331 — only an admin's session says so; the routes check again on every call.
  const isAdmin = session.status === "ready" && session.session.isAdmin === true;
  // Moderation chosen, then no longer an admin (the session changed): back to Projects.
  const tab: GalleryTab = chosenTab === "moderation" && !isAdmin ? "project" : chosenTab;

  const loadAccount = useCallback(() => {
    if (!accountAuthorId) {
      setAccount({ status: "off" });
      return;
    }
    setAccount((a) => (a.status === "ready" ? a : { status: "loading" }));
    fetchAccountShares()
      .then((data) => setAccount({ status: "ready", data }))
      .catch((err: Error) => setAccount({ status: "error", message: err.message || "your shares couldn't be loaded" }));
  }, [accountAuthorId]);

  const loadList = useCallback(() => {
    setList({ status: "loading" });
    fetchGalleryList()
      .then((r) => setList({ status: "ready", entries: Array.isArray(r.entries) ? r.entries : [] }))
      .catch((err: Error) => setList({ status: "error", message: err.message || "the gallery couldn't be loaded" }));
  }, []);

  const openEntry = useCallback((id: string) => {
    setDetail({ status: "loading", id });
    fetchGalleryEntry(id)
      .then((data) => {
        setDetail((d) => (d?.id === id ? { status: "ready", id, data } : d));
        setTab((t) => (isKindTab(t) ? data.entry.kind : t));
      })
      .catch((err: Error) => {
        setDetail((d) =>
          d?.id !== id
            ? d
            : err instanceof GalleryEntryRemoved || err?.name === "GalleryEntryRemoved"
              ? { status: "removed", id }
              : { status: "error", id, message: err.message || "the entry couldn't be loaded" },
        );
      });
  }, []);

  /** Open a view on top of what is showing. */
  const push = useCallback(
    (view: GalleryLinkTarget) => {
      setStack((s) => [...s, view]);
      if (view.kind === "entry") openEntry(view.id);
    },
    [openEntry],
  );

  const initialKind = initialView?.kind ?? null;
  const initialId = initialView?.id ?? null;
  // Each open: fresh list, the link's view if any, and the local shares.
  useEffect(() => {
    if (!open) return;
    loadList();
    setMine(listLocalShares());
    setLinks(listPrivateLinks());
    setMyAuthorId(loadAuthor()?.authorId ?? null);
    const first: GalleryLinkTarget | null =
      initialKind && initialId
        ? ({ kind: initialKind, id: initialId } as GalleryLinkTarget)
        : initialEntryId
          ? { kind: "entry", id: initialEntryId }
          : null;
    setStack(first ? [first] : []);
    if (first?.kind === "entry") openEntry(first.id);
    else setDetail(null);
  }, [open, initialEntryId, initialKind, initialId, loadList, openEntry]);

  // #2321 — signed in: the account's shares, on open and whenever sign-in resolves.
  useEffect(() => {
    if (open) loadAccount();
  }, [open, loadAccount]);

  useEffect(() => {
    if (!open) return;
    const refresh = () => {
      setMine(listLocalShares());
      setLinks(listPrivateLinks());
      setMyAuthorId(loadAuthor()?.authorId ?? null);
      // A claim just landed, or something was deleted: the account's list changed too.
      loadAccount();
    };
    window.addEventListener(LOCAL_SHARES_CHANGED, refresh);
    return () => window.removeEventListener(LOCAL_SHARES_CHANGED, refresh);
  }, [open, loadAccount]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A confirm / prompt on top owns Esc.
      if (e.key !== "Escape" || getDialog()) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const entries = list.status === "ready" ? list.entries : null;
  const counts = useMemo(() => countByKind(entries ?? []), [entries]);
  const shown = useMemo(
    () => (entries && isKindTab(tab) ? entriesForTab(entries, tab, query) : []),
    [entries, tab, query],
  );

  const rows: MyRows = useMemo(
    () => myRows(account.status === "ready" ? account.data : null, mine, links),
    [account, mine, links],
  );

  if (!open) return null;

  const top = stack[stack.length - 1] ?? null;
  const backLabel = stack.length > 1 ? "← Back" : "← Back to the gallery";
  const back = () => {
    const next = stack.slice(0, -1);
    setStack(next);
    const t = next[next.length - 1];
    if (t?.kind === "entry" && detail?.id !== t.id) openEntry(t.id);
  };
  const openAuthor = (id: string) => push({ kind: "author", id });
  const openCollection = (id: string) => push({ kind: "collection", id });
  const openOne = (id: string) => push({ kind: "entry", id });

  const runAction = async (fn: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    try {
      if (await fn()) onClose();
    } catch (err) {
      showToast(`Couldn't open it — ${(err as Error).message ?? "see console"}`, "error");
      console.error("[stave] gallery open failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const report = async (entry: GalleryEntry) => {
    const reason = await showPrompt({
      title: "Report this entry",
      description: `What's wrong with "${entry.title}"? A person reads every report.`,
      placeholder: "e.g. offensive title, copies someone else's work",
      confirmLabel: "Report",
    });
    const trimmed = reason?.trim();
    if (!trimmed) return;
    try {
      await reportGalleryEntry(entry.id, trimmed.slice(0, MAX_REPORT_REASON_CHARS));
      showToast("Thanks — the report was sent.", "info");
    } catch (err) {
      showToast(`Couldn't send the report — ${(err as Error).message}`, "error");
    }
  };

  const deleteShare = async (share: ShareRow) => {
    try {
      const outcome = await deleteMyShare(
        share,
        defaultDeleteDeps((s) =>
          showConfirm({
            title: "Delete from the gallery?",
            description: `"${s.title}" will be taken down for everyone. This can't be undone.`,
            confirmLabel: "Delete",
            danger: true,
          }),
        ),
      );
      if (outcome === "deleted") {
        showToast(`Deleted "${share.title}" from the gallery.`, "info");
        if (list.status === "ready") {
          setList({ status: "ready", entries: list.entries.filter((e) => e.id !== share.id) });
        }
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

  return (
    <div className="sg-backdrop" data-gallery="overlay" onClick={onClose}>
      <style>{CSS + CARD_CSS + PROFILE_CSS + MARKDOWN_CSS + MODERATION_CSS}</style>
      <div
        className="sg-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Community Gallery"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sg-header">
          <h2 className="sg-title">Community Gallery</h2>
          <div className="sg-header-actions">
            {onPublish && (
              <button
                className="sg-btn sg-primary"
                data-gallery-publish
                onClick={() => {
                  onClose();
                  onPublish();
                }}
              >
                Publish yours
              </button>
            )}
            <button className="sg-close" aria-label="Close gallery" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        {top?.kind === "author" ? (
          <ProfileView
            key={`a:${top.id}:${stack.length}`}
            authorId={top.id}
            backLabel={backLabel}
            onBack={back}
            onOpenEntry={openOne}
            onOpenCollection={openCollection}
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
        ) : top?.kind === "entry" && detail ? (
          <EntryDetail
            detail={detail}
            busy={busy}
            backLabel={backLabel}
            onBack={back}
            onAuthor={openAuthor}
            onRetry={() => openEntry(detail.id)}
            onOpenAsProject={(e, m) => runAction(() => onOpenAsProject(e, m))}
            onAddToProject={(e, m) => runAction(() => onAddToProject(e, m))}
            onReport={report}
          />
        ) : (
          <>
            <div className="sg-toolbar">
              <div className="sg-tabs" role="tablist">
                {galleryTabs(isAdmin).map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    data-gallery-tab={t.id}
                    className={tab === t.id ? "sg-tab sg-tab-on" : "sg-tab"}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                    {isKindTab(t.id) && entries ? <span className="sg-count">{counts[t.id]}</span> : null}
                    {t.id === "mine" && rows.entries.length + rows.links.length > 0 ? (
                      <span className="sg-count">{rows.entries.length + rows.links.length}</span>
                    ) : null}
                  </button>
                ))}
              </div>
              {isKindTab(tab) && (
                <input
                  className="sg-search"
                  type="search"
                  placeholder="Search title, tags, author"
                  aria-label="Search the gallery"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              )}
            </div>

            <div className="sg-body">
              {tab === "moderation" && isAdmin ? (
                <ModerationView
                  onOpen={openOne}
                  onTakenDown={(id) =>
                    setList((l) => (l.status === "ready" ? { status: "ready", entries: l.entries.filter((e) => e.id !== id) } : l))
                  }
                />
              ) : tab === "mine" ? (
                <MyShares
                  myAuthorId={accountAuthorId ?? myAuthorId}
                  onMyProfile={openAuthor}
                  rows={rows}
                  account={account}
                  onRetryAccount={loadAccount}
                  onOpenCollection={openCollection}
                  listed={entries}
                  onCopyPrivate={copyPrivateLink}
                  onRevoke={revokeLink}
                  onOpen={openOne}
                  onCopy={copyLink}
                  onDelete={deleteShare}
                />
              ) : list.status === "loading" ? (
                <div className="sg-state" data-gallery-state="loading">Loading the gallery…</div>
              ) : list.status === "error" ? (
                <div className="sg-state" data-gallery-state="error">
                  <p>Couldn&apos;t load the gallery: {list.message}.</p>
                  <button className="sg-btn" onClick={loadList}>Try again</button>
                </div>
              ) : shown.length === 0 ? (
                <div className="sg-state" data-gallery-state="empty">
                  {query.trim()
                    ? `Nothing in ${KIND_LABEL[tab as GalleryKind]} matches "${query.trim()}".`
                    : `No ${KIND_LABEL[tab as GalleryKind].toLowerCase()} entries have been published yet.`}
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
      </div>
    </div>
  );
}

function EntryDetail({
  detail,
  busy,
  backLabel,
  onBack,
  onAuthor,
  onRetry,
  onOpenAsProject,
  onAddToProject,
  onReport,
}: {
  detail: DetailState;
  busy: boolean;
  backLabel: string;
  onBack: () => void;
  onAuthor: (authorId: string) => void;
  onRetry: () => void;
  onOpenAsProject: (e: GalleryEntry, m: GalleryEntryResponse["manifest"]) => void;
  onAddToProject: (e: GalleryEntry, m: GalleryEntryResponse["manifest"]) => void;
  onReport: (e: GalleryEntry) => void;
}) {
  const [fileIdx, setFileIdx] = useState(0);
  useEffect(() => setFileIdx(0), [detail.id]);

  const back = (
    <button className="sg-btn sg-back" onClick={onBack}>
      {backLabel}
    </button>
  );

  if (detail.status === "loading") {
    return (
      <div className="sg-body">
        {back}
        <div className="sg-state" data-gallery-state="loading">Loading the entry…</div>
      </div>
    );
  }
  if (detail.status === "removed") {
    return (
      <div className="sg-body">
        {back}
        <div className="sg-state" data-gallery-state="removed">This was removed from the gallery.</div>
      </div>
    );
  }
  if (detail.status === "error") {
    return (
      <div className="sg-body">
        {back}
        <div className="sg-state" data-gallery-state="error">
          <p>Couldn&apos;t open the entry: {detail.message}.</p>
          <button className="sg-btn" onClick={onRetry}>Try again</button>
        </div>
      </div>
    );
  }

  const { entry, manifest } = detail.data;
  const files = manifest.files ?? [];
  const file = files[Math.min(fileIdx, Math.max(0, files.length - 1))];
  return (
    <div className="sg-body sg-detail" data-gallery-detail={entry.id}>
      {back}
      <div className="sg-detail-head">
        <div>
          <div className="sg-detail-title">{entry.title}</div>
          <div className="sg-card-meta">
            {KIND_LABEL[entry.kind]} by{" "}
            <AuthorName name={entry.authorName} authorId={entry.authorId} onAuthor={onAuthor} /> · {formatGalleryDate(entry.publishedAt)}
          </div>
          {entry.tags.length > 0 && (
            <div className="sg-tags">
              {entry.tags.map((t) => (
                <span key={t} className="sg-tag">#{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="sg-actions">
          <button className="sg-btn sg-primary" disabled={busy} onClick={() => onOpenAsProject(entry, manifest)}>
            Open as new project
          </button>
          {entry.kind !== "project" && (
            <button className="sg-btn" disabled={busy} onClick={() => onAddToProject(entry, manifest)}>
              Add to this project
            </button>
          )}
          <button className="sg-btn" onClick={() => void copyLink(entry.id)}>Copy link</button>
          <button className="sg-btn sg-quiet" onClick={() => onReport(entry)}>Report</button>
        </div>
      </div>
      <p className="sg-safe" data-gallery-safe-note>
        Nothing from this entry has run. Read the code below; once it is open, it plays only when you press Play.
      </p>
      {files.length > 1 && (
        <div className="sg-files" role="tablist" aria-label="Files">
          {files.map((f, i) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={i === fileIdx}
              className={i === fileIdx ? "sg-file sg-file-on" : "sg-file"}
              onClick={() => setFileIdx(i)}
            >
              {f.path}
            </button>
          ))}
        </div>
      )}
      {file ? (
        <div className="sg-code-wrap">
          <div className="sg-code-path">{file.path}</div>
          <pre className="sg-code" data-gallery-code={file.path}>{file.content}</pre>
        </div>
      ) : (
        <div className="sg-state">This entry has no files.</div>
      )}
    </div>
  );
}

function MyShares({
  myAuthorId,
  onMyProfile,
  rows,
  account,
  onRetryAccount,
  onOpenCollection,
  listed,
  onOpen,
  onCopy,
  onDelete,
  onCopyPrivate,
  onRevoke,
}: {
  myAuthorId: string | null;
  onMyProfile: (authorId: string) => void;
  rows: MyRows;
  account: AccountState;
  onRetryAccount: () => void;
  onOpenCollection: (id: string) => void;
  listed: GalleryEntry[] | null;
  onOpen: (id: string) => void;
  onCopy: (id: string) => void;
  onDelete: (s: ShareRow) => void;
  onCopyPrivate: (l: LinkRow) => void;
  onRevoke: (l: LinkRow) => void;
}) {
  const signedIn = account.status !== "off";
  const browserOnly = (home: "account" | "browser") =>
    signedIn && home === "browser" ? (
      <span className="sg-browser-only" data-gallery-browser-only>
        {" "}
        · only in this browser
      </span>
    ) : null;
  return (
    <div className="sg-mine" data-gallery-mine-source={signedIn ? "account" : "browser"}>
      {myAuthorId && (
        <button
          className="sg-btn sg-my-profile"
          data-gallery-my-profile={myAuthorId}
          onClick={() => onMyProfile(myAuthorId)}
        >
          View my profile →
        </button>
      )}
      {account.status === "loading" && (
        <div className="sg-section-note" data-gallery-state="account-loading">Loading your account&apos;s shares…</div>
      )}
      {account.status === "error" && (
        <div className="sg-section-note" data-gallery-state="account-error">
          Couldn&apos;t load your account&apos;s shares: {account.message}. Showing what this browser has.{" "}
          <button className="sg-btn" onClick={onRetryAccount}>Try again</button>
        </div>
      )}
      <section data-gallery-section="published">
        <h3 className="sg-section">In the gallery</h3>
        <p className="sg-section-note">Everyone can see and open these.</p>
        {rows.entries.length === 0 ? (
          <div className="sg-state sg-state-small" data-gallery-state="mine-empty">
            <p>
              {signedIn
                ? "You haven't published anything yet."
                : "You haven't published anything from this browser yet."}
            </p>
            <p className="sg-muted">
              Use File → Share → Publish to Gallery (or the Publish yours button above) to share a project, a pattern or
              a visual.{signedIn ? "" : " This browser keeps the key that lets you take it down again."}
            </p>
          </div>
        ) : (
          rows.entries.map((s) => {
            // An account row is live by definition; a browser row is checked against the list.
            const status = s.home === "account" ? "listed" : shareStatus(s, listed);
            return (
              <div
                key={s.id}
                className="sg-mine-row"
                data-gallery-mine={s.id}
                data-gallery-status={status}
                data-gallery-home={s.home}
              >
                <div className="sg-mine-text">
                  <div className="sg-card-title">{s.title}</div>
                  <div className="sg-card-meta">
                    {KIND_LABEL[s.kind] ?? s.kind} · published {formatGalleryDate(s.publishedAt)}
                    {browserOnly(s.home)}
                    {status === "missing" && (
                      <span className="sg-missing"> · No longer in the gallery — it was removed.</span>
                    )}
                  </div>
                </div>
                <div className="sg-actions">
                  <button className="sg-btn" onClick={() => onOpen(s.id)}>Open</button>
                  <button className="sg-btn" onClick={() => onCopy(s.id)}>Copy link</button>
                  <button className="sg-btn sg-danger" onClick={() => onDelete(s)}>
                    {status === "missing" ? "Forget" : "Delete"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>

      {signedIn && rows.collections.length > 0 && (
        <section data-gallery-section="collections">
          <h3 className="sg-section">Collections</h3>
          <p className="sg-section-note">Open one to change or delete it.</p>
          {rows.collections.map((c) => (
            <div key={c.id} className="sg-mine-row" data-gallery-my-collection={c.id}>
              <div className="sg-mine-text">
                <div className="sg-card-title">{c.title}</div>
                <div className="sg-card-meta">
                  Collection · {c.entryIds.length} {c.entryIds.length === 1 ? "entry" : "entries"}
                </div>
              </div>
              <div className="sg-actions">
                <button className="sg-btn" onClick={() => onOpenCollection(c.id)}>Open</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section data-gallery-section="private">
        <h3 className="sg-section">Private links</h3>
        <p className="sg-section-note" data-gallery-links-note>
          {signedIn
            ? "Only people you send these to can open them. Your account keeps each full link, key included, so you can copy it again on any device; only you can see this list."
            : "Only people you send these to can open them. Links made before this list existed aren't here and can't be revoked; the list lives in this browser."}
        </p>
        {rows.links.length === 0 ? (
          <div className="sg-state sg-state-small" data-gallery-state="links-empty">
            <p className="sg-muted">File → Share → Copy Private Link makes one; it will show up here.</p>
          </div>
        ) : (
          rows.links.map((l) => (
            <div key={l.id} className="sg-mine-row" data-gallery-link={l.id} data-gallery-home={l.home}>
              <div className="sg-mine-text">
                <div className="sg-card-title">{l.projectName}</div>
                <div className="sg-card-meta">
                  Private link · made {formatGalleryDate(l.createdAt)}
                  {browserOnly(l.home)}
                </div>
              </div>
              <div className="sg-actions">
                <button className="sg-btn" onClick={() => onCopyPrivate(l)}>Copy again</button>
                <button className="sg-btn sg-danger" onClick={() => onRevoke(l)}>Revoke</button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

const CSS = `
.sg-backdrop { position: fixed; inset: 0; background: var(--bg-overlay, rgba(0,0,0,.55)); display: flex; align-items: center; justify-content: center; z-index: 10000; font-family: system-ui, -apple-system, sans-serif; }
.sg-modal { width: min(1040px, 94vw); height: min(760px, 88vh); background: var(--bg-elevated); border: 1px solid var(--border-strong); border-radius: 10px; display: flex; flex-direction: column; color: var(--text-chrome); box-shadow: 0 20px 60px rgba(0,0,0,.45); overflow: hidden; }
.sg-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border-subtle); }
.sg-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
.sg-close { background: none; border: none; color: var(--text-icon); font-size: 24px; cursor: pointer; padding: 0 6px; line-height: 1; }
.sg-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; padding: 10px 18px; border-bottom: 1px solid var(--border-subtle); }
.sg-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.sg-tab { background: none; border: 1px solid transparent; color: var(--text-chrome); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; display: inline-flex; gap: 6px; align-items: center; }
.sg-tab:hover { background: var(--bg-hover, rgba(255,255,255,.06)); }
.sg-tab-on { border-color: var(--border-strong); background: var(--bg-hover, rgba(255,255,255,.08)); color: var(--text-primary); font-weight: 600; }
.sg-count { font-size: 11px; opacity: .7; }
.sg-search { flex: 1 1 200px; max-width: 320px; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--bg-input, var(--bg-elevated)); color: var(--text-primary); font-size: 13px; }
.sg-body { flex: 1; overflow: auto; padding: 16px 18px; min-height: 0; }
.sg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
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
.sg-danger { color: var(--text-error, #f27878); }
.sg-quiet { opacity: .8; }
.sg-back { align-self: flex-start; margin-bottom: 12px; background: none; border-color: transparent; padding-left: 0; }
.sg-detail { display: flex; flex-direction: column; }
.sg-detail-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
.sg-detail-title { font-size: 18px; font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
.sg-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.sg-safe { font-size: 12px; margin: 12px 0 10px; padding: 7px 10px; border-left: 3px solid var(--accent, #4a6cf7); background: var(--bg-hover, rgba(255,255,255,.04)); }
.sg-files { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.sg-file { background: none; border: 1px solid var(--border-subtle); color: var(--text-chrome); padding: 3px 8px; border-radius: 5px; cursor: pointer; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.sg-file-on { border-color: var(--accent, #4a6cf7); color: var(--text-primary); }
.sg-code-wrap { flex: 1; min-height: 160px; display: flex; flex-direction: column; border: 1px solid var(--border-subtle); border-radius: 6px; overflow: hidden; }
.sg-code-path { font-size: 11px; padding: 5px 10px; border-bottom: 1px solid var(--border-subtle); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; opacity: .8; }
.sg-code { flex: 1; margin: 0; padding: 10px 12px; overflow: auto; font-size: 12.5px; line-height: 1.5; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; color: var(--text-primary); background: var(--bg-editor, rgba(0,0,0,.25)); user-select: text; }
.sg-mine { display: flex; flex-direction: column; gap: 8px; }
.sg-mine-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: 8px; }
.sg-mine-text { min-width: 0; flex: 1 1 220px; }
.sg-header-actions { display: flex; align-items: center; gap: 8px; }
.sg-section { margin: 4px 0 2px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-primary); }
.sg-section-note { margin: 0 0 8px; font-size: 12px; opacity: .75; }
.sg-mine section { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
.sg-state-small { padding: 14px 12px; }
.sg-missing { color: var(--text-error, #f27878); }
.sg-browser-only { font-style: italic; opacity: .85; }
@media (max-width: 640px) {
  .sg-modal { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; border: none; }
  .sg-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .sg-search { max-width: none; }
  .sg-body { padding: 12px; }
  .sg-toolbar { padding: 8px 12px; }
  .sg-tab { padding: 8px 10px; }
  .sg-btn { padding: 8px 12px; }
}
`;
