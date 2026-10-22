/**
 * useTrackColourBars — #608. A per-track colour stripe down the LEFT edge of the
 * editor (over the glyph margin, before the line numbers), spanning every line of
 * each track's statement. The colour is the track's resolved identity colour —
 * byte-identical to the Mixer strip dot, the Song Timeline lane, and the
 * Pattern-tab chip because all four read the SAME source: `buildStripModels`
 * (display key + deterministic palette, config statements filtered) layered with
 * the per-file custom-colour override (`useTrackMetaMap`, V-track-2). No view
 * re-derives identity on its own (V-track-1).
 *
 * ## Why a DOM overlay, not a Monaco glyph-margin decoration
 *
 * A `glyphMarginClassName` decoration attaches only to a model line's FIRST
 * visual row, so a word-wrapped line leaves its continuation rows with no bar —
 * the stripe breaks (observed on a long `note(...)` line that wraps to 3 rows).
 * Instead we measure each track's block in PIXELS via `getTopForLineNumber` /
 * `getBottomForLineNumber` (both wrap-inclusive) and paint one continuous
 * absolutely-positioned segment per track in an overlay appended to the editor's
 * DOM node. An inner layer translated by `-scrollTop` keeps scrolling cheap
 * (only content/layout changes rebuild the segments); the overlay is
 * `pointer-events:none` so gutter clicks (breakpoints) pass through.
 *
 * The pure `trackBarSegments` projection (offset→line-range + override layering)
 * is unit-tested without a live Monaco model; the pixel positioning is covered
 * by the e2e observation.
 */
import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { detectAllChunks } from '../codeView'
import { buildStripModels, type StripModel } from '../codeView'
import { useTrackMetaMap } from '../workspace/useTrackMeta'
import type { TrackMeta } from '../workspace/WorkspaceFile'
import {
  getTrackColourBarsEnabled,
  onTrackColourBarsChange,
} from '../workspace/editorRegistry'

/** The slice of a Monaco text model `trackBarSegments` needs (testable). */
export interface PositionModel {
  getPositionAt(offset: number): { lineNumber: number; column: number }
}

/** A track's contiguous line block + the colour its stripe paints. */
export interface TrackBarSegment {
  startLine: number
  endLine: number
  color: string
}

/**
 * Project strips → one stripe segment per track: the model-line range of its
 * `statementRange` plus the resolved colour. The custom-colour override (keyed
 * by the display name `strip.name`) layers over the deterministic `strip.color`,
 * exactly as the Mixer/Timeline/Pattern consumers do.
 *
 * `statementRange[1]` is the EXCLUSIVE end offset; when it lands at column 1 of
 * the following line (end == start-of-next-line) that line is NOT part of the
 * track, so `endLine` is trimmed — otherwise the stripe would bleed onto the
 * next statement.
 */
export function trackBarSegments(
  strips: StripModel[],
  model: PositionModel,
  trackMeta: ReadonlyMap<string, TrackMeta>,
): TrackBarSegment[] {
  const out: TrackBarSegment[] = []
  for (const strip of strips) {
    const color = trackMeta.get(strip.name)?.color ?? strip.color
    const [start, end] = strip.statementRange
    const startLine = model.getPositionAt(start).lineNumber
    const endPos = model.getPositionAt(end)
    let endLine = endPos.lineNumber
    if (endPos.column === 1 && endLine > startLine) endLine -= 1
    out.push({ startLine, endLine, color })
  }
  return out
}

const BAR_WIDTH_PX = 3

/**
 * useTrackColourBars — paints the left-edge track stripes for `editor`'s model.
 * `editor` is null until Monaco mounts (EditorView flips `editorReady`), then the
 * effect runs; `fileId` scopes the override store to THIS view's file (split-safe
 * — the hook never reads the global active editor).
 */
export function useTrackColourBars(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  fileId: string,
): void {
  const trackMeta = useTrackMetaMap(fileId)
  const trackMetaRef = useRef(trackMeta)
  trackMetaRef.current = trackMeta

  // Show/hide is a user setting (#608). Subscribe so toggling in Editor
  // Settings adds/removes the overlay live — `enabled` is an effect dep, so a
  // change re-runs the effect (its cleanup removes the overlay when turning off).
  const [enabled, setEnabled] = useState<boolean>(getTrackColourBarsEnabled)
  useEffect(() => onTrackColourBarsChange(setEnabled), [])

  useEffect(() => {
    if (!editor || !enabled) return
    const host = editor.getDomNode?.()
    if (!host) return

    // Clip container pinned to the editor's top-left, over the glyph margin. The
    // inner layer holds segments in CONTENT coordinates and is translated by
    // -scrollTop, so a scroll is a single transform (no segment rebuild).
    const overlay = document.createElement('div')
    overlay.setAttribute('data-track-colour-bars', '')
    overlay.style.cssText =
      `position:absolute;left:0;top:0;width:${BAR_WIDTH_PX}px;height:100%;` +
      'overflow:hidden;pointer-events:none;z-index:5;'
    const inner = document.createElement('div')
    inner.style.cssText = 'position:absolute;left:0;top:0;width:100%;will-change:transform;'
    overlay.appendChild(inner)
    host.appendChild(overlay)

    const applyScroll = (): void => {
      inner.style.transform = `translateY(${-editor.getScrollTop()}px)`
    }

    const rebuild = (): void => {
      const model = editor.getModel()
      if (!model) {
        inner.replaceChildren()
        return
      }
      const segments = trackBarSegments(
        buildStripModels(detectAllChunks(model.getValue()), model.getValue()),
        model,
        trackMetaRef.current,
      )
      const frag = document.createDocumentFragment()
      for (const seg of segments) {
        const top = editor.getTopForLineNumber(seg.startLine)
        const bottom = editor.getBottomForLineNumber(seg.endLine)
        const div = document.createElement('div')
        div.setAttribute('data-track-colour-bar', '')
        div.style.cssText =
          `position:absolute;left:0;width:${BAR_WIDTH_PX}px;` +
          `top:${top}px;height:${Math.max(0, bottom - top)}px;background:${seg.color};`
        frag.appendChild(div)
      }
      inner.replaceChildren(frag)
      applyScroll()
    }

    rebuild()
    const subs = [
      editor.onDidScrollChange(applyScroll),
      editor.onDidChangeModelContent(rebuild),
      editor.onDidLayoutChange(rebuild), // width change → re-wrap → new line tops
      editor.onDidContentSizeChange(rebuild),
      editor.onDidChangeModel(rebuild),
    ]

    return () => {
      for (const s of subs) s.dispose()
      overlay.remove()
    }
  }, [editor, trackMeta, enabled])
}
