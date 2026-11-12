/**
 * velocityDrag.ts — may a vertical drag on a step grid's lit cell set its velocity? (#2525)
 *
 * OFF BY DEFAULT, in both grid modes (decided 2026-11-09). Measured on 385 community documents:
 * a gain is almost always one number (`.gain(0.75)`), and one level per written step — what a
 * velocity drag writes — appears in about 1% of them. With the drag armed, a click that wobbles
 * 4 px rewrites `.gain(0.75)` into a per-step string. So the step grids' velocity is opt-in:
 * Settings › Pattern & Timeline › Velocity drag. The piano roll's own velocity lane is not this.
 *
 * Off: no lit cell arms a vertical drag or claims a level (`data-gain`), and fills are full
 * height. On: the column grid's per-column gain (`ColumnStepGrid`, #409) and the tree grid's
 * per-step level (`ExactStepGrid`, #2468).
 *
 * The same tiny external store + SSR-safe localStorage as `gridMode.ts`.
 */
import * as React from 'react'

export const VELOCITY_DRAG_KEY = 'stave:visualEdit.velocityDrag'
const DEFAULT_ON = false

function readStored(): boolean {
  if (typeof window === 'undefined') return DEFAULT_ON
  try {
    const v = window.localStorage.getItem(VELOCITY_DRAG_KEY)
    return v === '1' ? true : v === '0' ? false : DEFAULT_ON
  } catch {
    return DEFAULT_ON
  }
}

let current: boolean = readStored()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whether the step grids take a velocity drag, re-rendering when Settings changes it. */
export function useVelocityDrag(): boolean {
  return React.useSyncExternalStore(subscribe, () => current, () => DEFAULT_ON)
}

/** For the Settings modal to seed its control. */
export function getVelocityDrag(): boolean {
  return current
}

/** Turn the step grids' velocity drag on or off (the Settings modal). Persists and redraws every live grid. */
export function setVelocityDrag(on: boolean): void {
  if (on === current) return
  current = on
  try {
    window.localStorage.setItem(VELOCITY_DRAG_KEY, on ? '1' : '0')
  } catch {
    /* Safari private mode — keep the in-memory value */
  }
  listeners.forEach((l) => l())
}
