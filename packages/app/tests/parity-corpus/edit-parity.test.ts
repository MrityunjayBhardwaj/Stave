/**
 * edit-parity.test.ts — the EDIT-ability regression gate over the vendored corpus.
 *
 * Sibling of `parity.test.ts`. Where that one gates the TIMELINE parser
 * (`ir/parseStrudel` — "does this tune parse to a structured IR"), this one
 * gates the EDIT path (`codeView/notation/parse.ts` + `chunkDetect` — "can a
 * Stave grid/roll open this tune, and if not, WHY"). Until #903 nothing did:
 * the only instrument that measured editability was `edit-coverage.spec.ts`,
 * and a `.spec.ts` is maintainer-only and never runs in CI.
 *
 * WHY THIS EXISTS (the concrete failure it was born from). Swapping the
 * hand-rolled mini grammar for Strudel's own krill parser (#903 A1) recovered
 * 33 units and silently took ONE away — `[c4,e4,g4,c5]*2`, a chord with a
 * multiplier, stopped opening. The swept aggregate reported "+32", which reads
 * as a clean win; the regression only surfaced when the per-tune numbers were
 * diffed. That diff was a throwaway script. This file is that script, made
 * permanent, because:
 *   - the 201 notation unit tests did NOT catch it (they cover the subset by
 *     hand; they cannot know what real tunes contain), and
 *   - an aggregate percentage NETS a regression against a recovery, so the one
 *     number everybody quotes is exactly the number that hides this.
 *
 * WHAT IT ASSERTS. Per fixture: how many units are editable, and the exact
 * reason for every one that is not. That catches BOTH directions —
 *   - a unit that stops being editable (a regression), and
 *   - a unit that starts being editable without anyone deciding to widen the
 *     view (a gate leak).
 * Both show up as a snapshot diff.
 *
 * DRIFT POLICY (same as parity.test.ts — the diff IS the news):
 *   - A PR touching the edit path that moves this snapshot MUST explain each
 *     line of the diff in its body. "Recovered N units" is not an explanation;
 *     name the mini form and why the old verdict was wrong.
 *   - NEVER run `vitest -u` to make this green. A snapshot regenerated without
 *     reading it re-buckets a silent data-loss bug as an improvement.
 *
 * The oracle is IMPORTED from `editCoverage.ts`, never re-derived here. A
 * second copy would answer confidently and diverge silently — the failure mode
 * this corpus exists to detect.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { measureDocs } from './editCoverage'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))

describe('edit-parity — view-editability over the vendored corpus', () => {
  const files = fs
    .readdirSync(corpusDir)
    .filter((f) => f.endsWith('.strudel'))
    .sort()

  it('corpus is non-empty (a green gate over zero fixtures is not a gate)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('pins per-fixture editability + the reason for every refusal', () => {
    const docs = files.map((f) => ({
      name: f,
      code: fs.readFileSync(path.join(corpusDir, f), 'utf8'),
    }))
    const m = measureDocs(docs)

    // Per fixture: the editable count and the class of every refusal. Reasons
    // are sorted, not raw-ordered, so the snapshot tracks WHAT the view refuses
    // rather than the order units happen to appear in.
    const verdicts = m.tunes.map((t) => ({
      file: t.file,
      units: t.units,
      editable: t.structurallyEditable,
      broken: t.noteBroken,
      class: t.tuneClass,
    }))
    expect(verdicts).toMatchSnapshot('per-fixture-editability')

    const reasons = [...m.brokenReasons.entries()].sort(([a], [b]) => a.localeCompare(b))
    expect(reasons).toMatchSnapshot('refusal-reasons')
  })

  /**
   * The corpus-wide floor. The snapshot above is the precise instrument; this
   * is the blunt one that fails loudly if a change guts editability wholesale
   * (e.g. the parser starts throwing and every unit lands in `broken`).
   * Deliberately a floor, not an equality: it must not need touching when a
   * fixture is added.
   */
  it('keeps a corpus-wide editability floor', () => {
    const docs = files.map((f) => ({
      name: f,
      code: fs.readFileSync(path.join(corpusDir, f), 'utf8'),
    }))
    const m = measureDocs(docs)
    const editable = m.tunes.reduce((n, t) => n + t.structurallyEditable, 0)
    const total = m.tunes.reduce((n, t) => n + t.units, 0)
    expect(total).toBeGreaterThan(0)
    // MEASURED 60/86 (69.8%) on this tree, re-derived in the run that changed
    // it — not the 48/98 this comment carried from #903 A1, which had been true
    // and then wrong for a long time while the floor below it stayed at 44.
    //
    // ⚠ THE FLOOR MOVES UP IN A COMMIT THAT MOVES THE VALUE DOWN, and both
    // halves belong in the same place. #1260 wired invariant 3's third term, so
    // 15 of this corpus's units left both sides of the fraction: 75/101 → 60/86.
    // A floor of 44 against an observed 60 is 16 units of headroom a regression
    // could disappear into with the gate still green ([[P541]]); 56 keeps the
    // slack this floor was originally written with. Still a floor and not an
    // equality, so adding a fixture does not need it touched.
    expect(editable).toBeGreaterThanOrEqual(56)
  })
})
