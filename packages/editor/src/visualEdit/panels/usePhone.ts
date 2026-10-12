/**
 * Is this a PHONE (#1990)? Two things, both asked of the browser:
 *
 *   - its main pointer is a finger (`(pointer: coarse)`) — so a narrow desktop window is
 *     still a desktop, and a laptop with a touch screen still has a mouse;
 *   - the SHORT side of its screen is under 600 px — the line phones and tablets fall
 *     either side of (a phone is 320–430 across, the smallest tablets 600 and up).
 *
 * The SCREEN is measured, not the window: turning a phone sideways makes its window
 * 800-odd px wide, and an on-screen keyboard makes a tablet's window short, and neither
 * changes what the device is.
 *
 * A tablet is not a phone here: it keeps the desktop's layout.
 */
import * as React from 'react'

export const TOUCH_POINTER_QUERY = '(pointer: coarse)'
/** a screen whose short side is under this is a phone's */
export const PHONE_SHORT_SIDE_PX = 600

function pointerQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(TOUCH_POINTER_QUERY) : null
}

/** the answer right now, for code that is not a component (a first render's starting state) */
export function isPhone(): boolean {
  if (!(pointerQuery()?.matches ?? false)) return false
  const s = window.screen
  // a browser that will not say how big its screen is gets the desktop layout
  if (!s || !(s.width > 0) || !(s.height > 0)) return false
  return Math.min(s.width, s.height) < PHONE_SHORT_SIDE_PX
}

export function usePhone(): boolean {
  return React.useSyncExternalStore(
    (changed) => {
      const mql = pointerQuery()
      if (!mql) return () => undefined
      mql.addEventListener('change', changed)
      // a folding phone opened flat becomes a tablet: its screen changes with a resize
      window.addEventListener('resize', changed)
      return () => {
        mql.removeEventListener('change', changed)
        window.removeEventListener('resize', changed)
      }
    },
    isPhone,
    () => false,
  )
}
