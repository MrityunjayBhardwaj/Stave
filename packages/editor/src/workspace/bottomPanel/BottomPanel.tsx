/**
 * BottomPanel — reusable bottom-drawer component for the editor surface.
 *
 * Mounted by `WorkspaceShell` below the groups area. Hosts a tab bar
 * with one active tab + a body. Tab content is contributed externally
 * via `bottomPanelRegistry` (DA-05); PR-A seeds a placeholder
 * "Timeline" tab so the surface is reviewable before PR-B fills it.
 *
 * Closed-state pixel cost: ~29px (28px header + 1px top border). When
 * zero tabs are registered the component returns `null` (true zero
 * shift — Trap 2). Default open=false so existing users see only the
 * 29px header strip until they expand the drawer.
 *
 * Persistence: height + open + activeTabId hydrate from localStorage in
 * `useState` initializers (Trap 7 — no first-paint flicker). Writes
 * happen in commit-time effects + a pagehide flush for the height.
 *
 * Audience: musician (PV35). Vocabulary lock (PV32 / D-06): the only
 * strings PR-A introduces are "Hide panel" / "Show panel" /
 * "Bottom panel" / "Bottom panel tabs" / "Resize bottom panel". Tab
 * titles are sourced from the registry (PR-A's seed uses "Timeline").
 *
 * Phase 20-01 PR-A.
 */

import * as React from 'react'

import {
  type BottomPanelTab,
  listBottomPanelTabs,
  subscribeToBottomPanelTabs,
} from './bottomPanelRegistry'
import {
  BOTTOM_PANEL_HEIGHT_MIN,
  BOTTOM_PANEL_HEIGHT_MAX,
  clampHeight,
  readPersistedHeight,
  writePersistedHeight,
} from './persistence'
import { setBottomPanelActiveTab, setBottomPanelOpen, useBottomPanelState } from './panelState'
import { usePhoneLayout } from '../usePhone'
import { useKeyboardUp } from '../visibleArea'
import { TOUCH_BAR_ATTR } from '../runtime/touchBar'
// Module-side-effect import: registers the placeholder Timeline tab at
// first bundle load (DA-09 / T-06). PR-B replaces by re-registering the
// same id (idempotent).
import './seedTabs'
// Visual-editing scaffold (#380): seeds the Sequencer / Mixer / Piano Roll
// standby tabs alongside Timeline. Each panel later re-registers its id with
// a live UI (idempotent replace).
import './visualEditSeed'

const HEADER_HEIGHT = 28
const RESIZE_HANDLE_HEIGHT = 4
const CLOSED_HEIGHT = HEADER_HEIGHT + 1 // +1 for the 1px top border

// ---------------------------------------------------------------------------
// The sheet — a phone held upright (#2002).
//
// There the panel does not take its height out of the editor's. Its strip of tabs
// keeps a fixed place at the bottom of the screen, tall enough for a finger, and an
// open panel lies OVER the code as a sheet. A tab opens it at half the height. The
// strip is the sheet's top edge and its handle: the sheet follows the finger and stays
// where it is let go, anywhere from the strip up to the editor's Play bar (#2260).
// Let go near either end, within a fifth of the screen's height, it goes the rest of
// the way: closed, or full. Nothing inside the panel's body moves the sheet; a drag
// there is the Timeline's or a grid's own.
//
// The editor never changes size for it, so closing the sheet leaves the code
// exactly where it was.
//
// Held SIDEWAYS (#2003) the same phone has no height for a strip or a half
// sheet. There the panel draws no header at all: which view is showing is chosen
// from a switch in the app's top bar, through `panelState`, and an open panel is
// its body alone, filling everything under the Play bar. Closed, it draws nothing
// — that is the Code view.
// ---------------------------------------------------------------------------

/** the smallest control a finger hits reliably */
const TOUCH = 44
const SHEET_HEADER_HEIGHT = TOUCH + 4
const SHEET_CLOSED_HEIGHT = SHEET_HEADER_HEIGHT + 1 // +1 for the 1px top border
/** a half sheet is never so short that its panel has nothing to show */
const SHEET_MIN_BODY = 120
/** a pull shorter than this is a tap that wobbled, and leaves the sheet where it was */
const SHEET_PULL_SLOP = 8
/** let go this close to either end, as a share of the screen's height, and the sheet goes there (#2260) */
const SHEET_SNAP_SHARE = 1 / 5
/** above the editor and everything Monaco lays inside it; below the phone's drawer */
const SHEET_Z_INDEX = 100

type SheetStop = 'closed' | 'half' | 'full'
/** where an open sheet rests: half, full, or the height in px where a finger let it go */
type SheetRest = 'half' | 'full' | number

/** the room the sheet has: its parent's height, and how far down the Play bar ends */
interface SheetRoom {
  readonly height: number
  readonly top: number
}

/** how tall the sheet is at each stop, strip included */
export function sheetHeights(room: SheetRoom): Record<SheetStop, number> {
  const full = Math.max(SHEET_CLOSED_HEIGHT, Math.round(room.height - room.top))
  const half = Math.min(full, Math.max(SHEET_CLOSED_HEIGHT + SHEET_MIN_BODY, Math.round(room.height / 2)))
  return { closed: SHEET_CLOSED_HEIGHT, half, full }
}

/**
 * Where the sheet comes to rest when a pull lets go of it at `height` px tall (#2260).
 * Within a fifth of the screen's height of either end it goes to that end. Anywhere
 * else it stays where it was let go. On a screen so short that the two zones overlap,
 * the nearer end wins.
 */
export function sheetRestAfterPull(
  height: number,
  heights: Record<SheetStop, number>,
  screenHeight: number,
): 'closed' | 'full' | number {
  const zone = screenHeight * SHEET_SNAP_SHARE
  const toClosed = height - heights.closed
  const toFull = heights.full - height
  if (toClosed <= zone && toFull <= zone) return toClosed < toFull ? 'closed' : 'full'
  if (toClosed <= zone) return 'closed'
  if (toFull <= zone) return 'full'
  return Math.round(height)
}

/** how tall a resting sheet is: a let-go height is kept inside the room it has now */
function restHeight(rest: SheetRest, heights: Record<SheetStop, number>): number {
  return typeof rest === 'number' ? Math.max(heights.closed, Math.min(heights.full, rest)) : heights[rest]
}

// ---------------------------------------------------------------------------
// useDragResize — pointer-event-based vertical resize hook (DA-03 / T-05).
// ---------------------------------------------------------------------------

interface UseDragResizeOptions {
  readonly initial: number
  readonly min: number
  readonly max: number
  readonly onCommit: (value: number) => void
}

interface DragHandleProps {
  readonly onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  readonly onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  readonly onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  readonly onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void
}

interface UseDragResizeResult {
  readonly value: number
  readonly setValue: (v: number) => void
  readonly handleProps: DragHandleProps
  readonly dragging: boolean
}

/**
 * Pure inversion math — drag UP increases drawer height. Exported so
 * the unit test can exercise the math without touching the DOM
 * (Trap 10: jsdom doesn't fire PointerEvent like browsers).
 */
export function computeNewHeight(
  startY: number,
  currentY: number,
  startHeight: number,
): number {
  return startHeight + (startY - currentY)
}

function useDragResize(opts: UseDragResizeOptions): UseDragResizeResult {
  const [value, setValueState] = React.useState<number>(opts.initial)
  const [dragging, setDragging] = React.useState(false)

  // Refs hold drag transients so pointermove handler does NOT close over
  // stale React state (P29 — stale useCallback closure).
  const startYRef = React.useRef<number>(0)
  const startValueRef = React.useRef<number>(opts.initial)
  const pointerIdRef = React.useRef<number | null>(null)
  const draggingRef = React.useRef<boolean>(false)
  const minRef = React.useRef(opts.min)
  const maxRef = React.useRef(opts.max)
  React.useEffect(() => {
    minRef.current = opts.min
    maxRef.current = opts.max
  }, [opts.min, opts.max])

  // Public setter — also writes to ref so a programmatic set during a
  // drag doesn't get clobbered on the next pointermove.
  const setValue = React.useCallback((v: number) => {
    const clamped = clampHeight(v)
    startValueRef.current = clamped
    setValueState(clamped)
  }, [])

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      pointerIdRef.current = e.pointerId
      startYRef.current = e.clientY
      startValueRef.current = value
      draggingRef.current = true
      setDragging(true)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* setPointerCapture can throw if the pointer is not active */
      }
    },
    [value],
  )

  const endDrag = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setDragging(false)
      const id = pointerIdRef.current
      pointerIdRef.current = null
      try {
        if (id != null) e.currentTarget.releasePointerCapture(id)
      } catch {
        /* may already be released */
      }
      if (commit) opts.onCommit(value)
    },
    [opts, value],
  )

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      const next = computeNewHeight(
        startYRef.current,
        e.clientY,
        startValueRef.current,
      )
      const clamped = Math.max(
        minRef.current,
        Math.min(maxRef.current, Number.isFinite(next) ? next : startValueRef.current),
      )
      setValueState(clamped)
    },
    [],
  )

  const onPointerUp = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      endDrag(e, true)
    },
    [endDrag],
  )

  const onPointerCancel = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      endDrag(e, false)
    },
    [endDrag],
  )

  return {
    value,
    setValue,
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    dragging,
  }
}

// ---------------------------------------------------------------------------
// BottomPanel component
// ---------------------------------------------------------------------------

function renderTabBody(tab: BottomPanelTab): React.ReactNode {
  if (typeof tab.content === 'function') {
    return (tab.content as () => React.ReactNode)()
  }
  return tab.content
}

/** the tab to show: the one last chosen if it is still registered, else the first */
function pickActiveTabId(
  tabs: readonly BottomPanelTab[],
  chosen: string | null,
): string | null {
  if (chosen && tabs.some((t) => t.id === chosen)) return chosen
  return tabs[0]?.id ?? null
}

export interface BottomPanelProps {
  /**
   * #2022 — draw nothing at all, header strip included, while keeping every
   * piece of the panel's state: open or closed, the active tab, the height.
   *
   * This is NOT the user closing the panel. It is the shell saying the panel
   * has nothing to describe right now (the active pane is a visual), so the
   * remembered open/closed choice must come through untouched — when `hidden`
   * goes false the panel is exactly as it was left.
   */
  readonly hidden?: boolean
}

export function BottomPanel({ hidden = false }: BottomPanelProps = {}): React.ReactElement | null {
  // Hydrate everything in initializers — Trap 7. Reads are SSR-safe.
  const [tabs, setTabs] = React.useState<readonly BottomPanelTab[]>(() =>
    listBottomPanelTabs(),
  )
  // Open / closed and the chosen tab live in `panelState` (#2002), where a control
  // outside this component can read and set them; it saves each change itself. The
  // store's values are read in the first render, so Trap 7 still holds.
  const { open, activeTabId: chosenTabId } = useBottomPanelState()
  const setOpen = setBottomPanelOpen
  const setActiveTabId = setBottomPanelActiveTab
  const [height, setHeight] = React.useState<number>(readPersistedHeight)
  const activeTabId = pickActiveTabId(tabs, chosenTabId)

  // Subscribe to registry changes so a later registerBottomPanelTab
  // (e.g., PR-B replacing the placeholder) rerenders the bar.
  React.useEffect(() => {
    return subscribeToBottomPanelTabs(() => setTabs(listBottomPanelTabs()))
  }, [])

  // The tab shown is the tab chosen. When they differ — nothing chosen yet, or the
  // chosen tab is no longer registered and the first one stands in — the stand-in
  // becomes the choice, so every other reader of the store sees what is on screen.
  React.useEffect(() => {
    if (activeTabId !== chosenTabId) setBottomPanelActiveTab(activeTabId)
  }, [activeTabId, chosenTabId])

  // Drag-resize hook (T-05). Commits to React state + persistence on
  // pointerup; live drag updates the hook's internal value only.
  const drag = useDragResize({
    initial: height,
    min: BOTTOM_PANEL_HEIGHT_MIN,
    max: BOTTOM_PANEL_HEIGHT_MAX,
    onCommit: (v) => {
      setHeight(v)
      writePersistedHeight(v)
    },
  })

  // ---- the sheet (a phone held upright, #2002) ----
  const layout = usePhoneLayout()
  const sheet = layout === 'upright'
  /** a phone held sideways: no header, and an open panel is the whole view (#2003) */
  const wholeView = layout === 'sideways'
  const [sheetRest, setSheetRest] = React.useState<SheetRest>('half')
  /** where the sheet is, as `data-sheet` says it: a named height, or 'free' where a pull left it */
  const stop: SheetStop | 'free' = !open ? 'closed' : typeof sheetRest === 'number' ? 'free' : sheetRest
  /** the sheet's height while a finger is pulling it; null otherwise */
  const [pulled, setPulled] = React.useState<number | null>(null)
  const [room, setRoom] = React.useState<SheetRoom | null>(null)
  /** the strip-sized space kept in the layout, whose parent is the room the sheet has */
  const spaceRef = React.useRef<HTMLDivElement | null>(null)

  const measureRoom = React.useCallback((): SheetRoom | null => {
    const parent = spaceRef.current?.parentElement
    if (!parent) return null
    const box = parent.getBoundingClientRect()
    const bar = parent.querySelector(`[${TOUCH_BAR_ATTR}]`)
    const top = bar ? Math.max(0, bar.getBoundingClientRect().bottom - box.top) : 0
    const next = { height: box.height, top }
    setRoom((prev) => (prev && prev.height === next.height && prev.top === next.top ? prev : next))
    return next
  }, [])

  const drawn = tabs.length > 0 && !hidden
  React.useLayoutEffect(() => {
    if (!(sheet || wholeView) || !drawn) return
    measureRoom()
    const parent = spaceRef.current?.parentElement
    window.addEventListener('resize', measureRoom)
    const observer = parent && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measureRoom()) : null
    if (parent && observer) observer.observe(parent)
    return () => {
      window.removeEventListener('resize', measureRoom)
      observer?.disconnect()
    }
    // `open`: the Play bar comes and goes with the file in front, so look again each
    // time the sheet is about to be drawn open
  }, [sheet, wholeView, drawn, open, measureRoom])

  const goToRest = React.useCallback((next: 'closed' | SheetRest) => {
    if (next === 'closed') {
      setBottomPanelOpen(false)
      return
    }
    setSheetRest(next)
    setBottomPanelOpen(true)
  }, [])

  // A pull on the strip. Followed on the window, not by capturing the pointer: a
  // captured pointer's click lands on the strip instead of the tab under the finger,
  // and a plain tap on a tab has to stay a tap on that tab.
  const pullRef = React.useRef<{ pointerId: number; startY: number; from: number; heights: Record<SheetStop, number>; moved: boolean } | null>(null)
  /** set when a pull ends, so the click the browser makes of it does not also press a tab */
  const swallowClickRef = React.useRef(false)
  const restRef = React.useRef<'closed' | SheetRest>(open ? sheetRest : 'closed')
  restRef.current = open ? sheetRest : 'closed'
  const endPullRef = React.useRef<(() => void) | null>(null)
  React.useEffect(() => () => endPullRef.current?.(), [])

  const onStripPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      swallowClickRef.current = false
      if (!sheet || pullRef.current) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const measured = measureRoom()
      if (!measured) return
      const heights = sheetHeights(measured)
      const rest = restRef.current
      const from = rest === 'closed' ? heights.closed : restHeight(rest, heights)
      pullRef.current = { pointerId: e.pointerId, startY: e.clientY, from, heights, moved: false }

      /** how tall the sheet is with the finger at `y`: under it, inside the room */
      const heightAt = (pull: NonNullable<typeof pullRef.current>, y: number): number =>
        Math.max(pull.heights.closed, Math.min(pull.heights.full, pull.from + pull.startY - y))
      const move = (ev: PointerEvent): void => {
        const pull = pullRef.current
        if (!pull || ev.pointerId !== pull.pointerId) return
        if (!pull.moved && Math.abs(pull.startY - ev.clientY) < SHEET_PULL_SLOP) return
        pull.moved = true
        setPulled(heightAt(pull, ev.clientY))
      }
      const finish = (ev: PointerEvent, settle: boolean): void => {
        const pull = pullRef.current
        if (!pull || ev.pointerId !== pull.pointerId) return
        end()
        if (!pull.moved) return
        swallowClickRef.current = true
        setPulled(null)
        if (settle) goToRest(sheetRestAfterPull(heightAt(pull, ev.clientY), pull.heights, window.innerHeight))
      }
      const up = (ev: PointerEvent): void => finish(ev, true)
      const cancel = (ev: PointerEvent): void => finish(ev, false)
      const end = (): void => {
        pullRef.current = null
        endPullRef.current = null
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
      }
      endPullRef.current = () => {
        end()
        setPulled(null)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
    },
    [sheet, measureRoom, goToRest],
  )

  // pagehide flush — defense against unload race for a not-yet-committed
  // drag (e.g., user grabs handle then closes tab without releasing).
  React.useEffect(() => {
    const flush = () => writePersistedHeight(height)
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [height])

  // Captures the drawer's open state at the FIRST click of a potential
  // double-click on a tab, so double-clicking a tab collapses it only when it
  // was already open — double-clicking a collapsed tab opens it (via the first
  // click) instead of flashing open-then-closed (#712).
  const wasOpenOnTabPressRef = React.useRef(open)

  // Refs for tab buttons so keyboard navigation can move focus.
  const tabButtonRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map())
  const setTabButtonRef = React.useCallback(
    (id: string) => (el: HTMLButtonElement | null) => {
      if (el) tabButtonRefs.current.set(id, el)
      else tabButtonRefs.current.delete(id)
    },
    [],
  )

  const focusTab = React.useCallback((id: string) => {
    const el = tabButtonRefs.current.get(id)
    if (el) el.focus()
  }, [])

  const onTabsKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (tabs.length === 0) return
      const idx = tabs.findIndex((t) => t.id === activeTabId)
      const safeIdx = idx < 0 ? 0 : idx
      let next = safeIdx
      if (e.key === 'ArrowRight') {
        next = (safeIdx + 1) % tabs.length
      } else if (e.key === 'ArrowLeft') {
        next = (safeIdx - 1 + tabs.length) % tabs.length
      } else if (e.key === 'Home') {
        next = 0
      } else if (e.key === 'End') {
        next = tabs.length - 1
      } else {
        return
      }
      e.preventDefault()
      const target = tabs[next]
      if (target) {
        setActiveTabId(target.id)
        // Move focus next tick so the rerender's tabIndex updates land.
        queueMicrotask(() => focusTab(target.id))
      }
    },
    [tabs, activeTabId, focusTab],
  )

  // ---- the keyboard (#2004) ----
  // Upright on a phone, the strip and its sheet give way while the keyboard is up —
  // unless the keyboard was raised from INSIDE the panel (a name being typed in the
  // Mixer or the Timeline): taking the panel away then would take the box being typed
  // in. Read in the render, not in an effect: an effect would run after the panel had
  // already gone, and the focus with it.
  const keyboardUp = useKeyboardUp()
  const [, refocused] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    if (!keyboardUp) return
    // focus moving out of the panel, into the code, while the keyboard stays up
    document.addEventListener('focusin', refocused)
    return () => document.removeEventListener('focusin', refocused)
  }, [keyboardUp])
  const typingInPanel =
    keyboardUp && typeof document !== 'undefined' && document.activeElement?.closest('[data-bottom-panel="root"]') != null
  const givesWayToKeyboard = sheet && keyboardUp && !typingInPanel

  // True zero-pixel cost when no tabs are registered (Trap 2).
  if (tabs.length === 0) return null
  // #2022 — after every hook, so hiding and showing never changes their order
  // and the state above survives the gap.
  if (hidden) return null
  // #2004 — the same for the sheet while the keyboard is up: the strip gives way so the
  // code has the room, and comes back as it was when the keyboard closes.
  if (givesWayToKeyboard) return null

  // While dragging, render with the live hook value so the drawer
  // visibly resizes; otherwise use the committed height.
  const renderHeight = drag.dragging ? drag.value : height

  // The sheet's height: where a pull has it right now, else where it rests. Before the
  // room has been measured (the first paint) an open sheet is drawn at half the
  // window, which is what half the room comes to within a few pixels.
  const stopHeights = sheetHeights(room ?? { height: typeof window === 'undefined' ? 0 : window.innerHeight, top: 0 })
  const sheetHeight = pulled ?? (open ? restHeight(sheetRest, stopHeights) : stopHeights.closed)
  const headerHeight = sheet ? SHEET_HEADER_HEIGHT : HEADER_HEIGHT
  const bodyDrawn = open || (sheet && pulled !== null)
  /** the showing tab's own header controls, if it has any (#2044) */
  const activeHeaderActions = tabs.find((tab) => tab.id === activeTabId)?.headerActions ?? null

  if (wholeView) {
    // The space keeps the panel's parent findable for `measureRoom`; it takes no room.
    return (
      <>
        <div ref={spaceRef} data-bottom-panel="strip-space" style={{ flex: '0 0 0px' }} />
        <div
          data-bottom-panel="root"
          data-whole-view={open ? 'open' : 'closed'}
          role="region"
          aria-label="Bottom panel"
          hidden={!open}
          style={{
            display: open ? 'flex' : 'none',
            flexDirection: 'column',
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            top: room?.top ?? 0,
            zIndex: SHEET_Z_INDEX,
            background: 'var(--background, #0f0f12)',
            color: 'var(--foreground, #e6e6ec)',
            overflow: 'hidden',
          }}
        >
          {open && (
            <div
              data-bottom-panel="body"
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            >
              {tabs.map((tab) => {
                const selected = tab.id === activeTabId
                return (
                  <div
                    key={tab.id}
                    role="tabpanel"
                    aria-label={tab.title}
                    hidden={!selected}
                    style={{
                      display: selected ? 'flex' : 'none',
                      flexDirection: 'column',
                      flex: 1,
                      minHeight: 0,
                      overflow: 'auto',
                    }}
                  >
                    {renderTabBody(tab)}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </>
    )
  }

  const panel = (
    <div
      data-bottom-panel="root"
      data-sheet={sheet ? stop : undefined}
      role="region"
      aria-label="Bottom panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        ...(sheet
          ? { position: 'absolute', left: 0, right: 0, bottom: 0, height: sheetHeight, zIndex: SHEET_Z_INDEX }
          : { flexBasis: open ? renderHeight : CLOSED_HEIGHT, flexShrink: 0, flexGrow: 0, position: 'relative' }),
        borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
        background: 'var(--background, #0f0f12)',
        color: 'var(--foreground, #e6e6ec)',
        overflow: 'hidden',
        boxSizing: sheet ? 'border-box' : undefined,
      }}
    >
      {open && !sheet && (
        <div
          data-bottom-panel="resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize bottom panel"
          tabIndex={-1}
          {...drag.handleProps}
          // Double-click the resize handle to collapse the drawer — same
          // one-gesture collapse affordance as the left panel (#616). Reopen
          // via the toggle button in the header. A plain click starts/ends a
          // zero-delta drag (no-op), so this doesn't fight the resize.
          onDoubleClick={() => setOpen(false)}
          style={{
            height: RESIZE_HANDLE_HEIGHT,
            cursor: 'ns-resize',
            background: 'transparent',
            // A subtle hover affordance via the user agent's outline isn't
            // enough — give the handle a visible top hairline so the user
            // sees something to grab. Stays inside the closed-state budget.
            flex: '0 0 auto',
            touchAction: 'none',
          }}
        />
      )}
      <div
        data-bottom-panel="header"
        // on a phone the whole strip is the sheet's handle (#2002)
        onPointerDown={sheet ? onStripPointerDown : undefined}
        onClickCapture={
          sheet
            ? (e) => {
                // the click a browser makes at the end of a pull is not a press on a tab
                if (!swallowClickRef.current) return
                swallowClickRef.current = false
                e.preventDefault()
                e.stopPropagation()
              }
            : undefined
        }
        style={{
          height: headerHeight,
          minHeight: headerHeight,
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: bodyDrawn
            ? '1px solid var(--border-subtle, rgba(255,255,255,0.06))'
            : 'none',
          flex: '0 0 auto',
          // the pull is the strip's; the browser must not scroll or go back with it
          touchAction: sheet ? 'none' : undefined,
        }}
      >
        <div
          role="tablist"
          aria-label="Bottom panel tabs"
          onKeyDown={onTabsKeyDown}
          style={{
            display: 'flex',
            alignItems: 'stretch',
            flex: sheet ? '0 1 auto' : 1,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {tabs.map((tab) => {
            const selected = tab.id === activeTabId
            return (
              <button
                key={tab.id}
                ref={setTabButtonRef(tab.id)}
                role="tab"
                type="button"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                data-tab-id={tab.id}
                onClick={(e) => {
                  // Double-click a tab to collapse the drawer (#712). `e.detail`
                  // is the click count: the 2nd click of a double-click arrives
                  // as detail>=2. Collapse only if the drawer was open when the
                  // sequence began (wasOpenOnTabPressRef) so a double-click on a
                  // collapsed tab just opens it, and keyboard activation
                  // (detail===0) never collapses.
                  if (e.detail >= 2) {
                    if (wasOpenOnTabPressRef.current) setOpen(false)
                    return
                  }
                  wasOpenOnTabPressRef.current = open
                  // Clicking a closed-drawer tab opens the drawer in
                  // addition to selecting; matches VSCode's terminal
                  // header behavior.
                  if (!open) {
                    // a sheet opened from its strip opens at half (#2002)
                    setSheetRest('half')
                    setOpen(true)
                  }
                  setActiveTabId(tab.id)
                }}
                style={{
                  appearance: 'none',
                  border: 'none',
                  background: 'transparent',
                  color: selected
                    ? 'var(--foreground, #e6e6ec)'
                    : 'var(--foreground-muted, #a0a0aa)',
                  padding: sheet ? '0 14px' : '0 12px',
                  minWidth: sheet ? TOUCH : undefined,
                  fontSize: sheet ? 14 : 12,
                  fontFamily:
                    'system-ui, -apple-system, "Segoe UI", sans-serif',
                  cursor: 'pointer',
                  borderTop: selected
                    ? '1px solid var(--accent, #8b5cf6)'
                    : '1px solid transparent',
                  outline: 'none',
                }}
              >
                {tab.title}
              </button>
            )
          })}
        </div>
        {sheet && (
          // The pull handle: the part of the strip that is nothing else. It is not a
          // button — there is nothing to press — and the tabs and the toggle beside
          // it pull the sheet just the same.
          <div
            data-bottom-panel="sheet-handle"
            aria-hidden="true"
            style={{ flex: 1, minWidth: TOUCH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: 'var(--foreground-muted, #a0a0aa)',
                opacity: 0.6,
              }}
            />
          </div>
        )}
        {/* the showing tab's own controls (#2044), only while there is a body for them to act on */}
        {bodyDrawn && activeHeaderActions}
        <button
          data-bottom-panel="toggle"
          type="button"
          aria-label={open ? 'Hide panel' : 'Show panel'}
          aria-expanded={open}
          onClick={() => {
            if (!open) setSheetRest('half')
            setOpen(!open)
          }}
          style={{
            appearance: 'none',
            border: 'none',
            background: 'transparent',
            color: 'var(--foreground-muted, #a0a0aa)',
            padding: '0 10px',
            minWidth: sheet ? TOUCH : undefined,
            cursor: 'pointer',
            fontSize: sheet ? 14 : 12,
          }}
        >
          {open ? '▾' : '▴'}
        </button>
      </div>
      {bodyDrawn && (
        <div
          data-bottom-panel="body"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {tabs.map((tab) => {
            const selected = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                role="tabpanel"
                aria-labelledby={tab.id}
                hidden={!selected}
                style={{
                  display: selected ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                }}
              >
                {renderTabBody(tab)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  if (!sheet) return panel
  return (
    <>
      {/* The strip's place in the layout. It never changes height, so the editor
          above it never does either, whatever the sheet is doing over it. */}
      <div ref={spaceRef} data-bottom-panel="strip-space" style={{ flex: `0 0 ${SHEET_CLOSED_HEIGHT}px` }} />
      {panel}
    </>
  )
}
