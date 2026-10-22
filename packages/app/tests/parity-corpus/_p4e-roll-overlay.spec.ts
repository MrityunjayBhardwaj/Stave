/**
 * _p4e-roll-overlay.spec.ts — INSTRUMENT. What a leaf-span OVERLAY would actually do
 * with the roll's 129 non-local deletes (#1232), asked per unit rather than counted.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_p4e-roll-overlay.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * ⚠ 129 IS A CEILING, NOT A PRIZE. `_p4e-roll-locality.spec.ts` counts the deletes that
 * move more of the document than the note's own text; that count says nothing about how
 * many an overlay could actually answer. A leaf projection may not exist for the mini at
 * all, and where it does the width guard or the shared-leaf rule may still refuse. This
 * asks the WRITER, per unit, instead of restating its rule here — the only reading that
 * can be trusted, because any "would surgery take this?" predicate written in a test is
 * a second copy of the decision production already makes.
 *
 * HOW IT ISOLATES SURGERY'S OWN ANSWER. `PianoRollModel.leafSource` is terminal: the
 * writer tries byte surgery and returns null rather than falling back. So moving the
 * overlay `surgical` spans into `leafSource` on a copy of the model gives exactly the
 * overlay's first branch with the fallback suppressed — non-null is what surgery wrote,
 * null is the refusal that falls through to today's writer. Nothing here re-implements
 * `anchorsDescribe` or the shared-leaf rule; both are reached through the real call.
 *
 * That also makes this a live check on the ATTACHMENT rather than only on the writer:
 * a unit reported "no leaf spans" is one `withRollSurgery` did not attach to.
 *
 * The delete mirrors `_p4e-roll-locality.spec.ts` note for note, so the two populations
 * reconcile — its 129 is this file's denominator.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePianoRoll, parsePianoRollCore } from '../../../editor/src/codeView/notation/parse'
import type { PianoRollModel } from '../../../editor/src/codeView/notation/model'
import { serializePianoRoll } from '../../../editor/src/codeView/notation/serialize'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/** how many bytes actually moved — identical to the locality instrument's */
function changedWidth(before: string, after: string): number {
  if (before === after) return 0
  let p = 0
  while (p < before.length && p < after.length && before[p] === after[p]) p++
  let s = 0
  while (
    s < before.length - p &&
    s < after.length - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  )
    s++
  return Math.max(before.length - p - s, after.length - p - s)
}

describe('P4e instrument — what an overlay would win on the roll', () => {
  it('asks the writer, per unit, what byte surgery would do with each non-local delete', () => {
    let moreThanNote = 0
    const tally = new Map<string, number>()
    const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1)
    const winners: { mini: string; was: string; now: string; owner: string }[] = []

    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model as PianoRollModel
      // leaf-owned units already write byte surgery — not this change's population
      if (m.leafSource) continue

      const starts = [...new Set(m.notes.map((n) => n.start))].sort((a, b) => a - b)
      const col = starts.find((c) => m.notes.filter((n) => n.start === c).length === 1)
      if (col === undefined) continue
      const gone = m.notes.find((n) => n.start === col)!
      const kept = m.notes.filter((n) => n !== gone)

      // PAIRED A/B ON ONE TREE, per unit: the same model with the overlay stripped is
      // exactly the pre-P4e writer, so neither arm is quoted from another session and
      // no arm can silently be the same tree twice.
      const { surgical, ...bare } = m
      const was = serializePianoRoll({ ...bare, notes: kept })
      if (was === null) continue
      const budget = String(gone.pitch).length + 3
      if (changedWidth(mini, was) <= budget) continue // already local — nothing to buy
      moreThanNote++

      const owner = parsePianoRollCore(mini).ok ? 'core-opened' : 'derived'

      if (!surgical) {
        bump(`${owner} · no leaf spans attached (impossible)`)
        continue
      }
      const now = serializePianoRoll({ ...m, notes: kept })
      if (now !== was) {
        bump(`${owner} · WINNABLE`)
        winners.push({ mini, was: was, now: now ?? '(refused)', owner })
        continue
      }
      // Same bytes — two different reasons, and they are worth telling apart. Ask
      // surgery in isolation by moving the spans into the terminal field, which
      // suppresses the fall-through.
      const alone = serializePianoRoll({ ...bare, notes: kept, leafSource: surgical.spans() })
      bump(
        alone === null
          ? `${owner} · overlay REFUSES, falls back (safe)`
          : `${owner} · surgery agrees with today (buys nothing)`,
      )
    }

    const win = (o: string) => tally.get(`${o} · WINNABLE`) ?? 0
    console.log(`\n===== P4e ROLL OVERLAY: what surgery would win (${minis.length} corpus units) =====`)
    console.log(`  deletes moving more than the note:   ${moreThanNote}   (the ceiling)`)
    console.log(`  -- asked of the writer, per unit --`)
    for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`     ${String(v).padStart(4)}x  ${k}`)
    console.log(`\n  WINNABLE, split by who owns the view — this is what a phase can claim:`)
    console.log(`     derived path (mirrors #1229's placement):   ${win('derived')}`)
    console.log(`     core-opened  (needs the core to carry it):  ${win('core-opened')}`)
    console.log(`     total:                                      ${win('derived') + win('core-opened')}`)

    console.log(`\n  -- every winner, today's bytes vs surgery's --`)
    winners.forEach((w) => {
      console.log(`     [${w.owner}] ${JSON.stringify(w.mini)}`)
      console.log(`         today   → ${JSON.stringify(w.was)}`)
      console.log(`         surgery → ${JSON.stringify(w.now)}`)
    })

    // the denominator must reconcile with the locality instrument's, or one of them is wrong
    expect(moreThanNote).toBe(129)
  })

  /**
   * WHY THIS SECOND COUNT EXISTS. The committed census (`writer-reach.test.ts`) counts
   * deletes ANSWERED BY the leaf path; the count above counts deletes whose BYTES
   * change. Those are different questions and they gave different answers — census +26
   * against 21 winnable — so the gap needs a name rather than a shrug. A delete that was
   * already local can still switch writer and write the identical bytes; that is a
   * routing fact with no product consequence, and it must not be quoted as documents
   * preserved.
   */
  it('reconciles the census delta against the byte-change count, over every delete', () => {
    let attached = 0
    let switched = 0
    let bytesChanged = 0
    let switchedSameBytes = 0

    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model as PianoRollModel
      if (m.leafSource) continue
      const starts = [...new Set(m.notes.map((n) => n.start))].sort((a, b) => a - b)
      const col = starts.find((c) => m.notes.filter((n) => n.start === c).length === 1)
      if (col === undefined) continue
      const gone = m.notes.find((n) => n.start === col)!
      const kept = m.notes.filter((n) => n !== gone)

      const { surgical, ...bare } = m
      if (surgical) attached++
      const was = serializePianoRoll({ ...bare, notes: kept })
      if (was === null) continue
      // did surgery answer this delete at all? (terminal field suppresses the fallback)
      const alone = surgical
        ? serializePianoRoll({ ...bare, notes: kept, leafSource: surgical.spans() })
        : null
      if (alone === null) continue
      switched++
      const now = serializePianoRoll({ ...m, notes: kept })
      if (now !== was) bytesChanged++
      else switchedSameBytes++
    }

    console.log(`\n===== P4e ROLL: census delta vs byte-change delta =====`)
    console.log(`  models carrying an overlay:            ${attached}`)
    console.log(`  deletes now ANSWERED by surgery:       ${switched}   <-- what the census counts`)
    console.log(`    of which the bytes CHANGE:           ${bytesChanged}   <-- what the change buys`)
    console.log(`    of which the bytes are identical:    ${switchedSameBytes}   (routing only, no product effect)`)

    expect(switched).toBe(bytesChanged + switchedSameBytes)
  })
})
