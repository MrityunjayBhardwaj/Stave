/**
 * The transport bar's size on a phone (#2035).
 *
 * On a phone this bar holds the only Play there is, and at the desktop's size —
 * a 40 px bar with a 25 px button — a finger misses it. So on a phone the bar is
 * tall enough for a 44 px control and every button in it is at least 44 px each
 * way, including the ones an embedder passes in as `chromeExtras`.
 *
 * The button rule is a stylesheet rule, not a style on each button: the extras
 * are the embedder's own components, and the bar cannot reach into their styles.
 * It only sets what no button's inline style sets — minimum sizes, and not shrinking
 * or wrapping — so nothing here has to out-rank anything.
 */
import { usePhone } from '../usePhone'

const DESKTOP_BAR_HEIGHT = 40
/** the smallest control a finger hits reliably */
const TOUCH = 44
const PHONE_BAR_HEIGHT = TOUCH + 8

/** on the bar's root while it is sized for a finger; the bottom panel's sheet stops under it */
export const TOUCH_BAR_ATTR = 'data-touch-bar'

let touchBarStyleInjected = false
function ensureTouchBarStyle(): void {
  if (touchBarStyleInjected) return
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.setAttribute('data-stave-style', 'touch-bar')
  // `flex-shrink:0` and `nowrap`: when an error message shares the bar it is the message
  // that gives way (it already ends in an ellipsis), never a button's width or its label
  el.textContent = `[${TOUCH_BAR_ATTR}] button{min-height:${TOUCH}px;min-width:${TOUCH}px;justify-content:center;flex-shrink:0;white-space:nowrap}`
  document.head.appendChild(el)
  touchBarStyleInjected = true
}

export interface TouchBar {
  /** the bar's height: the desktop's 40 px, or room for a finger on a phone */
  readonly height: number
  /** spread onto the bar's root element */
  readonly attrs: Readonly<Record<string, string>>
}

export function useTouchBar(): TouchBar {
  const phone = usePhone()
  if (phone) ensureTouchBarStyle()
  return phone
    ? { height: PHONE_BAR_HEIGHT, attrs: { [TOUCH_BAR_ATTR]: '' } }
    : { height: DESKTOP_BAR_HEIGHT, attrs: {} }
}
