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
 *   - the view (browse, My shares, Moderation), and the browse grid's filter,
 *     sort and search text (#2486), and My shares' own (#2492);
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
import { MAX_LISTED_ENTRIES, type GalleryEntry, type GalleryEntryResponse, type MySharesResponse } from "./types";
import type {
  GalleryFilter,
  GalleryLinkTarget,
  GallerySort,
  GalleryTab,
  MineFilter,
  MineSort,
  ProfileSort,
} from "./galleryModel";

export type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      entries: GalleryEntry[];
      /**
       * #2519 — the server's answer was as long as a listing gets
       * (MAX_LISTED_ENTRIES), so older entries may simply not be in it. Read
       * from the answer itself, before this browser's changes are laid over it.
       */
      full: boolean;
    };

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

/**
 * #2493 — a profile's search, filter and order, for the profile at one place in
 * the Back stack (`key`, profileListKey). Kept here so it survives opening one of
 * their entries and coming Back; another profile, the same one opened again
 * further up the stack, or any fresh open or change of view starts fresh. Not
 * saved with the tab across reloads.
 */
export interface ProfileList {
  key: string;
  filter: GalleryFilter;
  sort: ProfileSort;
  query: string;
}

export const PROFILE_LIST_START: Omit<ProfileList, "key"> = { filter: "all", sort: "newest", query: "" };

/** Which profile view a ProfileList belongs to: its depth in the Back stack, and the author. */
export function profileListKey(depth: number, authorId: string): string {
  return `${depth}:${authorId}`;
}

export interface GalleryState {
  /** The view chosen (browse is shown instead when Moderation is chosen but you're not an admin). */
  tab: GalleryTab;
  /** #2486 — the browse grid's filter, order and search. */
  filter: GalleryFilter;
  sort: GallerySort;
  query: string;
  /** #2492 — My shares' filter, order and search: a list of its own, kept apart from the grid's. */
  mineFilter: MineFilter;
  mineSort: MineSort;
  mineQuery: string;
  list: ListState;
  detail: DetailState | null;
  /** What is open on top of the browse grid, innermost last; Back pops one. */
  stack: GalleryLinkTarget[];
  /** #2493 — the open profile's search, filter and order (ProfileList). */
  profileList: ProfileList | null;
  /** #2493 — the open profile's name once it has loaded, for the tab's label. */
  profileName: { id: string; name: string } | null;
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
  /**
   * #2473 — come back to a place saved earlier (a gallery tab restored after a
   * reload): fetch the list, re-read this browser's shares, and put back the
   * view, the grid's filter, sort and search, and the whole Back stack. Like
   * `open`, a fresh start for the data.
   */
  resume(place: GalleryResumePlace): void;
  /**
   * #2497 — has `open` or `resume` run on this store yet? For the store a page
   * keeps (`galleryTabStore`), that is "opened since the page loaded": a gallery
   * tab restored after a reload resumes its saved place only while this is false,
   * so it never draws over a real open (the menu, a link, the phone overlay).
   */
  started(): boolean;
  /** Show browse, My shares or Moderation; closes whatever was open on top (the Back stack empties). */
  setTab(tab: GalleryTab): void;
  setFilter(filter: GalleryFilter): void;
  setSort(sort: GallerySort): void;
  setQuery(query: string): void;
  setMineFilter(filter: MineFilter): void;
  setMineSort(sort: MineSort): void;
  setMineQuery(query: string): void;
  /** #2493 — change the search, filter or order of the profile at `key`. */
  setProfileList(key: string, patch: Partial<Omit<ProfileList, "key">>): void;
  /** #2493 — the profile `id` loaded, and is called `name`. */
  setProfileName(id: string, name: string): void;
  loadList(): void;
  /** (Re)load the entry `id` into the detail. */
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

/** What `resume` puts back. */
export interface GalleryResumePlace {
  tab: GalleryTab;
  filter: GalleryFilter;
  sort: GallerySort;
  query: string;
  mineFilter: MineFilter;
  mineSort: MineSort;
  mineQuery: string;
  stack: readonly GalleryLinkTarget[];
}

/** Which view a scroll offset belongs to: the top of the Back stack, at its depth. */
export function scrollKey(stack: readonly GalleryLinkTarget[]): string {
  const top = stack[stack.length - 1];
  return top ? `${stack.length}:${top.kind}:${top.id}` : "browse";
}

const initialState = (): GalleryState => ({
  tab: "browse",
  filter: "all",
  sort: "newest",
  query: "",
  mineFilter: "all",
  mineSort: "newest",
  mineQuery: "",
  list: { status: "loading" },
  detail: null,
  stack: [],
  profileList: null,
  profileName: null,
  myAuthorId: null,
  mine: [],
  links: [],
  account: { status: "off" },
});

export function createGalleryStore(): GalleryStore {
  let state = initialState();
  let scroll: SavedScroll | null = null;
  let started = false;
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
      .then((r) => {
        const got = Array.isArray(r.entries) ? r.entries : [];
        set({ list: { status: "ready", entries: applyListChanges(got), full: got.length >= MAX_LISTED_ENTRIES } });
      })
      .catch((err: Error) => set({ list: { status: "error", message: err.message || "the gallery couldn't be loaded" } }));
  };

  const openEntry = (id: string) => {
    set({ detail: { status: "loading", id } });
    fetchGalleryEntry(id)
      .then((data) => {
        set((s) => ({ detail: s.detail?.id === id ? { status: "ready", id, data } : s.detail }));
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
      started = true;
      loadList();
      refreshLocal();
      scroll = null;
      set({ stack: first ? [first] : [], profileList: null });
      if (first?.kind === "entry") openEntry(first.id);
      else set({ detail: null });
    },
    resume(place) {
      started = true;
      loadList();
      refreshLocal();
      scroll = null;
      const { tab, filter, sort, query, mineFilter, mineSort, mineQuery } = place;
      set({ tab, filter, sort, query, mineFilter, mineSort, mineQuery, stack: [...place.stack], profileList: null });
      const top = place.stack[place.stack.length - 1];
      if (top?.kind === "entry") openEntry(top.id);
      else set({ detail: null });
    },
    started: () => started,
    setTab(tab) {
      // A view of its own: whatever was open on top of the grid closes.
      scroll = null;
      set({ tab, stack: [], detail: null, profileList: null });
    },
    setFilter: (filter) => set({ filter }),
    setSort: (sort) => set({ sort }),
    setQuery: (query) => set({ query }),
    setMineFilter: (mineFilter) => set({ mineFilter }),
    setMineSort: (mineSort) => set({ mineSort }),
    setMineQuery: (mineQuery) => set({ mineQuery }),
    setProfileList: (key, patch) =>
      set((s) => ({
        profileList: { ...(s.profileList?.key === key ? s.profileList : { key, ...PROFILE_LIST_START }), ...patch },
      })),
    setProfileName: (id, name) =>
      set((s) => (s.profileName?.id === id && s.profileName.name === name ? {} : { profileName: { id, name } })),
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
