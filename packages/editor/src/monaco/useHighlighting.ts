import { useEffect, useRef, useCallback } from 'react'
import type * as Monaco from 'monaco-editor'
import type { HapStream, HapEvent } from '../engine/HapStream'

// ---- Base style injection (the hook owns it; no other editor injects it) ----
let baseStyleInjected = false
function ensureBaseHighlightStyle(): void {
  if (baseStyleInjected || typeof document === 'undefined') return
  baseStyleInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .strudel-active-hap {
      background: rgba(var(--accent-rgb, 139, 92, 246), 0.3);
      border-radius: 2px;
      outline: 1px solid rgba(var(--accent-rgb, 139, 92, 246), 0.5);
      box-shadow: 0 0 8px rgba(var(--accent-rgb, 139, 92, 246), 0.3);
    }
  `
  document.head.appendChild(style)
}

// ---- Per-color style injection cache ----
const injectedColorClasses = new Map<string, boolean>()

/**
 * Simple string hash to create stable class name suffixes from color strings.
 * Not cryptographic — just needs to be collision-resistant for CSS class names.
 */
function hashColor(color: string): string {
  let hash = 0
  for (let i = 0; i < color.length; i++) {
    hash = (hash * 31 + color.charCodeAt(i)) | 0
  }
  // Make positive and convert to hex
  return Math.abs(hash).toString(16)
}

/**
 * Parse a CSS color string to RGB values using a canvas context.
 * Returns null if parsing fails.
 */
function parseColorToRGB(
  color: string
): { r: number; g: number; b: number } | null {
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    return { r: data[0], g: data[1], b: data[2] }
  } catch {
    return null
  }
}

/**
 * Returns the CSS class name to apply to a decoration.
 * If color is non-null, injects a per-color style rule and returns compound class.
 */
export function getDecorationClassName(color: string | null): string {
  const base = 'strudel-active-hap'
  if (!color) return base

  const hash = hashColor(color)
  const colorClass = `strudel-active-hap--c${hash}`

  if (!injectedColorClasses.has(colorClass) && typeof document !== 'undefined') {
    injectedColorClasses.set(colorClass, true)
    const rgb = parseColorToRGB(color)
    if (rgb) {
      const style = document.createElement('style')
      style.textContent = `
        .${colorClass} {
          background: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3) !important;
          outline: 1px solid rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5) !important;
          box-shadow: 0 0 8px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3) !important;
        }
      `
      document.head.appendChild(style)
    }
  }

  return `${base} ${colorClass}`
}

/**
 * Convert a zero-based character offset to a Monaco 1-based Position.
 */
function locToRange(
  model: Monaco.editor.ITextModel,
  start: number,
  end: number
): Monaco.IRange {
  const startPos = model.getPositionAt(start)
  const endPos = model.getPositionAt(end)
  return {
    startLineNumber: startPos.lineNumber,
    startColumn: startPos.column,
    endLineNumber: endPos.lineNumber,
    endColumn: endPos.column,
  }
}

/**
 * Shared teardown — cancels all pending timeouts and clears all decoration collections.
 */
function teardown(
  timeoutIds: number[],
  collections: Map<string, Monaco.editor.IEditorDecorationsCollection>
): void {
  for (const id of timeoutIds) {
    clearTimeout(id)
  }
  timeoutIds.length = 0
  for (const col of collections.values()) {
    col.clear()
  }
  collections.clear()
}

export interface UseHighlightingReturn {
  clearAll: () => void
}

/**
 * useHighlighting — bridges HapStream events to Monaco editor decorations.
 *
 * Subscribes to the HapStream and for each HapEvent with location data:
 * 1. Schedules a setTimeout at `scheduledAheadMs` to show a decoration
 * 2. Schedules a setTimeout at `scheduledAheadMs + audioDuration*1000` to clear it
 *
 * Each hap gets its own IEditorDecorationsCollection for independent lifecycle management.
 * All timeouts and collections are cleaned up on hapStream change or component unmount.
 */
export function useHighlighting(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  hapStream: HapStream | null
): UseHighlightingReturn {
  // Flat array of all pending timeout IDs — for bulk cancellation
  const timeoutIdsRef = useRef<number[]>([])

  // Per-hap decoration collections keyed by unique monotonic ID
  const hapCollectionsRef = useRef<
    Map<string, Monaco.editor.IEditorDecorationsCollection>
  >(new Map())

  // Monotonic counter for unique hap keys within this hook instance
  const hapCounterRef = useRef(0)

  // #339 — per-eval "anchor" decorations, keyed by the eval-time loc
  // `start:end`. Each anchor is an invisible (no className) decoration whose
  // range Monaco keeps position-correct across live edits (stickiness). Every
  // hap paints its highlight at the anchor's CURRENT range rather than
  // recomputing `getPositionAt(staleOffset)` against an edited model — which
  // is what made highlights drift onto the wrong line/column (#339). The
  // engine's eval epoch (event.epoch) tells us when the loc coordinate system
  // resets (a fresh evaluate) so the anchors must be rebuilt.
  const anchorsRef = useRef<
    Map<string, Monaco.editor.IEditorDecorationsCollection>
  >(new Map())
  const epochRef = useRef<number | undefined>(undefined)

  // #339 — model edits applied since the current epoch's eval, in
  // chronological order. Used to translate an eval-time loc offset to its
  // current offset when a loc is FIRST seen AFTER an edit (Monaco can't have
  // tracked an anchor that didn't exist yet). Anchors created before any edit
  // need no translation (Monaco moves them). Reset whenever the epoch resets.
  const editsRef = useRef<Array<{ at: number; removed: number; added: number }>>(
    []
  )

  const clearAnchors = useCallback(() => {
    for (const a of anchorsRef.current.values()) a.clear()
    anchorsRef.current.clear()
  }, [])

  const clearAll = useCallback(() => {
    teardown(timeoutIdsRef.current, hapCollectionsRef.current)
    clearAnchors()
  }, [clearAnchors])

  useEffect(() => {
    if (!editor || !hapStream) return

    // Ensure the base CSS for .strudel-active-hap exists. EditorView
    // injects none of its own, so the hook owns its styles.
    ensureBaseHighlightStyle()

    // Fresh subscription — start with no epoch seen and no anchors.
    epochRef.current = undefined
    editsRef.current = []
    clearAnchors()

    // Record every model edit so an offset captured at eval time can be
    // translated forward to the current text (for locs first seen post-edit).
    const model0 = editor.getModel()
    const changeSub = model0?.onDidChangeContent((e) => {
      for (const c of e.changes) {
        editsRef.current.push({
          at: c.rangeOffset,
          removed: c.rangeLength,
          added: c.text.length,
        })
      }
    })

    // Translate an eval-time (epoch-start) char offset to the current offset
    // by replaying the recorded edits chronologically. A point inside a
    // removed span collapses to the edit start.
    const translateOffset = (offset: number): number => {
      let o = offset
      for (const { at, removed, added } of editsRef.current) {
        if (o >= at + removed) o += added - removed
        else if (o > at) o = at + Math.min(added, o - at)
      }
      return o
    }

    /**
     * Return the CURRENT range for an eval-time loc, creating (on first sight
     * this epoch) an invisible anchor decoration Monaco then tracks across
     * edits. The eval-time offsets are translated through any edits recorded
     * so far, so a loc first seen AFTER an edit still anchors correctly.
     * `null` when the anchored text was fully deleted — the caller skips that
     * loc (the token is gone, so nothing to highlight).
     */
    const anchorRangeFor = (
      model: Monaco.editor.ITextModel,
      start: number,
      end: number
    ): Monaco.IRange | null => {
      const key = `${start}:${end}`
      let anchor = anchorsRef.current.get(key)
      if (!anchor) {
        anchor = editor.createDecorationsCollection([
          {
            range: locToRange(
              model,
              translateOffset(start),
              translateOffset(end)
            ),
            options: { stickiness: 1 as const }, // NeverGrowsWhenTypingAtEdges
          },
        ])
        anchorsRef.current.set(key, anchor)
      }
      return anchor.getRange(0)
    }

    const handler = (event: HapEvent): void => {
      if (!event.loc || event.loc.length === 0) return

      const model = editor.getModel()
      if (!model) return

      // #339 — a new evaluate() resets the loc coordinate system. Drop the
      // old anchors so this epoch's offsets re-anchor against the freshly
      // evaluated text. Engines that don't stamp an epoch keep one anchor
      // set for the hook's lifetime (still edit-tracked, never reset).
      if (event.epoch !== undefined && event.epoch !== epochRef.current) {
        epochRef.current = event.epoch
        editsRef.current = []
        clearAnchors()
      }

      // Establish anchors at emit time (earliest point — for the first cycle
      // after eval this is before the user can edit, so the anchor range is
      // exact; thereafter Monaco tracks it). Capture the loc list for paint.
      const locs = event.loc
      for (const { start, end } of locs) anchorRangeFor(model, start, end)

      const hapKey = `hap-${hapCounterRef.current++}`
      const showDelay = Math.max(0, event.scheduledAheadMs)
      const clearDelay = showDelay + event.audioDuration * 1000
      const className = getDecorationClassName(event.color)

      const showId = window.setTimeout(() => {
        const m = editor.getModel()
        if (!m) return
        const decorations = locs
          .map(({ start, end }) => anchorRangeFor(m, start, end))
          .filter((range): range is Monaco.IRange => range !== null)
          .map((range) => ({
            range,
            options: {
              className,
              stickiness: 1 as const, // NeverGrowsWhenTypingAtEdges
            },
          }))
        if (decorations.length === 0) return
        const collection = editor.createDecorationsCollection(decorations)
        hapCollectionsRef.current.set(hapKey, collection)
      }, showDelay)

      const clearId = window.setTimeout(() => {
        hapCollectionsRef.current.get(hapKey)?.clear()
        hapCollectionsRef.current.delete(hapKey)
      }, clearDelay)

      timeoutIdsRef.current.push(showId, clearId)
    }

    hapStream.on(handler)

    return () => {
      changeSub?.dispose()
      hapStream.off(handler)
      teardown(timeoutIdsRef.current, hapCollectionsRef.current)
      clearAnchors()
    }
  }, [editor, hapStream, clearAnchors])

  return { clearAll }
}
