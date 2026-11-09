"use client";

/**
 * #2492 — My shares: one list of everything you shared, each row's state at a glance.
 *
 * Signed out, the list is this browser's; signed in (#2321), the account's plus
 * whatever this browser holds that the account doesn't (myRows). Published
 * entries and private links are rows of the same list, with the gallery's own
 * search, filter (All / Published / Private links) and sort (GalleryBar).
 *
 * Each row: a small picture, title, kind and size, one status pill (mineItems
 * decides which), when it was shared, the row's common action (Copy link, or
 * Forget for a removed entry) and a ⋯ menu with the rest (Open, Delete, Revoke).
 * A private link made on another device can't be copied here — its key lives
 * only in the browser that made it (#2329) — and the row says so.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CardPicture, GeneratedThumb, useEntryRecording } from "./GalleryCards";
import { GalleryBar } from "./GalleryBar";
import { KIND_LABEL, MINE_FILTERS, MINE_SORTS, formatGalleryDate, publishedAgo } from "./galleryModel";
import { contentsLine } from "./recording";
import { shownName } from "./reservedNames";
import {
  PILL_LABEL,
  countMine,
  mineItems,
  shownMine,
  type LinkRow,
  type MineItem,
  type MyRows,
  type ShareRow,
  type SharePill,
} from "./myShares";
import { useGalleryStore, type AccountState, type GalleryStore } from "./galleryStore";
import type { GalleryEntry, GallerySessionResponse } from "./types";

type SessionUser = NonNullable<GallerySessionResponse["user"]>;

const PROVIDER_LABEL: Record<string, string> = { github: "GitHub", google: "Google" };

export interface MySharesProps {
  store: GalleryStore;
  rows: MyRows;
  account: AccountState;
  /** The gallery's public list, to tell a browser row that was removed; null while it loads. */
  listed: GalleryEntry[] | null;
  /** #2519 — `listed` is as long as a listing gets, so it may be cut short. */
  listFull: boolean;
  /** The signed-in account, when there is one. */
  user: SessionUser | null;
  /** This browser's or the account's author id, for View my profile. */
  myAuthorId: string | null;
  searchRef: React.Ref<HTMLInputElement>;
  onBrowse: () => void;
  onClose?: () => void;
  onPublish?: () => void;
  onMyProfile: (authorId: string) => void;
  onRetryAccount: () => void;
  onOpenCollection: (id: string) => void;
  onOpen: (id: string) => void;
  onCopy: (id: string) => void;
  /** `removed`: Forget a share already out of the gallery, not Delete one that is in it. */
  onDelete: (s: ShareRow, removed?: boolean) => void;
  onCopyPrivate: (l: LinkRow) => void;
  onRevoke: (l: LinkRow) => void;
}

export function MyShares(props: MySharesProps) {
  const { store, rows, account, listed, user } = props;
  const { mineFilter, mineSort, mineQuery } = useGalleryStore(store);
  const signedIn = account.status !== "off";
  const items = useMemo(
    () => mineItems(rows, listed, signedIn, props.listFull),
    [rows, listed, signedIn, props.listFull],
  );
  const counts = useMemo(() => countMine(items, mineQuery), [items, mineQuery]);
  const shown = useMemo(() => shownMine(items, mineFilter, mineQuery, mineSort), [items, mineFilter, mineQuery, mineSort]);

  // The entry a row stands for, for its picture and size: the account's copy, else the public list's.
  const entryById = useMemo(() => {
    const m = new Map<string, GalleryEntry>();
    for (const e of listed ?? []) m.set(e.id, e);
    if (account.status === "ready") for (const e of account.data.entries) m.set(e.id, e);
    return m;
  }, [listed, account]);

  const provider = user ? PROVIDER_LABEL[user.verified?.provider ?? ""] : undefined;
  const who = user
    ? `Signed in as ${shownName(user.name)}${provider ? ` with ${provider}` : ""}. Everything you've shared, from any device.`
    : "What you've shared from this browser. It keeps the key that lets you take each one down again.";

  return (
    <>
      <nav className="sg-crumbs" aria-label="Where you are">
        <button className="sg-crumb" data-gallery-crumb="gallery" data-gallery-browse onClick={props.onBrowse}>
          Gallery
        </button>
        <span className="sg-crumb-sep" aria-hidden="true">/</span>
        <span className="sg-crumb-here" aria-current="page">My shares</span>
        {props.onClose && (
          <button className="sg-close sg-crumb-close" aria-label="Close gallery" onClick={props.onClose}>
            ×
          </button>
        )}
      </nav>
      <div className="sg-header">
        <div className="sg-headline">
          <h2 className="sg-title">My shares</h2>
          <p className="sg-promise" data-gallery-mine-who>{who}</p>
        </div>
        <div className="sg-header-actions">
          {props.myAuthorId && (
            <button
              className="sg-btn sg-headbtn"
              data-gallery-my-profile={props.myAuthorId}
              onClick={() => props.onMyProfile(props.myAuthorId!)}
            >
              View my profile
            </button>
          )}
          {props.onPublish && (
            <button className="sg-btn sg-primary" data-gallery-publish onClick={props.onPublish}>
              Publish yours
            </button>
          )}
        </div>
      </div>
      <GalleryBar
        barHook="data-gallery-minebar"
        filterHook="data-gallery-mine-filter"
        sortHook="data-gallery-mine-sort"
        searchRef={props.searchRef}
        placeholder="Search your shares"
        searchLabel="Search your shares"
        query={mineQuery}
        onQuery={store.setMineQuery}
        filters={MINE_FILTERS}
        filter={mineFilter}
        onFilter={store.setMineFilter}
        counts={counts}
        sorts={MINE_SORTS}
        sort={mineSort}
        onSort={store.setMineSort}
      />
      <div className="sg-body">
        <div className="sg-mshare" data-gallery-mine-source={signedIn ? "account" : "browser"}>
          {account.status === "loading" && (
            <div className="sg-section-note" data-gallery-state="account-loading">Loading your account&apos;s shares…</div>
          )}
          {account.status === "error" && (
            <div className="sg-section-note" data-gallery-state="account-error">
              Couldn&apos;t load your account&apos;s shares: {account.message}. Showing what this browser has.{" "}
              <button className="sg-btn" onClick={props.onRetryAccount}>Try again</button>
            </div>
          )}
          {items.length === 0 ? (
            <div className="sg-state sg-state-small" data-gallery-state="mine-empty">
              <p>
                {signedIn ? "You haven't shared anything yet." : "You haven't shared anything from this browser yet."}
              </p>
              <p className="sg-muted">
                Use File → Share → Publish to Gallery (or the Publish yours button above) to share a project, a pattern or
                a visual, or File → Share → Copy Private Link to send one to a few people.
                {signedIn ? "" : " This browser keeps the key that lets you take it down again."}
              </p>
            </div>
          ) : shown.length === 0 ? (
            <div
              className="sg-state sg-state-small"
              data-gallery-state={mineQuery.trim() ? "mine-none" : mineFilter === "links" ? "links-empty" : "mine-none"}
            >
              {mineQuery.trim()
                ? `Nothing in your shares matches "${mineQuery.trim()}".`
                : mineFilter === "links"
                  ? "No private links yet. File → Share → Copy Private Link makes one; it will show up here."
                  : "You haven't published anything yet."}
            </div>
          ) : (
            <div className="sg-mshare-list" role="list">
              <div className="sg-mshare-head" aria-hidden="true">
                <span />
                <span>Title</span>
                <span>Status</span>
                <span>Shared</span>
                <span />
              </div>
              {shown.map((item) =>
                item.type === "entry" ? (
                  <EntryRow
                    key={`e:${item.row.id}`}
                    item={item}
                    entry={entryById.get(item.row.id) ?? null}
                    onOpen={props.onOpen}
                    onCopy={props.onCopy}
                    onDelete={props.onDelete}
                  />
                ) : (
                  <LinkRowView
                    key={`l:${item.row.id}`}
                    item={item}
                    onCopy={props.onCopyPrivate}
                    onRevoke={props.onRevoke}
                  />
                ),
              )}
            </div>
          )}

          {signedIn && rows.collections.length > 0 && (
            <section className="sg-mshare-colls" data-gallery-section="collections">
              <h3 className="sg-section">Collections</h3>
              <p className="sg-section-note">Open one to change or delete it.</p>
              {rows.collections.map((c) => (
                <div key={c.id} className="sg-mshare-coll" data-gallery-my-collection={c.id}>
                  <div className="sg-mshare-text">
                    <b>{c.title}</b>
                    <span>
                      Collection · {c.entryIds.length} {c.entryIds.length === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                  <button className="sg-btn" onClick={() => props.onOpenCollection(c.id)}>Open</button>
                </div>
              ))}
            </section>
          )}

          <p className="sg-mshare-foot" data-gallery-links-note>
            {signedIn
              ? "Private links open only for people you send them to. Your account lists each link so you can revoke it from any device, and only you can see this list. A link's key is kept only in the browser that made it, so you can copy a link again only there."
              : "Private links open only for people you send them to. Links made before this list existed aren't here and can't be revoked; the list lives in this browser."}{" "}
            Delete and Revoke are under the ⋯ menu on each row.
          </p>
        </div>
      </div>
    </>
  );
}

function Pill({ pill }: { pill: SharePill | null }) {
  if (!pill) return <span className="sg-mshare-pill-none" />;
  return (
    <span className={`sg-mshare-pill sg-mshare-pill-${pill}`} data-gallery-pill={pill}>
      {PILL_LABEL[pill]}
    </span>
  );
}

function When({ at }: { at: number }) {
  return (
    <span className="sg-mshare-when" title={formatGalleryDate(at)}>
      {publishedAgo(at)}
    </span>
  );
}

function EntryRow({
  item,
  entry,
  onOpen,
  onCopy,
  onDelete,
}: {
  item: Extract<MineItem, { type: "entry" }>;
  entry: GalleryEntry | null;
  onOpen: (id: string) => void;
  onCopy: (id: string) => void;
  onDelete: (s: ShareRow, removed?: boolean) => void;
}) {
  const s = item.row;
  const rec = useEntryRecording(entry ?? { id: s.id, hasRecording: false });
  const removed = item.status === "missing";
  const size =
    s.kind === "project" && entry
      ? (contentsLine(rec) ?? `${entry.fileCount} ${entry.fileCount === 1 ? "file" : "files"}`)
      : null;
  return (
    <div
      className="sg-mshare-row"
      role="listitem"
      data-gallery-mine={s.id}
      data-gallery-status={item.status}
      data-gallery-home={s.home}
    >
      <div className="sg-mshare-pic">
        {entry ? <CardPicture entry={entry} rec={rec} /> : <GeneratedThumb id={s.id} title={s.title} label={null} />}
      </div>
      <div className="sg-mshare-text">
        <button type="button" className="sg-mshare-title" onClick={() => onOpen(s.id)}>
          {s.title}
        </button>
        <span>
          {KIND_LABEL[s.kind] ?? s.kind}
          {size ? ` · ${size}` : ""}
          {removed && <span className="sg-mshare-gone"> · no longer in the gallery</span>}
        </span>
      </div>
      <Pill pill={item.pill} />
      <When at={item.at} />
      <div className="sg-mshare-act">
        {removed ? (
          <button className="sg-btn sg-mshare-btn" onClick={() => onDelete(s, true)}>Forget</button>
        ) : (
          <button className="sg-btn sg-mshare-btn" onClick={() => onCopy(s.id)}>Copy link</button>
        )}
        <RowMenu
          label={s.title}
          items={[
            { label: "Open", onSelect: () => onOpen(s.id) },
            ...(removed ? [] : [{ label: "Delete", danger: true, onSelect: () => onDelete(s) }]),
          ]}
        />
      </div>
    </div>
  );
}

function LinkRowView({
  item,
  onCopy,
  onRevoke,
}: {
  item: Extract<MineItem, { type: "link" }>;
  onCopy: (l: LinkRow) => void;
  onRevoke: (l: LinkRow) => void;
}) {
  const l = item.row;
  return (
    <div className="sg-mshare-row" role="listitem" data-gallery-link={l.id} data-gallery-home={l.home}>
      <div className="sg-mshare-pic">
        <GeneratedThumb id={l.id} title={l.projectName} label={null} />
      </div>
      <div className="sg-mshare-text">
        <b className="sg-mshare-name">{l.projectName}</b>
        <span>Project · private link</span>
      </div>
      <Pill pill={item.pill} />
      <When at={item.at} />
      <div className="sg-mshare-act">
        {l.url ? (
          <button className="sg-btn sg-mshare-btn" onClick={() => onCopy(l)}>Copy link</button>
        ) : (
          <span className="sg-mshare-note" data-gallery-link-elsewhere>
            Made on another device. The link&apos;s key is only kept there.
          </span>
        )}
        <RowMenu label={l.projectName} items={[{ label: "Revoke", danger: true, onSelect: () => onRevoke(l) }]} />
      </div>
    </div>
  );
}

interface RowMenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * The ⋯ button and its menu. Opens below the button; closes on a pick, Escape
 * (focus goes back to the button), a press outside it, or Tab out. Arrow keys
 * move between the items.
 */
function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // The menu's Escape, not the gallery's (which would close the tab or overlay).
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const all = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (all.length === 0) return;
    e.preventDefault();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const n = all.length;
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
    all[next].focus();
  };

  return (
    <div className="sg-mshare-menuwrap" ref={wrapRef} onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={buttonRef}
        type="button"
        className="sg-mshare-more"
        aria-label={`More actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-gallery-more
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="sg-mshare-menu" role="menu" ref={menuRef} aria-label={`Actions for ${label}`}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={it.danger ? "sg-mshare-item sg-danger" : "sg-mshare-item"}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const MINE_CSS = `
.sg-mshare { display: flex; flex-direction: column; gap: 12px; }
.sg-mshare-list { container-type: inline-size; border: 1px solid var(--border-subtle); border-radius: 12px; }
.sg-mshare-head, .sg-mshare-row { display: grid; grid-template-columns: 112px minmax(0, 1fr) 170px 120px 210px; gap: 16px; align-items: center; padding: 10px 14px; }
.sg-mshare-head { color: var(--text-muted, var(--text-chrome)); font-size: 11.5px; letter-spacing: .02em; padding-top: 8px; padding-bottom: 8px; border-radius: 12px 12px 0 0; background: var(--bg-hover, rgba(255,255,255,.03)); }
.sg-mshare-row { border-top: 1px solid var(--border-subtle); }
.sg-mshare-row:hover { background: var(--bg-hover, rgba(255,255,255,.04)); }
.sg-mshare-pic { width: 112px; height: 44px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border-subtle); background: #111; }
.sg-mshare-pic > * { width: 100% !important; height: 100% !important; aspect-ratio: auto !important; }
.sg-mshare-pic > img, .sg-mshare-pic > canvas { display: block; }
.sg-mshare-pic .sg-initials { font-size: 15px; }
.sg-mshare-text { display: grid; gap: 2px; min-width: 0; }
.sg-mshare-text > span { color: var(--text-muted, var(--text-chrome)); font-size: 12.5px; }
.sg-mshare-title, .sg-mshare-name { justify-self: start; max-width: 100%; padding: 0; border: 0; background: none; font: inherit; font-size: 14px; font-weight: 600; color: var(--text-primary); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-mshare-title { cursor: pointer; }
.sg-mshare-title:hover { text-decoration: underline; }
.sg-mshare-gone { color: var(--text-error, #f27878); }
.sg-mshare-when { color: var(--text-chrome); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.sg-mshare-act { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
.sg-mshare-btn { padding: 5px 10px; font-size: 12.5px; }
.sg-mshare-note { font-size: 11.5px; color: var(--text-muted, var(--text-chrome)); text-align: right; max-width: 190px; }
.sg-mshare-pill { justify-self: start; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 500; border: 1px solid transparent; white-space: nowrap; }
.sg-mshare-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.sg-mshare-pill-gallery { color: #7fd6c2; background: rgba(127,214,194,.1); }
.sg-mshare-pill-private { color: #a9b4ff; background: rgba(138,138,255,.12); }
.sg-mshare-pill-browser { color: #ffc27a; border-color: rgba(255,194,122,.35); }
.sg-mshare-pill-removed { color: #ff9a9a; background: rgba(255,120,120,.1); }
.sg-mshare-menuwrap { position: relative; }
.sg-mshare-more { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg-hover, rgba(255,255,255,.06)); color: var(--text-chrome); cursor: pointer; }
.sg-mshare-more[aria-expanded="true"] { color: var(--text-primary); }
.sg-mshare-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 5; min-width: 140px; padding: 4px; display: grid; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg-elevated); box-shadow: 0 8px 24px rgba(0,0,0,.4); }
.sg-mshare-item { text-align: left; padding: 7px 10px; border: 0; border-radius: 6px; background: none; color: var(--text-primary); font-size: 13px; cursor: pointer; }
.sg-mshare-item:hover, .sg-mshare-item:focus-visible { background: var(--bg-hover, rgba(255,255,255,.08)); outline: none; }
.sg-mshare-colls { display: flex; flex-direction: column; gap: 8px; }
.sg-mshare-coll { display: flex; gap: 10px; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: 8px; }
.sg-mshare-foot { margin: 0; color: var(--text-muted, var(--text-chrome)); font-size: 12.5px; max-width: 80ch; line-height: 1.5; }
/* By the list's own width (#2492): a narrow tab stacks the status and date under the title. */
@container (max-width: 760px) {
  .sg-mshare-head { display: none; }
  .sg-mshare-row { grid-template-columns: 80px minmax(0, 1fr) auto; grid-template-areas: "pic text act" "pic meta act"; row-gap: 4px; }
  .sg-mshare-pic { grid-area: pic; width: 80px; }
  .sg-mshare-text { grid-area: text; }
  .sg-mshare-row > .sg-mshare-pill, .sg-mshare-row > .sg-mshare-pill-none { grid-area: meta; }
  .sg-mshare-when { display: none; }
  .sg-mshare-act { grid-area: act; }
}
`;
