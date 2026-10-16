/**
 * anchorScroll — what an outside scroll does to a popover that was placed off
 * its trigger's rect (#2088).
 *
 * The Mixer's popovers are portaled to <body> and positioned from the
 * trigger's viewport rect, so a scroll that moves the trigger would leave the
 * menu floating (#587). They used to close on ANY outside scroll. But the
 * browser delivers `scroll` at the next frame — after the click that opened
 * the menu has run — so a scroll that happened BEFORE the open (a wheel flick,
 * a trackpad's momentum, a test runner scrolling the trigger clear of a toast)
 * closed the menu the moment it appeared.
 *
 * The rule: a scroll that left the trigger where the menu was placed from is
 * ignored; one that moved it re-places the menu so it stays on its button; one
 * that took the trigger out of the scrolled box's visible area closes it.
 */
import * as React from 'react'

export interface RectLike {
  readonly top: number
  readonly left: number
  readonly bottom: number
  readonly right: number
}

export type ScrollVerdict = 'ignore' | 'follow' | 'close'

/** Sub-pixel tolerance: layout rounding is not a move. */
const MOVED_PX = 0.5

/**
 * `placed` — the trigger's rect when the menu was last placed (null if never);
 * `now` — the trigger's rect at the scroll; `clip` — the visible box of the
 * element that scrolled (the viewport for a page scroll).
 */
export function scrollVerdict(placed: RectLike | null, now: RectLike, clip: RectLike): ScrollVerdict {
  if (
    placed &&
    Math.abs(placed.top - now.top) < MOVED_PX &&
    Math.abs(placed.left - now.left) < MOVED_PX
  ) {
    return 'ignore'
  }
  const outOfView =
    now.bottom <= clip.top || now.top >= clip.bottom || now.right <= clip.left || now.left >= clip.right
  return outOfView ? 'close' : 'follow'
}

function viewportRect(): RectLike {
  return { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth }
}

/**
 * Wire the rule for one popover. `place` re-reads the trigger's rect and sets
 * the menu's position; `close` dismisses it. Scrolls inside the menu itself
 * (its own list) never count.
 */
export function useAnchorScroll(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  menuRef: React.RefObject<HTMLElement | null>,
  place: () => void,
  close: () => void,
): void {
  const placedAt = React.useRef<RectLike | null>(null)

  // Runs in the same commit as the owner's own open-time `place()`, so both
  // read the trigger at the same moment.
  React.useLayoutEffect(() => {
    placedAt.current = open ? (anchorRef.current?.getBoundingClientRect() ?? null) : null
  }, [open, anchorRef])

  React.useEffect(() => {
    if (!open) return
    const onScroll = (e: Event): void => {
      const t = e.target
      if (t instanceof Node && menuRef.current?.contains(t)) return
      const anchor = anchorRef.current
      if (!anchor) {
        close()
        return
      }
      const now = anchor.getBoundingClientRect()
      const clip = t instanceof Element ? t.getBoundingClientRect() : viewportRect()
      const verdict = scrollVerdict(placedAt.current, now, clip)
      if (verdict === 'close') close()
      else if (verdict === 'follow') {
        placedAt.current = now
        place()
      }
    }
    // capture: a scroll on any ancestor (the drawer body) is seen too
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open, anchorRef, menuRef, place, close])
}
