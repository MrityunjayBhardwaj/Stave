"use client";

/**
 * #2473 — the community gallery as a workspace tab (epic #2470).
 *
 * The workspace shell draws an app tab's body only while it is its group's
 * active tab, so switching away unmounts it. Where you are in the gallery lives
 * in ONE store for the page (`galleryTabStore`), outside React: coming back to
 * the tab shows the same place without fetching again. A fresh fetch happens
 * only on a real open (the menu, a link, My Profile…, `GalleryHost.show`) or
 * when a tab restored after a reload is first drawn (`resume`).
 *
 * The tab also carries a small copy of the place (view, the grid's filter, sort
 * and search, My shares' own, Back stack, and the entry's title once known) as its shell state,
 * so the layout remembers it across reloads. It is written only when that place
 * changes — every write re-fires the shell's onActiveTabChange — and a change of
 * the search alone waits until typing pauses (SEARCH_WRITE_DELAY_MS).
 */
import React, { useEffect, useRef } from "react";
import type { AppTabLabel, AppTabState, WorkspaceTab } from "@stave/editor";
import { createGalleryStore, type GalleryState, type GalleryStore } from "./galleryStore";
import { GalleryView } from "./GalleryView";
import {
  GALLERY_AUTHOR_HASH_PREFIX,
  GALLERY_COLLECTION_HASH_PREFIX,
  GALLERY_HASH_PREFIX,
  isGalleryFilter,
  isGallerySort,
  isGalleryTab,
  isMineFilter,
  isMineSort,
  readGalleryLink,
  type GalleryFilter,
  type GalleryLinkTarget,
  type GallerySort,
  type GalleryTab,
  type MineFilter,
  type MineSort,
} from "./galleryModel";
import type { GalleryEntry, GalleryEntryResponse } from "./types";
import type { GalleryEntryActions } from "./GalleryHost";
import type { AppTabDefinition } from "../components/appTabs";

/** The gallery's key among the shell's app tabs. */
export const GALLERY_APP_KEY = "gallery";

/** Where you are in the gallery, for the whole page: the tab and the phone overlay share it. */
export const galleryTabStore: GalleryStore = createGalleryStore();

/** Has the store been opened (or resumed) since the page loaded? */
let started = false;

/** A real open: fetch again and start from `first`. */
export function openGalleryStore(store: GalleryStore, first: GalleryLinkTarget | null): void {
  started = true;
  store.open(first);
}

/** The place a gallery tab carries in the shell's layout (persisted). */
export interface GalleryPlace {
  tab: GalleryTab;
  /** #2486 — the browse grid's filter, order and search. */
  filter: GalleryFilter;
  sort: GallerySort;
  query: string;
  /** #2492 — My shares' filter, order and search. */
  mineFilter: MineFilter;
  mineSort: MineSort;
  mineQuery: string;
  stack: GalleryLinkTarget[];
  /** The open entry's title, once it has loaded — the tab's label. */
  title?: string;
}

/** The place the store is at now. */
export function placeOf(s: GalleryState): GalleryPlace {
  const top = s.stack[s.stack.length - 1];
  const title =
    top?.kind === "entry" && s.detail?.status === "ready" && s.detail.id === top.id
      ? s.detail.data.entry.title
      : undefined;
  return {
    tab: s.tab,
    filter: s.filter,
    sort: s.sort,
    query: s.query,
    mineFilter: s.mineFilter,
    mineSort: s.mineSort,
    mineQuery: s.mineQuery,
    stack: s.stack,
    ...(title ? { title } : {}),
  };
}

/** Where a fresh gallery starts. */
export const START_PLACE: GalleryPlace = {
  tab: "browse",
  filter: "all",
  sort: "newest",
  query: "",
  mineFilter: "all",
  mineSort: "newest",
  mineQuery: "",
  stack: [],
};

/** A saved search longer than this wasn't typed into the box; drop it. */
const MAX_QUERY = 200;
/** How long the search must sit still before the tab's saved copy is written. */
export const SEARCH_WRITE_DELAY_MS = 400;
const LINK_PREFIX = {
  entry: GALLERY_HASH_PREFIX,
  author: GALLERY_AUTHOR_HASH_PREFIX,
  collection: GALLERY_COLLECTION_HASH_PREFIX,
} as const;
/** Back stacks deeper than this aren't a place anyone walked to; keep the innermost. */
const MAX_STACK = 32;

/**
 * Read a tab's saved place back. It comes from localStorage, so it is checked
 * the way a link is: each view must pass `readGalleryLink`, the same gate a
 * pasted `#gallery…` link goes through, so a crafted value never reaches a fetch.
 */
export function readPlace(state: AppTabState | undefined): GalleryPlace | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const o = state as { [key: string]: AppTabState };
  // A place saved before #2486 names a kind as its tab ("project", "music", "viz"): it opens on All.
  const tab = isGalleryTab(o.tab) ? o.tab : START_PLACE.tab;
  const filter = isGalleryFilter(o.filter) ? o.filter : START_PLACE.filter;
  const sort = isGallerySort(o.sort) ? o.sort : START_PLACE.sort;
  const query = readQuery(o.query, START_PLACE.query);
  // #2492 — a place saved before My shares had its own list opens it on All, newest first.
  const mineFilter = isMineFilter(o.mineFilter) ? o.mineFilter : START_PLACE.mineFilter;
  const mineSort = isMineSort(o.mineSort) ? o.mineSort : START_PLACE.mineSort;
  const mineQuery = readQuery(o.mineQuery, START_PLACE.mineQuery);
  const stack: GalleryLinkTarget[] = [];
  if (Array.isArray(o.stack)) {
    for (const v of o.stack.slice(-MAX_STACK)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const { kind, id } = v as { [key: string]: AppTabState };
      if (typeof id !== "string" || (kind !== "entry" && kind !== "author" && kind !== "collection")) continue;
      const read = readGalleryLink(LINK_PREFIX[kind] + encodeURIComponent(id));
      if (read && read !== "invalid" && read.kind === kind) stack.push(read);
    }
  }
  const title = typeof o.title === "string" && o.title ? o.title : undefined;
  return { tab, filter, sort, query, mineFilter, mineSort, mineQuery, stack, ...(title ? { title } : {}) };
}

/** A saved search, or `fallback` when it isn't one somebody typed. */
function readQuery(v: AppTabState | undefined, fallback: string): string {
  return typeof v === "string" && v.length <= MAX_QUERY ? v : fallback;
}

/** A gallery place as the shell stores it (plain JSON). */
export function placeTabState(place: GalleryPlace): AppTabState {
  return JSON.parse(JSON.stringify(place)) as AppTabState;
}

/** Same place? (What decides whether the shell's copy needs writing.) */
function samePlace(a: GalleryPlace, b: GalleryPlace): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Do two places differ only in a search text (the grid's or My shares')? */
function onlySearchDiffers(a: GalleryPlace, b: GalleryPlace): boolean {
  const blank = (p: GalleryPlace): GalleryPlace => ({ ...p, query: "", mineQuery: "" });
  return (a.query !== b.query || a.mineQuery !== b.mineQuery) && samePlace(blank(a), blank(b));
}

/** What the tab says for a view with nothing open on top of it. */
const VIEW_LABEL: Record<GalleryTab, string | null> = { browse: null, mine: "My shares", moderation: "Moderation" };

/** The tab's label: where you are. */
export function galleryTabLabel(tab: WorkspaceTab & { kind: "app" }): AppTabLabel {
  const place = readPlace(tab.state);
  const top = place?.stack[place.stack.length - 1];
  const where = !top
    ? VIEW_LABEL[place?.tab ?? "browse"]
    : top.kind === "entry"
      ? (place?.title ?? null)
      : top.kind === "author"
        ? "Profile"
        : "Collection";
  return { title: where ? `Gallery · ${where}` : "Gallery", icon: GALLERY_ICON };
}

/** A small grid glyph (four tiles), drawn in the tab's text colour. */
export const GALLERY_ICON = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false" data-gallery-tab-icon>
    <rect x="1" y="1" width="4" height="4" rx="1" fill="currentColor" />
    <rect x="7" y="1" width="4" height="4" rx="1" fill="currentColor" opacity="0.7" />
    <rect x="1" y="7" width="4" height="4" rx="1" fill="currentColor" opacity="0.7" />
    <rect x="7" y="7" width="4" height="4" rx="1" fill="currentColor" />
  </svg>
);

export interface GalleryTabBodyProps {
  tab: WorkspaceTab & { kind: "app" };
  onOpenAsProject: (entry: GalleryEntry, manifest: GalleryEntryResponse["manifest"]) => Promise<boolean>;
  onAddToProject: (entry: GalleryEntry, manifest: GalleryEntryResponse["manifest"]) => Promise<boolean>;
  onPublish?: () => void;
  /** Write the place into the tab's shell state (`setAppTabState`). */
  onPlaceChange: (place: GalleryPlace) => void;
  /** Defaults to the page's store. */
  store?: GalleryStore;
}

/** The gallery tab's body. Drawn again on every return to the tab; never fetches by itself except to resume. */
export function GalleryTabBody({
  tab,
  onOpenAsProject,
  onAddToProject,
  onPublish,
  onPlaceChange,
  store = galleryTabStore,
}: GalleryTabBodyProps) {
  // A tab restored after a reload: nothing has opened the store on this page yet.
  // Before the view's own mount effects, so it never draws the empty start.
  const resumedRef = useRef(false);
  if (!started && !resumedRef.current) {
    resumedRef.current = true;
    started = true;
    const place = readPlace(tab.state);
    store.resume(place ?? START_PLACE);
  }

  // Keep the shell's copy of the place up to date — only when the place itself changes.
  const placeChange = useRef(onPlaceChange);
  placeChange.current = onPlaceChange;
  const savedRef = useRef<GalleryPlace | null>(readPlace(tab.state));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: GalleryPlace | null = null;
    const write = (place: GalleryPlace) => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      savedRef.current = place;
      placeChange.current(place);
    };
    const sync = () => {
      const place = placeOf(store.getState());
      const saved = savedRef.current;
      if (saved && samePlace(saved, place)) {
        // Typed and then deleted back to what is saved: nothing left to write.
        if (timer) clearTimeout(timer);
        timer = null;
        pending = null;
        return;
      }
      // #2486 — each keystroke in the search would rewrite the layout; wait for a pause.
      if (saved && onlySearchDiffers(saved, place)) {
        pending = place;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => pending && write(pending), SEARCH_WRITE_DELAY_MS);
        return;
      }
      write(place);
    };
    sync();
    const unsubscribe = store.subscribe(sync);
    return () => {
      unsubscribe();
      // Leaving the tab mid-typing still keeps what was typed.
      if (pending) write(pending);
    };
  }, [store]);

  return (
    <div className="sg-tabhost" data-gallery="tab">
      <style>{CSS}</style>
      <GalleryView store={store} onOpenAsProject={onOpenAsProject} onAddToProject={onAddToProject} onPublish={onPublish} />
    </div>
  );
}

/** The gallery's entry in the app's table of workspace tabs (components/appTabs.ts). */
export function galleryAppTab({ actions, onPublish }: { actions: GalleryEntryActions; onPublish?: () => void }): AppTabDefinition {
  return {
    key: GALLERY_APP_KEY,
    label: galleryTabLabel,
    render: (tab, ctx) => (
      <GalleryTabBody
        tab={tab}
        onOpenAsProject={actions.openAsProject}
        onAddToProject={actions.addToProject}
        onPublish={onPublish}
        onPlaceChange={(place) => ctx.setState(placeTabState(place))}
      />
    ),
  };
}

/** Test seam: forget that the page's store was opened. */
export function resetGalleryTabForTests(): void {
  started = false;
}

const CSS = `
.sg-tabhost { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--bg-elevated); color: var(--text-chrome); font-family: system-ui, -apple-system, sans-serif; overflow: hidden; }
`;
