// @vitest-environment jsdom
/**
 * #2433 — what this browser just changed in the public list stays visible while
 * a cached list catches up, for as long as a cached list can be out of date.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { LIST_CACHE } from "../../app/api/gallery/route";
import { applyListChanges, LIST_CHANGE_WINDOW_MS, LOCAL_SHARES_CHANGED, recordListChange } from "../localShares";
import type { GalleryEntry } from "../types";

const entry = (id: string, title = `Entry ${id}`): GalleryEntry => ({
  id,
  title,
  kind: "music",
  tags: [],
  authorName: "Ada",
  publishedAt: 1,
  fileCount: 1,
  hasThumbnail: false,
});
const ids = (list: GalleryEntry[]) => list.map((e) => e.id);
const T = 1_000_000;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("applyListChanges", () => {
  it("leaves the list alone when this browser changed nothing", () => {
    expect(ids(applyListChanges([entry("a"), entry("b")], T))).toEqual(["a", "b"]);
  });

  it("adds a new entry to a list from before it was published", () => {
    recordListChange("new", entry("new"), T);
    expect(ids(applyListChanges([entry("a")], T + 1))).toEqual(["new", "a"]);
  });

  it("shows an entry once, as the list has it, when the list has caught up", () => {
    recordListChange("new", entry("new", "As published"), T);
    const out = applyListChanges([entry("new", "As the list has it")], T + 1);
    expect(out.map((e) => e.title)).toEqual(["As the list has it"]);
  });

  it("hides a removed entry from a list that still has it", () => {
    recordListChange("gone", null, T);
    expect(ids(applyListChanges([entry("gone"), entry("a")], T + 1))).toEqual(["a"]);
  });

  it("the latest change to an entry wins, in both orders", () => {
    recordListChange("x", null, T);
    recordListChange("x", entry("x"), T + 1);
    expect(ids(applyListChanges([], T + 2))).toEqual(["x"]);
    recordListChange("x", null, T + 3);
    expect(ids(applyListChanges([entry("x")], T + 4))).toEqual([]);
  });

  it("stops overriding the list once the window has passed", () => {
    recordListChange("new", entry("new"), T);
    recordListChange("gone", null, T);
    const justInside = T + LIST_CHANGE_WINDOW_MS - 1;
    expect(ids(applyListChanges([entry("gone")], justInside))).toEqual(["new"]);
    const after = T + LIST_CHANGE_WINDOW_MS;
    expect(ids(applyListChanges([entry("gone")], after))).toEqual(["gone"]);
  });

  it("the window outlasts the longest a cached list can be served", () => {
    const seconds = (name: string) => Number(new RegExp(`${name}=(\\d+)`).exec(LIST_CACHE)?.[1]);
    const longest = seconds("s-maxage") + seconds("stale-while-revalidate");
    expect(longest).toBeGreaterThan(0);
    expect(LIST_CHANGE_WINDOW_MS).toBeGreaterThanOrEqual(longest * 1000);
  });

  it("ignores stored changes it can't read", () => {
    localStorage.setItem("stave.gallery.listChanges", "not json");
    expect(ids(applyListChanges([entry("a")], T))).toEqual(["a"]);
    localStorage.setItem("stave.gallery.listChanges", JSON.stringify({ not: "a list" }));
    expect(ids(applyListChanges([entry("a")], T))).toEqual(["a"]);
  });
});

describe("recordListChange", () => {
  it("tells an open gallery, and drops changes past the window", () => {
    const heard = vi.fn();
    window.addEventListener(LOCAL_SHARES_CHANGED, heard);
    recordListChange("old", entry("old"), T);
    recordListChange("new", entry("new"), T + LIST_CHANGE_WINDOW_MS);
    window.removeEventListener(LOCAL_SHARES_CHANGED, heard);
    expect(heard).toHaveBeenCalledTimes(2);
    const stored = JSON.parse(localStorage.getItem("stave.gallery.listChanges") ?? "[]") as Array<{ id: string }>;
    expect(stored.map((c) => c.id)).toEqual(["new"]);
  });

  it("doesn't throw when storage refuses: the server's answer still stands", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => recordListChange("new", entry("new"), T)).not.toThrow();
  });
});
