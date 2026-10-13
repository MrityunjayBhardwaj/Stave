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

  // True zero-pixel cost when no tabs are registered (Trap 2).
  if (tabs.length === 0) return null
  // #2022 — after every hook, so hiding and showing never changes their order
  // and the state above survives the gap.
  if (hidden) return null

  // While dragging, render with the live hook value so the drawer
  // visibly resizes; otherwise use the committed height.
  const renderHeight = drag.dragging ? drag.value : height

  return (
    <div
      data-bottom-panel="root"
      role="region"
      aria-label="Bottom panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexBasis: open ? renderHeight : CLOSED_HEIGHT,
        flexShrink: 0,
        flexGrow: 0,
        borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
        background: 'var(--background, #0f0f12)',
        color: 'var(--foreground, #e6e6ec)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {open && (
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
        style={{
          height: HEADER_HEIGHT,
          minHeight: HEADER_HEIGHT,
          display: 'flex',
          alignItems: 'stretch',
          borderBottom: open
            ? '1px solid var(--border-subtle, rgba(255,255,255,0.06))'
            : 'none',
          flex: '0 0 auto',
        }}
      >
        <div
          role="tablist"
          aria-label="Bottom panel tabs"
          onKeyDown={onTabsKeyDown}
          style={{
            display: 'flex',
            alignItems: 'stretch',
            flex: 1,
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
                  if (!open) setOpen(true)
                  setActiveTabId(tab.id)
                }}
                style={{
                  appearance: 'none',
                  border: 'none',
                  background: 'transparent',
                  color: selected
                    ? 'var(--foreground, #e6e6ec)'
                    : 'var(--foreground-muted, #a0a0aa)',
                  padding: '0 12px',
                  fontSize: 12,
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
        <button
          data-bottom-panel="toggle"
          type="button"
          aria-label={open ? 'Hide panel' : 'Show panel'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          style={{
            appearance: 'none',
            border: 'none',
            background: 'transparent',
            color: 'var(--foreground-muted, #a0a0aa)',
            padding: '0 10px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
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
}
