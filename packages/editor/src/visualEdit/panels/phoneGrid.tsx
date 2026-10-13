/**
 * The Pattern grids on a phone (#2006): steps wide enough to tap, and a way to reach
 * the ones that no longer fit.
 *
 * A 16-step bar in a 390 px screen gave each step 16 px. A finger needs about 40. So
 * on a phone a step is never drawn narrower than that, a bar that does not fit
 * scrolls sideways, and the row names stay put while it does.
 *
 * WHAT SCROLLS IT IS THE RULER, NOT THE STEPS. A drag on a step is the grid's own —
 * it paints, it sets a note's length — and the grids switch the browser's own
 * panning off so that it stays theirs. The row of step numbers above them edits
 * nothing, so on a phone it is made tall enough to hold and a drag along it moves the
 * grid. Under the numbers a thin bar shows which part of the pattern is in view.
 *
 * Both grids use this, so the rule is written once.
 */
import * as React from 'react'

import { usePhoneLayout } from '../../workspace/usePhone'

/** a step's narrowest width on a phone: what a finger hits reliably */
export const PHONE_STEP_MIN = 40
/** the ruler's height on a phone: tall enough to hold and drag */
export const PHONE_RULER_HEIGHT = 44

export interface PhoneGrid {
  /** steps get their finger-sized floor, the ruler pans, row names stay put */
  readonly phone: boolean
  /** held upright — where turning the phone would show more steps */
  readonly upright: boolean
}

export function usePhoneGrid(): PhoneGrid {
  const layout = usePhoneLayout()
  return { phone: layout !== 'none', upright: layout === 'upright' }
}

/** which part of the grid's width is on screen, as fractions of the whole */
export interface GridInView {
  readonly start: number
  readonly end: number
  /** there is more than fits: the ruler has something to pan to */
  readonly more: boolean
}

const ALL_IN_VIEW: GridInView = { start: 0, end: 1, more: false }

export function gridInView(scrollLeft: number, clientWidth: number, scrollWidth: number): GridInView {
  if (!(scrollWidth > 0) || !(clientWidth > 0) || scrollWidth <= clientWidth + 1) return ALL_IN_VIEW
  const start = Math.max(0, Math.min(1, scrollLeft / scrollWidth))
  const end = Math.max(start, Math.min(1, (scrollLeft + clientWidth) / scrollWidth))
  return { start, end, more: true }
}

interface RulerPan {
  /** spread onto the ruler: a drag along it scrolls the grid sideways */
  readonly handlers: {
    readonly onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  }
  readonly inView: GridInView
  /** how wide the scrolling element's window is, in px; 0 off a phone */
  readonly viewWidth: number
}

/**
 * Make the ruler the grid's sideways scroll handle. `scrollRef` is the element that
 * scrolls. Off a phone this does nothing and reports everything in view.
 */
export function useRulerPan(scrollRef: React.RefObject<HTMLElement | null>, enabled: boolean): RulerPan {
  const [inView, setInView] = React.useState<GridInView>(ALL_IN_VIEW)
  const [viewWidth, setViewWidth] = React.useState(0)
  /** the scrolling element, once there is one: a grid draws a standby before its first pattern */
  const [scroller, setScroller] = React.useState<HTMLElement | null>(null)

  const read = React.useCallback((): void => {
    const sc = scrollRef.current
    const next = enabled && sc ? gridInView(sc.scrollLeft, sc.clientWidth, sc.scrollWidth) : ALL_IN_VIEW
    setInView((prev) => (prev.start === next.start && prev.end === next.end && prev.more === next.more ? prev : next))
    setViewWidth(enabled && sc ? sc.clientWidth : 0)
  }, [scrollRef, enabled])

  // After EVERY render: the grid's width changes when its pattern does, and nothing
  // else says so — the scrolling element itself stays the size it was.
  React.useLayoutEffect(() => {
    if (scrollRef.current !== scroller) setScroller(scrollRef.current)
    read()
  })

  React.useEffect(() => {
    if (!enabled || !scroller) return
    scroller.addEventListener('scroll', read, { passive: true })
    window.addEventListener('resize', read)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null
    observer?.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
      observer?.disconnect()
    }
  }, [enabled, scroller, read])

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const sc = scrollRef.current
      if (!sc) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const pointerId = e.pointerId
      const startX = e.clientX
      const startLeft = sc.scrollLeft
      const move = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return
        // the grid follows the finger: dragging left brings later steps in
        sc.scrollLeft = startLeft - (ev.clientX - startX)
      }
      const end = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    [scrollRef],
  )

  return { handlers: enabled ? { onPointerDown } : {}, inView, viewWidth }
}

/**
 * A grid's content box on a phone: as wide as its steps, so that a row is as wide as
 * what it holds. A pinned row name stays put only inside its own row's width, and a
 * row left at the panel's width ends where the screen does.
 */
export const PHONE_GRID_WIDTH: React.CSSProperties = { width: 'max-content', minWidth: '100%' }

/**
 * The thin bar over the ruler's numbers: the lit part is what is on screen. `width` is
 * the panel's, not the pattern's — the bar is the whole pattern drawn small.
 */
export function InViewBar({ inView, width }: { readonly inView: GridInView; readonly width: number }): React.ReactElement {
  return (
    <div
      data-grid-in-view
      data-more={inView.more ? 'true' : 'false'}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        width: Math.max(0, width),
        top: 6,
        height: 3,
        borderRadius: 2,
        // drawn only when there is something out of view to point at
        background: inView.more ? 'var(--border, #3a3a42)' : 'transparent',
        pointerEvents: 'none',
      }}
    >
      <div
        data-grid-in-view-part
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${inView.start * 100}%`,
          width: `${(inView.end - inView.start) * 100}%`,
          borderRadius: 2,
          background: inView.more ? 'var(--accent, #8b5cf6)' : 'transparent',
        }}
      />
    </div>
  )
}

/** Said beside the track's name while an upright phone has more steps than fit. */
export function TurnHint({ show }: { readonly show: boolean }): React.ReactElement | null {
  if (!show) return null
  return (
    <span data-grid-turn-hint style={{ fontSize: 11, color: 'var(--foreground-muted, #a0a0aa)', whiteSpace: 'nowrap' }}>
      Drag the numbers, or turn the phone
    </span>
  )
}
