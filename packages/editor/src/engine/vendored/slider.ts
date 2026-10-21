// Vendored from upstream Strudel.
//
// Source: @strudel/codemirror@1.3.0, slider.mjs — `sliderValues` (line 5) and
// `slider` / `sliderWithID` (lines 125-133).
// License: AGPL-3.0-or-later — see /LICENSE
//
// #345. Strudel's transpiler (already loaded) rewrites every `slider(v, min, max, step)`
// into `sliderWithID('slider_<offset of v>', v, min, max, step)` and reports the slider
// in its `widgets` list. These lines are the pattern half that call lands on: the value
// lives in `sliderValues` under that id, and `ref` reads it on every query, so moving
// the slider is heard without evaluating again.
//
// Why vendored (not imported from @strudel/codemirror): the file also holds Strudel's
// CodeMirror widget, and importing it pulls CodeMirror in — measured 203 KB minified /
// 66 KB gzipped for these 1.9 KB. Stave's editor is Monaco; its slider lives in
// `monaco/inlineSliders.ts` and writes `sliderValues` itself, so upstream's
// `window.postMessage('cm-slider')` hop between its editor and this table is not
// copied. `slider.contract.test.ts` holds the transpiler to the id spelled here.
//
// The one change from upstream: `ref` and `pure` are passed in rather than imported.
// The engine loads @strudel/core lazily, in `init()`, and this file is also read by
// the editor (`sliderValues`), so importing core here would load it with the editor.

/** a slider's current value, by the id the transpiler gave it */
export const sliderValues: Record<string, number> = {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Core = { ref: (accessor: () => unknown) => any; pure: (value: unknown) => any }

/** `slider` and `sliderWithID`, built over the Strudel core the engine loaded */
export function sliderFunctions({ ref, pure }: Core) {
  /** Strudel's `slider` when the transpiler did not rewrite the call */
  const slider = (value: number) => {
    console.warn('slider will only work when the transpiler is used... passing value as is')
    return pure(value)
  }
  /** what the transpiler turns `slider(value, min, max)` into */
  const sliderWithID = (id: string, value: number, _min?: number, _max?: number) => {
    sliderValues[id] = value // sync state at eval time (code -> state)
    return ref(() => sliderValues[id]) // use state at query time
  }
  return { slider, sliderWithID }
}

/**
 * One slider as the transpiler reports it in `widgets`
 * (@strudel/transpiler@1.2.6, transpiler.mjs:91-100): `from`/`to` are the
 * value argument's offsets in the evaluated code.
 */
export interface SliderWidgetConfig {
  type: 'slider'
  from: number
  to: number
  value: string
  min: number
  max: number
  step?: number
}

/** the id `sliderWithID` is called with for the slider at `from` (transpiler.mjs:420) */
export const sliderId = (from: number) => `slider_${from}`

/** the sliders among the transpiler's `widgets` */
export function sliderWidgets(widgets: unknown): SliderWidgetConfig[] {
  if (!Array.isArray(widgets)) return []
  return widgets.filter((w): w is SliderWidgetConfig => w?.type === 'slider')
}
