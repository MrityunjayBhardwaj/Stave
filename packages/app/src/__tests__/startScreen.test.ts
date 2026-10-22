// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  START_SCREEN_PREF_KEY,
  openedAgo,
  setStartScreenWanted,
  showsStartScreen,
  startScreenWanted,
} from "../startScreen";

const arrival = { wanted: true, shareLink: false, automated: false, requested: false };

describe("the start screen — when it shows (#2019)", () => {
  it("greets an ordinary arrival", () => {
    expect(showsStartScreen(arrival)).toBe(true);
  });

  it("stays away when the person said not to show it", () => {
    expect(showsStartScreen({ ...arrival, wanted: false })).toBe(false);
  });

  it("stays away from a share link, whatever else is true", () => {
    expect(showsStartScreen({ ...arrival, shareLink: true })).toBe(false);
    expect(showsStartScreen({ ...arrival, shareLink: true, automated: true, requested: true })).toBe(false);
  });

  it("stays away from a browser driven by a program, unless the program asks for it", () => {
    expect(showsStartScreen({ ...arrival, automated: true })).toBe(false);
    expect(showsStartScreen({ ...arrival, automated: true, requested: true })).toBe(true);
  });

  it("a program that asks gets it even where the person turned it off", () => {
    expect(showsStartScreen({ wanted: false, shareLink: false, automated: true, requested: true })).toBe(true);
  });

  it("asking means nothing in a browser no program is driving", () => {
    expect(showsStartScreen({ wanted: false, shareLink: false, automated: false, requested: true })).toBe(false);
  });
});

describe("the start screen — the remembered choice (#2019)", () => {
  // this environment's own localStorage does not store, so give it one that does
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is on until someone turns it off", () => {
    expect(startScreenWanted()).toBe(true);
  });

  it("remembers off, and on again", () => {
    setStartScreenWanted(false);
    expect(store.get(START_SCREEN_PREF_KEY)).toBe("false");
    expect(startScreenWanted()).toBe(false);
    setStartScreenWanted(true);
    expect(startScreenWanted()).toBe(true);
  });

  it("a browser that refuses storage still shows the screen and does not throw", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    });
    expect(startScreenWanted()).toBe(true);
    expect(() => setStartScreenWanted(false)).not.toThrow();
  });
});

describe("the start screen — how long ago a project was opened (#2019)", () => {
  const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
  const ago = (ms: number) => openedAgo(NOW - ms, NOW);
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  it.each([
    [0, "opened just now"],
    [59_000, "opened just now"],
    [MIN, "opened 1 minute ago"],
    [59 * MIN, "opened 59 minutes ago"],
    [HOUR, "opened 1 hour ago"],
    [23 * HOUR, "opened 23 hours ago"],
    [DAY, "opened yesterday"],
    [2 * DAY, "opened 2 days ago"],
    [30 * DAY, "opened 30 days ago"],
  ])("%d ms ago reads %s", (ms, text) => {
    expect(ago(ms)).toBe(text);
  });

  it("past a month it gives the date", () => {
    expect(ago(31 * DAY)).toMatch(/^opened .*2026/);
    expect(ago(31 * DAY)).not.toMatch(/ago$/);
  });

  it("a stamp from the future reads as now, not as a negative time", () => {
    expect(openedAgo(NOW + HOUR, NOW)).toBe("opened just now");
  });
});
