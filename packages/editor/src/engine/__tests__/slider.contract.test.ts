import { describe, it, expect } from 'vitest'
import { setSliderScope, sliderFunctions, sliderId, sliderValues, sliderWidgets } from '../vendored/slider'
import { clearStringParser, installMiniStringParser } from '../stringParser'

/**
 * #345 — the vendored `sliderWithID` against the Strudel that calls it.
 *
 * The function is copied, not imported, so nothing would fail if the transpiler
 * changed how it names a slider. This runs the installed transpiler and core end to
 * end: the code is evaluated with the vendored pair in scope, and moving
 * `sliderValues` under the id `sliderId` spells must change what the pattern plays.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function evaluate(code: string): Promise<{ pattern: any; widgets: unknown }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const core: any = await import('@strudel/core')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini, sliderFunctions(core))
  installMiniStringParser({ core, mini })
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { transpiler }: any = await import('@strudel/transpiler')
    const r = await core.evaluate(code, transpiler)
    return { pattern: r.pattern ?? r, widgets: r.meta?.widgets }
  } finally {
    clearStringParser({ core })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gains = (pattern: any) => pattern.queryArc(0, 1).map((h: any) => h.value.gain)

describe('slider(…) — the vendored half against the installed transpiler', () => {
  it('plays the code’s value, then the value set under the id sliderId names, with no new evaluation', async () => {
    const code = `s("bd sd").gain(slider(0.5, 0, 1))`
    const { pattern, widgets } = await evaluate(code)
    const [w] = sliderWidgets(widgets)
    expect(w).toMatchObject({ type: 'slider', from: code.indexOf('0.5'), value: '0.5', min: 0, max: 1 })
    expect(gains(pattern)).toEqual([0.5, 0.5])
    sliderValues[sliderId(w.from)] = 0.8
    expect(gains(pattern)).toEqual([0.8, 0.8])
  })

  it('reports each slider at its own number, on any line', async () => {
    const code = `const v = slider(0.25)\ns("hh*2").gain(v).pan(slider(.2, 0, 1, 0.1))`
    const { widgets } = await evaluate(code)
    expect(sliderWidgets(widgets).map((w) => [code.slice(w.from, w.to), w.step])).toEqual([
      ['0.25', undefined],
      ['.2', 0.1],
    ])
  })

  it('keeps only the sliders out of the transpiler’s widget list', () => {
    expect(sliderWidgets([{ type: '_pianoroll', to: 3 }, { type: 'slider', from: 1, to: 2 }, null])).toEqual([
      { type: 'slider', from: 1, to: 2 },
    ])
    expect(sliderWidgets(undefined)).toEqual([])
  })
})

/**
 * #2165 — the Library's preview engine keeps its slider values apart from the
 * project's: same id, different scope, so neither overwrites the other.
 */
describe('slider scope', () => {
  it("an engine's values live under its scope; the project's ('') are left alone", () => {
    const ref = (read: () => unknown) => ({ read })
    const { sliderWithID } = sliderFunctions({ ref, pure: (v: unknown) => v })
    sliderValues['slider_42'] = 0.3 // the project's slider at offset 42
    try {
      setSliderScope('preview:')
      const previewed = sliderWithID('slider_42', 800)
      setSliderScope('')
      expect(sliderValues['slider_42']).toBe(0.3)
      expect(sliderValues['preview:slider_42']).toBe(800)
      expect(previewed.read()).toBe(800)
    } finally {
      setSliderScope('')
      delete sliderValues['slider_42']
      delete sliderValues['preview:slider_42']
    }
  })
})
