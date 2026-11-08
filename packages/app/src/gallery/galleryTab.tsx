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
 * The tab also carries a small copy of the place (list tab, Back stack, and the
 * entry's title once known) as its shell state, so the layout remembers it
 * across reloads. It is written only when that place changes — every write
 * re-fires the shell's onActiveTabChange.
 */
import React, { useEffect, useRef } from "react";
import type { AppTabLabel, AppTabState, WorkspaceTab } from "@stave/editor";
import { createGalleryStore, type GalleryState, type GalleryStore } from "./galleryStore";
import { GalleryView } from "./GalleryView";
import {
  GALLERY_AUTHOR_HASH_PREFIX,
  GALLERY_COLLECTION_HASH_PREFIX,
  GALLERY_HASH_PREFIX,
  GALLERY_TABS,
  MODERATION_TAB,
  readGalleryLink,
  type GalleryLinkTarget,
  type GalleryTab,
} from "./galleryModel";
import type { GalleryEntry, GalleryEntryResponse } from "./types";

/** The gallery's key among the shell's app tabs. */
export const GALLERY_APP_KEY = "gallery";
/** What the app passes to `loadShellState` so a restored gallery tab is kept. */
export const GALLERY_APP_KEYS: ReadonlySet<string> = new Set([GALLERY_APP_KEY]);

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
  return { tab: s.tab, stack: s.stack, ...(title ? { title } : {}) };
}

const LIST_TABS: ReadonlySet<string> = new Set([...GALLERY_TABS.map((t) => t.id), MODERATION_TAB.id]);
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
  const tab = typeof o.tab === "string" && LIST_TABS.has(o.tab) ? (o.tab as GalleryTab) : "project";
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
  return { tab, stack, ...(title ? { title } : {}) };
}

/** Same place? (What decides whether the shell's copy needs writing.) */
function samePlace(a: GalleryPlace, b: GalleryPlace): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The tab's label: where you are. */
export function galleryTabLabel(tab: WorkspaceTab & { kind: "app" }): AppTabLabel | undefined {
  if (tab.appKey !== GALLERY_APP_KEY) return undefined;
  const place = readPlace(tab.state);
  const top = place?.stack[place.stack.length - 1];
  const where =
    !top ? null : top.kind === "entry" ? (place?.title ?? null) : top.kind === "author" ? "Profile" : "Collection";
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
    store.resume(place ?? { tab: "project", stack: [] });
  }

  // Keep the shell's copy of the place up to date — only when the place itself changes.
  const placeChange = useRef(onPlaceChange);
  placeChange.current = onPlaceChange;
  const savedRef = useRef<GalleryPlace | null>(readPlace(tab.state));
  useEffect(() => {
    const sync = () => {
      const place = placeOf(store.getState());
      if (savedRef.current && samePlace(savedRef.current, place)) return;
      savedRef.current = place;
      placeChange.current(place);
    };
    sync();
    return store.subscribe(sync);
  }, [store]);

  return (
    <div className="sg-tabhost" data-gallery="tab">
      <style>{CSS}</style>
      <GalleryView store={store} onOpenAsProject={onOpenAsProject} onAddToProject={onAddToProject} onPublish={onPublish} />
    </div>
  );
}

/** Test seam: forget that the page's store was opened. */
export function resetGalleryTabForTests(): void {
  started = false;
}

const CSS = `
.sg-tabhost { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--bg-elevated); color: var(--text-chrome); font-family: system-ui, -apple-system, sans-serif; overflow: hidden; }
`;
