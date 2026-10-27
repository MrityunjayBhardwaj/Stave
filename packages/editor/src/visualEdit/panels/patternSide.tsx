/**
 * patternSide — is the Pattern tab's right side panel showing (#2044)?
 *
 * The Pattern tab pins a 220 px panel on its right (the track's strip, Slots, the
 * instrument or kit, Snap, the knobs). A menu button at the top right corner of the
 * tab, in the row with the tab names, puts it away so the grid has the whole width,
 * and brings it back.
 *
 * A UI preference: shared by the panel (which draws the column or not) and the button
 * (which sits in the bottom panel's header, outside the panel), and persisted — the
 * same tiny external store + SSR-safe localStorage as `gridMode.ts`.
 *
 * A phone has no room for the pinned column (#1990), so it has no button either: the
 * button draws nothing there, and the stored choice is not consulted. Instead the same
 * panel starts collapsed to a slim rail on the right edge and slides in OVER the grid
 * when the rail is tapped (#2252) — `PatternSideDrawer` below. Open or closed is not
 * stored: a reload starts collapsed.
 */
import * as React from 'react'

import { usePhone } from '../../workspace/usePhone'

export const PATTERN_SIDE_KEY = 'stave:visualEdit.patternSide'
/** on the button; the browser specs find it by this */
export const PATTERN_SIDE_TOGGLE_ATTR = 'data-pattern-side-toggle'
/** shown until someone hides it — what the tab always did */
const DEFAULT_SHOWN = true

function readStored(): boolean {
  if (typeof window === 'undefined') return DEFAULT_SHOWN
  try {
    const v = window.localStorage.getItem(PATTERN_SIDE_KEY)
    return v === 'shown' ? true : v === 'hidden' ? false : DEFAULT_SHOWN
  } catch {
    return DEFAULT_SHOWN
  }
}

let current: boolean = readStored()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Is the side panel showing? Re-renders when the button changes it. */
export function usePatternSideShown(): boolean {
  return React.useSyncExternalStore(subscribe, () => current, () => DEFAULT_SHOWN)
}

export function getPatternSideShown(): boolean {
  return current
}

/** Show or hide the side panel. Persists, and redraws the panel and the button. */
export function setPatternSideShown(shown: boolean): void {
  if (shown === current) return
  current = shown
  try {
    window.localStorage.setItem(PATTERN_SIDE_KEY, shown ? 'shown' : 'hidden')
  } catch {
    /* Safari private mode — keep the in-memory value */
  }
  listeners.forEach((l) => l())
}

/**
 * The menu button. Lives in the bottom panel's header while the Pattern tab is the one
 * showing (the tab's `headerActions`).
 */
export function PatternSideToggle(): React.ReactElement | null {
  const phone = usePhone()
  const shown = usePatternSideShown()
  if (phone) return null
  const label = shown ? 'Hide side panel' : 'Show side panel'
  return (
    <button
      {...{ [PATTERN_SIDE_TOGGLE_ATTR]: '' }}
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={shown}
      onClick={() => setPatternSideShown(!shown)}
      style={{
        appearance: 'none',
        border: 'none',
        background: 'transparent',
        color: shown ? 'var(--foreground, #e2e2e8)' : 'var(--foreground-muted, #a0a0aa)',
        padding: '0 8px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" focusable="false">
        <path d="M1 2h12M1 6h12M1 10h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  )
}

/** the collapsed rail on a phone; the browser specs find it by this */
export const PATTERN_SIDE_RAIL_ATTR = 'data-pattern-side-rail'
/** the panel sliding in over the grid on a phone */
export const PATTERN_SIDE_DRAWER_ATTR = 'data-pattern-side-drawer'
/** the dimmed grid behind the open drawer: a tap here closes it and goes no further */
export const PATTERN_SIDE_SCRIM_ATTR = 'data-pattern-side-scrim'
/** how wide the collapsed rail is, in px — all the grid gives up on a phone */
export const PATTERN_SIDE_RAIL_WIDTH = 30
const SLIDE_MS = 240
const DRAWER_ID = 'stave-pattern-side-drawer'

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

/**
 * The side panel on a phone (#2252): a rail on the right edge, and the panel itself
 * sliding in over the grid when the rail is tapped.
 *
 * Over, not beside: next to a 390 px grid the panel would leave it about 60 px. So the
 * grid keeps its width and its sideways scroll and is only dimmed, with a strip of it
 * still showing on the left. A tap on the dimmed part closes the panel and is not passed
 * on — closing must never toggle a step.
 *
 * Rendered as the last children of the Pattern tab's row, which is `position: relative`
 * on a phone: the rail takes its place in the row, the dimmed layer and the drawer cover
 * the row. The panel is first built when it is first opened and then kept, so a knob
 * being dragged is not rebuilt when the drawer closes and opens again. The tab stays
 * mounted while another bottom tab is showing, so open or closed survives a tab switch.
 */
export function PatternSideDrawer({ children }: { children: React.ReactNode }): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [built, setBuilt] = React.useState(false)
  const railRef = React.useRef<HTMLButtonElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  // focus moves only after a person opened or closed it — never on the first draw
  const moved = React.useRef(false)
  const slide = reducedMotion() ? 0 : SLIDE_MS

  const show = (): void => {
    moved.current = true
    setBuilt(true)
    setOpen(true)
  }
  const hide = (): void => {
    moved.current = true
    setOpen(false)
  }

  React.useEffect(() => {
    if (!moved.current) return
    ;(open ? closeRef : railRef).current?.focus()
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        ref={railRef}
        {...{ [PATTERN_SIDE_RAIL_ATTR]: '' }}
        type="button"
        aria-label="Show inspector"
        title="Show inspector"
        aria-expanded={open}
        aria-controls={DRAWER_ID}
        onClick={show}
        style={{
          appearance: 'none',
          width: PATTERN_SIDE_RAIL_WIDTH,
          flexShrink: 0,
          height: '100%',
          margin: 0,
          padding: '10px 0',
          border: 'none',
          borderLeft: '1px solid var(--border, #3a3a42)',
          background: 'var(--background, #1c1c20)',
          color: 'var(--foreground-muted, #a0a0aa)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          touchAction: 'manipulation',
        }}
      >
        <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" focusable="false">
          <path d="M6 1 1 6l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        <span
          aria-hidden="true"
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Inspector
        </span>
      </button>
      <div
        {...{ [PATTERN_SIDE_SCRIM_ATTR]: '' }}
        aria-hidden="true"
        onPointerDown={(e) => {
          // the grid under it must not see this press
          e.preventDefault()
          e.stopPropagation()
        }}
        onClick={(e) => {
          e.stopPropagation()
          hide()
        }}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 30,
          background: 'rgba(0, 0, 0, 0.42)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: `opacity ${slide}ms ease-out`,
          touchAction: 'none',
        }}
      />
      <div
        id={DRAWER_ID}
        {...{ [PATTERN_SIDE_DRAWER_ATTR]: open ? 'open' : 'closed' }}
        role="dialog"
        aria-label="Inspector"
        aria-hidden={!open}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 31,
          width: 'min(78%, 320px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--background, #1c1c20)',
          borderLeft: '1px solid var(--border, #3a3a42)',
          boxShadow: open ? '-12px 0 32px rgba(0, 0, 0, 0.5)' : 'none',
          transform: open ? 'none' : 'translateX(102%)',
          // hidden only once it has slid out, so it leaves the tab order and the
          // accessibility tree without cutting the slide short
          visibility: open ? 'visible' : 'hidden',
          transition: open
            ? `transform ${slide}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
            : `transform ${slide}ms cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear ${slide}ms`,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            padding: '4px 4px 4px 12px',
            borderBottom: '1px solid var(--border, #3a3a42)',
            color: 'var(--foreground, #e2e2e8)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <span style={{ flex: 1 }}>Inspector</span>
          <button
            ref={closeRef}
            type="button"
            aria-label="Hide inspector"
            title="Hide inspector"
            onClick={hide}
            style={{
              appearance: 'none',
              width: 36,
              height: 36,
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--foreground-muted, #a0a0aa)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
        <div style={{ flex: '1 1 0', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>{built ? children : null}</div>
      </div>
    </>
  )
}
