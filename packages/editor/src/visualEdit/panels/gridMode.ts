/**
 * gridMode.ts — how the grids draw a pattern and how they edit it (#1855, #2294).
 *
 *   exact  the tree: each row at its own part's steps (`~ sd ~ sd, hh*8` draws the snare as
 *          4 boxes and the hats as 8), and every edit is of one step's own text — a click
 *          fills one whole box, and the piano roll's add, delete, length and move go through
 *          the step writer (`codeView/stepEdit.ts`, `codeView/rollEdit.ts`) (the default)
 *   lcm    the shared grid: every row cut to the least common multiple of the parts — the
 *          snare's steps drawn 2 cells wide, as the grid always drew them — and edits go
 *          through the column writer that respells the pattern from that grid
 *
 * NOT ONLY A VIEW any more: the two modes can write different code for the same gesture.
 * The roll's choice lives in one place, `rollWriter.ts` (`rollStepText`). The stored values
 * stay `'exact'` and `'lcm'` so a saved choice survives.
 *
 * A global UI setting, shared by every grid and persisted — the same tiny external
 * store + SSR-safe localStorage as `noteColor.ts`, set from the app's Settings
 * (Pattern & Timeline › Grid).
 */
import * as React from 'react'

export type GridMode = 'exact' | 'lcm'

export const GRID_MODE_KEY = 'stave:visualEdit.gridMode'
/** Exact from the first launch (decided 2026-09-30 on #1855) */
const DEFAULT_MODE: GridMode = 'exact'

function readStored(): GridMode {
  if (typeof window === 'undefined') return DEFAULT_MODE
  try {
    const v = window.localStorage.getItem(GRID_MODE_KEY)
    return v === 'exact' || v === 'lcm' ? v : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

let current: GridMode = readStored()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The grid mode, re-rendering when Settings changes it. */
export function useGridMode(): GridMode {
  return React.useSyncExternalStore(subscribe, () => current, () => DEFAULT_MODE)
}

/** Current grid mode — for the Settings modal to seed its control. */
export function getGridMode(): GridMode {
  return current
}

/** Set the grid mode (the Settings modal). Persists and redraws every live grid. */
export function setGridMode(mode: GridMode): void {
  if (mode === current) return
  current = mode
  try {
    window.localStorage.setItem(GRID_MODE_KEY, mode)
  } catch {
    /* Safari private mode — keep the in-memory value */
  }
  listeners.forEach((l) => l())
}
