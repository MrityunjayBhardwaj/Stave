/**
 * #2472 — where you are in the gallery, kept outside React.
 *
 * GalleryView draws the gallery; whatever holds it (the overlay today, a
 * workspace tab later, #2470) can unmount it at any time. A tab is unmounted
 * every time you switch away from it. So the part of the gallery that is "your
 * place" lives here, in a small store GalleryView reads with
 * useSyncExternalStore, and survives the view being unmounted and drawn again.
 *
 * In the store (it is your place, or it is what that place shows):
 *   - the chosen list tab and the search text;
 *   - the loaded list, the entry being shown, and the Back stack of what is
 *     open on top of the list (entries, profiles, collections);
 *   - My shares' inputs: this browser's shares and private links, its author
 *     id, and the signed-in account's shares;
 *   - the scroll position of the view showing, with the view it belongs to.
 *
 * Not in the store (it belongs to one moment, and must not come back when the
 * view is drawn again):
 *   - an open Report dialog: a dialog reappearing on return would be a dialog
 *     nobody opened, and while it is open it owns Esc;
 *   - "busy" while an entry is being opened: it is tied to the promise of one
 *     click, which the view that started it waits for;
 *   - what a profile, collection or the moderation tab loaded, and which file of
 *     an entry is selected: those components keep and refetch their own data.
 *
 * Freshness stays exactly as the overlay had it. `open()` is a fresh open: the
 * list is fetched again (the API's 30 s CDN cache is the server's business),
 * with this browser's recent changes laid over it (applyListChanges, the
 * 6-minute window in localShares.ts), the Back stack starts from the link's
 * view if any, and the saved scroll is dropped. `refreshLocal()` re-reads this
 * browser's shares and links and lays its changes over the loaded list again —
 * on every mount of the view, and on LOCAL_SHARES_CHANGED while it is mounted.
 * `loadAccount()` refetches the account's shares, showing what was loaded until
 * the answer comes. The session itself is session.ts's store, read as before.
 *
 * Who holds a store decides how long your place lasts: the overlay makes one
 * per mount (as its React state was), a tab host can keep one for the page.
 */
import { useSyncExternalStore } from "react";
import { fetchAccountShares, fetchGalleryEntry, fetchGalleryList, GalleryEntryRemoved } from "./client";
import { applyListChanges, listLocalShares, listPrivateLinks, loadAuthor, type LocalPrivateLink, type LocalShare } from "./localShares";
import type { GalleryEntry, GalleryEntryResponse, MySharesResponse } from "./types";
import { isKindTab, type GalleryLinkTarget, type GalleryTab } from "./galleryModel";

export type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: GalleryEntry[] };

/** #2321 — the signed-in account's shares; "off" when signed out. */
export type AccountState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: MySharesResponse };

export type DetailState =
  | { status: "loading"; id: string }
  | { status: "removed"; id: string }
  | { status: "error"; id: string; message: string }
  | { status: "ready"; id: string; data: GalleryEntryResponse };

/** A scroll offset, and the view (scrollKey) it was measured in. */
export interface SavedScroll {
  key: string;
  top: number;
}

export interface GalleryState {
  /** The list tab chosen (the view shows Projects instead when Moderation is chosen but you're not an admin). */
  tab: GalleryTab;
  query: string;
  list: ListState;
  detail: DetailState | null;
  /** What is open on top of the browse grid, innermost last; Back pops one. */
  stack: GalleryLinkTarget[];
  myAuthorId: string | null;
  mine: LocalShare[];
  links: LocalPrivateLink[];
  account: AccountState;
}

export interface GalleryStore {
  getState(): GalleryState;
  subscribe(listener: () => void): () => void;
  /** A fresh open: fetch the list again, re-read this browser's shares, start the Back stack from `first`, forget the scroll. */
  open(first: GalleryLinkTarget | null): void;
  setTab(tab: GalleryTab): void;
  setQuery(query: string): void;
  loadList(): void;
  /** (Re)load the entry `id` into the detail; switches the kind tab to the entry's kind. */
  openEntry(id: string): void;
  /** Open a view on top of what is showing. */
  push(view: GalleryLinkTarget): void;
  /** Pop one view; reloads the entry under it if the detail holds another. */
  back(): void;
  /** Re-read this browser's shares, links and author, and lay its recent changes over the loaded list. */
  refreshLocal(): void;
  /** The signed-in account's shares (`null`: signed out). */
  loadAccount(accountAuthorId: string | null): void;
  /** Remember the scroll of the view showing (kept apart from the state: nothing draws it). */
  saveScroll(key: string, top: number): void;
  /** The scroll last saved, if no navigation or fresh open has happened since. */
  savedScroll(): SavedScroll | null;
}

/** Which view a scroll offset belongs to: the top of the Back stack, at its depth. */
export function scrollKey(stack: readonly GalleryLinkTarget[]): string {
  const top = stack[stack.length - 1];
  return top ? `${stack.length}:${top.kind}:${top.id}` : "browse";
}

const initialState = (): GalleryState => ({
  tab: "project",
  query: "",
  list: { status: "loading" },
  detail: null,
  stack: [],
  myAuthorId: null,
  mine: [],
  links: [],
  account: { status: "off" },
});

export function createGalleryStore(): GalleryStore {
  let state = initialState();
  let scroll: SavedScroll | null = null;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<GalleryState> | ((s: GalleryState) => Partial<GalleryState>)) => {
    const next = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...next };
    for (const l of listeners) l();
  };

  const loadList = () => {
    set({ list: { status: "loading" } });
    fetchGalleryList()
      // #2433 — the list may be cached from before this browser's latest change.
      .then((r) => set({ list: { status: "ready", entries: applyListChanges(Array.isArray(r.entries) ? r.entries : []) } }))
      .catch((err: Error) => set({ list: { status: "error", message: err.message || "the gallery couldn't be loaded" } }));
  };

  const openEntry = (id: string) => {
    set({ detail: { status: "loading", id } });
    fetchGalleryEntry(id)
      .then((data) => {
        set((s) => ({
          detail: s.detail?.id === id ? { status: "ready", id, data } : s.detail,
          tab: isKindTab(s.tab) ? data.entry.kind : s.tab,
        }));
      })
      .catch((err: Error) => {
        set((s) => ({
          detail:
            s.detail?.id !== id
              ? s.detail
              : err instanceof GalleryEntryRemoved || err?.name === "GalleryEntryRemoved"
                ? { status: "removed", id }
                : { status: "error", id, message: err.message || "the entry couldn't be loaded" },
        }));
      });
  };

  const refreshLocal = () =>
    set((s) => ({
      mine: listLocalShares(),
      links: listPrivateLinks(),
      myAuthorId: loadAuthor()?.authorId ?? null,
      // #2433 — published, deleted, taken down or restored here: show it straight away.
      list: s.list.status === "ready" ? { ...s.list, entries: applyListChanges(s.list.entries) } : s.list,
    }));

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open(first) {
      loadList();
      refreshLocal();
      scroll = null;
      set({ stack: first ? [first] : [] });
      if (first?.kind === "entry") openEntry(first.id);
      else set({ detail: null });
    },
    setTab: (tab) => set({ tab }),
    setQuery: (query) => set({ query }),
    loadList,
    openEntry,
    push(view) {
      scroll = null;
      set((s) => ({ stack: [...s.stack, view] }));
      if (view.kind === "entry") openEntry(view.id);
    },
    back() {
      const next = state.stack.slice(0, -1);
      scroll = null;
      set({ stack: next });
      const t = next[next.length - 1];
      if (t?.kind === "entry" && state.detail?.id !== t.id) openEntry(t.id);
    },
    refreshLocal,
    loadAccount(accountAuthorId) {
      if (!accountAuthorId) {
        set({ account: { status: "off" } });
        return;
      }
      set((s) => ({ account: s.account.status === "ready" ? s.account : { status: "loading" } }));
      fetchAccountShares()
        .then((data) => set({ account: { status: "ready", data } }))
        .catch((err: Error) => set({ account: { status: "error", message: err.message || "your shares couldn't be loaded" } }));
    },
    saveScroll(key, top) {
      if (scroll?.key !== key || scroll.top !== top) scroll = { key, top };
    },
    savedScroll: () => scroll,
  };
}

/** Read a gallery store from a component. */
export function useGalleryStore(store: GalleryStore): GalleryState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
