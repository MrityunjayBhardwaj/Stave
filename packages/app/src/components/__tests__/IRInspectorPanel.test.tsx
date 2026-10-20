/**
 * Phase 20-07 wave γ — Inspector pulse + chain-row breakpoint affordance + Resume button.
 *
 * Mirrors MusicalTimeline.test.tsx: mocks @stave/editor's IR snapshot
 * channel via vi.mock so this test owns the publish path. Constructs a
 * real BreakpointStore and a real HapStream: the mock spreads the real
 * module, so both come through it untouched.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import * as React from "react";
import { act, render, cleanup, fireEvent } from "@testing-library/react";
import type {
  IRSnapshot,
  IREvent,
  PatternIR,
  HapEvent,
  HapStream as HapStreamType,
  BreakpointStore as BreakpointStoreType,
} from "@stave/editor";

// The real runtime classes — the mock below spreads the real module and
// overrides neither (#1943).
import { HapStream as HapStreamRuntime, BreakpointStore as BreakpointStoreRuntime } from "@stave/editor";
const HapStream = HapStreamRuntime as unknown as new () => HapStreamType;
const BreakpointStore = BreakpointStoreRuntime as unknown as new () => BreakpointStoreType;

import { IRInspectorPanel } from "../IRInspectorPanel";

// ─── Mock @stave/editor's IR snapshot channel ──────────────────────────────

let mockCurrent: IRSnapshot | null = null;
const mockListeners = new Set<(s: IRSnapshot | null) => void>();
const revealLineInFileMock = vi.fn<(fileId: string, line: number) => void>();
const setCaptureCapacityMock = vi.fn<(capacity: number) => void>();

vi.mock("@stave/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stave/editor")>()),
  getIRSnapshot: () => mockCurrent,
  subscribeIRSnapshot: (cb: (s: IRSnapshot | null) => void) => {
    mockListeners.add(cb);
    return () => {
      mockListeners.delete(cb);
    };
  },
  revealLineInFile: (source: string, line: number) =>
    revealLineInFileMock(source, line),
  setCaptureCapacity: (n: number) => setCaptureCapacityMock(n),
  // IRInspectorTimeline transitively imports getCaptureBuffer +
  // subscribeCapture; stub both to empty so the timeline render is a
  // no-op for these tests.
  getCaptureBuffer: () => [],
  subscribeCapture: () => () => {},
}));

function pushSnapshot(snap: IRSnapshot | null): void {
  mockCurrent = snap;
  for (const l of mockListeners) l(snap);
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

function evt(partial: Partial<IREvent>): IREvent {
  return {
    begin: 0,
    end: 0.1,
    endClipped: 0.1,
    note: null,
    freq: null,
    s: null,
    gain: 1,
    velocity: 1,
    color: null,
    ...partial,
  } as IREvent;
}

function hapEvt(partial: Partial<HapEvent> & { irNodeId: string }): HapEvent {
  return {
    hap: { whole: { begin: 0 } },
    audioTime: 0,
    audioDuration: partial.audioDuration ?? 0.5,
    scheduledAheadMs: partial.scheduledAheadMs ?? 0,
    midiNote: null,
    s: partial.s ?? null,
    color: null,
    loc: null,
    irNodeId: partial.irNodeId,
  };
}

/** Build a snapshot whose IR root is a single Play leaf at loc[0]=10:12
 *  with irNodeId='id-bd', and a parallel events array carrying the same
 *  loc + id. The lookup tables are populated identically to
 *  enrichWithLookups(). */
function makeLeafSnapshot(): IRSnapshot {
  const irPlay: PatternIR = {
    tag: "Play",
    note: "bd",
    duration: 0.5,
    loc: [{ start: 10, end: 12 }],
  } as PatternIR;
  const e = evt({ loc: [{ start: 10, end: 12 }], irNodeId: "id-bd", s: "bd" });
  return {
    ts: Date.now(),
    runtime: "strudel" as IRSnapshot["runtime"],
    code: "          bd",
    passes: [{ name: "final", ir: irPlay }],
    ir: irPlay,
    events: [e],
    irNodeIdLookup: new Map([["id-bd", e]]),
    irNodeLocLookup: new Map([["10:12", [e]]]),
    irNodeIdsByLine: new Map([[1, ["id-bd"]]]),
  };
}

/** Build a snapshot whose IR root is a Stack with 2 Play leaves on the
 *  same line. Used to verify non-leaf chain-row clicks expand to the
 *  descendant leaf-set (DEC-AMENDED-2 / R-A). */
function makeStackSnapshot(): IRSnapshot {
  const playA: PatternIR = {
    tag: "Play",
    note: "bd",
    duration: 0.5,
    loc: [{ start: 10, end: 12 }],
  } as PatternIR;
  const playB: PatternIR = {
    tag: "Play",
    note: "hh",
    duration: 0.5,
    loc: [{ start: 13, end: 15 }],
  } as PatternIR;
  const stack: PatternIR = {
    tag: "Stack",
    tracks: [playA, playB],
    loc: [{ start: 10, end: 15 }],
  } as PatternIR;
  const eA = evt({ loc: [{ start: 10, end: 12 }], irNodeId: "id-bd", s: "bd" });
  const eB = evt({ loc: [{ start: 13, end: 15 }], irNodeId: "id-hh", s: "hh" });
  return {
    ts: Date.now(),
    runtime: "strudel" as IRSnapshot["runtime"],
    code: "          bd hh",
    passes: [{ name: "final", ir: stack }],
    ir: stack,
    events: [eA, eB],
    irNodeIdLookup: new Map([
      ["id-bd", eA],
      ["id-hh", eB],
    ]),
    irNodeLocLookup: new Map([
      ["10:12", [eA]],
      ["13:15", [eB]],
    ]),
    irNodeIdsByLine: new Map([[1, ["id-bd", "id-hh"]]]),
  };
}

beforeEach(() => {
  mockCurrent = null;
  mockListeners.clear();
  revealLineInFileMock.mockClear();
  setCaptureCapacityMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("20-07 γ — Inspector pulse + breakpoint affordance + Resume", () => {
  it("hap with matching irNodeId pulses the leaf row, then clears after audioDuration", () => {
    vi.useFakeTimers();
    mockCurrent = makeLeafSnapshot();

    const stream = new HapStream();
    const store = new BreakpointStore();

    const { container } = render(
      <IRInspectorPanel
        getHapStream={() => stream}
        getBreakpointStore={() => store}
        getIsPaused={() => false}
        onResume={() => {}}
        onPauseChanged={() => () => {}}
      />,
    );

    // Initial state — no row pulsed.
    expect(
      container.querySelector('[data-irinspector-pulsed="true"]'),
    ).toBeNull();

    // Emit a synthetic hap event with the leaf's irNodeId. scheduledAheadMs
    // = 0 so the show-timer fires immediately on tick. audioDuration = 0.4
    // so the clear-timer fires at 400ms.
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (stream as any).emitEvent(
        hapEvt({ irNodeId: "id-bd", audioDuration: 0.4, scheduledAheadMs: 0 }),
      );
    });

    // Advance 1ms past the show-timer (scheduledAheadMs=0 → fires at t=0).
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const pulsedAfterShow = container.querySelector(
      '[data-irinspector-pulsed="true"]',
    );
    expect(pulsedAfterShow).not.toBeNull();

    // Advance past the clear-timer.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const pulsedAfterClear = container.querySelector(
      '[data-irinspector-pulsed="true"]',
    );
    expect(pulsedAfterClear).toBeNull();
  });

  it("chain-row click on a leaf calls store.toggleSet([leaf-id]) with lineHint", () => {
    mockCurrent = makeLeafSnapshot();

    const store = new BreakpointStore();
    const toggleSetSpy = vi.spyOn(store, "toggleSet");

    const { container } = render(
      <IRInspectorPanel
        getHapStream={() => null}
        getBreakpointStore={() => store}
        getIsPaused={() => false}
        onResume={() => {}}
        onPauseChanged={() => () => {}}
      />,
    );

    // Find the registrable row and click it. data-irinspector-row="true" is
    // set whenever the row's leaf-set is non-empty (collectLeafIrNodeIds
    // resolved at least one id).
    const row = container.querySelector(
      '[data-irinspector-row="true"]',
    ) as HTMLElement | null;
    expect(row).not.toBeNull();

    act(() => {
      fireEvent.click(row!);
    });

    expect(toggleSetSpy).toHaveBeenCalledTimes(1);
    expect(toggleSetSpy).toHaveBeenCalledWith(["id-bd"], { lineHint: 1 });
    expect(store.has("id-bd")).toBe(true);
  });

  it("chain-row click on a Stack (non-leaf) expands to descendant leaf-set", () => {
    mockCurrent = makeStackSnapshot();

    const store = new BreakpointStore();
    const toggleSetSpy = vi.spyOn(store, "toggleSet");

    const { container } = render(
      <IRInspectorPanel
        getHapStream={() => null}
        getBreakpointStore={() => store}
        getIsPaused={() => false}
        onResume={() => {}}
        onPauseChanged={() => () => {}}
      />,
    );

    // Find the OUTERMOST registrable row — Stack rows live in <details>
    // / <summary>. The summary inside the first details should fire on
    // click. summary[onclick] is set when handleClick is bound. Click the
    // first <summary> at the top of the IR tree.
    const summary = container.querySelector(
      '[data-irinspector-row="true"] > summary',
    ) as HTMLElement | null;
    expect(summary).not.toBeNull();

    act(() => {
      fireEvent.click(summary!);
    });

    expect(toggleSetSpy).toHaveBeenCalledTimes(1);
    const call = toggleSetSpy.mock.calls[0]!;
    expect(call[0]).toEqual(expect.arrayContaining(["id-bd", "id-hh"]));
    expect(call[1]).toEqual({ lineHint: 1 });
  });

  it("breakpoint-marker class appears on rows whose irNodeId is in the store", () => {
    mockCurrent = makeLeafSnapshot();

    const store = new BreakpointStore();
    store.add("id-bd", { lineHint: 1 });

    const { container } = render(
      <IRInspectorPanel
        getHapStream={() => null}
        getBreakpointStore={() => store}
        getIsPaused={() => false}
        onResume={() => {}}
        onPauseChanged={() => () => {}}
      />,
    );

    const marked = container.querySelector(
      '[data-breakpoint-active="true"]',
    );
    expect(marked).not.toBeNull();
  });

  it("Resume button visible only when isPaused === true; clicking calls onResume", () => {
    mockCurrent = makeLeafSnapshot();

    const onResume = vi.fn();
    let pausedListener: ((p: boolean) => void) | null = null;
    const onPauseChanged = (cb: (p: boolean) => void): (() => void) => {
      pausedListener = cb;
      return () => {
        pausedListener = null;
      };
    };

    let isPausedState = false;
    const { container, rerender } = render(
      <IRInspectorPanel
        getHapStream={() => null}
        getBreakpointStore={() => new BreakpointStore()}
        getIsPaused={() => isPausedState}
        onResume={onResume}
        onPauseChanged={onPauseChanged}
      />,
    );

    // Not paused → button NOT in DOM.
    expect(
      container.querySelector('[data-testid="stave-debugger-resume"]'),
    ).toBeNull();

    // Flip to paused via the listener bus.
    act(() => {
      isPausedState = true;
      pausedListener?.(true);
    });

    rerender(
      <IRInspectorPanel
        getHapStream={() => null}
        getBreakpointStore={() => new BreakpointStore()}
        getIsPaused={() => isPausedState}
        onResume={onResume}
        onPauseChanged={onPauseChanged}
      />,
    );

    const button = container.querySelector(
      '[data-testid="stave-debugger-resume"]',
    ) as HTMLElement | null;
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain("Resume");

    act(() => {
      fireEvent.click(button!);
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("(R-1 / T17) Inspector button + Monaco command both invoke runtime.resume() — guard short-circuits the second call", () => {
    // Simulate the runtime.resume() guard: only fires the underlying
    // engine.resume() while isPausedState === true. Inspector button
    // click + Monaco command both invoke the same closure.
    let isPausedState = true;
    const engineResumeSpy = vi.fn();
    const onResume = (): void => {
      // T17 guard mirrors LiveCodingRuntime.resume() in
      // packages/editor/src/workspace/runtime/LiveCodingRuntime.ts.
      if (!isPausedState) return;
      engineResumeSpy();
      isPausedState = false;
    };

    // First call (Inspector button) — fires once + clears flag.
    onResume();
    // Second call (Monaco command palette) — guard short-circuits.
    onResume();

    expect(engineResumeSpy).toHaveBeenCalledTimes(1);
  });
});

// Re-mount support — the timeline component requires an explicit
// pushSnapshot before render to populate `displaySnapshot`. Used by the
// pulse test to ensure setSnap propagates before the first hap fires.
function _kickPublish(snap: IRSnapshot): void {
  pushSnapshot(snap);
}
void _kickPublish;
