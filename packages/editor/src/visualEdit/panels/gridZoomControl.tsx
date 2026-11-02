/**
 * gridZoomControl.tsx — the step grid's zoom (#2277): how wide its columns are drawn, and
 * the control that sets it.
 *
 * 1× fits the bar to the panel; each step in is wider. ⌘/Ctrl + wheel over the grid zooms
 * around the pointer, as a DAW's horizontal zoom does; the − / + buttons zoom around the
 * left edge of what is on screen. A view setting only: nothing here reaches the code.
 */
import * as React from 'react'

export const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16] as const

/** what sits left of and around the steps, inside the scroll box: its padding, the `+` room, the row names */
const CHROME_PX = 16 + 16 + 28 + 104

export interface GridZoom {
  level: number
  /** px the steps have at 1×: the panel's width less its row names and padding; null until measured */
  avail: number | null
  zoomIn: () => void
  zoomOut: () => void
  canIn: boolean
  canOut: boolean
}

/**
 * `mounted`: the scroll box is on the page. The grid draws a standby line until it has a
 * model, so the box it measures comes and goes — each time it comes, it is measured again.
 */
export function useGridZoom(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  mounted: boolean,
  /** the box the columns are laid in, when it can be measured directly (the roll's ruler track) */
  trackRef?: React.RefObject<HTMLDivElement | null>,
): GridZoom {
  const [index, setIndex] = React.useState(0)
  const [avail, setAvail] = React.useState<number | null>(null)
  const indexRef = React.useRef(index)
  indexRef.current = index

  React.useLayoutEffect(() => {
    const el = trackRef?.current ?? scrollRef.current
    if (!el || !enabled) return
    // a box with no room yet (a panel still opening) is not a width to fit to
    const measure = (): void => {
      const w = trackRef?.current ? el.clientWidth : el.clientWidth - CHROME_PX
      setAvail(w >= 50 ? w : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollRef, trackRef, enabled, mounted])

  /** move to level `next`, keeping the content under `x` (px from the scroll box's left) in place */
  const go = React.useCallback(
    (next: number, x: number) => {
      const el = scrollRef.current
      const from = ZOOM_LEVELS[indexRef.current]
      const to = ZOOM_LEVELS[next]
      if (next === indexRef.current) return
      setIndex(next)
      if (!el) return
      const before = el.scrollLeft
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, (before + x) * (to / from) - x)
      })
    },
    [scrollRef],
  )

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || !enabled) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return
      e.preventDefault()
      const at = indexRef.current
      const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, at + (e.deltaY < 0 ? 1 : -1)))
      go(next, e.clientX - el.getBoundingClientRect().left)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scrollRef, enabled, mounted, go])

  return {
    level: enabled ? ZOOM_LEVELS[index] : 1,
    avail: enabled ? avail : null,
    zoomIn: () => go(Math.min(ZOOM_LEVELS.length - 1, indexRef.current + 1), 0),
    zoomOut: () => go(Math.max(0, indexRef.current - 1), 0),
    canIn: index < ZOOM_LEVELS.length - 1,
    canOut: index > 0,
  }
}

const button: React.CSSProperties = {
  width: 18,
  height: 18,
  padding: 0,
  lineHeight: '16px',
  fontSize: 12,
  borderRadius: 3,
  border: '1px solid var(--border, #3a3a42)',
  background: 'transparent',
  color: 'var(--foreground-muted, #a0a0aa)',
  cursor: 'pointer',
}

/** − 1× + : the grid's zoom, beside the track's name */
export function GridZoomControl({ zoom }: { zoom: GridZoom }): React.ReactElement {
  return (
    <div data-grid-zoom style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--foreground-muted, #a0a0aa)' }}>
      <button type="button" aria-label="zoom out" title="Zoom out (⌘/Ctrl + scroll)" data-grid-zoom-out disabled={!zoom.canOut} onClick={zoom.zoomOut} style={{ ...button, opacity: zoom.canOut ? 1 : 0.4 }}>
        −
      </button>
      <span data-grid-zoom-level style={{ minWidth: 24, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {zoom.level}×
      </span>
      <button type="button" aria-label="zoom in" title="Zoom in (⌘/Ctrl + scroll)" data-grid-zoom-in disabled={!zoom.canIn} onClick={zoom.zoomIn} style={{ ...button, opacity: zoom.canIn ? 1 : 0.4 }}>
        +
      </button>
    </div>
  )
}
