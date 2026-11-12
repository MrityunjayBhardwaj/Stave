/**
 * Slots on the Exact step grid over the corpus (#2526): a snap over the tree, never a write.
 *
 * For every pattern the Exact grid opens: Slots ×2 opens too, with exactly twice the places of
 * the busiest row; and a click on a place the snap made (one that is not a place at ×1) writes,
 * or refuses with the writer's reason. A write adds hits from ONE written text, one of them at
 * exactly that place, and loses none — as Strudel plays the edited text. One written text can
 * play several times (`<bd>*4` → `<bd*2>*4` adds four): every copy changes together, the step
 * writer's own rule for a click.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { applyStepEdit } from '../../../codeView'
import { miniPattern } from '../../../codeView/strudelMini/pattern'
import { cellAt, cellEdit, exactGridOf, exactSlotState, placesPerBar, playsNumbers, snapFor, snappable } from '../exactGrid'

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/** every onset over the loop, as `time|value`, counted, and where each was written */
function onsets(mini: string, bars: number): { count: Map<string, number>; at: Map<string, Array<{ start: number; end: number }>> } {
  const count = new Map<string, number>()
  const at = new Map<string, Array<{ start: number; end: number }>>()
  const p = miniPattern(mini)
  for (let c = 0; c < bars; c++) {
    for (const h of p.hits(c)) {
      const k = `${h.begin.valueOf().toFixed(9)}|${JSON.stringify(h.value)}`
      count.set(k, (count.get(k) ?? 0) + 1)
      // every hit at this time and value: two parts can play the same sound at one time
      at.set(k, [...(at.get(k) ?? []), ...h.locations])
    }
  }
  return { count, at }
}

/** snap places clicked per pattern: the first few, so a run stays minutes long */
const PER_PATTERN = 6

function sweep(snapOf = (want: number, own: number) => snapFor(want, own), limit = Infinity, landOn = <T>(cells: readonly T[], i: number): T => cells[i]) {
  const t = { patterns: 0, unsnappable: 0, doubled: 0, notDoubled: [] as string[], copies: 0, asked: 0, wrote: 0, refused: {} as Record<string, number>, wrong: [] as string[] }
  for (const mini of minis) {
    if (t.patterns >= limit) break
    const one = exactGridOf(mini)
    if (!one.ok || playsNumbers(one.trees)) continue
    t.patterns++
    const own = placesPerBar(one.rows)
    // a row whose steps do not tile its bar is drawn from its hits: no snap reaches it, and the
    // control offers no snap for the pattern (`snappable`)
    if (!snappable(one.rows)) {
      t.unsnappable++
      continue
    }
    const two = exactGridOf(mini, [], snapOf(own * 2, own))
    if (!two.ok || placesPerBar(two.rows) !== own * 2) {
      t.notDoubled.push(`${JSON.stringify(mini)} own=${own} → ${two.ok ? placesPerBar(two.rows) : two.why}`)
      continue
    }
    t.doubled++
    const before = onsets(mini, two.bars)
    for (const row of two.rows) {
      const ownHere = new Set(one.rows.find((r) => r.sound === row.sound && r.part === row.part)?.cells.map((c) => cellAt(c).toFixed(9)) ?? [])
      const order = two.rows.filter((r) => r.part === row.part).map((r) => r.sound)
      const made = row.cells.filter((c) => !ownHere.has(cellAt(c).toFixed(9))).slice(0, PER_PATTERN)
      for (const cell of made) {
        t.asked++
        const r = cellEdit(mini, two.trees, row, order, landOn(row.cells, row.cells.indexOf(cell)))
        if (!r.ok) {
          t.refused[r.why] = (t.refused[r.why] ?? 0) + 1
          continue
        }
        t.wrote++
        const text = applyStepEdit(mini, r.edit)
        let after: ReturnType<typeof onsets>
        try {
          after = onsets(text, two.bars)
        } catch {
          t.wrong.push(`does not evaluate: ${JSON.stringify(mini)} → ${JSON.stringify(text)}`)
          continue
        }
        // hits added come from ONE written text, one of them at the place clicked; none lost
        const at = cellAt(cell).toFixed(9)
        const added = [...after.count].filter(([k, n]) => n > (before.count.get(k) ?? 0)).map(([k]) => k)
        const lost = [...before.count].filter(([k, n]) => n > (after.count.get(k) ?? 0)).map(([k]) => k)
        // ONE written step: every added hit was written at the same place, and that place holds the
        // row's own name (a location can also be an atom that shaped the hit — `bd:<1 0>`'s `1`,
        // a `*<1 8>`'s `8` — so the name, not the whole set, says which step it is)
        const name = row.sound.split(':')[0]
        const named = (k: string): string[] => (after.at.get(k) ?? []).filter((l) => text.slice(l.start, l.end) === name).map((l) => `${l.start}`)
        const shared = added.length === 0 ? [] : added.map(named).reduce((a, b) => a.filter((x) => b.includes(x)))
        const ok = added.some((k) => k.startsWith(`${at}|`)) && shared.length >= 1 && lost.length === 0
        if (ok && added.length > 1) t.copies++
        if (!ok) t.wrong.push(`${JSON.stringify(mini)} [${row.sound}] @${at} +${added.join(',')} -${lost.join(',')} → ${JSON.stringify(text)}`)
      }
    }
  }
  return t
}

describe('Slots on the Exact grid over the corpus (#2526)', () => {
  it('×2 doubles every pattern’s places, and a click on a snap place adds one hit there and nothing else', () => {
    const t = sweep()
    process.stderr.write(`\nSLOTS ${JSON.stringify({ ...t, notDoubled: t.notDoubled.slice(0, 10), wrong: t.wrong.slice(0, 20) }, null, 1)}\n`)
    expect(t.notDoubled.slice(0, 20)).toEqual([])
    expect(t.wrong.slice(0, 20)).toEqual([])
    // measured 2026-11-09 on this corpus; a change here is a change in what Slots offers or a click writes
    expect({ patterns: t.patterns, unsnappable: t.unsnappable, doubled: t.doubled, asked: t.asked, wrote: t.wrote, copies: t.copies, refused: t.refused }).toEqual({
      patterns: 1179,
      unsnappable: 12,
      doubled: 1167,
      asked: 14973,
      wrote: 11590,
      copies: 2973,
      refused: { 'inside-a-step': 2218, 'step-is-replicated': 74, 'not-inside-the-step': 529, 'no-step-there': 308, 'step-has-no-text': 71, 'step-is-generated': 183 },
    })
  }, 1_800_000)

  it('the control offers views only: below the pattern, or not a whole multiple of it, is unavailable', () => {
    expect([2, 4, 6, 8, 16, 512].map((n) => exactSlotState(n, 4, 4))).toEqual(['disabled', 'active', 'disabled', 'view', 'view', 'disabled'])
    expect([snapFor(null, 4), snapFor(8, 4), snapFor(6, 4), snapFor(2, 4), snapFor(8, 8)]).toEqual([1, 2, 1, 1, 1])
  })

  it('can go red: a click that lands one place later is seen', () => {
    const t = sweep(undefined, 150, (cells, i) => cells[Math.min(cells.length - 1, i + 1)])
    expect(t.wrong.length).toBeGreaterThan(0)
  }, 900_000)

  it('can go red: a snap that does not cut is seen', () => {
    const t = sweep(() => 1)
    expect(t.notDoubled.length).toBeGreaterThan(0)
  }, 1_800_000)
})
