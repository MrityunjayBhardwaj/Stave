/**
 * surgicalMemo.test.ts — the surgical overlay projects LAZILY and AT MOST ONCE (#1237).
 *
 * #1233 moved the overlay's leaf spans behind a thunk. That is not a style choice: the
 * eager form takes the core parse from 57.2us to 1459.8us (x25.5) on the parse that
 * serves 791 of 958 corpus units and re-runs on every keystroke. Three properties hold
 * that up, and losing any of them changes no output, no count and no verdict — only
 * work, which is why nothing else can see it:
 *
 *   1. parsing attaches an overlay WITHOUT projecting          (the cost claim itself)
 *   2. a second ask does not re-project                        (a writer may ask twice)
 *   3. a FAILED projection is remembered too                   (`undefined` is an answer)
 *
 * Clause 3 is why `SurgicalOverlay`'s memo is a separate flag rather than a null check —
 * a null check would re-run the whole projection on every write just to rediscover that
 * this mini has no leaf spans. `bd(3,8)` and `c3(3,8)` are exactly that case: an overlay
 * is attached and its spans are `undefined`.
 *
 * ⚠ WHY THIS COUNTS INVOCATIONS RATHER THAN MICROSECONDS. A wall-clock assertion on a
 * developer machine would be flaky, and a flaky gate teaches people to ignore it. The
 * quantity the memo actually controls is discrete — the projection either ran or it did
 * not — so the witness is a count, and it is exact.
 *
 * ⚠ TWO INDEPENDENT READINGS THAT MUST AGREE, and they fail differently on purpose. The
 * invocation delta is the primary one; object identity is the check on the INSTRUMENT.
 * A re-projection builds a freshly stamped source every call, so `spans() === spans()`
 * breaks the moment the memo goes — including in the one case the delta cannot see,
 * where a future edit drops the counter and every delta arm passes on zero.
 *
 * ⚠ THESE DRIVE `parseStepGrid`/`parsePianoRoll`, NEVER A HAND-BUILT OVERLAY. The thing
 * under gate is what the parse ATTACHES, so a `{ ...model, surgical: … }` fixture would
 * be a second oracle for the attach step and blind to the call site ([[P556]], [[P540]]).
 *
 * WHAT EACH ARM EARNS — seven breaks, and the first three were not enough ([[P558]]).
 * Their signatures NEST rather than being disjoint, so all three reddened while only the
 * failure arms were the unique catcher of anything; four more cells were needed to
 * certify the rest, and two groups still have no unique catcher and say so at the arm.
 *
 *     break                        lazy  success  failure  ctrl  sweep  drag
 *     A memo dropped entirely       -      xx       xx      -      x     x
 *     B flag -> null check          -      -      >xx<      -      -     -
 *     C eager at attach            xx      xx       xx      x      x     x
 *     D honest refactor (CONTROL)   -      -        -       -      -     -
 *     E instrument gone dark        -      xx       xx      x      x     x
 *     F fresh object per ask        -    >xx<       -       -      -     -
 *     G an op drops the overlay     -      -        -       -      -   >x<
 *
 * `>…<` marks a group's unique catcher. Every failure above lands in THIS file and
 * nowhere else in the editor package, and break G was additionally swept against the app
 * package: 1179 arms, 0 failures. So an edit op that dropped the overlay would be caught
 * by exactly one arm in either package — the drag arm below.
 */
import { describe, expect, it } from 'vitest'
import { parsePianoRoll, parseStepGrid, surgicalProjectionCount } from '../parse'
import { canResizeCell, resizeCell } from '../place'
import type { LazyLeafSource, LazyRollLeafSource } from '../model'

/** Minis whose overlay projects real spans. */
const GRID_WITH_SPANS = 'bd sd hh cp'
const ROLL_WITH_SPANS = 'c3 e3 g3 b3'

/**
 * Minis that attach an overlay whose projection FAILS. Euclid opens on both surfaces —
 * the element writer owns the view — while the leaf projection finds nothing to anchor,
 * so `spans()` answers `undefined`. If these ever start projecting spans, clause 3 is
 * being asserted about nothing and the fixture has to be replaced, not the arm relaxed.
 */
const GRID_NO_SPANS = 'bd(3,8)'
const ROLL_NO_SPANS = 'c3(3,8)'

/**
 * Fixtures for the gesture arms, and they have to be chosen rather than assumed: a length
 * handle is offered only where the note has ROOM to grow, so `bd sd hh cp` offers none at
 * all and a sweep over it reaches the writer zero times. A STACK for the handle sweep,
 * because a flat pattern's write is the identity and cannot exercise this seam (B22's
 * fixture rule); eight steps for the drag, so several intermediate lengths are real moves
 * rather than clamps.
 */
const GRID_RESIZABLE = 'bd ~ sd ~, hh ~ hh ~'
const GRID_DRAGGABLE = 'bd ~ ~ ~ sd ~ ~ ~'

const gridOverlay = (mini: string): LazyLeafSource => {
  const r = parseStepGrid(mini)
  if (!r.ok) throw new Error(`${mini} did not open: ${r.gate}`)
  if (!r.model.surgical) throw new Error(`${mini} carries no overlay`)
  return r.model.surgical
}

const rollOverlay = (mini: string): LazyRollLeafSource => {
  const r = parsePianoRoll(mini)
  if (!r.ok) throw new Error(`${mini} did not open: ${r.gate}`)
  if (!r.model.surgical) throw new Error(`${mini} carries no overlay`)
  return r.model.surgical
}

/** Run `work` and report how many deferred projections it caused. */
const projectionsDuring = (work: () => void): number => {
  const before = surgicalProjectionCount()
  work()
  return surgicalProjectionCount() - before
}

describe('the surgical overlay projects lazily (#1237)', () => {
  it('the grid attaches an overlay without projecting it', () => {
    let overlay: LazyLeafSource | undefined
    const projections = projectionsDuring(() => {
      overlay = gridOverlay(GRID_WITH_SPANS)
    })
    // the overlay is offered — presence is the offer, not the spans ([[PV322]])
    expect(overlay?.attachedSteps).toBe(4)
    expect(projections).toBe(0)
  })

  it('the roll attaches an overlay without projecting it', () => {
    let overlay: LazyRollLeafSource | undefined
    const projections = projectionsDuring(() => {
      overlay = rollOverlay(ROLL_WITH_SPANS)
    })
    expect(overlay?.attachedSteps).toBe(4)
    expect(projections).toBe(0)
  })
})

describe('the surgical overlay projects at most once (#1237)', () => {
  it('the grid remembers a successful projection', () => {
    const overlay = gridOverlay(GRID_WITH_SPANS)
    const asks: (unknown | undefined)[] = []
    const projections = projectionsDuring(() => {
      asks.push(overlay.spans(), overlay.spans(), overlay.spans())
    })

    expect(asks[0]).toBeTruthy()
    expect(projections).toBe(1)
    // the second reading: a re-projection would hand back a freshly stamped source
    expect(asks[1]).toBe(asks[0])
    expect(asks[2]).toBe(asks[0])
  })

  it('the roll remembers a successful projection', () => {
    const overlay = rollOverlay(ROLL_WITH_SPANS)
    const asks: (unknown | undefined)[] = []
    const projections = projectionsDuring(() => {
      asks.push(overlay.spans(), overlay.spans(), overlay.spans())
    })

    expect(asks[0]).toBeTruthy()
    expect(projections).toBe(1)
    expect(asks[1]).toBe(asks[0])
    expect(asks[2]).toBe(asks[0])
  })

  it('the grid remembers a FAILED projection too', () => {
    const overlay = gridOverlay(GRID_NO_SPANS)
    const asks: (unknown | undefined)[] = []
    const projections = projectionsDuring(() => {
      asks.push(overlay.spans(), overlay.spans(), overlay.spans())
    })

    // the fixture must still be the case this arm exists for
    expect(asks).toEqual([undefined, undefined, undefined])
    expect(projections).toBe(1)
  })

  it('the roll remembers a FAILED projection too', () => {
    const overlay = rollOverlay(ROLL_NO_SPANS)
    const asks: (unknown | undefined)[] = []
    const projections = projectionsDuring(() => {
      asks.push(overlay.spans(), overlay.spans(), overlay.spans())
    })

    expect(asks).toEqual([undefined, undefined, undefined])
    expect(projections).toBe(1)
  })

  it('counts each overlay separately, so the instrument is not stuck', () => {
    // The positive control for the counter itself — the laziness arms above assert `0`,
    // and a zero reads the same whether the property holds or the instrument is dead
    // ([[P521]], [[P488]]). This says the number can be something other than 0 or 1.
    //
    // ⚠ REPORTED AS NON-DISCRIMINATING, not as a detector. Across the six breaks run for
    // #1237 no break reddens this arm alone: dropping the counter reddens it together
    // with all four memo arms, and projecting eagerly reddens the whole file. It earns
    // its place by stating the expected magnitude where a reader of the `0` arms can see
    // it, not by catching anything they miss.
    const overlays = [
      gridOverlay('bd sd'),
      gridOverlay('bd ~ sd ~'),
      rollOverlay('c3 e3'),
    ]
    const projections = projectionsDuring(() => {
      for (const o of overlays) o.spans()
    })
    expect(projections).toBe(overlays.length)
  })
})

/**
 * The arm that gates the memo on the path that actually re-asks.
 *
 * ⚠ THE OVERLAY'S OWN DOCBLOCK UNDERSTATES WHO ASKS. It reads "one write per many
 * parses, and most parses never write at all", which is true of writes and is not the
 * whole population: `canResizeCell` decides whether the length handle is DRAWN by calling
 * `resizeCell`, which serializes the model twice (`place.ts` — once for the write, once
 * to ask whether the document actually moved), and `serializeStepGridWithExtent` is where
 * `spans()` is asked. So the projection is reached while deciding an affordance and on
 * every pointermove of a drag — per frame, not per write.
 *
 * That makes the memo worth MORE than the docblock claims, and it makes this the arm a
 * regression would show up in first. Two things have to hold for a drag to stay at one
 * projection, and only one of them is the memo: the overlay is a closure, and every edit
 * op rebuilds the model with `{ ...model, lanes }`, so the SAME overlay object rides
 * through the gesture. An op that dropped or re-derived `surgical` would pay the full
 * projection per frame with the memo entirely intact, and no arm above would notice.
 */
describe('a gesture re-asks the writer without re-projecting (#1237)', () => {
  it('probing every length handle on a grid projects at most once', () => {
    const r = parseStepGrid(GRID_RESIZABLE)
    if (!r.ok) throw new Error('fixture did not open')
    const m = r.model
    expect(m.surgical, 'fixture must carry the overlay').toBeTruthy()

    let offered = 0
    const projections = projectionsDuring(() => {
      // what the panel does to decide which handles to draw, then a drag on each
      for (let lane = 0; lane < m.lanes.length; lane++) {
        for (let col = 0; col < m.steps; col++) {
          for (let dur = 2; dur <= m.steps; dur++) {
            if (canResizeCell(m, lane, col, dur)) offered++
          }
        }
      }
    })

    // non-vacuity: the sweep must have reached the writer, or `0` proves nothing
    expect(offered).toBeGreaterThan(0)
    expect(projections).toBe(1)
  })

  it('a drag carries the same overlay across every intermediate model', () => {
    const r = parseStepGrid(GRID_DRAGGABLE)
    if (!r.ok) throw new Error('fixture did not open')

    let moved = 0
    const projections = projectionsDuring(() => {
      let m = r.model
      for (const dur of [2, 3, 4, 3, 2]) {
        const next = resizeCell(m, 0, 0, dur)
        if (next !== m) moved++
        m = next
      }
      // the overlay must have survived every `{ ...model, lanes }` rebuild
      expect(m.surgical).toBe(r.model.surgical)
    })

    expect(moved).toBeGreaterThan(0)
    expect(projections).toBe(1)
  })
})
