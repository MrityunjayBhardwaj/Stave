/**
 * round-trip.test.ts — opening a view and writing it back must not change the text.
 *
 * THE LAW: for any mini string a view can open, `serialize(parse(mini))` must
 * equal `mini` when nothing was edited. Opening a grid is a READ. A read that
 * rewrites the document is data loss, and it is loss the user never asked for
 * and cannot see coming.
 *
 * THE LAW HOLDS FOR BOTH VIEWS NOW. Measured over the 1500 real-world strings
 * in `mini-corpus.json`:
 *
 *     GRID   opens 781   round-trips 781 (100%)    rewrites 0      <- #913 (A2)
 *     ROLL   opens 392   round-trips 392 (100%)    rewrites 0      <- #916 (A2)
 *
 * Before #913 the grid round-tripped 512 of 781 (65.6%) and rewrote 269: open
 * `bd hh*2 sd cp`, nudge one cell, and the user's line came back as
 * `bd ~ hh hh sd ~ cp ~` — the `*2` gone, though the edit was over in the `bd`.
 * Reading those 269 and classifying them by hand rather than trusting the
 * total: 2 were whitespace, 16 swapped the user's `-` rests for `~`, and 251
 * were STRUCTURAL — sugar expanded, groups flattened, the grid padded to a
 * uniform resolution. 93% of them destroyed notation.
 *
 * That was not news to the catalogue — `atom*n` was documented as parse-only
 * sugar that "serializes back as the EXPANDED sequence", a deliberate choice.
 * What was never recorded is the BLAST RADIUS: a third of everything the grid
 * could open. A design note that reads reasonably as "sugar expands" reads
 * differently as "32% of real content is rewritten on touch".
 *
 * Both writers now perform span surgery: they copy the user's own bytes back
 * for every region they did not edit, so identity FALLS OUT instead of being a
 * case someone maintains. The grid's 269 (#913) and the roll's 160 (#916) were
 * the same defect and left the same way; the residual snapshots below are now
 * empty and are kept as the tripwire that catches either creeping back.
 *
 * THE OTHER HALF — `edit-locality.test.ts`, and it is the half with teeth. This
 * file measures the UNEDITED path, which is necessary and NOT sufficient: an
 * implementation that stashed the source text and handed it back whenever the
 * model was untouched would score a perfect 100% here and still destroy the
 * line on the first click. Locality is what makes this number mean anything.
 *
 * WHAT THIS FILE IS FOR — three jobs, and the middle one is the point:
 *
 *   1. LOCK what already works. The 512 grid / 230 roll strings that round-trip
 *      today are asserted exactly. If a change breaks one, this goes red now,
 *      not in someone's project.
 *   2. PIN the residual, VISIBLY. The failures are snapshotted with what each
 *      mini becomes — so the loss is documented instead of hidden, and it is
 *      reviewable. A number in a summary can be netted away; a list cannot.
 *   3. BE MEANT TO FLIP. This snapshot is a WORKLIST, not a baseline. #903 A2
 *      (span-surgery write) exists to shrink it, and its PR is measured by the
 *      lines LEAVING this file. Entries disappearing is the goal.
 *
 * DRIFT POLICY — read carefully, it differs by direction:
 *   - an entry LEAVING the residual  = A2 working. Expected, good, review it.
 *   - an entry ARRIVING              = a REGRESSION. Something that round-tripped
 *                                      stopped. Do not accept it with `-u`.
 *   - the locked set going red       = stop. That is live data loss.
 * `vitest -u` cannot tell these apart. You can. Read the diff.
 *
 * SCOPE: the UNEDITED open→write path only. An edited grid must of course emit
 * new text; identity is the right bar only when nothing changed. That is also
 * exactly the path a user hits by clicking a cell and clicking away.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Deep source path, not the `@stave/editor` barrel — the barrel pulls
// @strudel/draw -> gifenc (CJS) and crashes the ESM resolver under vite-node
// (same convention as parity.test.ts:38).
import {
  parseStepGrid,
  parsePianoRoll,
} from '../../../editor/src/codeView/notation/parse'
import {
  serializeStepGrid,
  serializePianoRoll,
} from '../../../editor/src/codeView/notation/serialize'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)

type Outcome =
  | { kind: 'closed' }
  | { kind: 'identity' }
  | { kind: 'rewritten'; out: string }
  | { kind: 'null' }

/** open → write, with nothing edited in between */
function roundTrip(
  mini: string,
  parse: (m: string) => { ok: boolean; model?: unknown },
  serialize: (model: never) => string | null,
): Outcome {
  const r = parse(mini)
  if (!r.ok) return { kind: 'closed' }
  let out: string | null
  try {
    out = serialize(r.model as never)
  } catch {
    // A serializer THROW on an unedited model is not a residual to pin — it is
    // a crash on the read path. Surfaced separately below.
    return { kind: 'null' }
  }
  if (out === null) return { kind: 'null' }
  return out.trim() === mini.trim() ? { kind: 'identity' } : { kind: 'rewritten', out }
}

const VIEWS = [
  { name: 'grid', parse: parseStepGrid, serialize: serializeStepGrid },
  { name: 'roll', parse: parsePianoRoll, serialize: serializePianoRoll },
] as const

/** the residual, computed once — the same data feeds the lock and the pin */
const outcomes = VIEWS.map((v) => ({
  view: v.name,
  rows: corpus.minis.map(({ mini }) => ({
    mini,
    r: roundTrip(mini, v.parse as never, v.serialize as never),
  })),
}))

describe('round-trip — an unedited open→write must not change the text', () => {
  /**
   * JOB 1 — lock what works: the set of real-world strings a user can safely
   * open TODAY, pinned by name. If one leaves this list, a change made a safe
   * string unsafe, and the diff says exactly which.
   *
   * This is a SNAPSHOT and not a computed check on purpose. The first draft of
   * this test recomputed the round-trip and asserted the result differed from
   * the result — `expect(X).toEqual(X)` with extra steps, on deterministic
   * code. It passed, it looked like a lock, and it could not have failed for
   * any reason. A lock needs a reference OUTSIDE the run it is checking; the
   * snapshot file is that reference.
   *
   * ⚠ 10 STRINGS LEFT THE GRID LOCK AT #1010 P4c, and "a change made a safe string
   * unsafe" is NOT what happened — read the bucket they went to. `roundTrip` files a
   * parse failure as `closed`, not as `null`, so these 10 left because the grid view is
   * no longer OFFERED for them: the printer now preserves lengths, and where the column
   * resolution cannot spell one, prove-before-offer (`parse.ts:1638`) declines the view
   * rather than opening one whose edits the writer cannot honour. They are the same 10
   * that take the projected-view count from 185 to 175 and flip their verdict in
   * `mini-corpus`'s snapshot — `[hh ~]!16`, `amen:1/4`, `breaks:{2,5,8}/2`, `lp:6/4`,
   * `sd:4/2`, `bassloop2:4/2`, `~ ~ ~ bd(<2 4!2>, 8)`, `[~ [<[d3,a3,f4]!2 …> ~]]*2`.
   *
   * The half of that diff worth checking is the OTHER pin: `grid-serializer-null` is
   * byte-identical. Nothing new opens and then refuses to write, which is the failure
   * mode that WOULD have been "a safe string made unsafe". Both facts are asserted
   * mechanically against the pre-change snapshots in `_p4c-pin-attribution.spec.ts`
   * rather than read off a diff ([[P361]]) — the corpus input did not move in this
   * change, so the code was the only variable and the set was checkable by construction.
   */
  it.each(VIEWS.map((v) => v.name))('%s: LOCKED — these round-trip today and must not stop', (name) => {
    const rows = outcomes.find((o) => o.view === name)!.rows
    const safe = rows.filter((x) => x.r.kind === 'identity').map((x) => x.mini)
    expect(safe).toMatchSnapshot(`${name}-round-trips-locked`)
  })

  /**
   * JOB 2 + 3 — pin the loss, visibly, as a worklist meant to shrink.
   * The snapshot records what each mini BECOMES, because "269 fail" is a number
   * that can be argued with and `bd hh*2 sd cp -> bd ~ hh hh sd ~ cp ~` is not.
   */
  it.each(VIEWS.map((v) => v.name))(
    '%s: KNOWN RESIDUAL — these are rewritten today and MUST flip (#903 A2)',
    (name) => {
      const rows = outcomes.find((o) => o.view === name)!.rows
      const residual = rows
        .filter((x): x is typeof x & { r: { kind: 'rewritten'; out: string } } => x.r.kind === 'rewritten')
        .map((x) => `${JSON.stringify(x.mini)}\n  -> ${JSON.stringify(x.r.out)}`)
      expect(residual).toMatchSnapshot(`${name}-rewritten-residual`)
    },
  )

  /**
   * The headline, asserted as a CEILING that A2 lowers. A ceiling rather than
   * an equality so an added fixture cannot trip it — but it cannot silently
   * grow either. When A2 lands, this number comes down and the snapshot shrinks
   * with it; the two must move together, which is what makes either credible.
   */
  it('the rewrite count does not grow', () => {
    const counts = Object.fromEntries(
      outcomes.map((o) => [o.view, o.rows.filter((x) => x.r.kind === 'rewritten').length]),
    )
    // MEASURED by running it, over 1500 real strings:
    //   grid  269 of 781 (65.6% round-trip) -> 0 of 781 (100%)   #913 span surgery
    //   roll  160 of 392 (58.7% round-trip) -> 0 of 392 (100%)   #916 span surgery
    // Both ceilings are 0 and stay 0: it is a LAW in both views now, not a
    // budget. A ceiling left at its old value would let the loss creep back
    // silently while every test stayed green.
    expect(counts.grid).toBe(0)
    expect(counts.roll).toBe(0)
  })

  /**
   * A serializer returning `null`/throwing on an UNEDITED model it just parsed
   * is a different animal from a rewrite: the view opened, and then could not
   * write back what it read. Pinned separately so it is never mistaken for a
   * notation residual A2 will fix.
   */
  it.each(VIEWS.map((v) => v.name))('%s: serializer refuses a model it just parsed', (name) => {
    const rows = outcomes.find((o) => o.view === name)!.rows
    const nulls = rows.filter((x) => x.r.kind === 'null').map((x) => x.mini)
    expect(nulls).toMatchSnapshot(`${name}-serializer-null`)
  })
})
