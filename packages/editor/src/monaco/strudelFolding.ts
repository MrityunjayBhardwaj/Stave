/**
 * strudelFolding — #708. A Monaco folding-range provider that folds whole
 * TRACK statements in a `.strudel` file: collapsing a track hides its body and
 * keeps its first line visible.
 *
 * The fold ranges reuse the EXACT same projection the left-edge colour bars use
 * (`detectAllChunks` → `buildStripModels` → `trackBarSegments`), so a fold range
 * is precisely a track block — config statements (`setcps`, …) are excluded and
 * single-line tracks aren't foldable. Sharing the projection guarantees the fold
 * boundaries never drift from the colour-bar boundaries.
 */
import type * as Monaco from 'monaco-editor'
import { detectAllChunks } from '../codeView'
import { buildStripModels } from '../codeView'
import { trackBarSegments, type PositionModel } from './useTrackColourBars'

/** A foldable track block as 1-indexed inclusive line numbers. */
export interface TrackFoldRange {
  start: number
  end: number
}

/**
 * One fold range per MULTI-LINE track statement. Single-line tracks
 * (`endLine === startLine`) are skipped — nothing to collapse.
 */
export function trackFoldingRanges(
  model: PositionModel & { getValue(): string },
): TrackFoldRange[] {
  const segments = trackBarSegments(
    buildStripModels(detectAllChunks(model.getValue()), model.getValue()),
    model,
    new Map(),
  )
  const ranges: TrackFoldRange[] = []
  for (const seg of segments) {
    if (seg.endLine > seg.startLine) {
      ranges.push({ start: seg.startLine, end: seg.endLine })
    }
  }
  return ranges
}

/**
 * Register the track-block folding provider for the `strudel` language.
 * No-op when the Monaco mock lacks the API (unit tests) — same guard style as
 * the other providers in `ensureWorkspaceLanguages`.
 */
export function registerStrudelFoldingProvider(monaco: typeof Monaco): void {
  if (typeof monaco.languages?.registerFoldingRangeProvider !== 'function') return
  monaco.languages.registerFoldingRangeProvider('strudel', {
    provideFoldingRanges(model) {
      return trackFoldingRanges(model).map((r) => ({ start: r.start, end: r.end }))
    },
  })
}
