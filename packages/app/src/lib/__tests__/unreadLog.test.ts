import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocked at the specifier so the test never pulls the editor barrel in — it
// drags a CJS dependency that vitest cannot load in this project.
const listeners = new Set<(e: unknown) => void>();
let history: Array<{ level: string; message: string }> = [];

vi.mock("@stave/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stave/editor")>()),
  getLogHistory: () => history,
  subscribeLog: (cb: (e: unknown) => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
}));

const emit = (level: string) => {
  for (const l of [...listeners]) l({ level, message: level });
};
const emitCleared = () => {
  for (const l of [...listeners]) l(null);
};

import {
  consoleBadge,
  getUnreadLogCount,
  getUnreadLogBreakdown,
  clearUnreadLog,
  subscribeUnreadLog,
  __resetUnreadLogForTests,
} from "../unreadLog";

describe("unread log counts (#1368)", () => {
  beforeEach(() => {
    __resetUnreadLogForTests();
    listeners.clear();
    history = [];
  });

  it("seeds from history on the first subscribe, so a reload doesn't zero the badge", () => {
    history = [
      { level: "error", message: "boom" },
      { level: "warn", message: "hmm" },
      { level: "info", message: "hello" },
    ];
    subscribeUnreadLog(() => {});
    expect(getUnreadLogBreakdown()).toEqual({ errors: 1, warns: 1 });
    expect(getUnreadLogCount()).toBe(2);
  });

  it("counts errors and warnings, and ignores info", () => {
    const seen: number[] = [];
    subscribeUnreadLog(() => seen.push(getUnreadLogCount()));
    emit("error");
    emit("warn");
    emit("info");
    expect(getUnreadLogBreakdown()).toEqual({ errors: 1, warns: 1 });
    // info must not even notify — a subscriber that re-renders on every info
    // line would repaint the rail constantly during normal playback.
    expect(seen).toEqual([1, 2]);
  });

  it("clears when the user opens the panel", () => {
    subscribeUnreadLog(() => {});
    emit("error");
    emit("warn");
    clearUnreadLog();
    expect(getUnreadLogCount()).toBe(0);
  });

  it("clears when the log itself is cleared", () => {
    subscribeUnreadLog(() => {});
    emit("error");
    emitCleared();
    expect(getUnreadLogCount()).toBe(0);
  });

  it("does not notify when clearing an already-empty count", () => {
    let calls = 0;
    subscribeUnreadLog(() => { calls++; });
    clearUnreadLog();
    emitCleared();
    expect(calls).toBe(0);
  });

  it("a remount that drops every listener does NOT resurrect a cleared count", () => {
    // React's development double-invoke unsubscribes and resubscribes. If the
    // module tore its log subscription down at zero listeners it would re-seed
    // from history on the way back — and history still holds the entries the
    // user just marked as seen, so the badge would silently reappear.
    history = [{ level: "error", message: "boom" }];
    const off = subscribeUnreadLog(() => {});
    expect(getUnreadLogCount()).toBe(1);
    clearUnreadLog();
    expect(getUnreadLogCount()).toBe(0);

    off();
    subscribeUnreadLog(() => {});
    expect(getUnreadLogCount()).toBe(0);
  });

  it("keeps counting entries that arrive while nothing is subscribed", () => {
    subscribeUnreadLog(() => {})();
    emit("error");
    subscribeUnreadLog(() => {});
    expect(getUnreadLogCount()).toBe(1);
  });
});

describe("badge tone and tooltip (#1368)", () => {
  beforeEach(() => {
    __resetUnreadLogForTests();
    listeners.clear();
    history = [];
  });

  it("warnings alone are amber, not red", () => {
    subscribeUnreadLog(() => {});
    emit("warn");
    expect(consoleBadge.tone?.()).toBe("warning");
  });

  it("any error outranks warnings", () => {
    subscribeUnreadLog(() => {});
    emit("warn");
    emit("warn");
    emit("error");
    expect(consoleBadge.tone?.()).toBe("danger");
  });

  it("the tooltip names what is actually waiting, and pluralises", () => {
    subscribeUnreadLog(() => {});
    emit("error");
    expect(consoleBadge.describe?.()).toBe("1 error — open Console");
    emit("warn");
    emit("warn");
    expect(consoleBadge.describe?.()).toBe("1 error, 2 warnings — open Console");
    clearUnreadLog();
    expect(consoleBadge.describe?.()).toBe("Open Console");
  });
});
