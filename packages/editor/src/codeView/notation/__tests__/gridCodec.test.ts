import { describe, it, expect } from 'vitest'

import {
  stepGridCodec,
  pianoRollCodec,
  gainWritable,
  slotPress,
  slotPressCost,
  reconcileGrid,
  gridWritePlan,
} from '../gridCodec'
import type { ChunkGain, StepGridModel } from '../model'
import { toggleCell } from '../place'
import { setColumnGain } from '../../../visualEdit/panels/inspector'
import { UNREFINED, documentSteps } from '../viewResolution'

const NO_GAIN: ChunkGain = { mini: null, numeric: null, foreign: false }
const step = (mini: string, scale = UNREFINED): StepGridModel => {
  const r = stepGridCodec.parse(mini, scale)
  if (!r.ok) throw new Error(`unparseable: ${mini}`)
  return r.model
}

describe('slotPress — the Slots press is a view change or a write (#1942)', () => {
  const always = (): boolean => true

  it('a whole multiple of the document is a view, at the scale that draws it', () => {
    const m = step('bd ~ sn ~')
    expect(slotPress(stepGridCodec, m, 16, always)).toEqual({ kind: 'view', scale: 4 })
    // and looking closer costs nothing
    expect(slotPressCost(stepGridCodec, m, 16, always)).toEqual({ lengthened: 0, snapped: 0, merged: 0, shortened: 0 })
  })

  it('a coarser target is a write, and its cost is the op’s', () => {
    const m = step('bd ~ ~ ~ sn ~ ~ ~')
    expect(slotPress(stepGridCodec, m, 4, always)).toEqual({ kind: 'write' })
    expect(slotPressCost(stepGridCodec, m, 4, always)).toEqual(stepGridCodec.resolutionEffect(m, 4))
    expect(slotPressCost(stepGridCodec, m, 4, always).lengthened).toBe(2)
  })

  it('CONTROL: with no proof the view draws, the same refine is a write', () => {
    const m = step('bd ~ sn ~')
    expect(slotPress(stepGridCodec, m, 16)).toEqual({ kind: 'write' })
  })

  it('the roll answers through its own ops', () => {
    const r = pianoRollCodec.parse('c3 e3 g3 a3 b3', UNREFINED)
    if (!r.ok) throw new Error('unparseable')
    expect(slotPress(pianoRollCodec, r.model, 4, always)).toEqual({ kind: 'write' })
    expect(slotPressCost(pianoRollCodec, r.model, 4, always)).toEqual({ lengthened: 5, snapped: 4, merged: 0, shortened: 0 })
  })
})

describe('gainWritable — asked of the gain writer', () => {
  it('a single-bar grid takes a .gain; a multi-bar one does not', () => {
    expect(gainWritable(stepGridCodec, step('bd ~ sn ~'))).toBe(true)
    expect(gainWritable(stepGridCodec, step('<[bd sn] [sn bd]>'))).toBe(false)
  })
  it('a codec with no gain writer offers no velocity', () => {
    expect(gainWritable({}, step('bd ~ sn ~'))).toBe(false)
  })
})

describe('reconcileGrid — keep the panel’s model, or reseed (#1942)', () => {
  it('keeps the model it holds when that model writes exactly what the document says', () => {
    // a cleared lane survives because the kept model, not a fresh parse, stays on screen
    const prev = step('bd ~ sn ~')
    const held = reconcileGrid(stepGridCodec, 'bd ~ sn ~', NO_GAIN, UNREFINED, prev, UNREFINED)
    expect(held?.model).toBe(prev)
    expect(held?.read).not.toBe(prev) // `read` is always the text's own reading
  })

  it('reseeds on an external edit to the mini', () => {
    const prev = step('bd ~ sn ~')
    const held = reconcileGrid(stepGridCodec, 'bd ~ sn sn', NO_GAIN, UNREFINED, prev, UNREFINED)
    expect(held?.model).not.toBe(prev)
    expect(stepGridCodec.serialize(held!.model)).toBe('bd ~ sn sn')
  })

  it('reseeds on an external edit to the .gain alone', () => {
    const prev = step('bd ~ sn ~')
    const held = reconcileGrid(
      stepGridCodec,
      'bd ~ sn ~',
      { mini: '0.5 ~ 1 ~', numeric: null, foreign: false },
      UNREFINED,
      prev,
      UNREFINED,
    )
    expect(held?.model).not.toBe(prev)
  })

  it('reseeds when the panel draws at a new scale, even though the text is unchanged', () => {
    const prev = step('bd ~ sn ~')
    const held = reconcileGrid(stepGridCodec, 'bd ~ sn ~', NO_GAIN, 2, prev, UNREFINED)
    expect(held?.model).not.toBe(prev)
    expect(held?.model.steps).toBe(8)
  })

  it('keeps a REFINED model across its own write', () => {
    // The keep check collapses the model before serializing it, the way the write does
    // (#1057). Measured 2026-10-05: on 2,993 refined corpus models (step + roll, ×2 and
    // ×4) the collapsed and the direct spellings never differ, so this arm holds the KEEP,
    // and cannot tell the two comparisons apart.
    const prev = toggleCell(step('bd [hh hh] sn cp', 2), 0, 0, false)
    const written = gridWritePlan(stepGridCodec, prev)!
    expect(written.mini).toBe('~ [hh hh] sn cp')
    const held = reconcileGrid(stepGridCodec, written.mini, NO_GAIN, 2, prev, 2)
    expect(held?.model).toBe(prev)
  })

  it('keeps a refined model across its own velocity write (#1950)', () => {
    // The echo of the write: the bytes `gridWritePlan` puts in, read back as the chunk's gain.
    // The `.gain` half compares the model AS WRITTEN (collapsed to the document), the same rule
    // the mini half and the write follow, so the panel keeps its own model.
    const prev = setColumnGain(step('bd ~ sn ~', 2), 0, 0.42)
    const plan = gridWritePlan(stepGridCodec, prev)!
    expect(plan.gain).toEqual({ kind: 'write', value: '0.42 ~ 1 ~', quoted: true })
    const echo = { mini: plan.gain!.kind === 'write' ? plan.gain!.value : '', numeric: null, foreign: false }
    const held = reconcileGrid(stepGridCodec, plan.mini, echo, 2, prev, 2)
    expect(held?.model).toBe(prev)
  })

  it('CONTROL: a gain the write did not produce still reseeds a refined model', () => {
    const prev = setColumnGain(step('bd ~ sn ~', 2), 0, 0.42)
    const held = reconcileGrid(
      stepGridCodec,
      'bd ~ sn ~',
      { mini: '0.9 ~ 1 ~', numeric: null, foreign: false },
      2,
      prev,
      2,
    )
    expect(held?.model).not.toBe(prev)
  })

  it('an unparseable mini holds nothing', () => {
    expect(reconcileGrid(stepGridCodec, 'bd(', NO_GAIN, UNREFINED, null, UNREFINED)).toBeNull()
  })
})

describe('gridWritePlan — which bytes a write puts in (#1942)', () => {
  it('a velocity edit while refined is spelled at the document’s resolution, and keeps the view', () => {
    const next = setColumnGain(step('bd ~ sn ~', 2), 0, 0.42)
    const plan = gridWritePlan(stepGridCodec, next)!
    expect(plan.mini).toBe('bd ~ sn ~')
    expect(plan.gain).toEqual({ kind: 'write', value: '0.42 ~ 1 ~', quoted: true })
    expect(plan.spellsRefinement).toBe(false)
    expect(plan.written).toBe(next)
  })

  it('an edit that uses a view-only column spells it, and absorbs the view', () => {
    const next = toggleCell(step('bd ~ sn ~', 2), 0, 1, true)
    const plan = gridWritePlan(stepGridCodec, next)!
    expect(plan.mini).toBe('[bd bd] ~ sn ~')
    expect(plan.spellsRefinement).toBe(true)
    expect(documentSteps(plan.written)).toBe(8)
  })

  it('an inexpressible model plans no write', () => {
    expect(gridWritePlan({ ...stepGridCodec, serialize: () => null }, step('bd ~ sn ~'))).toBeNull()
  })
})
