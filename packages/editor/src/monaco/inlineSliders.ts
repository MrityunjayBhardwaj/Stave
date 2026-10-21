import type * as Monaco from 'monaco-editor'
import { closeGesture, commit, createWriter, openGesture, sliderEdit } from '../codeView'
import { sliderId, sliderValues, type SliderWidgetConfig } from '../engine/vendored/slider'

/**
 * #345 — Strudel's `slider(…)`, drawn in the code the way strudel.cc draws it: a
 * small range input just before the call's number.
 *
 * Where the sliders are, and what moving one means, are Strudel's: the transpiler
 * reports each slider's span in `widgets`, and the pattern reads `sliderValues[id]`
 * through `ref` (`engine/vendored/slider.ts`). This file is only what Monaco needs
 * to show one, where strudel.cc's CodeMirror widget does it for itself:
 *
 *  - room in the line: Monaco has no widget that takes space in the text, so a
 *    `before` decoration reserves it and a content widget sits on that space;
 *  - following the text: the decoration tracks the number as the document moves,
 *    but a content widget does not, so every change lays the widgets out again
 *    (CodeMirror's `decorations.map(tr.changes)`);
 *  - the write: a drag moves the number through `sliderEdit` and `commit`, as one
 *    gesture — one undo step, one re-evaluation on release — and sets the value the
 *    pattern reads, so the sound follows the drag before any re-evaluation.
 */

/** the input's width plus its right margin — strudel.cc's `width:64px;margin-right:4px` */
const SLIDER_WIDTH_PX = 64
const GAP_PX = SLIDER_WIDTH_PX + 4

let styleInjected = false
function ensureSliderStyle(): void {
  if (styleInjected || typeof document === 'undefined') return
  styleInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .stave-slider-gap { display: inline-block; width: ${GAP_PX}px; }
    .stave-slider { display: inline-flex; align-items: center; }
    .stave-slider input { width: ${SLIDER_WIDTH_PX}px; margin: 0; accent-color: rgb(var(--accent-rgb, 139, 92, 246)); }
  `
  document.head.appendChild(style)
}

export interface InlineSlidersHandle {
  cleanup(): void
}

/**
 * Draw a slider on each of `sliders` in `editor`. The offsets are into the code
 * that was evaluated; a slider whose span does not hold the number it reported
 * (the document changed since) is left out rather than drawn over other text.
 */
export function addInlineSliders(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  sliders: readonly SliderWidgetConfig[],
): InlineSlidersHandle | null {
  const model = editor.getModel()
  if (!model || sliders.length === 0) return null
  const doc = model.getValue()
  const placed = sliders.filter((w) => w.to <= doc.length && (w.value === undefined || doc.slice(w.from, w.to) === w.value))
  if (placed.length === 0) return null
  ensureSliderStyle()

  const writer = createWriter(editor)
  const rangeOf = (start: number, end: number) => {
    const a = model.getPositionAt(start)
    const b = model.getPositionAt(end)
    return new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column)
  }
  const decoration = (range: Monaco.IRange): Monaco.editor.IModelDeltaDecoration => ({
    range,
    options: {
      before: { content: ' ', inlineClassName: 'stave-slider-gap' },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  })
  const spans = editor.createDecorationsCollection(placed.map((w) => decoration(rangeOf(w.from, w.to))))

  const widgets = placed.map((w, i): Monaco.editor.IContentWidget => {
    // the id the transpiler gave this call when it was evaluated — it stays this
    // id however the text moves until the next evaluation, as in strudel.cc
    const id = sliderId(w.from)
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(w.min)
    input.max = String(w.max)
    input.step = String(w.step ?? (w.max - w.min) / 1000)
    input.value = doc.slice(w.from, w.to)
    // the range only: the input reports its own value, which a drag changes
    input.setAttribute('aria-label', `slider from ${w.min} to ${w.max}`)
    const dom = document.createElement('span')
    dom.className = 'stave-slider'
    dom.dataset.staveSlider = id
    dom.appendChild(input)

    let dragging = false
    const endDrag = () => {
      if (!dragging) return
      dragging = false
      closeGesture(writer)
    }
    input.addEventListener('pointerdown', () => {
      dragging = true
      openGesture(writer)
      window.addEventListener('pointerup', endDrag, { once: true })
      window.addEventListener('pointercancel', endDrag, { once: true })
    })
    input.addEventListener('input', () => {
      const range = spans.getRange(i)
      if (!range || !writer) return
      const span: [number, number] = [model.getOffsetAt(range.getStartPosition()), model.getOffsetAt(range.getEndPosition())]
      const edit = sliderEdit(model.getValue(), span, Number(input.value))
      if (!edit || commit(writer, edit, 'slider') !== 'written') return
      // the decoration spans exactly the new number, whatever its length
      const ranges = spans.getRanges()
      ranges[i] = rangeOf(span[0], span[0] + edit.text.length)
      spans.set(ranges.map(decoration))
      editor.layoutContentWidget(widgets[i])
      sliderValues[id] = Number(edit.text)
    })

    return {
      getId: () => `stave.slider.${id}`,
      getDomNode: () => dom,
      getPosition: () => {
        const range = spans.getRange(i)
        return range && !range.isEmpty()
          ? { position: range.getStartPosition(), preference: [monaco.editor.ContentWidgetPositionPreference.EXACT] }
          : null
      },
    }
  })
  for (const widget of widgets) editor.addContentWidget(widget)
  const relayout = editor.onDidChangeModelContent(() => {
    for (const widget of widgets) editor.layoutContentWidget(widget)
  })

  return {
    cleanup() {
      relayout.dispose()
      closeGesture(writer)
      for (const widget of widgets) editor.removeContentWidget(widget)
      spans.clear()
    },
  }
}
