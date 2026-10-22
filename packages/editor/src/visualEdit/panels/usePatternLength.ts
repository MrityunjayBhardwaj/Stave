/**
 * usePatternLength — what the grid's `+` handle offers, decided before it is
 * pressed (#1824).
 *
 * Both rewrites (`notation/lengthen.ts`) are asked of Strudel and then of this
 * panel's own parser when the handle is reached, so it can say "not here,
 * because…" on hover instead of failing after the click. `lengthenOffers` asks
 * all of that (#1942); this hook holds the cache and the write.
 */
import * as React from 'react'

import { emitLog } from '../../engine/engineLog'
import type { ChunkInfo } from '../../codeView'
import { lengthenOffers, appendBarsOffer, type LengthenOffers } from '../../codeView'
import type { ParseResult } from '../../codeView'
import { readChunkGain, type ViewScale } from '../../codeView'

/** what the handle offers: the two choices, each ok or with the reason it isn't */
export type Verdict = LengthenOffers

export interface PatternLength {
  /** bars the grid draws the pattern over */
  bars: number
  /**
   * What the handle offers right now, or null with no pattern. Asked ON DEMAND —
   * when the pointer or focus reaches the handle — and cached per pattern, because
   * it queries Strudel: ~20ms on a 12-bar, 16-step pattern (measured), which paid on
   * every edit would land on every frame of an unrelated note drag.
   */
  verdict: () => Verdict | null
  onDuplicate: () => void
  onAddBars: (n: number) => void
}

export function usePatternLength<M extends { bars?: number }>(
  chunk: ChunkInfo | null,
  model: M | null,
  parse: (mini: string, viewScale: ViewScale) => ParseResult<M>,
  writeMini: (mini: string) => void,
): PatternLength {
  const mini = model ? (chunk?.miniString ?? null) : null
  const bars = model?.bars ?? 1
  const gain = chunk ? readChunkGain(chunk) : null
  // the only part of the `.gain` the offers depend on: is it a per-column string
  const velocity = gain?.mini != null
  const parseRef = React.useRef(parse)
  parseRef.current = parse

  const cache = React.useRef<{ key: string; verdict: Verdict } | null>(null)
  const verdict = (): Verdict | null => {
    if (mini === null || gain === null) return null
    const key = `${bars}|${velocity}|${mini}`
    if (cache.current?.key !== key) {
      cache.current = { key, verdict: lengthenOffers(parseRef.current, mini, bars, gain) }
    }
    return cache.current.verdict
  }

  const onDuplicate = (): void => {
    const r = verdict()?.duplicate
    if (!r) return
    if (r.ok) writeMini(r.mini)
    else report("Couldn't add a bar that continues the pattern", r.reason)
  }
  const onAddBars = (n: number): void => {
    if (mini === null || gain === null || n < 1) return
    const r = appendBarsOffer(parseRef.current, mini, bars, n, gain)
    if (r.ok) writeMini(r.mini)
    else report(`Couldn't add ${n === 1 ? 'a bar' : `${n} bars`}`, r.reason)
  }
  return { bars, verdict, onDuplicate, onAddBars }
}

/** Said in the Console, as the grids' other refusals are; the document is untouched. */
function report(attempted: string, reason: string): void {
  emitLog({ level: 'warn', runtime: 'stave', message: `${attempted} — ${reason}, so it was left unchanged.` })
}
