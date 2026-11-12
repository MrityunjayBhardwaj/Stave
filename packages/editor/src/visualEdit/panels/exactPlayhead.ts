/**
 * exactPlayhead — a line at the exact position the transport plays, over a grid drawn in
 * columns (#1834).
 *
 * The playing CELL (`usePlayingStep`) is a column: `floor(phase × steps)`, which is right
 * for "which step is sounding" and wrong for "where is the music now" — inside a step of
 * eight columns it jumps eight times a step. This line moves with the phase itself: the
 * column it falls in (`cycleToColumn`, unrounded) is found on screen and the line is put
 * that far into it. It moves each frame by style alone, never by a render.
 */
import * as React from 'react'

import { readCurrentCycle } from '../../workspace/currentCycle'
import { cycleToColumn } from './usePlayingStep'

/** the phase a cycle plays, in cycles from the pattern's start, `[0, bars)` */
export function patternPhase(cycle: number | null, bars: number): number | null {
  if (cycle === null || !Number.isFinite(cycle)) return null
  const b = bars > 0 ? bars : 1
  return ((cycle % b) + b) % b
}

/**
 * Keep `line` at the playing position inside `box`. `column(c)` is the element drawn for
 * column `c` (the ruler's), whose left edge and width place the line; it need not sit
 * inside `box`, only share its horizontal axis.
 */
export function useExactPlayhead(
  box: React.RefObject<HTMLElement | null>,
  line: React.RefObject<HTMLElement | null>,
  layout: { steps: number; bars?: number; barSteps?: readonly number[] } | null,
  column: (c: number) => HTMLElement | null,
): void {
  const steps = layout?.steps ?? 0
  const bars = layout?.bars ?? 1
  const layoutKey = layout?.barSteps?.join(',') ?? ''
  const columnRef = React.useRef(column)
  columnRef.current = column
  React.useEffect(() => {
    if (steps <= 0) return
    const counts = layoutKey ? layoutKey.split(',').map(Number) : undefined
    let raf = 0
    const tick = (): void => {
      const el = line.current
      const root = box.current
      if (el && root) {
        const t = patternPhase(readCurrentCycle(), bars)
        const at = t === null ? null : Math.min(steps - 1e-9, Math.max(0, cycleToColumn(t, steps, bars, counts)))
        const c = at === null ? -1 : Math.floor(at)
        const col = c >= 0 ? columnRef.current(c) : null
        if (!col || at === null) el.style.display = 'none'
        else {
          const r = col.getBoundingClientRect()
          const x = r.left - root.getBoundingClientRect().left + (at - c) * r.width
          el.style.display = 'block'
          el.style.transform = `translateX(${x}px)`
          el.dataset.playheadCol = at.toFixed(4)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [box, line, steps, bars, layoutKey])
}
