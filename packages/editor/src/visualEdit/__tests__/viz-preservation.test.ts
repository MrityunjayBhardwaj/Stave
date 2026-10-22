/**
 * Cross-cutting invariant (#657): EVERY timeline row operation must preserve a
 * lane's terminal `.viz(...)` — exactly ONE copy, still the last call on the
 * statement (the inline-viz reader requires terminal viz, #571).
 *
 * `.viz()` is a DISPLAY annotation on the whole statement, not part of the sound
 * pattern. An op that slices/duplicates/wraps pattern text must never copy it
 * into an arm or strip it of its terminal position. This was a real bug in the
 * bare-materialize path (split/delete copied the whole RHS, viz and all); the
 * arrange and pick paths edit INNER ranges and were already correct. This test
 * fences all three families so a future op can't reintroduce the class.
 */
import { describe, it, expect } from 'vitest'
import {
  detectArrangeAt, detectBarePattern,
  setWeight, splitArm, reorderArm, silenceArm, insertArm,
  materializeBareSplit, materializeBareDelete,
} from '../../codeView/arrange'
import { detectPickControlAt } from '../../codeView/pickControl/parse'
import {
  setWeight as pSetWeight, splitArm as pSplitArm, removeArm as pRemoveArm,
  reorderArm as pReorderArm, duplicateArm as pDuplicateArm,
} from '../../codeView/pickControl/serialize'
import type { OffsetEdit } from '../../codeView/writeback'

const VIZ = '.viz("pianoroll")'

function apply(doc: string, edits: OffsetEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.range[0] - a.range[0])
  let out = doc
  for (const e of sorted) out = out.slice(0, e.range[0]) + e.text + out.slice(e.range[1])
  return out
}

/** Asserts the rewrite kept exactly one `.viz()` and it is still terminal. */
function expectVizTerminal(out: string): void {
  expect(out.split(VIZ).length - 1, `expected exactly one ${VIZ} in:\n${out}`).toBe(1)
  expect(out.trimEnd().endsWith(VIZ), `expected ${VIZ} to be terminal in:\n${out}`).toBe(true)
}

describe('#657 — every timeline row op preserves a single terminal .viz()', () => {
  describe('arrange combinator (ops edit inner arm ranges)', () => {
    const d = '$: arrange([2, s("bd")], [2, s("hh")]).viz("pianoroll")'
    const c = () => detectArrangeAt(d, d.indexOf('bd'))!

    it('TRIM (setWeight)', () => expectVizTerminal(apply(d, setWeight(d, c(), 0, 3))))
    it('SPLIT (splitArm)', () => expectVizTerminal(apply(d, splitArm(d, c(), 0, 1))))
    it('MOVE (reorderArm)', () => expectVizTerminal(apply(d, reorderArm(d, c(), 0, 1))))
    it('DELETE (silenceArm)', () => expectVizTerminal(apply(d, silenceArm(d, c(), 0))))
    it('DUPLICATE (insertArm)', () => {
      const arm = c().arms[0]
      expectVizTerminal(apply(d, insertArm(d, c(), 1, d.slice(arm.armRange[0], arm.armRange[1]))))
    })
  })

  describe('bare materialize (the fixed path — wraps the sound, not the viz)', () => {
    const d = '$: s("bd*4").viz("pianoroll")'
    const b = () => detectBarePattern(d, d.indexOf('bd'))!

    it('SPLIT (materializeBareSplit)', () => expectVizTerminal(apply(d, materializeBareSplit(d, b().patternRange, 1, 2))))
    it('DELETE (materializeBareDelete)', () => expectVizTerminal(apply(d, materializeBareDelete(d, b().patternRange, 0, 2))))
  })

  describe('pick control (ops edit the quoted control string)', () => {
    const d = '"<~@2 verse@2 chorus@2>".pickRestart({verse: s("bd"), chorus: s("hh")}).viz("pianoroll")'
    const c = () => detectPickControlAt(d, 5)!

    it('TRIM (setWeight)', () => expectVizTerminal(apply(d, pSetWeight(d, c(), 1, 4))))
    it('SPLIT (splitArm)', () => expectVizTerminal(apply(d, pSplitArm(d, c(), 1, 1))))
    it('DELETE (removeArm)', () => expectVizTerminal(apply(d, pRemoveArm(d, c(), 2))))
    it('MOVE (reorderArm)', () => expectVizTerminal(apply(d, pReorderArm(d, c(), 1, 2))))
    it('DUPLICATE (duplicateArm)', () => expectVizTerminal(apply(d, pDuplicateArm(d, c(), 1))))
  })
})
