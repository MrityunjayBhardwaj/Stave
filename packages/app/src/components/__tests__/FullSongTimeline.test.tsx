/**
 * FullSongTimeline coverage (#385) —
 *   - lane labels render from analysis.lanes
 *   - section chips + onset cells render once a width is known
 *   - empty state when there is no analysis
 *   - clicking the ruler/grid calls onSeek (the DV-10 relaxation)
 *
 * Pure props in (no @stave/editor runtime dependency — SongAnalysis is a
 * type), so no module mock is needed. A MockResizeObserver supplies the grid
 * width (jsdom ships none), mirroring MusicalTimeline.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as React from 'react'
import { act, render, cleanup, fireEvent } from '@testing-library/react'
import type { SongAnalysis } from '@stave/editor'
import { setRulerUnits } from '../../state/rulerUnits'
import {
  getLoopState,
  subscribeLoopState,
  __resetLoopStateForTests,
} from '../../state/loopRange'

// The mock below is the REAL `@stave/editor` with only the collect events and the lane
// structure swapped for fixtures (#1943). The mini-note collection path on a real song is
// covered by the Playwright spec.
// Trim-gesture fixture (#437): an `arrange` song with TWO bd arms — arm 0 over
// cycles [0,2), arm 1 over [2,4). The events carry `armIndex` + `loc` so
// collectNoteMarks builds real clips (armIndex ≥ 0 = trimmable). Returned only
// when an `ir` is passed, so the no-`ir` tests above still see no marks.
const { TRIM_EVENTS, BARE_EVENTS, NESTED_EVENTS } = vi.hoisted(() => ({
  TRIM_EVENTS: [
    { begin: 0, end: 1, s: 'bd', armIndex: 0, loc: [{ start: 9, end: 21 }] },
    { begin: 1, end: 2, s: 'bd', armIndex: 0, loc: [{ start: 9, end: 21 }] },
    { begin: 2, end: 3, s: 'bd', armIndex: 1, loc: [{ start: 23, end: 35 }] },
    { begin: 3, end: 4, s: 'bd', armIndex: 1, loc: [{ start: 23, end: 35 }] },
  ],
  // A BARE track: events with NO armIndex → no clipsByLane entry → the scene
  // synthesises ONE implicit clip (armIndex −1) spanning the song. Used for the
  // bare-clip-is-not-movable test (#488: dragging it must be a no-op).
  BARE_EVENTS: [
    { begin: 0, end: 1, s: 'bd', loc: [{ start: 0, end: 9 }] },
    { begin: 1, end: 2, s: 'bd', loc: [{ start: 0, end: 9 }] },
  ],
  // A NESTED combinator (#451), mimicking the real collector output for
  // `arrange([2, cat(s("bd"),s("sd"))], [1, s("hh")])`: ONE track lane
  // (shared `trackId`), the cat block's events carry the OUTER arm index 0
  // (outermost-wins) and `loc` = [inner cat {12,39}, outer arrange {0,58}];
  // `hh` is the outer arm 1, non-nested (`loc` = [arrange]). So the lane RLEs
  // into ONE clip for arm 0 spanning cycles [0,2) and one for arm 1 at [2,3),
  // and its `arrangeOffset` (loc[last]) = 0 → detectArrangeAt resolves the outer.
  NESTED_EVENTS: [
    { begin: 0, end: 1, s: 'bd', trackId: 'song', armIndex: 0, loc: [{ start: 12, end: 39 }, { start: 0, end: 58 }] },
    { begin: 1, end: 2, s: 'sd', trackId: 'song', armIndex: 0, loc: [{ start: 12, end: 39 }, { start: 0, end: 58 }] },
    { begin: 2, end: 3, s: 'hh', trackId: 'song', armIndex: 1, loc: [{ start: 0, end: 58 }] },
  ],
}))
vi.mock('@stave/editor', async (importOriginal) => {
  // Everything is the REAL module except the fixtures below (#1943): the collect
  // events, and the lane STRUCTURE (#974) reduced from those SAME events through
  // the real reducer, so structure and marks stay in sync. Only vi.hoisted
  // values (the fixtures) are safe to reference here — the factory is hoisted
  // above every top-level const, so `eventsForIr` lives inside it.
  const { skeletonsFromEvents } = await import('../musicalTimeline/__tests__/structuralWalkTestStub')
  const eventsForIr = (ir: { bare?: boolean; nested?: boolean } | null) =>
    ir?.bare ? BARE_EVENTS : ir?.nested ? NESTED_EVENTS : ir ? TRIM_EVENTS : []
  return {
    ...(await importOriginal<typeof import('@stave/editor')>()),
    collectCycles: (ir: { bare?: boolean; nested?: boolean } | null) => eventsForIr(ir),
    structuralWalk: (ir: { bare?: boolean; nested?: boolean } | null, window: { originCycle: number; spanCycles: number }) =>
      skeletonsFromEvents(eventsForIr(ir), window),
    // #459 — Song view now reads the shared timeline row-height setting. Mock it
    // to 22 (the height these layout assertions were written for) + a no-op
    // subscribe, mirroring MusicalTimeline.test's mock.
    getMusicalTimelineSubRowHeight: () => 22,
    onMusicalTimelineSubRowHeightChange: () => () => {},
  }
})

import { FullSongTimeline } from '../FullSongTimeline'

// jsdom ships no PointerEvent, so fireEvent.pointer* would drop clientX/pointerId
// (the trim hit-test reads both). Shim it as a MouseEvent subclass that keeps the
// coordinate init and carries pointerId — enough for the gesture tests below.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    pointerId: number
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 1
    }
  }
  ;(globalThis as { PointerEvent?: unknown }).PointerEvent =
    PointerEventShim as unknown as typeof PointerEvent
}

let mockGridWidth = 800
class MockResizeObserver {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(target: Element): void {
    Object.defineProperty(target, 'clientWidth', { value: mockGridWidth, configurable: true })
    Promise.resolve().then(() => {
      this.cb(
        [{ contentRect: { width: mockGridWidth, height: 48 } as DOMRectReadOnly, target } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      )
    })
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  mockGridWidth = 800
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
})
afterEach(() => cleanup())

const analysisFixture: SongAnalysis = {
  periodCycles: 4,
  horizonCycles: 8,
  displaySpan: { kind: 'loop', cycles: 4 },
  repeatCycles: 4, lanePeriods: [],
  lanes: [
    { laneKey: 'bd', onsetsByCycle: [2, 0, 2, 0] },
    { laneKey: 'hh', onsetsByCycle: [1, 1, 1, 1] },
  ],
  sections: [
    { startCycle: 0, endCycle: 1, laneKeys: ['bd', 'hh'] },
    { startCycle: 1, endCycle: 4, laneKeys: ['hh'] },
  ],
}

// One-lane song for the NESTED fixture (period 3: cat block [0,2) + hh [2,3)).
const nestedAnalysis: SongAnalysis = {
  periodCycles: 3,
  horizonCycles: 6,
  displaySpan: { kind: 'loop', cycles: 3 },
  repeatCycles: 3, lanePeriods: [],
  lanes: [{ laneKey: 'song', onsetsByCycle: [1, 1, 1] }],
  sections: [{ startCycle: 0, endCycle: 3, laneKeys: ['song'] }],
}

function renderFull(overrides?: Partial<React.ComponentProps<typeof FullSongTimeline>>) {
  const props = {
    analysis: analysisFixture,
    getSongPosition: () => null,
    onSeek: vi.fn(),
    getDrawerOpen: () => true,
    getActiveTabId: () => 'musical-timeline',
    ...overrides,
  }
  const utils = render(<FullSongTimeline {...props} />)
  return { ...utils, onSeek: props.onSeek as ReturnType<typeof vi.fn> }
}

describe('FullSongTimeline', () => {
  it('renders a lane label per analysis lane', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const lanes = container.querySelectorAll('[data-full-song-lane]')
    expect(lanes.length).toBe(2)
    expect(container.querySelector('[data-full-song-lane="bd"]')).not.toBeNull()
    expect(container.querySelector('[data-full-song-lane="hh"]')).not.toBeNull()
  })

  it('mounts the canvas body without any DOM section chips on the ruler', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    // Section bands were removed from the ruler (#752): the numbered labels
    // collided with the cycle numbers and were a no-op for single-section songs.
    expect(container.querySelectorAll('[data-full-song-section]').length).toBe(0)
    // The onset heatmap is now drawn on the canvas (the per-cell DOM nodes are
    // gone). Assert the canvas surface mounted; pixel output is covered by the
    // drawTimeline unit tests + the Playwright screenshot.
    expect(container.querySelector('[data-full-song-canvas]')).not.toBeNull()
    expect(container.querySelectorAll('[data-full-song-cell]').length).toBe(0)
  })

  it('shows an empty state when there is no analysis', async () => {
    const { container } = renderFull({ analysis: null })
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelectorAll('[data-full-song-lane]').length).toBe(0)
    expect(container.textContent).toContain('No song to map yet')
  })

  it('seeks from the RULER, not the grid (#610 — the grid row now jumps to code)', async () => {
    const { container, onSeek } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    // A grid press no longer seeks — it selects/jumps to the track under it
    // (#610). With no onSelectLane wired here it is a no-op, but crucially it
    // does NOT call onSeek.
    const grid = container.querySelector('[data-full-song="grid"]') as HTMLElement
    await act(async () => {
      grid.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50 }))
    })
    expect(onSeek).not.toHaveBeenCalled()
    // The ruler time-axis is now the seek surface (seek moved off the grid).
    const ruler = container.querySelector('[data-full-song="ruler-area"]') as HTMLElement
    await act(async () => {
      ruler.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50 }))
    })
    expect(onSeek).toHaveBeenCalledTimes(1)
    // jsdom getBoundingClientRect is zero-width → seek resolves to cycle 0, but
    // the call itself proves the wiring (x→cycle math is unit-tested in
    // songAxis.test.ts).
    expect(typeof onSeek.mock.calls[0][0]).toBe('number')
  })

  it('toggles a lane expansion and binds it when the disclosure caret is clicked', async () => {
    const onBindLane = vi.fn()
    const { container } = renderFull({ onBindLane })
    await act(async () => {
      await Promise.resolve()
    })
    const row = () => container.querySelector('[data-full-song-lane="bd"]') as HTMLElement
    expect(row().getAttribute('data-expanded')).toBe('false')
    const caret = container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement
    await act(async () => {
      caret.click()
    })
    expect(row().getAttribute('data-expanded')).toBe('true') // accordion expanded
    expect(onBindLane).toHaveBeenCalledTimes(1) // bound into the Pattern panel
    // no `ir` in this fixture → no source provenance, so the offset is null.
    expect(onBindLane).toHaveBeenLastCalledWith(null)
    await act(async () => {
      ;(container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement).click()
    })
    expect(row().getAttribute('data-expanded')).toBe('false') // collapses again
  })

  it('jumps to the track code when the lane header is clicked, without expanding (#610)', async () => {
    const onSelectLane = vi.fn()
    // A `bare` ir gives the lane source provenance (loc[0].start = 0) so the
    // header becomes a jump target; no `dollarPos` here, so the offset resolves
    // through the sourceOffset fallback (the labelOffset path is covered e2e).
    const { container } = renderFull({ ir: { bare: true } as never, onSelectLane })
    await act(async () => {
      await Promise.resolve()
    })
    const header = container.querySelector('[data-full-song-lane-select="bd"]') as HTMLElement
    expect(header).not.toBeNull()
    await act(async () => {
      header.click()
    })
    expect(onSelectLane).toHaveBeenCalledTimes(1)
    expect(onSelectLane).toHaveBeenLastCalledWith(0)
    // It is a pure "go to code" — the lane must NOT have expanded.
    expect(
      (container.querySelector('[data-full-song-lane="bd"]') as HTMLElement).getAttribute('data-expanded'),
    ).toBe('false')
  })

  it('does not jump when the disclosure caret is clicked (caret stops propagation) (#610)', async () => {
    const onSelectLane = vi.fn()
    const onBindLane = vi.fn()
    const { container } = renderFull({ ir: { bare: true } as never, onSelectLane, onBindLane })
    await act(async () => {
      await Promise.resolve()
    })
    const caret = container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement
    await act(async () => {
      caret.click()
    })
    // Caret expands + binds, but the header's jump must NOT also fire.
    expect(onBindLane).toHaveBeenCalledTimes(1)
    expect(onSelectLane).not.toHaveBeenCalled()
    expect(
      (container.querySelector('[data-full-song-lane="bd"]') as HTMLElement).getAttribute('data-expanded'),
    ).toBe('true')
  })

  it('supports multi-expand (two lanes expanded for cross-track alignment)', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      ;(container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement).click()
      ;(container.querySelector('[data-full-song-lane-expand="hh"]') as HTMLElement).click()
    })
    expect(container.querySelector('[data-full-song-lane="bd"]')!.getAttribute('data-expanded')).toBe('true')
    expect(container.querySelector('[data-full-song-lane="hh"]')!.getAttribute('data-expanded')).toBe('true')
  })

  it('exposes the loop length for observation', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const meta = container.querySelector('[data-full-song-period]')
    expect(meta?.getAttribute('data-full-song-period')).toBe('loop 4')
  })

  it('#1721 — an arranged song reads as its declared end, not a loop or a horizon', async () => {
    // Measured period 1 beside a declared end of 6: the label is the end.
    const arranged: SongAnalysis = {
      ...analysisFixture,
      periodCycles: 1,
      repeatCycles: 1,
      horizonCycles: 6,
      displaySpan: { kind: 'arranged', cycles: 6 },
      lanes: [{ laneKey: 'bd', onsetsByCycle: [1, 1, 1, 1, 1, 1] }],
      sections: [{ startCycle: 0, endCycle: 6, laneKeys: ['bd'] }],
    }
    const { container } = renderFull({ analysis: arranged })
    await act(async () => {
      await Promise.resolve()
    })
    const meta = container.querySelector('[data-full-song-period]')
    expect(meta?.getAttribute('data-full-song-period')).toBe('arranged 6 cycles')
  })

  // ── Zoom + ruler controls (#412) ───────────────────────────────────────────

  it('renders zoom controls at 100% with Fit/zoom-out disabled', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const cluster = container.querySelector('[data-full-song-zoom]') as HTMLElement
    expect(cluster.getAttribute('data-full-song-zoom')).toBe('100')
    expect((container.querySelector('[data-full-song-zoom-fit]') as HTMLButtonElement).disabled).toBe(true)
    expect((container.querySelector('[data-full-song-zoom-out]') as HTMLButtonElement).disabled).toBe(true)
    expect((container.querySelector('[data-full-song-zoom-in]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('zooms in on the + button (enables Fit/zoom-out)', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const zoomIn = container.querySelector('[data-full-song-zoom-in]') as HTMLButtonElement
    await act(async () => {
      zoomIn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // default ZOOM_STEP is 1.5 → 150%
    expect(container.querySelector('[data-full-song-zoom]')?.getAttribute('data-full-song-zoom')).toBe('150')
    expect((container.querySelector('[data-full-song-zoom-fit]') as HTMLButtonElement).disabled).toBe(false)
  })

  // ── Follow toggle (#415) ───────────────────────────────────────────────────

  it('renders the Follow toggle defaulting to on', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const toggle = container.querySelector('[data-full-song-follow-toggle]') as HTMLButtonElement
    expect(toggle).not.toBeNull()
    expect(toggle.getAttribute('data-follow')).toBe('on')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('flips Follow off on click', async () => {
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const toggle = container.querySelector('[data-full-song-follow-toggle]') as HTMLButtonElement
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(toggle.getAttribute('data-follow')).toBe('off')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('the ruler reflects the shared units store — bars adds beat ticks (#750)', async () => {
    // The CYCLES/BARS toggle moved to the editor pattern bar; the ruler now
    // reads the shared `rulerUnits` store. Drive the store directly.
    setRulerUnits('cycles')
    const { container } = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    // CYCLES: 4 major ticks (period 4 across 800px → 200px/cycle), no beats.
    expect(container.querySelectorAll('[data-full-song-tick="major"]').length).toBe(4)
    expect(container.querySelectorAll('[data-full-song-tick="beat"]').length).toBe(0)
    await act(async () => {
      setRulerUnits('bars')
    })
    // BARS: 4 majors + 4×3 interior beat ticks (200/4 = 50px/beat ≥ 14).
    expect(container.querySelectorAll('[data-full-song-tick="major"]').length).toBe(4)
    expect(container.querySelectorAll('[data-full-song-tick="beat"]').length).toBe(12)
    setRulerUnits('cycles') // reset the module singleton for other tests
  })
})

describe('FullSongTimeline — trim a clip (drag right edge → set-weight, #437)', () => {
  // The fixture song is `arrange([2, s("bd")], [2, s("hh")])`-shaped: bd lane has
  // two clips, arm 0 over [0,2) and arm 1 over [2,4). At zoom 1 the period (4)
  // fits 800px → 200px/cycle, so arm 0's right edge sits at x=400. We grab just
  // inside it, drag to cycle 3, and expect a set-weight to 3 for arm 0.
  function renderTrimmable(onTrimClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: {} as never, onTrimClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    // jsdom has no layout — supply the grid rect the content-space math reads.
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }

  it('drags arm 0’s right edge to cycle 3 → onTrimClip(arm 0, weight 3)', async () => {
    const onTrimClip = vi.fn()
    const { grid } = renderTrimmable(onTrimClip)
    await act(async () => {
      await Promise.resolve()
    })
    // Grab 2px inside arm 0's right edge (x=400), in the bd row (y≈10).
    fireEvent.pointerDown(grid, { clientX: 398, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // cycle 3
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledTimes(1)
    // sourceOffset = the bd lane's first event loc (9); arm 0; new whole-cycle weight 3.
    expect(onTrimClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0, weight: 3 })
  })

  it('grabs the LAST clip’s right edge (at the song end) and shrinks it', async () => {
    const onTrimClip = vi.fn()
    const { grid } = renderTrimmable(onTrimClip)
    await act(async () => {
      await Promise.resolve()
    })
    // Arm 1 spans [2,4); its right edge is the song end at x=800. Grab it and
    // drag left to cycle 3 → new weight 1 (4−2 was 2). clipAtCycle(4) is null —
    // the edge-proximity scan is what makes this clip grabbable.
    fireEvent.pointerDown(grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // cycle 3
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 1, weight: 1 })
  })

  it('EXTENDS the LAST clip past the song end → grows the span + set-weight (#487)', async () => {
    const onTrimClip = vi.fn()
    const { grid, container } = renderTrimmable(onTrimClip)
    await act(async () => {
      await Promise.resolve()
    })
    // At rest the visual span is exactly the song (period 4) — NO trailing blank,
    // so the ruler shows 4 major ticks and the last clip's edge sits at the wall.
    expect(container.querySelectorAll('[data-full-song-tick="major"]').length).toBe(4)
    // Grab arm 1's right edge (the song end, cycle 4 → x=800) and drag RIGHT to
    // a content-x mapping to cycle 6 (1200px at the constant 200px/cycle). The
    // edge tracks the cursor 1:1 (constant px/cycle) and the span grows to make
    // room: displayCycles = max(4, 6 + EXTEND_MARGIN(2)) = 8.
    fireEvent.pointerDown(grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 1200, clientY: 10, pointerId: 1 }) // cycle 6
    // Mid-drag the span GREW — 8 major ticks now (the empty extend room is real
    // timeline). The pre-#487 code held the span fixed at 4; this is the
    // discriminator for the grow logic.
    expect(container.querySelectorAll('[data-full-song-tick="major"]').length).toBe(8)
    fireEvent.pointerUp(grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    // arm 1 extended from weight 2 (span [2,4)) to weight 4 (end cycle 6).
    expect(onTrimClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 1, weight: 4 })
    // On release the transient room collapses → back to 4 majors (no permanent
    // blank; the real re-eval would then grow the period to fill it).
    expect(container.querySelectorAll('[data-full-song-tick="major"]').length).toBe(4)
  })

  it('a click that lands NOT on a clip edge does not trim (and no longer seeks — #610)', async () => {
    const onTrimClip = vi.fn()
    const { grid, onSeek } = renderTrimmable(onTrimClip)
    await act(async () => {
      await Promise.resolve()
    })
    // Mid-clip (x=100 ≈ cycle 0.5), nowhere near an edge → no trim. The grid no
    // longer seeks either (#610 moved seek to the ruler); with no onSelectLane
    // wired here the click is a no-op.
    fireEvent.pointerDown(grid, { clientX: 100, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 100, clientY: 10, pointerId: 1 })
    expect(onTrimClip).not.toHaveBeenCalled()
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('a drag that does not change the weight does not fire onTrimClip', async () => {
    const onTrimClip = vi.fn()
    const { grid } = renderTrimmable(onTrimClip)
    await act(async () => {
      await Promise.resolve()
    })
    // Grab the edge and release without crossing into a new cycle (stays weight 2).
    fireEvent.pointerDown(grid, { clientX: 398, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 402, clientY: 10, pointerId: 1 }) // still cycle 2
    fireEvent.pointerUp(grid, { clientX: 402, clientY: 10, pointerId: 1 })
    expect(onTrimClip).not.toHaveBeenCalled()
  })
})

describe('FullSongTimeline — delete a clip (select body + Delete → remove-arm, #386)', () => {
  // Same `arrange([2, s("bd")], [2, s("hh")])`-shaped fixture: the bd lane has two
  // real clips (arm 0 [0,2), arm 1 [2,4)) at 200px/cycle, so arm 0's body centre
  // sits at x≈200 and arm 1's at x≈600 (bd row y≈10). The hh lane carries no
  // armIndex events, so it gets ONE implicit clip (armIndex −1, not deletable).
  function renderDeletable(onDeleteClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: {} as never, onDeleteClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }

  const settle = () => act(async () => { await Promise.resolve() })

  it('selecting arm 0’s body then Delete → onDeleteClip(arm 0)', async () => {
    const onDeleteClip = vi.fn()
    const { grid, container } = renderDeletable(onDeleteClip)
    await settle()
    // Click arm 0's body (x≈200 = cycle 1, bd row) → selects it (highlight shows).
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    // Delete removes that arm — assert the VALUE (sourceOffset = bd lane anchor 9).
    fireEvent.keyDown(grid, { key: 'Delete' })
    expect(onDeleteClip).toHaveBeenCalledTimes(1)
    expect(onDeleteClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0 })
    // Selection clears after the delete fires.
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })

  it('Backspace also deletes the selected clip (arm 1)', async () => {
    const onDeleteClip = vi.fn()
    const { grid } = renderDeletable(onDeleteClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // arm 1 body
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 'Backspace' })
    expect(onDeleteClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 1 })
  })

  it('Delete with nothing selected is a no-op', async () => {
    const onDeleteClip = vi.fn()
    const { grid } = renderDeletable(onDeleteClip)
    await settle()
    fireEvent.keyDown(grid, { key: 'Delete' })
    expect(onDeleteClip).not.toHaveBeenCalled()
  })

  it('clicking the bare/implicit clip (hh lane) + Delete → gap at the clicked bar (#489)', async () => {
    const onDeleteClip = vi.fn()
    const { grid, container } = renderDeletable(onDeleteClip)
    await settle()
    // hh row (y≈30) has only the implicit clip (armIndex −1, span [0,4)). Clicking
    // x≈200 (cycle 1) selects bar 1; Delete carves a GAP there — the parent
    // materializes arrange([1,pat],[1,silence],[2,pat]) (#489). barIndex = the
    // clicked whole-cycle, span = the bare clip's floored width.
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 30, pointerId: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    fireEvent.keyDown(grid, { key: 'Delete' })
    expect(onDeleteClip).toHaveBeenCalledTimes(1)
    expect(onDeleteClip.mock.calls[0][0]).toMatchObject({ armIndex: -1, barIndex: 1, span: 4 })
    // Selection clears after the delete fires.
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })

  it('clicking a clip selects it but no longer seeks (#610 — seek moved to the ruler)', async () => {
    const onDeleteClip = vi.fn()
    const { grid, container, onSeek } = renderDeletable(onDeleteClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    // Selection (for clip ops) is preserved; the grid click no longer seeks.
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    expect(onSeek).not.toHaveBeenCalled()
  })
})

describe('FullSongTimeline — move a clip (drag body → reorder; bare clip = no-op, #386/#488)', () => {
  // Reorder fixture: the same two-arm bd lane (arm 0 [0,2), arm 1 [2,4)) at
  // 200px/cycle. Dragging arm 0's body (x≈200) right into arm 1's span (x≈600 =
  // cycle 3) reorders it to slot 1.
  function renderReorderable(onMoveClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: {} as never, onMoveClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  // Wrap fixture: a BARE track (no armIndex) → one implicit clip spanning [0,4).
  function renderWrappable(onMoveClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: { bare: true } as never, onMoveClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  const settle = () => act(async () => { await Promise.resolve() })

  it('dragging arm 0’s body into arm 1’s span → onMoveClip reorder(0 → 1)', async () => {
    const onMoveClip = vi.fn()
    const { grid } = renderReorderable(onMoveClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // arm 0 body
    fireEvent.pointerMove(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // cycle 3 = arm 1 span
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(onMoveClip).toHaveBeenCalledTimes(1)
    expect(onMoveClip).toHaveBeenCalledWith({ kind: 'reorder', sourceOffset: 9, fromIndex: 0, toIndex: 1 })
  })

  it('a body press that does not travel is a click (select), not a move', async () => {
    const onMoveClip = vi.fn()
    const { grid, container } = renderReorderable(onMoveClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 202, clientY: 10, pointerId: 1 }) // 2px < threshold
    fireEvent.pointerUp(grid, { clientX: 202, clientY: 10, pointerId: 1 })
    expect(onMoveClip).not.toHaveBeenCalled()
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
  })

  it('dropping a clip back on its own span does not fire onMoveClip', async () => {
    const onMoveClip = vi.fn()
    const { grid } = renderReorderable(onMoveClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 100, clientY: 10, pointerId: 1 }) // still arm 0 span
    fireEvent.pointerUp(grid, { clientX: 100, clientY: 10, pointerId: 1 })
    expect(onMoveClip).not.toHaveBeenCalled()
  })

  it('clears a held selection after a reorder (no stale armIndex, #448)', async () => {
    const onMoveClip = vi.fn()
    const { grid, container } = renderReorderable(onMoveClip)
    await settle()
    // Select arm 1 (a non-drag click) — the highlight shows.
    fireEvent.pointerDown(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    // Now reorder arm 0 → arm 1's span; the arm list reindexes, so selection clears.
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(onMoveClip).toHaveBeenCalledWith({ kind: 'reorder', sourceOffset: 9, fromIndex: 0, toIndex: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })

  it('dragging a BARE track’s clip is a no-op — onMoveClip never fires (#488)', async () => {
    const onMoveClip = vi.fn()
    const { grid, container } = renderWrappable(onMoveClip)
    await settle()
    // The implicit clip tiles [0,4) uniformly; dragging it must NOT introduce an
    // arrange/silence (a uniform pattern has no distinct clip to move).
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // cycle 3
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    expect(onMoveClip).not.toHaveBeenCalled()
    // A bare clip isn't selectable either — the press falls through to seek.
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })
})

describe('FullSongTimeline — duplicate a clip (select + ⌘/Ctrl-D → insert arm, #386)', () => {
  function renderDuplicatable(onDuplicateClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: {} as never, onDuplicateClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  const settle = () => act(async () => { await Promise.resolve() })

  it('selecting arm 0 then ⌘-D → onDuplicateClip(arm 0)', async () => {
    const onDuplicateClip = vi.fn()
    const { grid } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // select arm 0
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(onDuplicateClip).toHaveBeenCalledTimes(1)
    expect(onDuplicateClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0 })
  })

  it('Ctrl-D also duplicates (arm 1)', async () => {
    const onDuplicateClip = vi.fn()
    const { grid } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 600, clientY: 10, pointerId: 1 }) // arm 1
    fireEvent.pointerUp(grid, { clientX: 600, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 'd', ctrlKey: true })
    expect(onDuplicateClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 1 })
  })

  it('⌘⇧-D does NOT duplicate, while ⌘-D on the same selection does (#1421)', async () => {
    // `e.key` is the produced character, so Shift+d is literally 'D' — the
    // handler's `|| e.key === 'D'` used to swallow ⌘⇧D and duplicate on it.
    // ⚠ Both halves in ONE arm on purpose. The negative alone would also pass
    // if the whole handler were broken, which is the failure it is meant to
    // exclude; the positive that follows is what makes the silence meaningful.
    const onDuplicateClip = vi.fn()
    const { grid } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // select arm 0
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })

    fireEvent.keyDown(grid, { key: 'D', metaKey: true, shiftKey: true })
    expect(onDuplicateClip, '⌘⇧D must not duplicate').not.toHaveBeenCalled()

    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(onDuplicateClip, 'the selection was live all along').toHaveBeenCalledTimes(1)
  })

  it('⌘-D still duplicates when Shift is absent but the key arrives capitalised', async () => {
    // Capslock produces 'D' with no shiftKey. That case was always meant to
    // work and must survive the guard — the guard is about SHIFT, not case.
    const onDuplicateClip = vi.fn()
    const { grid } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 'D', metaKey: true })
    expect(onDuplicateClip).toHaveBeenCalledTimes(1)
  })

  it('⌘-D with nothing selected is a no-op', async () => {
    const onDuplicateClip = vi.fn()
    const { grid } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(onDuplicateClip).not.toHaveBeenCalled()
  })

  it('clears the selection after duplicating (no stale armIndex, #448)', async () => {
    const onDuplicateClip = vi.fn()
    const { grid, container } = renderDuplicatable(onDuplicateClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // select arm 0
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })
})

describe('FullSongTimeline — split a clip (select + S → split arm at midpoint, #386)', () => {
  function renderSplittable(onSplitClip: ReturnType<typeof vi.fn>) {
    const utils = renderFull({ ir: {} as never, onSplitClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  const settle = () => act(async () => { await Promise.resolve() })

  it('selecting a 2-cycle arm then S → onSplitClip(firstWeight = midpoint 1)', async () => {
    const onSplitClip = vi.fn()
    const { grid } = renderSplittable(onSplitClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // arm 0 [0,2)
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 's' })
    expect(onSplitClip).toHaveBeenCalledTimes(1)
    // weight 2 → midpoint firstWeight = floor(2/2) = 1; span = clip width (2)
    expect(onSplitClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0, firstWeight: 1, span: 2 })
  })

  it('S with nothing selected is a no-op', async () => {
    const onSplitClip = vi.fn()
    const { grid } = renderSplittable(onSplitClip)
    await settle()
    fireEvent.keyDown(grid, { key: 's' })
    expect(onSplitClip).not.toHaveBeenCalled()
  })

  it('clears the selection after splitting (#448)', async () => {
    const onSplitClip = vi.fn()
    const { grid, container } = renderSplittable(onSplitClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 }) // select arm 0 [0,2)
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    expect(container.querySelector('[data-full-song="clip-selection"]')).not.toBeNull()
    fireEvent.keyDown(grid, { key: 's' })
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })

  it('⌘-S (save) does not trigger a split', async () => {
    const onSplitClip = vi.fn()
    const { grid } = renderSplittable(onSplitClip)
    await settle()
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 's', metaKey: true })
    expect(onSplitClip).not.toHaveBeenCalled()
  })
})

describe('FullSongTimeline — NESTED combinator arm binds the OUTER arrange (#451)', () => {
  // `arrange([2, cat(s("bd"),s("sd"))], [1, s("hh")])`: the cat block is ONE
  // outer clip (arm 0, cycles [0,2)). Gestures must bind the OUTER arrange
  // (sourceOffset = 0, the `arrange(` token) — NOT the inner cat at offset 12 —
  // so the op edits the outer arm. Period 3 over 800px → 266.7px/cycle.
  function renderNested(overrides: Partial<React.ComponentProps<typeof FullSongTimeline>>) {
    const utils = renderFull({ ir: { nested: true } as never, analysis: nestedAnalysis, ...overrides })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  const settle = () => act(async () => { await Promise.resolve() })

  it('the cat block is ONE clip spanning the outer weight (split → firstWeight 1)', async () => {
    // Splitting at the midpoint yields floor(weight/2). firstWeight 1 holds ONLY
    // if the cat block clip has weight 2 (the whole outer arm) — i.e. bd/sd did
    // NOT become separate 1-cycle clips. Also confirms the OUTER offset (0).
    const onSplitClip = vi.fn()
    const { grid } = renderNested({ onSplitClip })
    await settle()
    fireEvent.pointerDown(grid, { clientX: 133, clientY: 10, pointerId: 1 }) // select cat block
    fireEvent.pointerUp(grid, { clientX: 133, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 's' })
    expect(onSplitClip).toHaveBeenCalledWith({ sourceOffset: 0, armIndex: 0, firstWeight: 1, span: 2 })
  })

  it('⌘-D on the cat block dispatches the OUTER arrange offset (0), not the inner cat (12)', async () => {
    const onDuplicateClip = vi.fn()
    const { grid } = renderNested({ onDuplicateClip })
    await settle()
    // Click inside the cat block (cycle ~0.5 → x≈133), song row (y≈10).
    fireEvent.pointerDown(grid, { clientX: 133, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 133, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(onDuplicateClip).toHaveBeenCalledWith({ sourceOffset: 0, armIndex: 0 })
  })

  it('trimming the cat block’s right edge dispatches the OUTER arrange offset (0)', async () => {
    const onTrimClip = vi.fn()
    const { grid } = renderNested({ onTrimClip })
    await settle()
    // arm 0's right edge is cycle 2 → x = 2*266.7 ≈ 533; grab 2px inside, drag
    // to cycle 1 (x≈267) → shrink the OUTER arm 0 to weight 1.
    fireEvent.pointerDown(grid, { clientX: 531, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 267, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 267, clientY: 10, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledTimes(1)
    expect(onTrimClip).toHaveBeenCalledWith({ sourceOffset: 0, armIndex: 0, weight: 1 })
  })
})

describe('FullSongTimeline — resize a bare loop (#662, set display span; option B = no write-back)', () => {
  const settle = () => act(async () => { await Promise.resolve() })

  // A PURE bare song mirroring `$: s("bd*4")`: one lane, content period 1 cycle
  // (the pattern tiles every cycle). So the natural floor is 1 and the user can
  // shrink the DISPLAY span down to the MIN_BARE_SPLIT_SPAN clamp (2). The fixture
  // analysis used by the trim tests has period 4 — too coarse to exercise shrink.
  const bareAnalysis: SongAnalysis = {
    periodCycles: 1,
    horizonCycles: 1,
    displaySpan: { kind: 'loop', cycles: 1 },
    repeatCycles: 1, lanePeriods: [],
    lanes: [{ laneKey: 'bd', onsetsByCycle: [4] }],
    sections: [{ startCycle: 0, endCycle: 1, laneKeys: ['bd'] }],
  }

  // Every test already gets fresh in-memory storage from vitest.setup.ts (#2126).
  // This suite installs its own Map-backed Storage on top (the idiom of
  // timelineCameraPersistence.test, from before that setup existed); the bare
  // span override round-trips through it. Fresh per test → isolation.
  let originalStorage: PropertyDescriptor | undefined
  beforeEach(() => {
    originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
    const map = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        get length() { return map.size },
        clear: () => map.clear(),
        getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
        key: (i: number) => Array.from(map.keys())[i] ?? null,
        removeItem: (k: string) => map.delete(k),
        setItem: (k: string, v: string) => { map.set(k, String(v)) },
      } as Storage,
    })
  })
  afterEach(() => {
    if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage)
  })

  // BARE_EVENTS (no armIndex) → one implicit clip per lane spanning [0, displaySpan).
  // `onTrimClip` is wired so the edge hit-test runs — but a bare resize must NEVER
  // call it (option B writes no code). `onSplitClip` lets the split-at-span test
  // observe the chosen granularity flowing through.
  function renderBareResizable() {
    const onTrimClip = vi.fn()
    const onSplitClip = vi.fn()
    const utils = renderFull({ analysis: bareAnalysis, ir: { bare: true } as never, onTrimClip, onSplitClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid, onTrimClip, onSplitClip }
  }

  const majors = (c: HTMLElement) => c.querySelectorAll('[data-full-song-tick="major"]').length

  it('drags the bare clip’s right edge to EXTEND the span — grows bars, writes NO code', async () => {
    const { grid, container, onTrimClip } = renderBareResizable()
    await settle()
    // At rest the bare loop is floored to MIN_BARE_SPAN (4) → 4 major ticks; its
    // single implicit clip’s right edge sits at the song end (cycle 4 → x=800).
    expect(majors(container as unknown as HTMLElement)).toBe(4)
    // Grab the bare edge (x=798, 2px inside) in the bd row (y≈10) and drag RIGHT to
    // a content-x mapping to cycle 6 (1200px at the constant 200px/cycle).
    fireEvent.pointerDown(grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    // Mid-drag the transient extend room is real timeline: max(4, 6 + MARGIN 2) = 8.
    expect(majors(container as unknown as HTMLElement)).toBe(8)
    fireEvent.pointerUp(grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    // On release the OVERRIDE persists (unlike #487 real-trim, which collapses the
    // room): displaySpan = max(2, natural 1, override 6) = 6 → 6 majors that STAY.
    expect(majors(container as unknown as HTMLElement)).toBe(6)
    // Option B observation gate: NO code write-back — the set-weight handler is
    // never called. Only Split/Delete (separate gestures) write code.
    expect(onTrimClip).not.toHaveBeenCalled()
  })

  it('drags the edge LEFT to shrink — clamped at MIN_BARE_SPLIT_SPAN (2) so Split stays possible', async () => {
    const { grid, container, onTrimClip } = renderBareResizable()
    await settle()
    expect(majors(container as unknown as HTMLElement)).toBe(4)
    // Grab the edge (cycle 4 → x=798) and drag hard LEFT past cycle 0 (x=0). The
    // bare clamp floors the span at 2 — never below a splittable 2 bars.
    fireEvent.pointerDown(grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 0, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 0, clientY: 10, pointerId: 1 })
    // displaySpan = max(2, natural 1, override 2) = 2 → 2 majors.
    expect(majors(container as unknown as HTMLElement)).toBe(2)
    expect(onTrimClip).not.toHaveBeenCalled()
  })

  it('persists the resized span to the camera and restores it on a fresh mount (reload)', async () => {
    const first = renderBareResizable()
    await settle()
    fireEvent.pointerDown(first.grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(first.grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(first.grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    expect(majors(first.container as unknown as HTMLElement)).toBe(6)
    // The override landed in the persisted camera under `bareSpan`.
    const cam = JSON.parse(window.localStorage.getItem('stave:timelineCamera') ?? '{}')
    expect(cam.bareSpan).toBe(6)
    cleanup()
    // A fresh mount (a reload) seeds the override from the camera → 6 bars with NO
    // drag. This is the "persists across reload" guarantee at the unit level.
    const second = renderBareResizable()
    await settle()
    expect(majors(second.container as unknown as HTMLElement)).toBe(6)
  })

  it('after extending to 6, selecting the bare clip + S splits at the CHOSEN span (6), not the floor (4)', async () => {
    const { grid, onSplitClip } = renderBareResizable()
    await settle()
    // Extend to 6 bars.
    fireEvent.pointerDown(grid, { clientX: 798, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 1200, clientY: 10, pointerId: 1 })
    // Select the bare clip (a click that does NOT travel) in the bd row.
    fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    // `S` materializes the combinator at the bare clip’s width — now 6, the chosen
    // span — so split → arrange([3, pat], [3, pat]). The span flows through the
    // clip’s endCycle (= displaySpan) for free, no serializer change (#662).
    fireEvent.keyDown(grid, { key: 's' })
    expect(onSplitClip).toHaveBeenCalledTimes(1)
    expect(onSplitClip.mock.calls[0][0]).toMatchObject({ armIndex: -1, firstWeight: 3, span: 6 })
  })
})

describe('FullSongTimeline — the marks are read for the WINDOW on screen (#1209)', () => {
  // The view's marks used to be read as a PREFIX (`getTimelineEvents(span)`)
  // and derived over `[0, span)`, whatever the origin. Once the view pages that
  // is the wrong stretch of song twice over: it asks for events the window does
  // not contain, and it discards the ones it does. These arms drive the real
  // memo through a real render, so they fail if production stops threading the
  // window — which is what separates them from arms that restate the rule.
  function renderAtOrigin(originCycle: number) {
    const band = vi.fn(() => [] as never[])
    const prefix = vi.fn(() => [] as never[])
    renderFull({
      ir: {} as never,
      windowOriginCycles: originCycle,
      getTimelineEventsBand: band as never,
      getTimelineEvents: prefix as never,
    })
    return { band, prefix }
  }

  it('asks the BAND accessor for the window, not for a prefix from cycle 0', () => {
    // The fixture's display span is 4, so the second page is [4, 8).
    const { band, prefix } = renderAtOrigin(4)

    expect(band).toHaveBeenCalled()
    expect(band.mock.calls[0]).toEqual([4, 8])
    // ⚠ The whole point of the band accessor: a deep page must not query and
    // discard everything to its left. If the prefix form is still reached while
    // a band accessor is wired, that cost is back.
    expect(prefix).not.toHaveBeenCalled()
  })

  it('at origin 0 it asks for [0, span) — the unpaged behaviour, unchanged', () => {
    const { band } = renderAtOrigin(0)
    expect(band.mock.calls[0]).toEqual([0, 4])
  })

  it('falls back to the PREFIX accessor when no band accessor is wired', () => {
    // Correct, just slow: the prefix returns a superset and `collectNoteMarks`
    // narrows it to the window.
    const prefix = vi.fn(() => [] as never[])
    renderFull({
      ir: {} as never,
      windowOriginCycles: 4,
      getTimelineEvents: prefix as never,
    })
    expect(prefix).toHaveBeenCalled()
    expect(prefix.mock.calls[0]).toEqual([8])
  })
})

describe('FullSongTimeline — trim a REGION (drag a mark edge → .begin/.end, #1527)', () => {
  // The fixture's bd lane has four 1-cycle marks. At zoom 1 the period (4) fits
  // 800px → 200px/cycle, so the mark at cycle 1 is the rect x∈[200,400).
  //
  // Its Y is derived, not guessed: an expanded single-voice percussive lane is
  // one 22px sub-row (the mocked row height), `laneMarkBands` insets it by 3 and
  // gives an expanded mark 4px, so the band is [3, 15) and the mark sits on its
  // centre line at y=9, occupying [9, 13). y=10 is inside it; y=20 is not.
  //
  // ⚠ THE HAPS CARRY `trackId: 'bd'` AND THAT IS LOAD-BEARING. With the clip
  // fixture's own events — which have no `trackId` — the marks are keyed to an
  // EVAL-BACKED lane appended after the analysis lanes, so they land on a lane
  // that has no clips and no source anchor, and the precedence arm below cannot
  // contest anything. Naming the track puts the marks on the same lane as the
  // clips, which is what the app does for a declared track.
  //
  // With `bd` expanded the rows are bd [0,22), hh [22,44); an expanded
  // single-voice percussive lane is inset 3 and its mark is 4px, so the mark
  // band is [9, 13). y=20 is inside the lane and outside the mark.
  const MARK_LANE = 'bd'
  const MARK_X = 200
  const MARK_Y = 10
  const OUTSIDE_MARK_Y = 20
  const REGION_EVENTS = TRIM_EVENTS.map((e) => ({ ...e, trackId: 'bd' }))

  function renderRegion(
    onTrimRegion: ReturnType<typeof vi.fn>,
    extra?: Partial<React.ComponentProps<typeof FullSongTimeline>>,
  ) {
    // ⚠ `getTimelineEvents` IS LOAD-BEARING HERE, and its absence is why the
    // first version of these arms passed by never applying. Note marks come from
    // the EVENT accessors on the props, not from the barrel's `collectCycles`
    // — the clip fixtures above need no haps because clips come off the IR walk.
    // Without it the lanes carry zero marks and every "is inert" arm below is
    // vacuous while every "it fires" arm is impossible.
    const utils = renderFull({
      ir: {} as never,
      onTrimRegion,
      getTimelineEvents: () => REGION_EVENTS as never,
      ...extra,
    })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }

  /** Expand a lane — the gesture is deliberately inert on a collapsed one. */
  async function expandLane(container: HTMLElement, laneKey: string) {
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      ;(container.querySelector(`[data-full-song-lane-expand="${laneKey}"]`) as HTMLElement).click()
    })
  }

  it('drags a mark’s LEFT edge → onTrimRegion(begin), scaled by the mark’s width', async () => {
    const onTrimRegion = vi.fn()
    const { grid, container } = renderRegion(onTrimRegion)
    await expandLane(container, MARK_LANE)
    // 80px of travel across a 200px mark = 0.4 of the file.
    fireEvent.pointerDown(grid, { clientX: MARK_X, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: MARK_X + 80, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: MARK_X + 80, clientY: MARK_Y, pointerId: 1 })
    expect(onTrimRegion).toHaveBeenCalledTimes(1)
    const req = onTrimRegion.mock.calls[0][0]
    expect(req.side).toBe('begin')
    expect(req.value).toBeCloseTo(0.4, 6)
    // The mark plays the whole file — no region controls on the fixture.
    expect(req.playing).toEqual({ begin: 0, end: 1 })
    // The lane's anchors, statement first. These events carry no `dollarPos`, so
    // only the content anchor exists — which is exactly the case the ordered
    // list is there to handle.
    expect(req.anchors).toEqual([9])
  })

  it('drags a mark’s RIGHT edge → onTrimRegion(end)', async () => {
    const onTrimRegion = vi.fn()
    const { grid, container } = renderRegion(onTrimRegion)
    await expandLane(container, MARK_LANE)
    // The LAST mark spans [3,4) → its right edge is x=800, with no neighbour to
    // contest it. Drag LEFT by 100px across a 200px mark → 1 − 0.5.
    fireEvent.pointerDown(grid, { clientX: 800, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 700, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 700, clientY: MARK_Y, pointerId: 1 })
    const req = onTrimRegion.mock.calls[0][0]
    expect(req.side).toBe('end')
    expect(req.value).toBeCloseTo(0.5, 6)
  })

  it('⚠ where two marks touch, BOTH gestures stay reachable', async () => {
    // Marks at cycles 1 and 2 abut at x=400. With grip bands centred on the
    // edges, the eight pixels around that join claimed both the earlier mark's
    // `end` and the later one's `begin`, and the scan resolved them to a `begin`
    // already at 0 — where dragging left clamps to 0 and commits nothing. The
    // bands lie inside the marks instead, so each side of the join is its own
    // gesture. This is the arm that fails if they ever straddle again.
    const onTrimRegion = vi.fn()
    const { grid, container } = renderRegion(onTrimRegion)
    await expandLane(container, MARK_LANE)
    // Just LEFT of the join → the earlier mark's `end`, draggable downwards.
    fireEvent.pointerDown(grid, { clientX: 397, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 297, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 297, clientY: MARK_Y, pointerId: 1 })
    expect(onTrimRegion.mock.calls[0][0].side).toBe('end')
    expect(onTrimRegion.mock.calls[0][0].value).toBeCloseTo(0.5, 6)
    // Just RIGHT of it → the later mark's `begin`, draggable upwards.
    fireEvent.pointerDown(grid, { clientX: 403, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 503, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 503, clientY: MARK_Y, pointerId: 1 })
    expect(onTrimRegion.mock.calls[1][0].side).toBe('begin')
    expect(onTrimRegion.mock.calls[1][0].value).toBeCloseTo(0.5, 6)
  })

  it('⚠ is INERT on a collapsed lane — the waveform it trims is not drawn there', async () => {
    const onTrimRegion = vi.fn()
    const { grid, container } = renderRegion(onTrimRegion)
    // Deliberately NOT expanded.
    await act(async () => {
      await Promise.resolve()
    })
    expect(
      (container.querySelector(`[data-full-song-lane="${MARK_LANE}"]`) as HTMLElement).getAttribute(
        'data-expanded',
      ),
    ).toBe('false')
    fireEvent.pointerDown(grid, { clientX: MARK_X, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: MARK_X + 80, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: MARK_X + 80, clientY: MARK_Y, pointerId: 1 })
    expect(onTrimRegion).not.toHaveBeenCalled()
  })

  it('does not fire off the mark’s own band', async () => {
    const onTrimRegion = vi.fn()
    const { grid, container } = renderRegion(onTrimRegion)
    await expandLane(container, MARK_LANE)
    fireEvent.pointerDown(grid, { clientX: MARK_X, clientY: OUTSIDE_MARK_Y, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: MARK_X + 80, clientY: OUTSIDE_MARK_Y, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: MARK_X + 80, clientY: OUTSIDE_MARK_Y, pointerId: 1 })
    expect(onTrimRegion).not.toHaveBeenCalled()
  })

  it('a press that never moves does not commit', async () => {
    const onTrimRegion = vi.fn()
    const { grid, container } = renderRegion(onTrimRegion)
    await expandLane(container, MARK_LANE)
    fireEvent.pointerDown(grid, { clientX: MARK_X, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: MARK_X, clientY: MARK_Y, pointerId: 1 })
    expect(onTrimRegion).not.toHaveBeenCalled()
  })

  it('a cancelled drag discards, and clears the edge ghost', async () => {
    const onTrimRegion = vi.fn()
    const { grid, container } = renderRegion(onTrimRegion)
    await expandLane(container, MARK_LANE)
    fireEvent.pointerDown(grid, { clientX: MARK_X, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: MARK_X + 80, clientY: MARK_Y, pointerId: 1 })
    // The ghost is the drag's only visible feedback — a region is a fraction of
    // a file and nothing else on screen reads it off.
    expect(container.querySelector('[data-full-song="region-edge"]')).not.toBeNull()
    fireEvent.pointerCancel(grid, { clientX: MARK_X + 80, clientY: MARK_Y, pointerId: 1 })
    expect(onTrimRegion).not.toHaveBeenCalled()
    expect(container.querySelector('[data-full-song="region-edge"]')).toBeNull()
  })

  it('⚠ the CLIP edge keeps precedence where the two gestures contest a pixel', async () => {
    // Arm 0's right edge is at x=400, which is also the cycle-1 mark's right
    // edge. The arrangement trim is the established gesture and wins; without
    // this ordering the clip trim would become ungrabbable on an expanded lane.
    const onTrimRegion = vi.fn()
    const onTrimClip = vi.fn()
    const { grid, container } = renderRegion(onTrimRegion, { onTrimClip })
    await expandLane(container, MARK_LANE)
    fireEvent.pointerDown(grid, { clientX: 400, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 600, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 600, clientY: MARK_Y, pointerId: 1 })
    expect(onTrimClip).toHaveBeenCalledTimes(1)
    expect(onTrimRegion).not.toHaveBeenCalled()
  })

  it('is inert with no handler wired — the marks stay read-only', async () => {
    const { grid, container } = renderRegion(vi.fn(), { onTrimRegion: undefined })
    await expandLane(container, MARK_LANE)
    fireEvent.pointerDown(grid, { clientX: MARK_X, clientY: MARK_Y, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: MARK_X + 80, clientY: MARK_Y, pointerId: 1 })
    expect(container.querySelector('[data-full-song="region-edge"]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Loop locators (#1570) — the strip along the top of the ruler
// ---------------------------------------------------------------------------
// Grounded on Logic's cycle area and Ableton's loop brace: drag in the top part
// of the ruler to draw a loop, which arms immediately; drag an edge to resize;
// drag the middle to move; click to switch it off and back on without losing
// where the locators are.
//
// ⚠ jsdom reports a zero-width rect, which would collapse every cycle to 0 and
// make each assertion below pass against any implementation. So the ruler's rect
// is stubbed to a real width — without it these are not tests, they are shapes.
describe('FullSongTimeline loop locators (#1570)', () => {
  const RULER_WIDTH = 800

  beforeEach(() => {
    __resetLoopStateForTests()
  })

  /** Render, then give the ruler area a real rect so x→cycle means something. */
  async function renderWithRuler() {
    const utils = renderFull()
    await act(async () => {
      await Promise.resolve()
    })
    const strip = utils.container.querySelector('[data-full-song="loop-strip"]') as HTMLElement
    // ⚠ THE GRID, not the ruler. Both the seek and the loop inversion resolve
    // through the GRID's rect — the ruler and grid share a left edge and a
    // scrollLeft, and the component's own comment says so. Stubbing the ruler's
    // rect instead leaves every cycle at 0, which reads as "the gesture does
    // nothing" rather than as a mis-aimed stub.
    const area = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    area.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: RULER_WIDTH, height: 28, right: RULER_WIDTH, bottom: 28, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    // The fixture song is 4 cycles wide over 800px → 200px per cycle.
    return { ...utils, strip, area }
  }

  it('renders the strip, and no band until a loop is drawn', async () => {
    const { container, strip } = await renderWithRuler()
    expect(strip).not.toBeNull()
    expect(container.querySelector('[data-full-song="loop-band"]')).toBeNull()
  })

  it('a drag draws a loop, and arms it immediately', async () => {
    const { container, strip } = await renderWithRuler()
    fireEvent.pointerDown(strip, { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 600, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 600, pointerId: 1 })

    // 200px → cycle 1, 600px → cycle 3, over a 4-cycle song in 800px.
    expect(getLoopState().range).toEqual({ startCycle: 1, cycles: 2 })
    expect(getLoopState().enabled).toBe(true) // "Cycle mode is automatically turned on"
    expect(container.querySelector('[data-full-song="loop-band"]')).not.toBeNull()
  })

  it('draws the same loop dragged right-to-left', async () => {
    const { strip } = await renderWithRuler()
    fireEvent.pointerDown(strip, { clientX: 600, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 200, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 200, pointerId: 1 })
    expect(getLoopState().range).toEqual({ startCycle: 1, cycles: 2 })
  })

  // THE arm that decides the shape of the gesture. Every store write reaches the
  // transport, and the transport re-evaluates the document — so a drag that
  // committed per pointermove would hot-swap the audio on every frame.
  it('commits ONCE on release, not on every move', async () => {
    await renderWithRuler()
    let writes = 0
    const stop = subscribeLoopState(() => {
      writes++
    })
    const strip = document.querySelector('[data-full-song="loop-strip"]') as HTMLElement

    fireEvent.pointerDown(strip, { clientX: 200, pointerId: 1 })
    for (let x = 220; x <= 600; x += 20) {
      fireEvent.pointerMove(strip, { clientX: x, pointerId: 1 })
    }
    expect(writes).toBe(0) // twenty frames of drag, nothing written
    fireEvent.pointerUp(strip, { clientX: 600, pointerId: 1 })
    expect(writes).toBe(1)
    stop()
  })

  it('does not seek while drawing a loop', async () => {
    const { strip, onSeek } = await renderWithRuler()
    fireEvent.pointerDown(strip, { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 600, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 600, pointerId: 1 })
    // The ruler underneath is a seek surface; the strip has to stop the event
    // or drawing a loop would also jump the transport to where the drag began.
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('still seeks when the ruler itself is clicked (the control)', async () => {
    const { container, onSeek } = await renderWithRuler()
    const area = container.querySelector('[data-full-song="ruler-area"]') as HTMLElement
    fireEvent.pointerDown(area, { clientX: 400, pointerId: 1 })
    expect(onSeek).toHaveBeenCalledTimes(1)
  })

  it('a click toggles looping off and on, keeping the locators', async () => {
    const { strip } = await renderWithRuler()
    fireEvent.pointerDown(strip, { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 600, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 600, pointerId: 1 })

    fireEvent.pointerDown(strip, { clientX: 400, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 400, pointerId: 1 })
    expect(getLoopState().enabled).toBe(false)
    expect(getLoopState().range).toEqual({ startCycle: 1, cycles: 2 }) // still drawn

    fireEvent.pointerDown(strip, { clientX: 400, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 400, pointerId: 1 })
    expect(getLoopState().enabled).toBe(true)
  })

  it('dragging an edge resizes, leaving the other end where it was', async () => {
    const { strip } = await renderWithRuler()
    fireEvent.pointerDown(strip, { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 600, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 600, pointerId: 1 })

    // Grab the RIGHT edge (600px = cycle 3) and pull it in to cycle 2.
    fireEvent.pointerDown(strip, { clientX: 600, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 400, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 400, pointerId: 1 })
    expect(getLoopState().range).toEqual({ startCycle: 1, cycles: 1 })
  })

  it('dragging the middle moves the loop without changing its length', async () => {
    const { strip } = await renderWithRuler()
    fireEvent.pointerDown(strip, { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 600, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 600, pointerId: 1 })

    // Grab the middle (400px, clear of both edges) and shove it one cycle right.
    fireEvent.pointerDown(strip, { clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 600, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 600, pointerId: 1 })
    const range = getLoopState().range!
    expect(range.cycles).toBe(2) // length preserved — the arm that separates move from resize
    expect(range.startCycle).toBe(2)
  })
})

describe('FullSongTimeline — point a section at a different part (select + P → chooser, #1560)', () => {
  function renderChoosable(
    onAssignSectionPart: ReturnType<typeof vi.fn>,
    parts: string[] = ['bass', 'lead'],
  ) {
    const sectionParts = vi.fn(() => parts)
    const utils = renderFull({ ir: {} as never, onAssignSectionPart, sectionParts })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid, sectionParts }
  }
  const settle = () => act(async () => { await Promise.resolve() })
  const selectArm = (grid: HTMLElement, x: number) => {
    fireEvent.pointerDown(grid, { clientX: x, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: x, clientY: 10, pointerId: 1 })
  }

  it('P over a selected clip opens a chooser listing the document\'s parts', async () => {
    const onAssignSectionPart = vi.fn()
    const { grid, container, sectionParts } = renderChoosable(onAssignSectionPart)
    await settle()
    selectArm(grid, 200)
    fireEvent.keyDown(grid, { key: 'p' })
    const chooser = container.querySelector('[data-full-song="section-part"]') as HTMLSelectElement
    expect(chooser).not.toBeNull()
    // The fixture's clip plays an inline expression, so there is no name to
    // preselect — the ordinal the clip already draws leads the list rather than
    // a guess at what the expression is, and the parts follow.
    expect([...chooser.options].map((o) => o.textContent)).toEqual(['§1 (expression)', 'bass', 'lead'])
    expect(chooser.value).toBe('')
    // The list is ASKED for, with the clip it is about to be shown over.
    expect(sectionParts).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0 })
  })

  it('choosing a part calls onAssignSectionPart and clears the selection', async () => {
    const onAssignSectionPart = vi.fn()
    const { grid, container } = renderChoosable(onAssignSectionPart)
    await settle()
    selectArm(grid, 200)
    fireEvent.keyDown(grid, { key: 'p' })
    const chooser = container.querySelector('[data-full-song="section-part"]') as HTMLSelectElement
    fireEvent.change(chooser, { target: { value: 'lead' } })
    expect(onAssignSectionPart).toHaveBeenCalledTimes(1)
    expect(onAssignSectionPart).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0, part: 'lead' })
    // Keyed by sourceOffset + armIndex, and the write moves offsets (#448).
    expect(container.querySelector('[data-full-song="clip-selection"]')).toBeNull()
  })

  it('a MODIFIED P does not open the chooser, while a bare P on the same selection does', async () => {
    // ⚠ Both halves in ONE arm. The negative alone would also pass if the whole
    // handler were broken, which is the failure it exists to exclude — the shape
    // the silent ⌘⇧D duplicate binding taught (#1421).
    const onAssignSectionPart = vi.fn()
    const { grid, container } = renderChoosable(onAssignSectionPart)
    await settle()
    selectArm(grid, 200)

    fireEvent.keyDown(grid, { key: 'p', metaKey: true })
    expect(container.querySelector('[data-full-song="section-part"]'), '⌘P must not open it').toBeNull()
    fireEvent.keyDown(grid, { key: 'p', altKey: true })
    expect(container.querySelector('[data-full-song="section-part"]'), '⌥P must not open it').toBeNull()

    fireEvent.keyDown(grid, { key: 'p' })
    expect(container.querySelector('[data-full-song="section-part"]'), 'the selection was live all along').not.toBeNull()
  })

  it('opens with NOTHING to offer rather than doing nothing at all', async () => {
    // The distinction the gesture exists to keep: a song with no other part has
    // nowhere to point a section, and saying so is not the same as a dead key.
    const onAssignSectionPart = vi.fn()
    const { grid, container } = renderChoosable(onAssignSectionPart, [])
    await settle()
    selectArm(grid, 200)
    fireEvent.keyDown(grid, { key: 'p' })
    const chooser = container.querySelector('[data-full-song="section-part"]') as HTMLSelectElement
    expect(chooser).not.toBeNull()
    expect([...chooser.options].map((o) => o.textContent)).toContain('no other parts in this song')
    expect(onAssignSectionPart).not.toHaveBeenCalled()
  })

  it('P with nothing selected is a no-op', async () => {
    const onAssignSectionPart = vi.fn()
    const { grid, container } = renderChoosable(onAssignSectionPart)
    await settle()
    fireEvent.keyDown(grid, { key: 'p' })
    expect(container.querySelector('[data-full-song="section-part"]')).toBeNull()
    expect(onAssignSectionPart).not.toHaveBeenCalled()
  })

  it('Escape closes the chooser without writing', async () => {
    const onAssignSectionPart = vi.fn()
    const { grid, container } = renderChoosable(onAssignSectionPart)
    await settle()
    selectArm(grid, 200)
    fireEvent.keyDown(grid, { key: 'p' })
    const chooser = container.querySelector('[data-full-song="section-part"]') as HTMLSelectElement
    fireEvent.keyDown(chooser, { key: 'Escape' })
    expect(container.querySelector('[data-full-song="section-part"]')).toBeNull()
    expect(onAssignSectionPart).not.toHaveBeenCalled()
  })

  it('a keystroke inside the chooser cannot reach the clip-delete branch', async () => {
    // ⚠ The guard, not a belt over a brace: this control is a DOM descendant of
    // the element carrying the grid handler and React's onKeyDown BUBBLES, so
    // without stopPropagation a Backspace would delete the clip being re-pointed.
    const onDeleteClip = vi.fn()
    const sectionParts = vi.fn(() => ['bass', 'lead'])
    const utils = renderFull({ ir: {} as never, onAssignSectionPart: vi.fn(), sectionParts, onDeleteClip })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    await settle()
    selectArm(grid, 200)
    fireEvent.keyDown(grid, { key: 'p' })
    const chooser = utils.container.querySelector('[data-full-song="section-part"]') as HTMLSelectElement
    fireEvent.keyDown(chooser, { key: 'Backspace' })
    expect(onDeleteClip).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Edit a STEP on a stepped lane (#1463 Stage 3)
// ---------------------------------------------------------------------------
describe('FullSongTimeline — edit a STEP on a stepped lane (#1463 Stage 3)', () => {
  // A hand-built IR with ONE stepped parameter on the `bd` track, read by the
  // REAL `steppedAutomations` (the barrel mock loads it from source). The spans
  // are the offsets of the two step numbers, which is all an edit may write.
  //
  // Geometry: `bd` is the top lane, and each level's y is READ off the lane's
  // rendered height (`levelY`), never assumed. ⚠ The first draft assumed the 22px
  // expanded row the region arms above use, and every arm failed while the
  // product was right: those arms' haps carry a `trackId`, these have none, and
  // this lane expands to 96px. `gain`'s knob axis is 0…1. The period (4) fits
  // 800px → 200px/cycle, and `<0.2 0.8>` plays 0.2 in even cycles, 0.8 in odd.
  //
  // ⚠ EVERY SPAN IS ONE `parseStrudel` WOULD GIVE, AND THEY AGREE WITH EACH OTHER
  // (#1584). The reader now checks that the `Cycle` was parsed from the whole
  // literal, located from the call site and `rawArgs`. These are the offsets the
  // real parser gave `.gain("<0.2 0.8>")` at offset 9 (call 9–27, value 16–25,
  // steps 17–20 and 21–24), moved to put the steps at 40 and 44. The first draft
  // had no value span and a call site two characters off, which nothing read
  // until then.
  const STEPPED_IR = {
    tag: 'Stack',
    tracks: [
      {
        tag: 'Track',
        trackId: 'bd',
        body: {
          tag: 'Param',
          key: 'gain',
          rawArgs: '"<0.2 0.8>"',
          loc: [{ start: 32, end: 50 }],
          value: {
            tag: 'Cycle',
            loc: [{ start: 39, end: 48 }],
            items: [
              { tag: 'Play', note: '0.2', loc: [{ start: 40, end: 43 }] },
              { tag: 'Play', note: '0.8', loc: [{ start: 44, end: 47 }] },
            ],
          },
          body: { tag: 'Play', note: 'bd' },
        },
      },
    ],
  }

  function renderStepped(extra?: Partial<React.ComponentProps<typeof FullSongTimeline>>) {
    const utils = renderFull({ ir: STEPPED_IR as never, ...extra })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ...utils, grid }
  }
  const settle = () => act(async () => { await Promise.resolve() })
  async function expandBd(container: HTMLElement) {
    await settle()
    await act(async () => {
      ;(container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement).click()
    })
  }
  const stepEditor = (c: HTMLElement) =>
    c.querySelector('[data-full-song="automation-step"]') as HTMLInputElement | null
  /** A CLICK — down and up at one point. Since #1578 a press on a step is pending
   *  until release: travel makes it a drag, no travel opens the typed editor. */
  const press = (grid: HTMLElement, x: number, y: number) => {
    fireEvent.pointerDown(grid, { clientX: x, clientY: y, pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: x, clientY: y, pointerId: 1 })
  }

  /** Canvas y of `value`'s level on `bd`, from the lane's RENDERED height:
   *  `stepY` over the 0…1 gain axis, inset 3 top and bottom. Collapsed or
   *  expanded, whichever the row currently is. */
  const levelY = (container: HTMLElement, value: number) => {
    const h = parseFloat((container.querySelector('[data-full-song-lane="bd"]') as HTMLElement).style.height)
    return 3 + (1 - value) * (h - 6)
  }

  it('a press on a step opens its number, and Enter writes that step alone — with ONLY the automation handler wired', async () => {
    // Only `onEditAutomation`: the gesture must not depend on a clip handler being
    // present, which is the class the selectability gate once hid.
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    press(grid, 300, levelY(container, 0.8))
    const input = stepEditor(container)
    expect(input, 'no step editor opened on the 0.8 level').not.toBeNull()
    expect(input!.value).toBe('0.8')
    fireEvent.change(input!, { target: { value: '0.4' } })
    fireEvent.keyDown(input!, { key: 'Enter' })
    expect(onEditAutomation).toHaveBeenCalledTimes(1)
    expect(onEditAutomation).toHaveBeenCalledWith({ range: [44, 47], text: '0.4' }, 'automation gain step 1')
    expect(stepEditor(container), 'the editor lingered after its commit').toBeNull()
  })

  it('inside an arrangement section a press picks the step by the SECTION\'s count, and a bar the section is silent in has none (#1585)', async () => {
    // `arrange([1, s("hh")], [3, bd.gain("<0.2 0.8>")])`, the stepped `Param` being
    // the one above with its parser spans. Bars 1–3 are the section's cycles 0–2, so
    // bar 1 plays 0.2 where the song's own cycle would say 0.8, and bar 0 plays
    // nothing of it. The lane must be handed the reader's selection, not a copy.
    const SECTION_IR = {
      tag: 'Stack',
      tracks: [
        {
          tag: 'Track',
          trackId: 'bd',
          body: {
            tag: 'Arrange',
            mode: 'arrange',
            arms: [
              { weight: 1, pattern: { tag: 'Play', note: 'hh' } },
              { weight: 3, pattern: STEPPED_IR.tracks[0].body },
            ],
          },
        },
      ],
    }
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ ir: SECTION_IR as never, onEditAutomation })
    await expandBd(container)
    press(grid, 100, levelY(container, 0.2))
    press(grid, 100, levelY(container, 0.8))
    expect(stepEditor(container), 'a bar where the section is silent opened a step').toBeNull()
    press(grid, 300, levelY(container, 0.2))
    expect(stepEditor(container)?.value, 'bar 1 did not open the section\'s first step').toBe('0.2')
    fireEvent.change(stepEditor(container)!, { target: { value: '0.5' } })
    fireEvent.keyDown(stepEditor(container)!, { key: 'Enter' })
    expect(onEditAutomation.mock.calls.map((c) => c[0])).toEqual([{ range: [40, 43], text: '0.5' }])
  })

  it('the pressed bar only chooses WHICH step — a later bar playing it opens the same one', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    // Cycle 3 plays step 1 again.
    press(grid, 700, levelY(container, 0.8))
    expect(stepEditor(container)?.value).toBe('0.8')
    fireEvent.change(stepEditor(container)!, { target: { value: '0.6' } })
    fireEvent.keyDown(stepEditor(container)!, { key: 'Enter' })
    // Cycle 0 plays step 0.
    press(grid, 100, levelY(container, 0.2))
    expect(stepEditor(container)?.value).toBe('0.2')
    fireEvent.change(stepEditor(container)!, { target: { value: '0.5' } })
    fireEvent.keyDown(stepEditor(container)!, { key: 'Enter' })
    expect(onEditAutomation.mock.calls.map((c) => c[0])).toEqual([
      { range: [44, 47], text: '0.6' },
      { range: [40, 43], text: '0.5' },
    ])
  })

  it('pressing a second step while one is open commits the first and shows the SECOND step\'s number', async () => {
    // The editor is uncontrolled, so a reused input would keep the first step's
    // typed text on screen over the second step — and Enter would write it there.
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    press(grid, 300, levelY(container, 0.8))
    fireEvent.change(stepEditor(container)!, { target: { value: '0.9' } })
    press(grid, 100, levelY(container, 0.2))
    // Pressing away is leaving the field, and leaving commits — as the bounds editor does.
    expect(onEditAutomation.mock.calls.map((c) => c[0])).toEqual([{ range: [44, 47], text: '0.9' }])
    expect(stepEditor(container)?.value, 'the second step opened showing the first step\'s text').toBe('0.2')
  })

  it('a collapsed lane is inert, and so is a level the staircase does not hold at that bar', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await settle()
    press(grid, 300, levelY(container, 0.8))
    expect(stepEditor(container), 'a collapsed lane opened a step editor').toBeNull()
    await expandBd(container)
    // Cycle 0 plays 0.2, so the 0.8 height there is empty space.
    press(grid, 100, levelY(container, 0.8))
    expect(stepEditor(container), 'a press where no step is drawn opened one').toBeNull()
    // The CONTROL, same arm: the same height one bar later is the step.
    press(grid, 300, levelY(container, 0.8))
    expect(stepEditor(container)).not.toBeNull()
  })

  /** A key and the blur behind it, delivered inside ONE act so both handlers run
   *  before React re-renders — the browser's "Enter (or Escape), then the blur of
   *  the input being removed". ⚠ Two separate `fireEvent`s cannot show this, and
   *  the first version of these arms used them: the first event unmounts the
   *  input, the second reaches nothing, and a break of the once-only guard turned
   *  no arm red. */
  const keyThenBlur = (input: HTMLInputElement, key: string) =>
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })

  it('Escape writes nothing, even with a blur arriving behind it', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    press(grid, 300, levelY(container, 0.8))
    const input = stepEditor(container)!
    fireEvent.change(input, { target: { value: '0.9' } })
    keyThenBlur(input, 'Escape')
    expect(onEditAutomation, 'the blur behind Escape committed what was abandoned').not.toHaveBeenCalled()
    expect(stepEditor(container)).toBeNull()
  })

  it('an emptied entry writes nothing — not a step of zero', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    press(grid, 300, levelY(container, 0.8))
    fireEvent.change(stepEditor(container)!, { target: { value: '' } })
    fireEvent.keyDown(stepEditor(container)!, { key: 'Enter' })
    expect(onEditAutomation, 'an emptied step was written').not.toHaveBeenCalled()
  })

  it('Enter with a blur arriving behind it commits exactly once', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    press(grid, 300, levelY(container, 0.8))
    const input = stepEditor(container)!
    fireEvent.change(input, { target: { value: '0.3' } })
    keyThenBlur(input, 'Enter')
    expect(onEditAutomation).toHaveBeenCalledTimes(1)
    expect(onEditAutomation.mock.calls[0][0]).toEqual({ range: [44, 47], text: '0.3' })
  })

  it('typing in the step editor cannot delete the selected clip, while the same key on the grid does', async () => {
    const onEditAutomation = vi.fn()
    const onDeleteClip = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation, onDeleteClip })
    await expandBd(container)
    fireEvent.pointerDown(grid, { clientX: 200, clientY: levelY(container, 0.5), pointerId: 1 })
    fireEvent.pointerUp(grid, { clientX: 200, clientY: levelY(container, 0.5), pointerId: 1 })
    const selection = () => container.querySelector('[data-full-song="clip-selection"]')
    expect(selection(), 'no clip is selected, so the guard is untested').not.toBeNull()

    press(grid, 300, levelY(container, 0.8))
    const input = stepEditor(container)!
    expect(input).not.toBeNull()
    expect(selection(), 'opening a step dropped the selection — the dangerous state is gone').not.toBeNull()
    fireEvent.keyDown(input, { key: 'Backspace' })
    fireEvent.keyDown(input, { key: 'Delete' })
    expect(onDeleteClip).not.toHaveBeenCalled()

    // The CONTROL, same arm: the selection was live, so the key on the grid deletes.
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.keyDown(grid, { key: 'Backspace' })
    expect(onDeleteClip).toHaveBeenCalledTimes(1)
  })

  it('a double-click on a step keeps the lane open, while one off the staircase collapses it', async () => {
    const { grid, container } = renderStepped({ onEditAutomation: vi.fn() })
    await expandBd(container)
    const expanded = () =>
      (container.querySelector('[data-full-song-lane="bd"]') as HTMLElement).getAttribute('data-expanded')
    expect(expanded()).toBe('true')
    fireEvent.doubleClick(grid, { clientX: 300, clientY: levelY(container, 0.8) })
    expect(expanded(), 'a double-click on a step collapsed its lane').toBe('true')
    fireEvent.doubleClick(grid, { clientX: 300, clientY: levelY(container, 0.5) })
    expect(expanded()).toBe('false')
  })

  it('with no automation handler the staircase stays read-only', async () => {
    const { grid, container } = renderStepped()
    await expandBd(container)
    press(grid, 300, levelY(container, 0.8))
    expect(stepEditor(container)).toBeNull()
  })

  // ── #1578: drag a step's level ─────────────────────────────────────────────
  const down = (grid: HTMLElement, x: number, y: number) =>
    fireEvent.pointerDown(grid, { clientX: x, clientY: y, pointerId: 1 })
  const move = (grid: HTMLElement, x: number, y: number) =>
    fireEvent.pointerMove(grid, { clientX: x, clientY: y, pointerId: 1 })
  const up = (grid: HTMLElement, x: number, y: number) =>
    fireEvent.pointerUp(grid, { clientX: x, clientY: y, pointerId: 1 })
  const dragLabel = (c: HTMLElement) => c.querySelector('[data-full-song="automation-step-drag"]')

  it('a drag writes that step ONCE, on release, by the pointer\'s travel — with ONLY the automation handler wired', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    // Grab the line 3px BELOW it, inside the hit tolerance. The value must follow
    // the TRAVEL: an absolute reading of the release height would give 0.87.
    const from = levelY(container, 0.8) + 3
    const to = levelY(container, 0.9) + 3
    down(grid, 300, from)
    move(grid, 300, from - 5)
    move(grid, 300, to)
    expect(onEditAutomation, 'the drag wrote before release — a write per pixel').not.toHaveBeenCalled()
    expect(dragLabel(container)?.textContent, 'no value shown while dragging').toContain('0.9')
    up(grid, 300, to)
    expect(onEditAutomation).toHaveBeenCalledTimes(1)
    expect(onEditAutomation).toHaveBeenCalledWith({ range: [44, 47], text: '0.9' }, 'automation gain step 1')
    expect(dragLabel(container), 'the value label lingered after release').toBeNull()
    expect(stepEditor(container), 'a drag also opened the typed editor').toBeNull()
  })

  // ── #1582: the fine drag ──────────────────────────────────────────────────
  // This lane's band is 90px, so a plain 9px of travel is exactly a tenth of
  // `gain`'s 0…1 axis — which makes every number below exact rather than
  // approximately right.
  const moveFine = (grid: HTMLElement, x: number, y: number) =>
    fireEvent.pointerMove(grid, { clientX: x, clientY: y, pointerId: 1, shiftKey: true })

  it('holds the modifier and the same travel moves a TENTH as far', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    const from = levelY(container, 0.8) + 3
    // The control first: 9px of plain travel is a tenth of the axis.
    down(grid, 300, from)
    move(grid, 300, from - 9)
    up(grid, 300, from - 9)
    expect(onEditAutomation).toHaveBeenLastCalledWith({ range: [44, 47], text: '0.9' }, 'automation gain step 1')
    // The same 9px with the modifier held moves a hundredth. Held from before
    // the press — the other way in is the arm below.
    fireEvent.pointerDown(grid, { clientX: 300, clientY: from, pointerId: 1, shiftKey: true })
    moveFine(grid, 300, from - 9)
    expect(dragLabel(container)?.textContent, 'the fine drag previewed the plain value').toContain('0.81')
    up(grid, 300, from - 9)
    expect(onEditAutomation).toHaveBeenLastCalledWith({ range: [44, 47], text: '0.81' }, 'automation gain step 1')
  })

  it('the modifier pressed after the press but BEFORE the first move still prices that move', async () => {
    // The ordinary way in: press, then hold the key, then start moving. The
    // browser sends that keydown before any pointermove, so a handler that only
    // listened once a drag was under way would charge the whole first move — and
    // the first move is most of a short drag — at full speed.
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    const from = levelY(container, 0.8) + 3
    down(grid, 300, from)
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    moveFine(grid, 300, from - 9)
    up(grid, 300, from - 9)
    expect(onEditAutomation).toHaveBeenCalledWith({ range: [44, 47], text: '0.81' }, 'automation gain step 1')
  })

  it('pressing or releasing the modifier mid-drag does not move the level, and re-prices only what follows', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    const from = levelY(container, 0.8) + 3
    down(grid, 300, from)
    move(grid, 300, from + 9) // 9px down, plain → 0.7
    expect(dragLabel(container)?.textContent).toContain('0.7')
    // The key goes down where the pointer is STANDING. Nothing may move.
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    expect(dragLabel(container)?.textContent, 'the level leapt when the modifier went down').toContain('0.7')
    moveFine(grid, 300, from + 18) // 9 more, priced at a tenth → 0.69
    expect(dragLabel(container)?.textContent).toContain('0.69')
    // And released, again with the pointer standing still.
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false })
    expect(dragLabel(container)?.textContent, 'the level leapt when the modifier came up').toContain('0.69')
    move(grid, 300, from + 27) // 9 more at full price → 0.59
    up(grid, 300, from + 27)
    expect(onEditAutomation).toHaveBeenCalledWith({ range: [44, 47], text: '0.59' }, 'automation gain step 1')
  })

  it('a press released without travel — or with less than the threshold — opens the typed editor and writes nothing', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    const y = levelY(container, 0.8)
    down(grid, 300, y)
    expect(stepEditor(container), 'the editor opened on press, before the gesture resolved').toBeNull()
    move(grid, 300, y - 2)
    expect(dragLabel(container), 'a 2px tremble started a drag').toBeNull()
    up(grid, 300, y - 2)
    expect(stepEditor(container)?.value).toBe('0.8')
    expect(onEditAutomation).not.toHaveBeenCalled()
  })

  it('a drag that comes back to where it began writes nothing, and a cancelled one writes nothing', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    const y = levelY(container, 0.8)
    down(grid, 300, y)
    move(grid, 300, y - 20)
    move(grid, 300, y)
    up(grid, 300, y)
    expect(onEditAutomation, 'a drag back to the start rewrote the step').not.toHaveBeenCalled()
    expect(stepEditor(container), 'a drag back to the start opened the editor').toBeNull()

    down(grid, 300, y)
    move(grid, 300, y - 20)
    expect(dragLabel(container)).not.toBeNull()
    fireEvent.pointerCancel(grid, { clientX: 300, clientY: y - 20, pointerId: 1 })
    expect(onEditAutomation, 'a cancelled drag wrote').not.toHaveBeenCalled()
    expect(dragLabel(container)).toBeNull()
    expect(stepEditor(container), 'a cancelled drag opened the editor').toBeNull()
  })

  it('a second release behind the first commits nothing more', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    const y = levelY(container, 0.8)
    down(grid, 300, y)
    move(grid, 300, levelY(container, 0.5))
    // Both releases inside ONE act, so the second runs before any re-render —
    // two separate fireEvents could not show a missing once-only guard. jsdom has
    // no PointerEvent, so the id rides on a MouseEvent as an own property, which
    // is where React reads it from.
    const release = () =>
      Object.assign(new MouseEvent('pointerup', { bubbles: true, clientX: 300, clientY: levelY(container, 0.5) }), { pointerId: 1 })
    act(() => {
      grid.dispatchEvent(release())
      grid.dispatchEvent(release())
    })
    expect(onEditAutomation).toHaveBeenCalledTimes(1)
    expect(onEditAutomation.mock.calls[0][0]).toEqual({ range: [44, 47], text: '0.5' })
  })

  it('stops at the axis — a drag cannot write past the knob\'s range', async () => {
    const onEditAutomation = vi.fn()
    const { grid, container } = renderStepped({ onEditAutomation })
    await expandBd(container)
    const y = levelY(container, 0.8)
    down(grid, 300, y)
    move(grid, 300, y - 1000)
    up(grid, 300, y - 1000)
    expect(onEditAutomation.mock.calls.map((c) => c[0])).toEqual([{ range: [44, 47], text: '1' }])
  })

  it('the cursor promises a vertical drag over a level, and not off it', async () => {
    const { grid, container } = renderStepped({ onEditAutomation: vi.fn() })
    await expandBd(container)
    move(grid, 300, levelY(container, 0.8))
    expect(grid.style.cursor, 'no drag cursor over a step\'s level').toBe('ns-resize')
    // The CONTROL, same arm: the same bar at a height the staircase does not hold.
    move(grid, 300, levelY(container, 0.5))
    expect(grid.style.cursor).not.toBe('ns-resize')
  })
})

describe('FullSongTimeline — automate a fixed value from its lane (#1601)', () => {
  // One track `bd` setting one fixed value, read by the REAL `fixedParameters` (the
  // barrel mock loads it from source). The call site starts at 9 in
  // `s("bd*2").<method>(<raw>)` and ends past the `)`, the offsets the parser gives;
  // the argument's span is what the edit may replace.
  const settle = () => act(async () => { await Promise.resolve() })
  async function renderFixed(
    method: string,
    raw: string,
    extra: Partial<React.ComponentProps<typeof FullSongTimeline>>,
    expand = true,
  ) {
    // #2126 — a fresh timeline each time: the camera saves expanded lanes, so a
    // second render in the same test would start expanded and the click below
    // would collapse it. (It passed on Node 25 only because nothing got saved.)
    window.localStorage.clear()
    const source = `s("bd*2").${method}(${raw})`
    const ir = {
      tag: 'Stack',
      tracks: [
        {
          tag: 'Track',
          trackId: 'bd',
          body: {
            tag: 'Param',
            key: method,
            rawArgs: raw,
            value: Number(raw),
            loc: [{ start: 9, end: source.length }],
            body: { tag: 'Play', note: 'bd' },
          },
        },
      ],
    }
    const utils = renderFull({ ir: ir as never, source, ...extra })
    await settle()
    if (expand) {
      await act(async () => {
        ;(utils.container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement).click()
      })
    }
    return utils
  }
  const automate = (c: HTMLElement) => c.querySelector('[data-full-song-lane-automate="bd"]') as HTMLElement | null
  const menu = (c: HTMLElement) => c.querySelector('[data-full-song="automate-parameter"]') as HTMLSelectElement | null

  it('choosing a fixed value writes it as one step per bar the lane shows, in one edit', async () => {
    const onEditAutomation = vi.fn()
    const { container } = await renderFixed('gain', '.8', { onEditAutomation })
    expect(automate(container), 'no automate button on the expanded lane').not.toBeNull()
    await act(async () => {
      automate(container)!.click()
    })
    const m = menu(container)
    expect(m, 'the menu did not open').not.toBeNull()
    expect(Array.from(m!.options).map((o) => o.textContent)).toEqual(['automate…', 'gain .8'])
    expect(onEditAutomation, 'opening the menu wrote').not.toHaveBeenCalled()
    fireEvent.change(m!, { target: { value: '0' } })
    // The fixture's span is 4 cycles, so the lane shows 4 bars: 4 steps, spelled `.8`.
    expect(onEditAutomation).toHaveBeenCalledTimes(1)
    expect(onEditAutomation).toHaveBeenCalledWith({ range: [15, 17], text: '"<.8 .8 .8 .8>"' }, 'automation gain steps')
    expect(menu(container), 'the menu lingered after its commit').toBeNull()
  })

  it('offers nothing on a collapsed lane, without a write handler, or for a control with no knob range of its own', async () => {
    const onEditAutomation = vi.fn()
    expect(automate((await renderFixed('gain', '0.8', { onEditAutomation }, false)).container), 'collapsed').toBeNull()
    cleanup()
    expect(automate((await renderFixed('gain', '0.8', {})).container), 'no handler').toBeNull()
    cleanup()
    expect(automate((await renderFixed('orbit', '1', { onEditAutomation })).container), 'orbit').toBeNull()
    cleanup()
    expect(automate((await renderFixed('cps', '0.5', { onEditAutomation })).container), 'cps').toBeNull()
    cleanup()
    // Control: the same render with a ranged control DOES offer it.
    expect(automate((await renderFixed('pan', '0.5', { onEditAutomation })).container), 'pan').not.toBeNull()
    expect(onEditAutomation).not.toHaveBeenCalled()
  })

  it('Escape and a blur close the menu without writing', async () => {
    const onEditAutomation = vi.fn()
    const { container } = await renderFixed('gain', '0.8', { onEditAutomation })
    const open = async () => {
      await act(async () => {
        automate(container)!.click()
      })
      return menu(container)!
    }
    fireEvent.keyDown(await open(), { key: 'Escape' })
    expect(menu(container), 'Escape did not close the menu').toBeNull()
    fireEvent.blur(await open())
    expect(menu(container), 'a blur did not close the menu').toBeNull()
    expect(onEditAutomation).not.toHaveBeenCalled()
  })
})

describe('FullSongTimeline — change a stepped parameter\'s step count from its lane (#1602)', () => {
  // One stepped `gain` on `bd`, spelled at the offsets `parseStrudel` gives
  // `s("bd*2").gain("<…>")`: the call from the `.` at 9 to the end, the literal's
  // `<` at 16, each step at its own offset from 17 (the Stage 3 fixture's numbers).
  // The analysis gives `bd` a 2-cycle period that is 1 without its gain, beside a
  // 4-cycle `hh`: the song repeats at 4, and 3 steps would make it 12.
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  const analysis: SongAnalysis = {
    ...analysisFixture,
    lanePeriods: [
      { laneKey: 'bd', periodCycles: 2, restCycles: 1 },
      { laneKey: 'hh', periodCycles: 4, restCycles: 4 },
    ],
  }
  async function renderSteps(
    steps: readonly string[],
    extra: Partial<React.ComponentProps<typeof FullSongTimeline>>,
    expand = true,
  ) {
    const inner = steps.join(' ')
    const source = `s("bd*2").gain("<${inner}>")`
    let at = 17
    const items = steps.map((note) => {
      const item = { tag: 'Play', note, loc: [{ start: at, end: at + note.length }] }
      at += note.length + 1
      return item
    })
    const ir = {
      tag: 'Stack',
      tracks: [
        {
          tag: 'Track',
          trackId: 'bd',
          body: {
            tag: 'Param',
            key: 'gain',
            rawArgs: `"<${inner}>"`,
            loc: [{ start: 9, end: source.length }],
            value: { tag: 'Cycle', loc: [{ start: 16, end: 16 + inner.length + 2 }], items },
            body: { tag: 'Play', note: 'bd' },
          },
        },
      ],
    }
    const props = { ir: ir as never, source, analysis, ...extra }
    const utils = renderFull(props)
    await settle()
    if (expand) {
      await act(async () => {
        ;(utils.container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement).click()
      })
    }
    /** Re-render with the document text changed and everything else as it was. */
    const retype = (next: string) =>
      utils.rerender(
        <FullSongTimeline
          getSongPosition={() => null}
          onSeek={utils.onSeek}
          getDrawerOpen={() => true}
          getActiveTabId={() => 'musical-timeline'}
          {...props}
          source={next}
        />,
      )
    return { ...utils, source, retype }
  }
  const chip = (c: HTMLElement) => c.querySelector('[data-full-song-lane-steps="bd"]') as HTMLElement | null
  const menu = (c: HTMLElement) => c.querySelector('[data-full-song="step-count"]') as HTMLSelectElement | null
  const open = async (c: HTMLElement) => {
    await act(async () => {
      chip(c)!.click()
    })
    return menu(c)!
  }
  const choose = async (c: HTMLElement, value: string) => {
    const m = await open(c)
    await act(async () => {
      fireEvent.change(m, { target: { value } })
    })
    await settle()
  }

  it('lists the counts that fit first, each saying what it does to the song, and writes the chosen one in one edit', async () => {
    const onEditAutomation = vi.fn()
    const { container } = await renderSteps(['0.2', '0.8'], { onEditAutomation, onConfirm: vi.fn() })
    expect(chip(container), 'no step-count chip on the expanded lane').not.toBeNull()
    const m = await open(container)
    expect(m, 'the menu did not open').not.toBeNull()
    const labels = Array.from(m.options).map((o) => o.textContent)
    expect(labels.slice(0, 7)).toEqual([
      'steps…',
      '1 step · removes written steps',
      '4 steps · plays the same',
      '8 steps · plays the same',
      '12 steps · plays the same',
      '16 steps · plays the same',
      '3 steps · song repeats every 12 bars (was 4)',
    ])
    expect(m.querySelector('optgroup')?.getAttribute('label')).toBe('gain')
    expect(onEditAutomation, 'opening the menu wrote').not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.change(m, { target: { value: '0:4' } })
    })
    await settle()
    expect(onEditAutomation).toHaveBeenCalledTimes(1)
    expect(onEditAutomation).toHaveBeenCalledWith({ range: [17, 24], text: '0.2 0.8 0.2 0.8' }, 'automation gain step count 4')
    expect(menu(container), 'the menu lingered after its commit').toBeNull()
  })

  it('asks before a cut removes written steps, and writes nothing when the answer is no', async () => {
    const onEditAutomation = vi.fn()
    const answers = [false, true]
    const onConfirm = vi.fn(async () => answers.shift()!)
    const { container } = await renderSteps(['0.2', '0.8', '0.5', '0.9'], { onEditAutomation, onConfirm })
    await choose(container, '0:2')
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0]).toEqual([expect.objectContaining({ title: 'Remove steps from gain?', confirmLabel: 'Remove steps' })])
    expect(onEditAutomation, 'a declined cut wrote').not.toHaveBeenCalled()
    await choose(container, '0:2')
    expect(onEditAutomation).toHaveBeenCalledTimes(1)
    expect(onEditAutomation).toHaveBeenCalledWith({ range: [17, 32], text: '0.2 0.8' }, 'automation gain step count 2')
  })

  it('refuses a confirmed cut when the document changed while the question was open', async () => {
    const onEditAutomation = vi.fn()
    let answer: (ok: boolean) => void = () => {}
    const onConfirm = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve }))
    const { container, source, retype } = await renderSteps(['0.2', '0.8', '0.5', '0.9'], { onEditAutomation, onConfirm })
    await choose(container, '0:2')
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await act(async () => {
      retype(`${source}\n`)
    })
    await act(async () => {
      answer(true)
    })
    await settle()
    expect(onEditAutomation, 'a cut computed against the old text was written over the new one').not.toHaveBeenCalled()
  })

  it('asks nothing for a cut whose removed steps repeat the ones kept', async () => {
    // The control on the confirmation: the same cut, the same spans, nothing written lost.
    const onEditAutomation = vi.fn()
    const onConfirm = vi.fn(async () => false)
    const { container } = await renderSteps(['0.2', '0.8', '0.2', '0.8'], { onEditAutomation, onConfirm })
    await choose(container, '0:2')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onEditAutomation).toHaveBeenCalledWith({ range: [17, 32], text: '0.2 0.8' }, 'automation gain step count 2')
  })

  it('without a way to ask, a cut that removes written steps cannot be chosen', async () => {
    const onEditAutomation = vi.fn()
    const { container } = await renderSteps(['0.2', '0.8', '0.5', '0.9'], { onEditAutomation })
    const m = await open(container)
    const option = (value: string) => Array.from(m.options).find((o) => o.value === value)!
    expect(option('0:2').disabled, 'the cut was offered as choosable').toBe(true)
    expect(option('0:8').disabled, 'a growth was disabled too').toBe(false)
    await act(async () => {
      fireEvent.change(m, { target: { value: '0:2' } })
    })
    await settle()
    expect(onEditAutomation).not.toHaveBeenCalled()
  })

  it('offers no chip on a collapsed lane, without a write handler, or on a lane with no stepped parameter', async () => {
    const onEditAutomation = vi.fn()
    expect(chip((await renderSteps(['0.2', '0.8'], { onEditAutomation }, false)).container), 'collapsed').toBeNull()
    cleanup()
    expect(chip((await renderSteps(['0.2', '0.8'], {})).container), 'no handler').toBeNull()
    cleanup()
    const fixed = renderFull({
      ir: { tag: 'Stack', tracks: [{ tag: 'Track', trackId: 'bd', body: { tag: 'Param', key: 'gain', rawArgs: '.8', value: 0.8, loc: [{ start: 9, end: 18 }], body: { tag: 'Play', note: 'bd' } } }] } as never,
      source: 's("bd*2").gain(.8)',
      analysis,
      onEditAutomation,
    })
    await settle()
    await act(async () => {
      ;(fixed.container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement).click()
    })
    expect(chip(fixed.container), 'a fixed value').toBeNull()
    cleanup()
    // Control: the same render with steps DOES offer it.
    expect(chip((await renderSteps(['0.2', '0.8'], { onEditAutomation })).container), 'stepped').not.toBeNull()
    expect(onEditAutomation).not.toHaveBeenCalled()
  })

  it('Escape and a blur close the menu without writing', async () => {
    const onEditAutomation = vi.fn()
    const { container } = await renderSteps(['0.2', '0.8'], { onEditAutomation })
    fireEvent.keyDown(await open(container), { key: 'Escape' })
    expect(menu(container), 'Escape did not close the menu').toBeNull()
    fireEvent.blur(await open(container))
    expect(menu(container), 'a blur did not close the menu').toBeNull()
    expect(onEditAutomation).not.toHaveBeenCalled()
  })
})

describe('FullSongTimeline — the shape menu measures a swap against the song it opened on (#1611)', () => {
  // `s("bd*2").gain(sine.slow(16))`, with the spans the parser gives: the call site
  // 9–29, the chain 15–28, the identifier 15–19. Read by the REAL `signalAutomations`.
  const source = 's("bd*2").gain(sine.slow(16))'
  const SIGNAL_IR = {
    tag: 'Stack',
    tracks: [
      {
        tag: 'Track',
        trackId: 'bd',
        body: {
          tag: 'Param',
          key: 'gain',
          rawArgs: 'sine.slow(16)',
          loc: [{ start: 9, end: 29 }],
          value: {
            tag: 'Slow',
            factor: 16,
            loc: [{ start: 15, end: 28 }],
            body: { tag: 'Signal', kind: 'sine', loc: [{ start: 15, end: 19 }] },
          },
          body: { tag: 'Play', note: 'bd' },
        },
      },
    ],
  }
  const loopOf = (cycles: number): SongAnalysis => ({
    ...analysisFixture,
    periodCycles: cycles,
    horizonCycles: cycles * 2,
    displaySpan: { kind: 'loop', cycles },
    repeatCycles: cycles,
  })
  const settle = () => act(async () => { await Promise.resolve() })

  /** ⚠ jsdom has no canvas, so the caption's text measures 0 wide and no name can be
   *  pressed. The stub answers only an OFFSCREEN canvas, which is the measurer's own
   *  (`measureCaption` creates one and never attaches it); the drawn canvases keep
   *  jsdom's null, so the draw path is not handed a context it would half-use. */
  async function withMeasuredCaptions(run: () => Promise<void>): Promise<void> {
    const realGetContext = HTMLCanvasElement.prototype.getContext
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      ...args: Parameters<HTMLCanvasElement['getContext']>
    ) {
      if (this.isConnected) return realGetContext.apply(this, args as never)
      return { font: '', measureText: (t: string) => ({ width: t.length * 6 }) } as never
    } as never)
    try {
      await run()
    } finally {
      spy.mockRestore()
    }
  }

  /** The song at 16 bars with `bd` expanded, and a press on its caption's name. */
  async function renderSignal(onPreviewShape: NonNullable<React.ComponentProps<typeof FullSongTimeline>['onPreviewShape']>) {
    const props = { ir: SIGNAL_IR as never, source, analysis: loopOf(16), onEditAutomation: vi.fn(), onPreviewShape }
    const utils = renderFull(props)
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    await settle()
    await act(async () => {
      ;(utils.container.querySelector('[data-full-song-lane-expand="bd"]') as HTMLElement).click()
    })
    // The name `gain` is the caption's first field: x from CAPTION_PAD_X (4) over four
    // 6px glyphs, y inside the first line (the lane's top inset is 3).
    const pressName = () => fireEvent.pointerDown(grid, { clientX: 10, clientY: 5, pointerId: 1 })
    const menu = () => utils.container.querySelector('[data-full-song="automation-shape"]') as HTMLSelectElement | null
    /** The cross-class options' labels, the ones a preview speaks for. */
    const across = () => Array.from(menu()?.options ?? []).map((o) => o.textContent ?? '').filter((l) => l.includes(' · '))
    return { ...utils, props, pressName, menu, across }
  }

  it('a re-evaluation while the preview is measuring does not move the "(was N)" beside it', async () => {
    await withMeasuredCaptions(async () => {
      let answer: (a: SongAnalysis | null) => void = () => {}
      const onPreviewShape = vi.fn(() => new Promise<SongAnalysis | null>((resolve) => { answer = resolve }))
      const { props, pressName, menu, across, rerender, onSeek } = await renderSignal(onPreviewShape)
      pressName()
      expect(menu(), 'a press on the name did not open the shape menu').not.toBeNull()
      expect(onPreviewShape).toHaveBeenCalledTimes(1)
      expect(across().length, 'no shape across classes was offered').toBeGreaterThan(0)
      expect(across().every((l) => l.endsWith('measuring song length…'))).toBe(true)

      // The song is re-evaluated under the open menu, to a length the preview never saw.
      rerender(
        <FullSongTimeline
          getSongPosition={() => null}
          onSeek={onSeek}
          getDrawerOpen={() => true}
          getActiveTabId={() => 'musical-timeline'}
          {...props}
          analysis={loopOf(8)}
        />,
      )
      expect(menu(), 'a new snapshot closed the menu — this arm no longer tests anything').not.toBeNull()
      await act(async () => {
        answer(loopOf(4))
        await Promise.resolve()
      })
      // The preview was measured from the song at 16; its baseline must be that song's.
      expect(across().length).toBeGreaterThan(0)
      for (const label of across()) expect(label).toMatch(/ · song repeats every 4 bars \(was 16\)$/)
    })
  })

  it('a preview for a menu that closed does not land on the next one opened', async () => {
    await withMeasuredCaptions(async () => {
      const answers: Array<(a: SongAnalysis | null) => void> = []
      const onPreviewShape = vi.fn(() => new Promise<SongAnalysis | null>((resolve) => { answers.push(resolve) }))
      const { pressName, menu, across } = await renderSignal(onPreviewShape)
      pressName()
      expect(menu(), 'a press on the name did not open the shape menu').not.toBeNull()
      fireEvent.keyDown(menu()!, { key: 'Escape' })
      expect(menu(), 'Escape did not close the menu').toBeNull()
      pressName()
      expect(menu(), 'the menu did not open again').not.toBeNull()
      expect(onPreviewShape).toHaveBeenCalledTimes(2)

      // The FIRST menu's answer arrives late, for a menu nobody is looking at any more.
      await act(async () => {
        answers[0](loopOf(4))
        await Promise.resolve()
      })
      expect(across().length).toBeGreaterThan(0)
      expect(
        across().every((l) => l.endsWith('measuring song length…')),
        `the closed menu's preview landed on the open one: ${across().join(' / ')}`,
      ).toBe(true)

      // Control: the open menu's own answer does land, so the arm above is not a menu
      // that ignores every answer.
      await act(async () => {
        answers[1](loopOf(2))
        await Promise.resolve()
      })
      for (const label of across()) expect(label).toMatch(/ · song repeats every 2 bars \(was 16\)$/)
    })
  })
})

// ---------------------------------------------------------------------------
// #1562 — the clip gestures are commands: listed, rebindable, palette-runnable
// ---------------------------------------------------------------------------

import { setKeybindingOverride, resetAllKeybindings, getKeybindingsFor } from '../../commands/keybindings'
import { listCommands, listEnabledCommands, executeCommand } from '../../commands/registry'
import { CLIP_GESTURE, CLIP_GESTURES, SONG_TIMELINE_SCOPE } from '../musicalTimeline/clipGestures'

describe('FullSongTimeline — clip gestures are registered commands (#1562)', () => {
  const settle = () => act(async () => { await Promise.resolve() })
  function renderSelectable(props: Partial<React.ComponentProps<typeof FullSongTimeline>>) {
    const utils = renderFull({ ir: {} as never, ...props })
    const grid = utils.container.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 48, right: 800, bottom: 48, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    const selectArm0 = () => {
      fireEvent.pointerDown(grid, { clientX: 200, clientY: 10, pointerId: 1 })
      fireEvent.pointerUp(grid, { clientX: 200, clientY: 10, pointerId: 1 })
    }
    return { ...utils, grid, selectArm0 }
  }
  afterEach(() => resetAllKeybindings())

  it('all seven are registered, scoped to the timeline, with the keys the grid always answered to', () => {
    const byId = new Map(listCommands().map((c) => [c.id, c]))
    const want: Record<string, string[]> = {
      [CLIP_GESTURE.duplicate]: ['mod+d'],
      [CLIP_GESTURE.split]: ['s'],
      [CLIP_GESTURE.delete]: ['delete', 'backspace'],
      [CLIP_GESTURE.rippleDelete]: ['mod+shift+backspace', 'mod+shift+delete'],
      [CLIP_GESTURE.insert]: ['mod+i'],
      [CLIP_GESTURE.rename]: ['f2', 'enter'],
      [CLIP_GESTURE.pointAtPart]: ['p'],
    }
    expect(CLIP_GESTURES).toHaveLength(7)
    for (const [id, chords] of Object.entries(want)) {
      const cmd = byId.get(id)
      expect(cmd, id).toBeDefined()
      expect(cmd!.scope).toBe(SONG_TIMELINE_SCOPE)
      expect(cmd!.category).toBe('Song timeline')
      expect(getKeybindingsFor(cmd!)).toEqual(chords)
    }
  })

  it('a rebind reaches the grid: the new chord duplicates and the old one no longer does', async () => {
    const onDuplicateClip = vi.fn()
    const { grid, selectArm0 } = renderSelectable({ onDuplicateClip })
    await settle()
    setKeybindingOverride(CLIP_GESTURE.duplicate, 'mod+j')
    selectArm0()
    fireEvent.keyDown(grid, { key: 'd', metaKey: true })
    expect(onDuplicateClip, 'the old chord is released by the rebind').not.toHaveBeenCalled()
    fireEvent.keyDown(grid, { key: 'j', metaKey: true })
    expect(onDuplicateClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0 })
  })

  it('a MODIFIED Backspace does not delete the section, while plain Backspace does', async () => {
    // The old branch matched Delete/Backspace with any modifier, so ⌥⌫ (delete a
    // word, by muscle memory) or ⌘⌫ removed the selected section.
    const onDeleteClip = vi.fn()
    const { grid, selectArm0 } = renderSelectable({ onDeleteClip })
    await settle()
    selectArm0()
    fireEvent.keyDown(grid, { key: 'Backspace', altKey: true })
    fireEvent.keyDown(grid, { key: 'Backspace', metaKey: true })
    fireEvent.keyDown(grid, { key: 'Delete', ctrlKey: true })
    expect(onDeleteClip, 'no modified delete may remove the section').not.toHaveBeenCalled()
    fireEvent.keyDown(grid, { key: 'Backspace' })
    expect(onDeleteClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0 })
  })

  it('the palette offers a gesture only while it applies, and running it acts on the selection', async () => {
    const onDuplicateClip = vi.fn()
    const { selectArm0 } = renderSelectable({ onDuplicateClip })
    await settle()
    const offered = (id: string) => listEnabledCommands().some((c) => c.id === id)
    expect(offered(CLIP_GESTURE.duplicate), 'nothing selected').toBe(false)
    selectArm0()
    expect(offered(CLIP_GESTURE.duplicate)).toBe(true)
    // No split handler was given, so split is not offered even with a selection.
    expect(offered(CLIP_GESTURE.split)).toBe(false)
    act(() => {
      expect(executeCommand(CLIP_GESTURE.duplicate)).toBe(true)
    })
    expect(onDuplicateClip).toHaveBeenCalledWith({ sourceOffset: 9, armIndex: 0 })
  })

  it('a keystroke the gesture acted on stops at the grid; one it declined travels on', async () => {
    const onDuplicateClip = vi.fn()
    const { grid, selectArm0 } = renderSelectable({ onDuplicateClip })
    await settle()
    const seen = vi.fn()
    window.addEventListener('keydown', seen)
    try {
      selectArm0()
      fireEvent.keyDown(grid, { key: 's' }) // no split handler → declined
      expect(seen).toHaveBeenCalledTimes(1)
      fireEvent.keyDown(grid, { key: 'd', metaKey: true }) // acted
      expect(onDuplicateClip).toHaveBeenCalledTimes(1)
      expect(seen, 'an acted-on chord must not also reach a global command').toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', seen)
    }
  })
})
