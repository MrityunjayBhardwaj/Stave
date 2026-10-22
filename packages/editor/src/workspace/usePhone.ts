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

function subscribe(changed: () => void): () => void {
  const mql = pointerQuery()
  if (!mql) return () => undefined
  mql.addEventListener('change', changed)
  // a folding phone opened flat becomes a tablet: its screen changes with a resize.
  // Turning a phone is a resize too.
  window.addEventListener('resize', changed)
  return () => {
    mql.removeEventListener('change', changed)
    window.removeEventListener('resize', changed)
  }
}

export function usePhone(): boolean {
  return React.useSyncExternalStore(subscribe, isPhone, () => false)
}

/** not a phone; or a phone, and which way it is being held */
export type PhoneLayout = 'none' | 'upright' | 'sideways'

/**
 * Which way up is the phone (#2002)?
 *
 * Asked of the window's WIDTH against the screen's short side: upright, the window is
 * as wide as the short side; sideways, it is wider. Not asked of the window's shape —
 * an on-screen keyboard makes an upright phone's window wider than it is tall, and the
 * phone has not been turned. Not asked of the screen's own width and height either:
 * some browsers report those turned with the phone and some do not (an iPhone's stay
 * 390 x 844 either way up).
 */
export function phoneLayout(): PhoneLayout {
  if (!isPhone()) return 'none'
  const s = window.screen
  return window.innerWidth > Math.min(s.width, s.height) ? 'sideways' : 'upright'
}

export function usePhoneLayout(): PhoneLayout {
  return React.useSyncExternalStore(subscribe, phoneLayout, () => 'none' as const)
}
