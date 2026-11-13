/**
 * #2489 — the piano roll in the preview frame: when it shows, the line under
 * it, and (with the engine and the renderers stood in for) that playing mounts
 * it, stopping or failing takes it down, and the frame's messages to the page
 * are the same ones it always sent. That the roll really draws notes, and that
 * they move, is gallery-sandbox.spec.ts, read from the frame's pixels.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { barAt, rollLabel, rollShows, songBarsOf } from "../previewRoll";

// ─── the rules ──────────────────────────────────────────────────────────────

describe("previewRoll — when the roll shows", () => {
  it("a pattern that draws no visual of its own gets the roll", () => {
    expect(rollShows(0)).toBe(true);
  });
  it("a pattern that draws one or more of its own: no roll stacked over them", () => {
    for (const n of [1, 2, 4]) expect(rollShows(n), String(n)).toBe(false);
  });
});

describe("previewRoll — the line under it", () => {
  it("a song with a length: bar N of M", () => {
    expect(rollLabel("main.strudel", 8.4, 32)).toBe("▶ main.strudel · bar 9 of 32");
    expect(rollLabel("main.strudel", 0, 32)).toBe("▶ main.strudel · bar 1 of 32");
    expect(rollLabel("main.strudel", 31.99, 32)).toBe("▶ main.strudel · bar 32 of 32");
  });
  it("a song wraps round its length, as the preview plays it again", () => {
    expect(rollLabel("main.strudel", 32, 32)).toBe("▶ main.strudel · bar 1 of 32");
    expect(barAt(41.5, 32)).toBe(10);
  });
  it("a loop (no known length): plain bar N, and it counts on", () => {
    expect(rollLabel("main.strudel", 8.4, null)).toBe("▶ main.strudel · bar 9");
    expect(rollLabel("loops/floor.strudel", 140.2, null)).toBe("▶ loops/floor.strudel · bar 141");
  });
  it("before the clock starts (or a bad reading): bar 1", () => {
    for (const c of [-0.2, Number.NaN, Number.POSITIVE_INFINITY]) expect(barAt(c, null), String(c)).toBe(1);
  });
  it("the length is the arrangement's, rounded up; a loop or an unreadable arrangement has none", () => {
    expect(songBarsOf({ kind: "arranged", cycles: 32 })).toBe(32);
    expect(songBarsOf({ kind: "arranged", cycles: 6.5 })).toBe(7);
    expect(songBarsOf({ kind: "loop" })).toBeNull();
    expect(songBarsOf({ kind: "opaque" })).toBeNull();
    expect(songBarsOf({ kind: "arranged", cycles: 0 })).toBeNull();
    expect(songBarsOf(null)).toBeNull();
  });
});

// ─── the frame, with the engine stood in for ────────────────────────────────

const fake = vi.hoisted(() => ({
  vizRequests: new Map<string, string>(),
  cycle: 0,
  evaluateError: null as Error | null,
  playThrows: false,
  mounts: [] as Array<{ label: string; destroyed: boolean }>,
  queried: 0,
}));

vi.mock("@stave/editor", () => {
  const scheduler = {
    now: () => fake.cycle,
    cps: () => 0.5,
    query: () => {
      fake.queried++;
      return [];
    },
  };
  class StrudelEngine {
    setRuntimeErrorHandler() {}
    async init() {}
    async evaluate() {
      return fake.evaluateError ? { error: fake.evaluateError } : {};
    }
    getVizRequests() {
      return fake.vizRequests;
    }
    get components() {
      return { queryable: { scheduler, trackSchedulers: new Map() } };
    }
    getAudioContext() {
      return { state: "running", resume: async () => {} };
    }
    unlockAudio() {}
    play() {
      if (fake.playThrows) throw new Error("the engine would not start");
    }
    stop() {}
  }
  const factory = () => ({});
  return {
    StrudelEngine,
    DEFAULT_VIZ_DESCRIPTORS: [
      { id: "scope", factory },
      { id: "pianoroll", factory },
    ],
    resolveDescriptor: (id: string) => (id === "scope" ? { id, factory } : undefined),
    songEndOf: (code: string) => (code.includes("arrange") ? { kind: "arranged", cycles: 32 } : { kind: "loop" }),
    compilePreset: () => ({ factory }),
    // what previewRegistry's name rule reads (no visual files in these entries)
    getPresetIdForFile: () => null,
    isVizLanguage: () => false,
    normalizeVizName: (n: string) => n.toLowerCase(),
    rendererForLanguage: () => null,
    mountVizRenderer: (box: HTMLElement, _f: unknown, components: { queryable?: { scheduler?: { query(a: number, b: number): unknown } } }) => {
      const rec = { label: box.getAttribute("data-gallery-player-roll") ?? box.getAttribute("data-gallery-player-visual") ?? "?", destroyed: false };
      fake.mounts.push(rec);
      box.appendChild(document.createElement("canvas"));
      components.queryable?.scheduler?.query(0, 1); // the roll asks its scheduler, as the real sketch does each frame
      return { renderer: { destroy: () => (rec.destroyed = true) }, disconnect() {} };
    },
  };
});

import { GalleryPlayer } from "../GalleryPlayer";
import { parseFromFrame } from "../previewProtocol";

const posted: unknown[] = [];
let parentStub: { postMessage: (m: unknown) => void };
let parentDesc: PropertyDescriptor | undefined;

beforeEach(() => {
  fake.vizRequests = new Map();
  fake.cycle = 0;
  fake.evaluateError = null;
  fake.playThrows = false;
  fake.mounts = [];
  fake.queried = 0;
  posted.length = 0;
  parentStub = { postMessage: (m: unknown) => posted.push(m) };
  parentDesc = Object.getOwnPropertyDescriptor(window, "parent");
  Object.defineProperty(window, "parent", { configurable: true, get: () => parentStub });
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => setTimeout(() => cb(0), 0));
});

afterEach(() => {
  cleanup();
  if (parentDesc) Object.defineProperty(window, "parent", parentDesc);
  vi.unstubAllGlobals();
});

/** A message from the embedding page, as the frame receives it. */
function fromPage(data: unknown) {
  const ev = new MessageEvent("message", { data, origin: window.location.origin });
  Object.defineProperty(ev, "source", { value: parentStub });
  window.dispatchEvent(ev);
}

const playMsg = (code: string, extra: Array<{ path: string; kind: "hydra"; code: string }> = []) => ({
  play: true,
  path: "main.strudel",
  files: [{ path: "main.strudel", kind: "strudel", code }, ...extra],
});

const rollBox = () => document.querySelector("[data-gallery-player-roll]");
const label = () => document.querySelector("[data-gallery-player-roll-label]");

async function settle() {
  for (let i = 0; i < 40; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

describe("GalleryPlayer — the roll (#2489)", () => {
  it("playing a pattern with no visual of its own draws the roll, fed by its scheduler, with its bar", async () => {
    await act(async () => {
      render(<GalleryPlayer />);
    });
    fake.cycle = 8.4;
    await act(async () => fromPage(playMsg('s("bd*4")')));
    await settle();
    expect(rollBox()).not.toBeNull();
    expect(rollBox()!.querySelector("canvas")).not.toBeNull();
    expect(fake.mounts.map((m) => m.label)).toEqual(["pianoroll"]);
    expect(fake.queried).toBeGreaterThan(0);
    expect(label()!.textContent).toBe("▶ main.strudel · bar 9");
    // the line follows the clock
    fake.cycle = 12.1;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(label()!.textContent).toBe("▶ main.strudel · bar 13");
  });

  it("an arranged song: bar N of its length", async () => {
    await act(async () => {
      render(<GalleryPlayer />);
    });
    fake.cycle = 40.5; // the second time round a 32-bar song
    await act(async () => fromPage(playMsg('arrange([16, s("bd*4")], [16, s("hh*8")])')));
    await settle();
    expect(label()!.textContent).toBe("▶ main.strudel · bar 9 of 32");
  });

  it("a pattern that draws its own visual: no roll stacked over it", async () => {
    fake.vizRequests = new Map([["$0", "scope"]]);
    await act(async () => {
      render(<GalleryPlayer />);
    });
    await act(async () => fromPage(playMsg('$: s("bd*4").viz("scope")')));
    await settle();
    expect(document.querySelectorAll("[data-gallery-player-visual]").length).toBe(1);
    expect(rollBox()).toBeNull();
    expect(label()).toBeNull();
    expect(fake.mounts.map((m) => m.label)).toEqual(["scope"]);
  });

  it("CONTROL: a pattern whose .viz name resolves nowhere draws none of its own, so it gets the roll", async () => {
    fake.vizRequests = new Map([["$0", "nosuchvisual"]]);
    await act(async () => {
      render(<GalleryPlayer />);
    });
    await act(async () => fromPage(playMsg('$: s("bd*4").viz("nosuchvisual")')));
    await settle();
    expect(document.querySelector("[data-gallery-player-missing]")).not.toBeNull();
    expect(rollBox()).not.toBeNull();
  });

  it("stopping clears it, and the frame's messages to the page are the ones it always sent", async () => {
    await act(async () => {
      render(<GalleryPlayer />);
    });
    await act(async () => fromPage(playMsg('s("bd*4")')));
    await settle();
    expect(rollBox()).not.toBeNull();
    await act(async () => fromPage({ stop: true }));
    await settle();
    expect(rollBox()).toBeNull();
    expect(label()).toBeNull();
    expect(fake.mounts.every((m) => m.destroyed)).toBe(true);
    // the whole conversation, in order: nothing new, and each passes the page's own check unchanged
    expect(posted).toEqual([{ state: "ready" }, { state: "playing" }, { state: "stopped" }]);
    for (const m of posted) expect(parseFromFrame(m)).toEqual(m);
  });

  it("a run that fails after the roll went up takes it down", async () => {
    fake.playThrows = true;
    await act(async () => {
      render(<GalleryPlayer />);
    });
    await act(async () => fromPage(playMsg('s("bd*4")')));
    await settle();
    expect(rollBox()).toBeNull();
    expect(label()).toBeNull();
    expect(fake.mounts.map((m) => [m.label, m.destroyed])).toEqual([["pianoroll", true]]);
    expect(posted).toEqual([{ state: "ready" }, { state: "error", message: "the engine would not start" }]);
  });

  it("a code error before anything plays: no roll at all", async () => {
    fake.evaluateError = new Error("bad code");
    await act(async () => {
      render(<GalleryPlayer />);
    });
    await act(async () => fromPage(playMsg("oops(")));
    await settle();
    expect(rollBox()).toBeNull();
    expect(fake.mounts).toEqual([]);
  });

  it("playing a visual file next: the music's roll and its line are gone, not left over the visual", async () => {
    await act(async () => {
      render(<GalleryPlayer />);
    });
    await act(async () => fromPage(playMsg('s("bd*4")')));
    await settle();
    expect(label()).not.toBeNull();
    await act(async () =>
      fromPage({ play: true, path: "bloom.hydra", files: [{ path: "bloom.hydra", kind: "hydra", code: "osc().out()" }] }),
    );
    await settle();
    expect(document.querySelector("[data-gallery-player-visual]")).not.toBeNull();
    expect(posted.at(-1)).toEqual({ state: "playing" });
    expect(rollBox()).toBeNull();
    expect(label()).toBeNull();
  });

  it("playing again replaces the roll; it never stacks a second", async () => {
    await act(async () => {
      render(<GalleryPlayer />);
    });
    await act(async () => fromPage(playMsg('s("bd*4")')));
    await settle();
    await act(async () => fromPage(playMsg('s("hh*8")')));
    await settle();
    expect(document.querySelectorAll("[data-gallery-player-roll]").length).toBe(1);
    expect(fake.mounts.map((m) => m.destroyed)).toEqual([true, false]);
  });
});
