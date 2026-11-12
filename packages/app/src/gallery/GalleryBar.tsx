"use client";

/**
 * The gallery's shared chrome.
 *
 * GalleryBar (#2486, #2492, #2493) — search, filter and sort, as one bar: the
 * browse grid draws it, My shares draws it with its own filters and orders, and
 * an artist's profile draws it over their work. One component, so every list in
 * the gallery is searched, filtered and sorted the same way.
 *
 * GalleryCrumbs (#2491, #2492, #2493) — "Gallery / … / here", the bar an entry,
 * My shares and a profile have in place of the gallery's header.
 *
 * The filter is a radio group: one Tab stop, ← → (and Home / End) pick. Its
 * counts follow the search. Which data attribute each part carries is the
 * caller's (`hooks`), so two bars never answer the same selector.
 */
import React from "react";

export interface BarOption<T extends string> {
  id: T;
  label: string;
}

export interface GalleryBarProps<F extends string, S extends string> {
  /** The bar's own data attribute (`data-gallery-browsebar`, `data-gallery-minebar`). */
  barHook: string;
  /** The filter buttons' and sort's data attributes (`data-gallery-filter`, `data-gallery-sort`). */
  filterHook: string;
  sortHook: string;
  searchRef?: React.Ref<HTMLInputElement>;
  placeholder: string;
  searchLabel: string;
  query: string;
  onQuery: (query: string) => void;
  filters: ReadonlyArray<BarOption<F>>;
  filter: F;
  onFilter: (filter: F) => void;
  /** Each filter's count for this search; absent while the list loads. */
  counts: Record<F, number> | null;
  sorts: ReadonlyArray<BarOption<S>>;
  sort: S;
  onSort: (sort: S) => void;
}

export function GalleryBar<F extends string, S extends string>(props: GalleryBarProps<F, S>) {
  const { filters, filter, onFilter, sorts, sort, onSort, counts } = props;

  const moveFilter = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = filters.findIndex((f) => f.id === filter);
    const n = filters.length;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % n
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const id = filters[next].id;
    onFilter(id);
    e.currentTarget.querySelector<HTMLElement>(`[${props.filterHook}="${id}"]`)?.focus();
  };

  return (
    <div className="sg-browsebar" {...{ [props.barHook]: "" }}>
      <label className="sg-searchbox">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={props.searchRef}
          className="sg-search"
          type="search"
          placeholder={props.placeholder}
          aria-label={props.searchLabel}
          aria-keyshortcuts="/"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
        />
        <kbd className="sg-search-key" aria-hidden="true">/</kbd>
      </label>
      <div className="sg-filterrow">
        <div className="sg-filters" role="radiogroup" aria-label="Show" onKeyDown={moveFilter}>
          {filters.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={filter === f.id}
              tabIndex={filter === f.id ? 0 : -1}
              {...{ [props.filterHook]: f.id }}
              className={filter === f.id ? "sg-filter sg-filter-on" : "sg-filter"}
              onClick={() => onFilter(f.id)}
            >
              {f.label}
              {counts ? <span className="sg-count" data-gallery-filter-count>{counts[f.id]}</span> : null}
            </button>
          ))}
        </div>
        <label className="sg-sortlabel">
          <span className="sg-sortword">Sort by</span>
          <select
            className="sg-sort"
            {...{ [props.sortHook]: "" }}
            aria-label="Sort by"
            value={sort}
            onChange={(e) => {
              const picked = sorts.find((o) => o.id === e.target.value);
              if (picked) onSort(picked.id);
            }}
          >
            {sorts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

export interface GalleryCrumbsProps {
  /** "← Back", when there is something under this view to go back to. */
  backLabel?: string | null;
  onBack?: () => void;
  /** The "Gallery" crumb: back to the grid. */
  onHome: () => void;
  /** Crumbs between "Gallery" and this page (an entry's kind). */
  middle?: ReadonlyArray<{ label: string; hook: string; onClick: () => void }>;
  /** This page's name. */
  here: string;
  /** The ×, where the container can close. */
  onClose?: () => void;
}

export function GalleryCrumbs({ backLabel, onBack, onHome, middle = [], here, onClose }: GalleryCrumbsProps) {
  return (
    <nav className="sg-crumbs" aria-label="Where you are">
      {backLabel && onBack && (
        <button className="sg-btn sg-crumb-back" onClick={onBack}>
          {backLabel}
        </button>
      )}
      {/* data-gallery-browse: the way back to the grid, as the old Back button was. */}
      <button className="sg-crumb" data-gallery-crumb="gallery" data-gallery-browse onClick={onHome}>
        Gallery
      </button>
      {middle.map((m) => (
        <React.Fragment key={m.hook}>
          <span className="sg-crumb-sep" aria-hidden="true">/</span>
          <button className="sg-crumb" data-gallery-crumb={m.hook} onClick={m.onClick}>
            {m.label}
          </button>
        </React.Fragment>
      ))}
      <span className="sg-crumb-sep" aria-hidden="true">/</span>
      <span className="sg-crumb-here" aria-current="page">{here}</span>
      {onClose && (
        <button className="sg-close sg-crumb-close" aria-label="Close gallery" onClick={onClose}>
          ×
        </button>
      )}
    </nav>
  );
}

export const BAR_CSS = `
.sg-crumbs { display: flex; align-items: center; gap: 8px; padding: 12px 24px; border-bottom: 1px solid var(--border-subtle); font-size: 13px; color: var(--text-muted, var(--text-chrome)); position: sticky; top: 0; z-index: 2; background: var(--bg-elevated); }
.sg-crumb { background: none; border: 0; padding: 0; color: var(--text-chrome); cursor: pointer; font: inherit; }
.sg-crumb:hover { color: var(--text-primary); text-decoration: underline; }
.sg-crumb-sep { opacity: .6; }
.sg-crumb-here { color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sg-crumb-back { padding: 3px 8px; font-size: 12px; margin-right: 4px; }
.sg-crumb-close { margin-left: auto; }
.sg-browsebar { container-type: inline-size; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 0 20px 12px; border-bottom: 1px solid var(--border-subtle); }
.sg-searchbox { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--bg-input, var(--bg-elevated)); color: var(--text-muted, var(--text-chrome)); cursor: text; }
.sg-searchbox:focus-within { border-color: var(--accent, #4a6cf7); }
.sg-search { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: none; background: none; color: var(--text-primary); font-size: 14px; }
.sg-search-key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--border-strong); }
/* One row at every width (#2486): the filter scrolls sideways before the sort is pushed under it. */
.sg-filterrow { display: flex; align-items: center; gap: 8px 12px; }
.sg-filters { display: inline-flex; flex: 0 1 auto; min-width: 0; gap: 2px; padding: 3px; border-radius: 10px; border: 1px solid var(--border-subtle); background: var(--bg-hover, rgba(255,255,255,.03)); overflow-x: auto; scrollbar-width: none; }
.sg-filter { height: 30px; padding: 0 12px; border: 0; border-radius: 7px; background: none; color: var(--text-chrome); cursor: pointer; font-size: 13px; display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
.sg-filter:hover { color: var(--text-primary); }
.sg-filter-on { background: var(--bg-elevated); color: var(--text-primary); font-weight: 600; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.sg-sortlabel { flex: none; margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted, var(--text-chrome)); }
.sg-sort { height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg-input, var(--bg-elevated)); color: var(--text-primary); font-size: 13px; cursor: pointer; }
@media (hover: none) { .sg-search-key { display: none; } }
/* By the bar's own width, not the screen's: a gallery tab can be narrow on a wide screen. */
@container (max-width: 520px) {
  .sg-sortword { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .sg-filter { padding: 0 9px; }
  /* As the phone mockup: no counts, so all the filters fit beside the sort. */
  .sg-filter .sg-count { display: none; }
}
@media (max-width: 640px) {
  .sg-browsebar { padding: 0 12px 10px; gap: 10px; }
  .sg-filter { padding: 0 10px; }
}
`;
