/**
 * gainLevels.ts — the level a chain's `.gain` plays at each instant (#2467).
 *
 * The step grids do not edit `.gain` (#2606: velocity is set in the piano roll or the code), but
 * they read it for one thing: a hit added where the `.gain` is a rest `~` plays nothing, so a
 * click that would add one is refused and the cell says why.
 *
 * Pure: Strudel's own mini parser answers what plays where.
 */
import type { ChunkGain } from './notation/model'
import { miniValuesAt } from './strudelMini/pattern'

/**
 * The level playing at each instant (cycles from the pattern's start): a number, or null where
 * the `.gain` is a rest and a hit there plays nothing. No `.gain` reads 1 everywhere, a number
 * reads that number; a `.gain` that is a signal or an expression reads null for the whole answer
 * (`foreign`: nothing is known, so nothing is refused because of it).
 */
export function gainLevelsAt(gain: ChunkGain, times: readonly number[]): Array<number | null> | null {
  if (gain.foreign) return null
  if (gain.mini === null) return times.map(() => gain.numeric ?? 1)
  let values: unknown[][]
  try {
    values = miniValuesAt(gain.mini, times)
  } catch {
    return null
  }
  return values.map((v) => {
    const n = v.find((x) => typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))))
    return n === undefined ? null : Number(n)
  })
}
