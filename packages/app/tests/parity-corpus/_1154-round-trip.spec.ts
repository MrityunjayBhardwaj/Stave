/**
 * _1154-round-trip.spec.ts — PROBE (inert: `_` prefix + `.spec.ts`).
 *
 * CAN YOU UNDO YOUR OWN DELETE? Measured over the WHOLE corpus, not a hand-picked set.
 *
 * cont.198b found delete-then-re-add refusing 21 of 25 asks across 16 hand-picked leaf
 * units. Sixteen units chosen by hand is a SHAPE, not a rate — the same session had just
 * watched a proposal turn out to have zero population, so a figure that has never met the
 * full corpus is exactly the kind that should not be quoted. This re-derives it over every
 * grid-openable unit, with the non-leaf cohort alongside as the positive control: if the
 * probe cannot see a round trip SUCCEED somewhere, its zero means nothing.
 *
 * THE GESTURE, exactly as a user performs it:
 *   1. open the grid on the unit as written
 *   2. click a sounding cell OFF   → write → the document now says `~` where the note was
 *   3. re-open the grid on THAT document
 *   4. click the same cell back ON → write
 * and ask whether step 4 gives the bytes step 1 started from.
 *
 * Step 3 re-parses rather than reusing the model, because that is what the app does — the
 * panel is re-read from the document after every write. Skipping it would measure a model
 * the user never has.
 *
 * Every write is asked through `serializeStepGridWithExtent`, so each outcome is recorded
 * with THE PATH THAT SERVED IT rather than with a guess about which branch ran. The routing
 * discriminator is the measurement; the source text is not.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import { serializeStepGridWithExtent } from '../../../editor/src/codeView/notation/serialize'
import { isCellOn, cellOn } from '../../../editor/src/codeView/notation/model'
import type { StepGridModel, StepCell } from '../../../editor/src/codeView/notation/model'
import { enginePlayedCycle, sig } from './engineEditOracle'

/**
 * WHAT THE DOCUMENT PLAYS, over four cycles — the only sound comparison here.
 *
 * A byte compare cannot answer this question. The DELETE is entitled to re-spell what
 * it touches, so `<a b>` written across three padded lines comes back as one line, and
 * a re-add that faithfully restores the note into THAT document still fails `=== mini`.
 * The first cut of this probe scored 1711 such asks as broken; every sample inspected
 * was whitespace the delete had normalised, with the note itself perfectly restored.
 *
 * Four cycles rather than one because an alternation is only visible across cycles: a
 * `<a b>` arm that a round trip flattened would play identically in cycle 0 and differ
 * in cycle 1. Null (unreadable to the engine) is kept distinct from "differs" — an
 * oracle that cannot read the input has not found a defect.
 */
const CYCLES = 4
function played(src: string): string | null {
  const parts: string[] = []
  for (let c = 0; c < CYCLES; c++) {
    const rows = enginePlayedCycle(src, c)
    if (rows === null) return null
    parts.push(sig(rows, true))
  }
  return parts.join(' || ')
}

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

const shapeOf = (m: StepGridModel): 'leaf' | 'alt' | 'source' | 'bare' =>
  m.leafSource ? 'leaf' : m.altSource ? 'alt' : m.source ? 'source' : 'bare'

const laneKey = (l: { sound: string; part?: number }): string => `${l.sound}#${l.part ?? 0}`

/**
 * A write, plus WHICH REFUSAL SITE FIRED — when the writer has been asked to say.
 *
 * The extent path alone is too coarse: it reports `leaf`, which names the module, not
 * the reason, and three issues in a row here had a recorded cause that measurement
 * overturned. So the per-site breakdown is read off the run.
 *
 * `serialize.ts` carries NO instrumentation in the committed tree. To get the site
 * names, temporarily wrap each `return null` inside `spliceByLeaf` in a helper that
 * increments `globalThis.__leafRefusals[why]`, run this probe, then restore the file by
 * checksum. Without that wrapper this falls back to the extent path, which is honest but
 * blunt — it will say `leaf` for every refusal rather than distinguishing
 * `shared-leaf-disagrees` (which is what the DELETE hits) from `add-no-leaf(anchors=N)`
 * (which is what the RE-ADD hits, and only `anchors=0` is a defect).
 */
function probeWrite(m: StepGridModel): { mini: string | null; why: string } {
  const g = globalThis as unknown as { __leafRefusals?: Record<string, number> }
  g.__leafRefusals = {}
  const r = serializeStepGridWithExtent(m)
  const sites = Object.keys(g.__leafRefusals)
  g.__leafRefusals = undefined
  if (r.mini !== null) return { mini: r.mini, why: '' }
  return { mini: null, why: sites.length > 0 ? sites.join('+') : r.extent.path }
}

const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1)

/** a shallow clone deep enough that a cell write cannot touch the original */
function withCell(m: StepGridModel, laneIdx: number, col: number, cell: StepCell): StepGridModel {
  const lanes = m.lanes.map((l, i) =>
    i === laneIdx ? { ...l, cells: l.cells.map((c, j) => (j === col ? cell : c)) } : l,
  )
  return { ...m, lanes }
}

interface Tally {
  asks: number
  deleteRefused: number
  reparseFailed: number
  laneVanished: number
  widthMoved: number
  opaque: number
  readdRefused: number
  exact: number
  respelled: number
  lost: number
}
const blank = (): Tally => ({
  asks: 0,
  deleteRefused: 0,
  reparseFailed: 0,
  laneVanished: 0,
  widthMoved: 0,
  opaque: 0,
  readdRefused: 0,
  exact: 0,
  respelled: 0,
  lost: 0,
})

describe('#1154 — the delete→re-add round trip, over the whole corpus', () => {
  it('measures it', () => {
    const byShape = new Map<string, Tally>()
    /** units in which EVERY ask failed to come back exact — the population #1154 is about */
    const unitsAllBroken = new Map<string, string[]>()
    const readdRefusePath = new Map<string, number>()
    const deleteRefuseSite = new Map<string, number>()
    let fixableAsks = 0
    const fixableUnits = new Set<string>()
    const fixableSamples: Array<{ from: string; via: string; at: string }> = []
    const changedSamples: Array<{ shape: string; from: string; via: string; to: string }> = []
    const unitsSeen = new Map<string, number>()

    for (const mini of minis) {
      let base: StepGridModel | null = null
      try {
        const r = parseStepGrid(mini)
        base = r.ok ? r.model : null
      } catch {
        base = null
      }
      if (!base || base.lanes.length === 0) continue
      const shape = shapeOf(base)
      unitsSeen.set(shape, (unitsSeen.get(shape) ?? 0) + 1)
      if (!byShape.has(shape)) byShape.set(shape, blank())
      const t = byShape.get(shape)!

      let asksHere = 0
      let exactHere = 0
      const brokenHere: string[] = []

      for (let li = 0; li < base.lanes.length; li++) {
        const lane = base.lanes[li]
        for (let c = 0; c < base.steps; c++) {
          const cell = lane.cells[c]
          if (!isCellOn(cell)) continue
          asksHere++
          t.asks++

          // ── step 2: delete ──────────────────────────────────────────────────
          const del = probeWrite(withCell(base, li, c, false))
          if (del.mini === null) {
            t.deleteRefused++
            bump(deleteRefuseSite, `${shape}:${del.why}`)
            brokenHere.push(`${laneKey(lane)}@${c} delete-refused(${del.why})`)
            continue
          }

          // ── step 3: re-open the grid on what the delete wrote ───────────────
          let after: StepGridModel | null = null
          try {
            const r = parseStepGrid(del.mini)
            after = r.ok ? r.model : null
          } catch {
            after = null
          }
          if (!after) {
            t.reparseFailed++
            brokenHere.push(`${laneKey(lane)}@${c} reparse-failed`)
            continue
          }
          const li2 = after.lanes.findIndex((l) => laneKey(l) === laneKey(lane))
          if (li2 < 0) {
            // the lane fell out of the document entirely — the user would not see a
            // cell to click, so this is a DIFFERENT gesture, counted apart rather
            // than folded into the refusal rate
            t.laneVanished++
            continue
          }
          if (after.steps !== base.steps) {
            // the delete changed how many columns the grid has, so column `c` is no
            // longer the cell the user clicked. Re-adding "there" would measure a
            // different gesture and quietly inflate the failure rate.
            t.widthMoved++
            continue
          }

          // ── step 4: put it back, at the length it had ───────────────────────
          const re = probeWrite(withCell(after, li2, c, cellOn(cell.duration)))
          if (re.mini === null) {
            t.readdRefused++
            bump(readdRefusePath, `${shape}:${re.why}`)
            brokenHere.push(`${laneKey(lane)}@${c} readd-refused(${re.why})`)
            // THE FIXABLE CLASS: the column the user is clicking back on has NO anchor,
            // because the `~` the delete wrote there a moment ago is not indexed as a
            // leaf. Distinct from `anchors≥1`, where re-adding means putting a SECOND
            // sound into a column that already has one — authoring a chord, which is the
            // boundary the issue correctly defends.
            if (re.why.includes('anchors=0')) {
              fixableAsks++
              fixableUnits.add(mini)
              if (fixableSamples.length < 8)
                fixableSamples.push({ from: mini, via: del.mini, at: `${laneKey(lane)}@${c}` })
            }
          } else if (re.mini === mini) {
            t.exact++
            exactHere++
          } else {
            // bytes differ — the only question left is whether the MUSIC does
            const wantPlay = played(mini)
            const gotPlay = played(re.mini)
            if (wantPlay === null || gotPlay === null) {
              t.opaque++
            } else if (wantPlay === gotPlay) {
              t.respelled++
              exactHere++ // the note came back; the delete merely reformatted around it
            } else {
              t.lost++
              brokenHere.push(`${laneKey(lane)}@${c} LOST`)
              if (changedSamples.length < 25)
                changedSamples.push({ shape, from: mini, via: del.mini, to: re.mini })
            }
          }
        }
      }
      if (asksHere > 0 && exactHere === 0)
        unitsAllBroken.set(mini, [shape, ...brokenHere].slice(0, 4))
    }

    const pct = (n: number, d: number): string => (d === 0 ? '  n/a' : `${((n / d) * 100).toFixed(1)}%`)

    console.log(`\n  corpus: ${minis.length} unique minis\n`)
    console.log('  UNITS THAT OPEN A GRID, by write shape')
    for (const [s, n] of [...unitsSeen].sort((a, b) => b[1] - a[1]))
      console.log(`    ${s.padEnd(8)} ${String(n).padStart(5)}`)

    console.log('\n  THE ROUND TRIP, per ask (one ask = one sounding cell)')
    console.log(
      '    not-asked = the gesture could not be posed: the delete emptied the lane, moved the',
    )
    console.log('                grid width, or produced a document the reader cannot re-open.')
    const cols = [
      ['shape', 8],
      ['asks', 6],
      ['ASKED', 6],
      ['back', 6],
      ['back%', 7],
      ['bytes', 6],
      ['respelt', 8],
      ['LOST', 5],
      ['del-ref', 8],
      ['add-ref', 8],
      ['opaque', 7],
      ['not-asked', 10],
    ] as const
    console.log(
      '    ' + cols.map(([h, w]) => (h === 'shape' ? h.padEnd(w) : h.padStart(w))).join(' '),
    )
    for (const [s, v] of [...byShape].sort((a, b) => b[1].asks - a[1].asks)) {
      const notAsked = v.laneVanished + v.widthMoved + v.reparseFailed
      const asked = v.asks - notAsked
      const back = v.exact + v.respelled
      const row = [
        s.padEnd(8),
        String(v.asks).padStart(6),
        String(asked).padStart(6),
        String(back).padStart(6),
        pct(back, asked).padStart(7),
        String(v.exact).padStart(6),
        String(v.respelled).padStart(8),
        String(v.lost).padStart(5),
        String(v.deleteRefused).padStart(8),
        String(v.readdRefused).padStart(8),
        String(v.opaque).padStart(7),
        String(notAsked).padStart(10),
      ]
      console.log('    ' + row.join(' '))
    }

    console.log('\n  WHY THE GESTURE COULD NOT BE POSED (not-asked, split)')
    console.log(
      `    ${'shape'.padEnd(8)} ${'lane-emptied'.padStart(13)} ${'width-moved'.padStart(12)} ${'unreadable'.padStart(11)}`,
    )
    for (const [s, v] of [...byShape].sort((a, b) => b[1].asks - a[1].asks))
      console.log(
        `    ${s.padEnd(8)} ${String(v.laneVanished).padStart(13)} ${String(v.widthMoved).padStart(12)} ${String(v.reparseFailed).padStart(11)}`,
      )

    console.log('\n  WHICH SITE REFUSED THE DELETE (read off the run, not the source text)')
    for (const [k, n] of [...deleteRefuseSite].sort((a, b) => b[1] - a[1]))
      console.log(`    ${String(n).padStart(6)}  ${k}`)

    console.log('\n  WHICH SITE REFUSED THE RE-ADD')
    for (const [k, n] of [...readdRefusePath].sort((a, b) => b[1] - a[1]))
      console.log(`    ${String(n).padStart(6)}  ${k}`)

    const leaf = byShape.get('leaf')
    const nonLeafBack = [...byShape]
      .filter(([s]) => s !== 'leaf')
      .reduce((a, [, v]) => a + v.exact + v.respelled, 0)
    console.log(
      `\n  POSITIVE CONTROL — the probe CAN see a round trip succeed: ${nonLeafBack} outside the leaf path.`,
    )
    console.log('  (a zero there would mean the instrument is broken, not that the round trip is)')
    if (leaf) {
      const notAsked = leaf.laneVanished + leaf.widthMoved + leaf.reparseFailed
      const asked = leaf.asks - notAsked
      const back = leaf.exact + leaf.respelled
      console.log(
        `  LEAF COHORT: ${back} of ${asked} posable asks come back (${pct(back, asked)}); ` +
          `${leaf.deleteRefused} refused the DELETE, ${leaf.readdRefused} refused the RE-ADD, ${leaf.lost} lost music.`,
      )
    }

    console.log(
      `\n  THE FIXABLE CLASS — re-add onto a column whose only content is the \`~\` THIS DELETE WROTE:`,
    )
    console.log(
      `    ${fixableAsks} asks across ${fixableUnits.size} units. These have a span (ours, written a moment ago),`,
    )
    console.log(
      `    so restoring them authors nothing the user did not write — the objection that justifies`,
    )
    console.log(`    the boundary everywhere else does not apply to them.`)
    for (const s of fixableSamples) console.log(`      ${s.at.padEnd(10)} ${s.from}\n                 delete → ${s.via}`)

    console.log(`\n  UNITS WHERE NO ASK ROUND-TRIPS: ${unitsAllBroken.size}`)
    let shown = 0
    for (const [mini, why] of unitsAllBroken) {
      if (shown++ >= 12) break
      console.log(`    [${why[0]}] ${mini.slice(0, 76)}`)
      console.log(`        ${why.slice(1).join(' · ')}`)
    }

    console.log(`\n  MUSIC LOST BY THE ROUND TRIP (accepted, and it does not play the same):`)
    for (const s of changedSamples.slice(0, 10)) {
      console.log(`    [${s.shape}] ${s.from}`)
      console.log(`       delete →  ${s.via}`)
      console.log(`       re-add →  ${s.to}`)
    }
  })
})
