/**
 * visibleArea — how much of a phone's screen is showing, and is the keyboard up (#2004)?
 *
 * A phone's on-screen keyboard does not shrink the page. It shrinks what the browser
 * calls the VISUAL viewport: the page keeps its full height and the keyboard lies over
 * the lower part of it. So the keyboard is read from the gap between the two — the
 * window's height, and the height the visual viewport says is showing.
 *
 * One owner, here. It writes what it reads onto the document root:
 *
 *   --stave-visible-height   the height still showing, in px (the app's shell is this tall)
 *   --stave-visible-top      how far the browser has slid the page up under the keyboard
 *   data-keyboard            present while the keyboard is up
 *
 * and unsets all three when the keyboard goes. The shell sizes itself with the CSS
 * variable, so the app's own React never has to call a hook from this package; the
 * editor's components that need to know (the bottom panel's strip gives way, the
 * editor brings the cursor's line into view) use `useKeyboardUp`.
 *
 * A phone only (`isPhone`): a tablet's keyboard, a desktop's narrow window and a
 * pinch-zoomed page are none of them this.
 */
import * as React from 'react'

import { isPhone } from './usePhone'

/** a gap smaller than this is a browser bar or a rounding, not a keyboard */
export const KEYBOARD_MIN_PX = 120

export const VISIBLE_HEIGHT_VAR = '--stave-visible-height'
export const VISIBLE_TOP_VAR = '--stave-visible-top'
export const KEYBOARD_ATTR = 'data-keyboard'

export interface VisibleArea {
  readonly keyboardUp: boolean
  /** px still showing above the keyboard; null when the keyboard is down */
  readonly height: number | null
  /** px the browser has slid the page up; 0 when the keyboard is down */
  readonly top: number
}

const ALL: VisibleArea = { keyboardUp: false, height: null, top: 0 }

/** what the browser says right now */
export function readVisibleArea(): VisibleArea {
  if (typeof window === 'undefined' || !isPhone()) return ALL
  const vv = window.visualViewport
  if (!vv) return ALL
  // a pinch-zoomed page shows fewer page pixels too; in screen terms it shows the same
  const scale = vv.scale > 0 ? vv.scale : 1
  const showing = vv.height * scale
  if (window.innerHeight - showing < KEYBOARD_MIN_PX) return ALL
  return {
    keyboardUp: true,
    height: Math.round(showing),
    // while zoomed, the offset is the zoom's pan, not the keyboard's push
    top: scale === 1 ? Math.max(0, Math.round(vv.offsetTop)) : 0,
  }
}

let current: VisibleArea = ALL
const listeners = new Set<() => void>()
let started = false

function write(area: VisibleArea): void {
  const root = document.documentElement
  if (area.keyboardUp && area.height !== null) {
    root.style.setProperty(VISIBLE_HEIGHT_VAR, `${area.height}px`)
    root.style.setProperty(VISIBLE_TOP_VAR, `${area.top}px`)
    root.setAttribute(KEYBOARD_ATTR, '')
  } else {
    root.style.removeProperty(VISIBLE_HEIGHT_VAR)
    root.style.removeProperty(VISIBLE_TOP_VAR)
    root.removeAttribute(KEYBOARD_ATTR)
  }
}

function update(): void {
  const next = readVisibleArea()
  if (next.keyboardUp === current.keyboardUp && next.height === current.height && next.top === current.top) return
  current = next
  write(next)
  listeners.forEach((l) => l())
}

/**
 * Start listening. Idempotent; called by the app once it is up, and by the first
 * component that asks. There is no stop: the listeners are three, they do nothing on a
 * device that is not a phone, and the page they are on is the app.
 */
export function startVisibleArea(): void {
  if (started || typeof window === 'undefined') return
  started = true
  const vv = window.visualViewport
  // the keyboard opening and closing is the visual viewport's resize; iOS sliding the
  // page under it is its scroll
  vv?.addEventListener('resize', update)
  vv?.addEventListener('scroll', update)
  // turning the phone, or a folding phone opened flat (no longer a phone)
  window.addEventListener('resize', update)
  update()
}

function subscribe(listener: () => void): () => void {
  startVisibleArea()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Is the on-screen keyboard up? Re-renders when it opens or closes. */
export function useKeyboardUp(): boolean {
  return React.useSyncExternalStore(subscribe, () => current.keyboardUp, () => false)
}

export function getVisibleArea(): VisibleArea {
  return current
}

/** for code that is not a component (the editor, which lives outside React) */
export function subscribeToVisibleArea(listener: () => void): () => void {
  return subscribe(listener)
}

/** tests only: forget everything, as a fresh page would */
export function __resetVisibleAreaForTests(): void {
  current = ALL
  listeners.clear()
  started = false
}
