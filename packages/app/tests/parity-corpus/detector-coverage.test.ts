/**
 * detector-coverage.test.ts — the harness must ask EVERY shipped editor (#1003).
 *
 * `editCoverage.ts` decides a unit's editability by consulting a hand-written
 * set of detectors. That set was correct when it was written and then the
 * product grew: `detectMasterAll` shipped, nothing tied the two together, and
 * sixteen units that the app can edit today reported as `code-only` — a bucket
 * everyone reads as "no view exists" when it only ever meant "none of the
 * detectors this file happens to import said yes."
 *
 * This is the sibling of `denominator-audit.test.ts`, on the other half of the
 * fraction: that one guards what may leave the denominator, this one guards
 * that nothing shipped is missing from the numerator. As there, the direction
 * that costs us is the load-bearing one — a detector may only be listed as NOT
 * consulted with a stated reason, so the escape hatch cannot quietly become
 * "whatever we haven't got round to."
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measureDocs, aggregate } from './editCoverage'

/**
 * Where shipped editors' detectors live: the views, and the code↔view directory the
 * editors moved into (#1875). `codeView/ir` is left out, as `ir/` always was: its
 * `detect*` functions measure a pattern's period, they are not editors.
 */
const detectorDirs = ['../../../editor/src/visualEdit', '../../../editor/src/codeView'].map((d) =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), d),
)
const notEditors = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../editor/src/codeView/ir')
const harnessPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'editCoverage.ts')

/**
 * Every detector the harness deliberately does NOT consult, and why. A reason
 * is required: an entry here is a claim that consulting it would make the
 * measurement WRONG, not that we have not looked at it yet.
 */
const NOT_CONSULTED: Record<string, string> = {
  // Cursor-position variants of the `detectAll*` entry points the harness does
  // consult. They answer "what is under the caret", which a whole-document
  // measurement has no caret for; their `All` siblings cover the same surface.
  detectArrangeAt: 'cursor variant of detectAllArrangeCalls, which is consulted',
  detectPickControlAt: 'cursor variant of detectAllPickControls, which is consulted',

  // A refinement of detectMasterAll — it picks WHICH master line the expand
  // drawer binds its insert chain to. Every line it can return is already
  // returned by detectMasterAll, so consulting it would double-count.
  detectMasterAudioAll: 'strict subset of detectMasterAll, which is consulted',

  // Not an editability verdict. It returns the span to WRAP when a bare pattern
  // is first placed in time, and it succeeds for essentially every top-level
  // pattern — consulting it would classify the whole corpus as editable and
  // measure nothing.
  detectBarePattern: 'returns a wrap target for any bare pattern, not a view verdict',
}

/** `export function detectFoo` across the detector directories, excluding tests. */
function shippedDetectors(dir: string, out: Set<string> = new Set()): Set<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    const p = path.join(dir, entry.name)
    if (p === notEditors) continue
    if (entry.isDirectory()) { shippedDetectors(p, out); continue }
    if (!entry.name.endsWith('.ts')) continue
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/^export function (detect\w+)/gm)) out.add(m[1])
  }
  return out
}

describe('the coverage harness asks every shipped editor', () => {
  const detectors = detectorDirs.reduce((out, d) => shippedDetectors(d, out), new Set<string>())
  const harness = fs.readFileSync(harnessPath, 'utf8')

  it('finds the detectors at all (guards the scan itself)', () => {
    // Without this, a broken scan reports zero detectors and the suite passes
    // vacuously — the failure mode the thing it is testing already had once.
    expect(detectors.size).toBeGreaterThanOrEqual(9)
    expect(detectors.has('detectMasterAll')).toBe(true)
  })

  it('consults every detector, or names why not', () => {
    const unconsulted: string[] = []
    for (const d of detectors) {
      // Word-boundary, not `includes`: a substring test passes for
      // `detectMasterAllSomethingElse`, so renaming the import away would have
      // left this green. Found by red-testing the assertion, not by review.
      if (new RegExp(`\\b${d}\\b`).test(harness)) continue
      if (NOT_CONSULTED[d]) continue
      unconsulted.push(d)
    }
    expect(
      unconsulted,
      `visualEdit exports ${unconsulted.join(', ')}, which editCoverage.ts neither consults nor ` +
        'lists in NOT_CONSULTED with a reason. A surface the app can edit must not be measured as ' +
        '`code-only` — see #1003.',
    ).toEqual([])
  })

  it('credits the master strip with exactly the line it edits', () => {
    // ⚠ THE COMPANION LINE IS `s("bd sd")`, NOT `s("bd")`, SINCE #1260, and the
    // change is to the fixture rather than to what the arm claims. This arm is
    // about the MASTER strip; the note line beside it only has to be a unit the
    // grid counts, and `s("bd")` stopped being one when term 3 landed — a single
    // grey box is now `note-single` and leaves the denominator. Two steps make
    // it a pattern again and the arm asks exactly what it always asked. The
    // behaviour that displaced it is pinned in its own arm below, so this is not
    // a fixture edited until a gate went quiet.
    const plain = measureDocs([{ name: 'm', code: 's("bd sd")\nall(x=>x.gain(1.5))\n' }]).tunes[0]
    expect({ master: plain.master, note: plain.noteEditable, knobs: plain.knobs }).toEqual({
      master: 1, note: 1, knobs: 0,
    })

    // A master line with patterns nested inside it still counts ONCE. The strip
    // edits the whole line, so anything it swallowed twice would inflate the
    // numerator — the failure this file exists to stop, in the other direction.
    const nested = measureDocs([
      { name: 'n', code: 's("bd sd")\nall(x=>x.add(stack(s("hh cp"), gain(0.5))))\n' },
    ]).tunes[0]
    expect({ units: nested.units, master: nested.master, note: nested.noteEditable }).toEqual({
      units: 2, master: 1, note: 1,
    })
  })

  // ── THE NEXT TWO ARMS ARE SPLIT ON PURPOSE ─────────────────────────────
  // Term 3 is two decisions — "ask whether the view holds more than one thing"
  // and "put the ones that do not outside the denominator" — and as ONE arm
  // asserting one record they could not be told apart: dropping the question
  // and keeping the units in the fraction reddened the identical arm set, which
  // is the signature of an arm that catches two mechanisms and separates
  // neither ([[P558]]). Split, the first arm reddens only when the QUESTION is
  // gone; the second reddens for either. The containment is the discrimination.

  it('a view holding one thing is not counted as an editable surface', () => {
    // INVARIANT 3'S THIRD TERM, at the smallest scale that shows it (#1256).
    // `s("piano")` routes to a grid and round-trips perfectly — terms 1 and 2
    // both hold — and what it draws is one grey box. `note("c3")` on the roll:
    // one dot. Neither is a surface anyone can edit music in.
    const one = measureDocs([{ name: 's', code: 's("piano")\nnote("c3")\n' }]).tunes[0]
    expect({
      note: one.noteEditable, single: one.noteSingle,
      broken: one.noteBroken, knobs: one.knobs, code: one.codeOnly,
    }).toEqual({ note: 0, single: 2, broken: 0, knobs: 0, code: 0 })

    // The control that stops the rule from being "exclude everything": the same
    // two heads with real content stay fully counted. Without it, term 3
    // answering `false` unconditionally satisfies the assertion above.
    const many = measureDocs([{ name: 'm', code: 's("bd sd")\nnote("c3 e3 g3")\n' }]).tunes[0]
    expect({ note: many.noteEditable, single: many.noteSingle }).toEqual({ note: 2, single: 0 })
  })

  it('…and it leaves the denominator too, not only the numerator', () => {
    // Shape B, the call recorded in #1256 — and what separates these units from
    // `knobs`. `knobs` means "a musical unit we have no view for yet, and it
    // counts against us"; these got a view, and there is no melody in them for a
    // better view to have drawn. Counting them would mean the number can only
    // improve by building a surface for content that has none.
    const one = measureDocs([{ name: 's', code: 's("piano")\nnote("c3")\n' }]).tunes[0]
    expect(one.units).toBe(0)
    const many = measureDocs([{ name: 'm', code: 's("bd sd")\nnote("c3 e3 g3")\n' }]).tunes[0]
    expect(many.units).toBe(2)
  })

  it('a tune with nothing to measure is not a tune we failed to serve', () => {
    // The tune-level half of the same decision, and the thing that made it
    // necessary: wiring term 3 sent 5 vendored fixtures into the `musical === 0`
    // branch — which was unreachable in that corpus before — and it filed them
    // as `code-only`. That reads as "we have no view for this yet" and it took
    // the corpus headline from 41/57 to 34/57 by reclassifying tunes that pose
    // no question. Exactly the mislabel #998 removed at unit level.
    const nothing = measureDocs([{ name: 'n', code: 's("piano")\n' }]).tunes[0]
    expect({ units: nothing.units, cls: nothing.tuneClass })
      .toEqual({ units: 0, cls: 'no-musical-units' })

    // `code-only` keeps meaning what it meant: this tune HAS a musical unit and
    // no view opens on it. Without this arm the branch above could swallow the
    // real failure class whole.
    const real = measureDocs([{ name: 'c', code: 'pick(order, sections)\n' }]).tunes[0]
    expect({ units: real.units, cls: real.tuneClass }).toEqual({ units: 1, cls: 'code-only' })

    // …and the tunes with nothing to measure leave the tune-level denominator,
    // rather than sitting in it as failures.
    const m = aggregate(measureDocs([
      { name: 'a', code: 's("bd sd")\n' },
      { name: 'b', code: 's("piano")\n' },
    ]))
    expect({ n: m.n, measurable: m.measurable, any: m.anyEditable, pct: m.anyEditablePct })
      .toEqual({ n: 2, measurable: 1, any: 1, pct: 100 })
  })

  it('every NOT_CONSULTED entry still exists and still carries a reason', () => {
    // The other direction: a stale exemption silently re-opens the hole it was
    // written to document, and an empty reason turns the list into a to-do.
    for (const [name, why] of Object.entries(NOT_CONSULTED)) {
      expect(detectors.has(name), `NOT_CONSULTED lists ${name}, which no longer exists`).toBe(true)
      expect(why.length, `NOT_CONSULTED[${name}] needs a reason`).toBeGreaterThan(20)
    }
  })
})
