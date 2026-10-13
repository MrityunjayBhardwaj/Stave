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
 * A phone has no side panel in this tab (#1990), so it has no button either: the
 * button draws nothing there, and the stored choice is not consulted.
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
