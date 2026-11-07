/**
 * codeViz — the background a pattern's CODE declares, wherever it is declared
 * (#2394): on the master `all(x => …)` line or on a track line.
 *
 * It names what the engine would play, in the engine's order (see
 * `backdropCall.ts`): tracks run first, then the `all()` transforms, and every
 * background call overwrites the one before. So a master background, when there
 * is one, wins over every track; otherwise the last track declaration does.
 *
 * Read statically, so the background and its options follow the code before the
 * first Play and on every edit, as a master-line background already did (#2385).
 * Whatever only an evaluation can tell (a name in a variable, a call nested in an
 * argument) stays with the last evaluation: this reader then names nothing, or
 * something the evaluation disagrees with, and the app keeps the evaluation's.
 */
import { masterBackdropCall } from './masterEdit'
import { lastTrackBackdropCall } from './backdropCall'
import type { CodeVizOptions } from './vizOptionsLiteral'

export interface CodeViz {
  /** the viz name as written (`.viz("Fold")`) or the method's renderer id */
  name: string
  /** what the code says about its options; null when the call has none */
  options: CodeVizOptions | null
  /** where it is declared */
  level: 'master' | 'track'
}

export function readCodeViz(doc: string): CodeViz | null {
  const master = masterBackdropCall(doc)
  if (master) {
    // the master call plays over every track, readable or not
    return master.name === null ? null : { name: master.name, options: master.options, level: 'master' }
  }
  const track = lastTrackBackdropCall(doc)
  if (!track || track.name === null) return null
  return { name: track.name, options: track.options, level: 'track' }
}
