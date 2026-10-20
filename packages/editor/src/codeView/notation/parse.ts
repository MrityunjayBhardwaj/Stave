/**
 * Mini-notation → notation models.
 *
 * The grammar is STRUDEL'S, so we ask Strudel for it. `@strudel/mini`'s krill
 * parser — the same parser the transpiler runs — answers "what IS this syntax",
 * and this file maps its AST onto the view models below.
 *
 * This file used to hand-roll that grammar. Every real-world "gap" the copy
 * reported turned out to be DRIFT from the original rather than a missing
 * feature: krill parses 623 of the 625 real-world units the copy rejected
 * (99.7%; the 2 residuals are a truncated source and a floatbeat DSP
 * expression that is not mini-notation at all). The copy is gone.
 *
 * THE RULE AT THIS BOUNDARY: if you need to know what a character MEANS, ask
 * krill — and do not write its answer back down here as a regex. A transcribed
 * rule is a second oracle: correct the day it is written, silently divergent
 * after, and the divergence surfaces as a user-visible bug rather than an
 * error. That is how `gm_agogo` became uneditable (an `_` in a char-class read
 * a NAME as syntax) and how `stack (` blanked a whole timeline.
 *
 * What stays OURS is the VIEW. krill yields an unbounded recursive tree;
 * `Step[]` is two levels (steps → slots), so deeper nesting is refused as a
 * MODEL limit — an honest "a grid can't show this", not a fake parse failure.
 */
import { joinedCycle, type JoinedHit } from '../strudelMini/joined'
import { miniPattern, type MiniPattern } from '../strudelMini/pattern'
import { miniTree, type KAtom, type KElement, type KOp, type KPattern } from '../strudelMini/tree'
import { isRest, miniShape, type MiniAtom, type MiniGroup } from '../strudelMini/shape'
import { bjorklund, rotateEuclid } from '../ir/euclid'
import { detectPeriod } from '../ir/songAnalysis'
import { serializeByLeaf, serializeStepGrid, serializePianoRoll } from './serialize'
import type {
  AltRegion,
  AltSource,
  ChunkGain,
  Gate,
  GridCell,
  GridCells,
  LazyLeafSource,
  LazyRollLeafSource,
  LeafAnchor,
  LeafSource,
  LeafSpan,
  NotationSource,
  ParseResult,
  PianoRollModel,
  RollLeafAnchor,
  RollLeafSource,
  RollNote,
  SourcePart,
  SourceRegion,
  StepCell,
  StepGridModel,
  StepLane,
} from './model'
import { cellOn, gridCellKey, isCellOn } from './model'
import { MAX_VIEW_STEPS, UNREFINED, documentSteps, viewScaleFits } from './viewResolution'
import type { ViewScale } from './viewResolution'
import { pitchToMidi } from './pitch'
import { MAX_SHARED_STEPS, lcmOf, perBarLayout, toDrawnGrid, toDrawnRoll } from './perBar'

/**
 * A bare integer (`60`, `0`, `-7`) — a numeric note value for the roll (#469).
 * This is a VIEW question (does this lane carry pitches or sounds?), not a
 * grammar one, so it stays here: krill is happy to call `909` an atom, but a
 * bare number is not a sound name.
 */
const NUMERIC = /^-?\d+$/
/**
 * A token this lane can SHOW. krill has already ruled on what is a valid atom,
 * so there is no syntax check here — only the view's own question. Sounds pass
 * everywhere; bare integers pass only where the consumer opts in
 * (`allowNumeric`) — the Piano Roll (`note`/`n`), never the step grid.
 * Note-name validity is owned by `pitchToMidi` (the row-math authority) — a
 * second NOTE regex here drifted out of sync once already (it required an
 * octave, so bare `c` was rejected even though pitchToMidi maps it to C3);
 * single source = no drift (P189).
 */
const isAtomToken = (t: string, allowNumeric: boolean): boolean =>
  allowNumeric || !NUMERIC.test(t)

/** ceiling on expanded columns so `[7 hits][11 hits]` can't blow up the grid */
/* exported so the #1066 invariant (`ONSET_GRID % MAX_STEPS === 0`) can be asserted
   against both real values rather than against a copy of either */
export const MAX_STEPS = 64

/**
 * The grid every played onset is snapped to before it is asked for a denominator
 * (#1066).
 *
 * A hap's `begin` is a float. Two onsets that are musically the same instant can
 * differ in the last bits, so they are rounded onto a fixed rational grid before
 * being compared or given a denominator — that rounding is what lets `byCol`
 * group occurrences and what makes `onsetKey`/`rollKey` compare periods at all.
 *
 * ⚠ THE GRID MUST BE DIVISIBLE BY `MAX_STEPS`, AND THAT IS THE WHOLE POINT.
 * `denom(x, MAX_STEPS)` is the acceptance test every projection runs: an onset
 * is editable iff some `d <= MAX_STEPS` makes `x·d` integral. A position this
 * grid cannot express exactly is therefore rejected by a test it was never able
 * to pass — the refusal reports `irrational-onset` about a perfectly rational
 * position that the snapping made irrational.
 *
 * That is not hypothetical: the previous value was `720720` = `LCM(1..16)` =
 * `2^4 · 3^2 · 5 · 7 · 11 · 13`, which carries only four factors of two, so
 * neither 32 nor 64 divides it. A thirty-second landed like this:
 *
 *     9/32 · 720720       = 202702.5
 *     Math.round(…)       = 202703        (JS rounds half away from zero)
 *     202703 / 720720     = 0.2812506937506937
 *     denom(…, 64)        = 0             -> irrational-onset
 *
 * So the projection advertised 64 columns while the grid feeding it topped out
 * at sixteenths for powers of two, and every behaviour-path document needing a
 * 32nd or 64th was unreachable. `bd [~ bd bd _ bd _ _ _] sn ~` — which the grid
 * writer itself emits after three subdivisions — is one of them.
 *
 * `2882880` = `720720 · 4` = `2^6 · 3^2 · 5 · 7 · 11 · 13`. It is a strict
 * WIDENING: 720720 divides it, so every position expressible before still is,
 * and no document that opened can start refusing.
 *
 * ⚠ It does NOT express every `d <= MAX_STEPS`, and cannot — that would need
 * `LCM(1..64)`, which is ~5e26 and past `Number.MAX_SAFE_INTEGER`. Denominators
 * with a factor this grid lacks (27, 25, 49, primes above 13) still snap to a
 * neighbour and are still refused, exactly as before. The invariant worth
 * holding is the one asserted in the tests: the finest UNIFORM grid the system
 * permits, `MAX_STEPS`, must be exactly expressible.
 */
export const ONSET_GRID = 2882880

/**
 * The value the resolution folds saturate at (#1239).
 *
 * Every consumer of an `lcm` fold in this file asks one question of it —
 * `… > MAX_STEPS`? — and refuses above the cap. So the exact value above the cap
 * cannot change a verdict, while computing it exactly is what used to blow up:
 * `lcm(1..43)` is 9.4e18, four orders of magnitude past `Number.MAX_SAFE_INTEGER`,
 * and it arises from ordinary notation (`"1*1, 2*2, … 43*43"`).
 *
 * ⚠ FINITE, and deliberately so. An unbounded sentinel — `Infinity`, or simply
 * the exact value — escapes into loops and allocations that this file sizes FROM
 * the fold before any cap is consulted: `bars` is folded with `lcm` at the
 * alternation site below and then drives `for (let b = 0; b < bars; b++)`, and
 * the column builders allocate `perBar × bars`. A crash traded for a hang is not
 * a fix.
 *
 * MEASURED, by removing this saturation and keeping everything else: the 43-part
 * case stops throwing and starts HANGING instead — it enters `parsePianoRoll` and
 * does not return, and because the spin is synchronous no test timeout can
 * interrupt it. So this is the half that carries the fix.
 *
 * ⚠ THE CAP IS THE VIEW'S, NOT THE DOCUMENT'S, AND THE DIFFERENCE IS LOAD-BEARING.
 * Twelve of the thirteen folds here take unscaled quantities and refuse above
 * `MAX_STEPS`, so `MAX_STEPS + 1` would serve them. The thirteenth — the shared
 * width across a stack's parts — folds over columns that have ALREADY been scaled
 * by `viewScale`, and a refined view may legitimately be 256 columns wide. Cutting
 * that fold off at 65 does not refuse such a view: it returns a total the parts do
 * not divide, so `factor` goes fractional and the lanes come back wrong — measured,
 * a ×4 view of a three-part stack drew 65 columns where it owes 96. Saturating at
 * the view ceiling instead is invisible to every legitimate value — that fold is
 * already bounded by the `viewScaleFits` check above it — while still bounding the
 * growth, because anything past `MAX_STEPS` refuses whether it reads 65 or 257.
 *
 * Caught by `1058-refined-placement` and `view-scale-entry` in the app package and
 * by nothing in this one: no editor arm drew a multi-part stack at a refined scale.
 * There is one now, directly below the crash arms it belongs beside.
 */
const OVER_CAP = MAX_VIEW_STEPS + 1

/**
 * Iterative Euclid.
 *
 * The recursion is what turned an unrepresentable fold into a stack overflow
 * rather than merely a wrong number: past the safe-integer range the operands
 * stop being exact integers, so `a % b` never reaches 0 and there is no base case
 * left to reach (#1239).
 *
 * ⚠ DEFENSIVE, and measured to be. `lcm` saturates on entry, so by the time this
 * is called both operands are at most `MAX_STEPS` and Euclid on those cannot
 * recurse more than a handful of frames — restoring the recursive form with the
 * saturation in place reddens nothing at all (73 arms, all green). It is kept
 * because the shape it removes is a whole class rather than one input, and
 * because the cost is four lines; not because anything currently depends on it.
 */
const gcd = (a: number, b: number): number => {
  while (b !== 0) {
    const r = a % b
    a = b
    b = r
  }
  return a
}

/**
 * Least common multiple, saturating at `OVER_CAP`.
 *
 * VERDICT-PRESERVING, and the argument is short enough to state: `lcm(a, b)` is
 * never less than `max(a, b)`, so an input already past the cap forces a result
 * past it too — saturating on entry can only agree with the exact answer. Below
 * the cap both operands are at most `MAX_STEPS`, so the product is at most
 * `64 · 63` and is computed exactly. Hence `saturated ≤ MAX_STEPS` exactly when
 * `exact ≤ MAX_STEPS`, and the two are equal whenever that holds — which is the
 * only range any caller reads a value from rather than refusing it.
 */
const lcm = (a: number, b: number): number => {
  if (a >= OVER_CAP || b >= OVER_CAP) return OVER_CAP
  const r = (a / gcd(a, b)) * b
  return r >= OVER_CAP ? OVER_CAP : r
}

/**
 * The euclid distribution + rotation now live in ONE place (`ir/euclid.ts`) —
 * this file and `ir/parseMini.ts` each carried their own copy until #943, and
 * they had already drifted: this one inverts a negative `k` (Strudel's real
 * behaviour, #917) while the IR's returned empty. Re-exported because the
 * notation tests import `bjorklund` from here.
 */
// Imported (not just re-exported) — this file calls both below, and a bare
// `export … from` would re-export them without binding them in module scope.
export { bjorklund, rotateEuclid }

/** one slot inside a `[...]` sub-sequence */
interface Slot {
  /** atoms played together; empty = rest */
  atoms: string[]
  /** `@n` weight within the group */
  units: number
}

/** a top-level step: a plain atom/rest, or a sub-sequence of slots */
interface Step {
  atoms: string[]
  /** `@n` — flat columns, or bars when inside a `<...>` alternation */
  elongation: number
  /** `[a b]` slots, or null for a plain step */
  sub: Slot[] | null
}

const stepUnits = (s: Step): number =>
  s.sub ? s.sub.reduce((n, slot) => n + slot.units, 0) : 1

/** finest subdivision so every sub-sequence slot lands on a whole column */
const division = (steps: Step[]): number => steps.reduce((d, s) => lcm(d, stepUnits(s)), 1)

/** split on commas that sit outside every bracket and euclid `(k,n)` paren */
function splitTopLevel(src: string): string[] {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === ',' && depth === 0) {
      out.push(src.slice(from, i))
      from = i + 1
    }
  }
  out.push(src.slice(from))
  return out
}

/** inner text when the trimmed string is exactly one `<...>` alternation */
function unwrapAlternation(mini: string): string | null {
  const t = mini.trim()
  if (t.length < 2 || !t.startsWith('<') || !t.endsWith('>')) return null
  // The opening `<` must close only at the FINAL `>`: `<a> <b>` is TWO
  // alternations, not one, and stripping its ends yields `a> <b` — garbage that
  // then refuses downstream. Depth returning to 0 before the end means the outer
  // brackets don't enclose the whole string.
  let depth = 0
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '<') depth++
    else if (t[i] === '>' && --depth === 0 && i !== t.length - 1) return null
  }
  return t.slice(1, -1)
}

/* ── reading the krill tree ────────────────────────────────────── */

/**
 * The krill nodes this file reads (`KAtom`, `KPattern`, `KOp`, `KElement`) and the
 * call that produces them (`miniTree`) live in `../strudelMini/tree.ts` (#1971) —
 * the shape is written down once, there.
 *
 * ⚠ ONLY THE OLD READER BELOW READS THOSE NODES' FIELDS (#1972): `isAtom`, `isRestAtom`,
 * `tokenOf`, `numArg`, `readOps`, `groupSlots`, `chordAtoms`, `elementToSteps`,
 * `tokenize`, `altAlternatives`, `expandAltElements`. They are listed with their read
 * counts in `modellingRatchet/boundary.exceptions.json`, the counts only go down, and
 * #1012 deletes them. Everything else in this file — the span readers, the projections —
 * asks `../strudelMini/shape.ts` for plain nodes; a field read in any other function
 * fails the boundary test.
 *
 * The tree is uniformly recursive — `pattern > element > (atom | pattern)` —
 * and `weight`/`reps`/`ops` are fields on EVERY element. That uniformity is
 * why this adapter is short and the parser it replaced was not: the copy made
 * position-specific (one reader per place a token could appear) what Strudel
 * makes uniform, which is why all of its gaps read "works on an atom, fails on
 * a group".
 */

/**
 * One top-level krill element: where its bytes are, and how many steps it
 * expanded to. `!n` is why the count is needed — one element, n steps.
 * Offsets are into the string handed to `tokenize` (already trimmed).
 */
interface ElementSpan {
  start: number
  end: number
  /**
   * The element's total WEIGHT — its steps' elongations summed (`bd` 1, `bd@3`
   * 3, `bd!3` 3, `[a b]` 1). Columns are `weight * div` in both views, which is
   * why the region builder is shared: the grid refuses elongation, so there
   * weight is just the step count, while the roll's `c4@2` is one element owning
   * two columns. Counting STEPS instead would be right for the grid and quietly
   * wrong for the roll.
   */
  weight: number
}

type Tokenized =
  | { ok: true; steps: Step[]; elements: ElementSpan[] }
  | { ok: false; reason: string }

/** a refusal — always the VIEW's ("a grid can't show this"), never the grammar's */
type Refused = { reason: string }

const isAtom = (n: KAtom | KPattern): n is KAtom => n.type_ === 'atom'

/**
 * `~` and `-` are both silence — literally one branch upstream:
 * `if (ast.source_ === '~' || ast.source_ === '-') return silence` (mini.mjs:157).
 * Both are atoms occupying a slot. (`_` is NOT silence — it is sustain, and
 * krill has already folded it into the previous element's weight by now.)
 */
const isRestAtom = (a: KAtom): boolean => a.source_ === '~' || a.source_ === '-'

/**
 * The token a lane displays. krill splits `bd:3` into an atom plus a `tail` op
 * (upstream turns that pair into superdough's `s` + `n`); the views show — and
 * round-trip — the written form, so re-join it.
 *
 * A tail is not always an atom: `rd:<1 3 2>` selects the sample by an
 * ALTERNATION, and `sd:[1|0]` by a random choice. Those are patterns, and this
 * flat token cannot hold one — so the answer is `null` (the caller refuses the
 * unit) and never a truncated `"rd"`. Dropping the tail would render a cell
 * that looks editable and then write `rd` back over the user's `rd:<1 3 2>`:
 * silent data loss, which is strictly worse than declining to show it.
 */
const tokenOf = (atom: KAtom, ops: KOp[]): string | null => {
  let t = atom.source_
  for (const op of ops) {
    if (op.type_ !== 'tail') continue
    // the tail's `element` IS the node — an atom for `bd:3`, a pattern for `rd:<1 3 2>`
    const node = op.arguments_?.element as KAtom | KPattern | undefined
    if (!node || node.type_ !== 'atom' || typeof node.source_ !== 'string') return null
    t += ':' + node.source_
  }
  return t
}

/**
 * A number krill parsed as a node. `*2`'s amount arrives as a bare atom;
 * `(3,8)`'s pulse/step arrive wrapped in an element. Observed, not assumed.
 */
const numArg = (node: unknown): number | null => {
  const n = node as { type_?: string; source_?: unknown } | undefined
  if (!n || typeof n !== 'object') return null
  const inner = (n.type_ === 'element' ? n.source_ : n) as KAtom | undefined
  if (!inner || inner.type_ !== 'atom') return null
  const v = Number(inner.source_)
  return Number.isFinite(v) ? v : null
}

interface Euclid {
  k: number
  n: number
  rot: number
}

/**
 * Fold an element's ops into the two the views can render. `tail` is already in
 * the token and `replicate` is already in `reps`, so both are no-ops here.
 * Everything else — `?` degrade, `bd/2` slow — is a real Strudel feature this
 * view has no way to draw, and says so.
 */
function readOps(ops: KOp[]): { mult: number; euclid: Euclid | null } | Refused {
  let mult = 1
  let euclid: Euclid | null = null
  for (const op of ops) {
    switch (op.type_) {
      case 'tail':
      case 'replicate':
        break
      case 'stretch': {
        const type = op.arguments_?.type
        if (type !== 'fast') {
          return { reason: `"${String(type)}" stretch is beyond the editable subset` }
        }
        const amount = numArg(op.arguments_?.amount)
        if (amount === null || !Number.isInteger(amount) || amount < 1) {
          return { reason: 'invalid * multiplier' }
        }
        mult *= amount
        break
      }
      case 'bjorklund': {
        const k = numArg(op.arguments_?.pulse)
        const n = numArg(op.arguments_?.step)
        // absent rotation arrives as an explicit `null`, not `undefined`
        const rot = op.arguments_?.rotation == null ? 0 : numArg(op.arguments_.rotation)
        if (k === null || n === null || rot === null) {
          return { reason: 'invalid euclid (k,n) arguments' }
        }
        if (n < 1) return { reason: 'invalid euclid step count' }
        euclid = { k, n, rot }
        break
      }
      case 'degradeBy':
        return { reason: '"?" random degrade is beyond the editable subset' }
      default:
        return { reason: `"${op.type_}" is beyond the editable subset` }
    }
  }
  return { mult, euclid }
}

/** the slots of a `[...]` group — one nesting level, a `[a,b]` chord per slot */
function groupSlots(pat: KPattern, allowNumeric: boolean): Slot[] | Refused {
  const slots: Slot[] = []
  for (const el of pat.source_) {
    const opts = el.options_ ?? {}
    const ops = opts.ops ?? []
    const units = opts.weight ?? 1
    if ((opts.reps ?? 1) > 1) {
      return { reason: '! inside a group is beyond the editable subset' }
    }
    // A slot renders as a flat token (or a chord); it has nowhere to put an
    // operator. Refuse rather than drop one — `[[0,1]*<1!3 2> [2,3]]` would
    // otherwise show as a plain `[0,1]` chord and write the `*<1!3 2>` away.
    // `tail` is the exception: it belongs to the atom and `tokenOf` folds it in.
    if (ops.some((o) => o.type_ !== 'tail')) {
      return { reason: 'operators inside a group are beyond the editable subset' }
    }
    if (isAtom(el.source_)) {
      if (isRestAtom(el.source_)) {
        // a `:` variant on silence (`~:3`) has no cell to name — refuse rather
        // than drop it, same rule as a patterned tail
        if (ops.length) return { reason: 'a ":" variant on a rest has nothing to name' }
        slots.push({ atoms: [], units })
        continue
      }
      const token = tokenOf(el.source_, ops)
      if (token === null) {
        return { reason: `a patterned ":" variant on "${el.source_.source_}" is beyond the editable subset` }
      }
      if (!isAtomToken(token, allowNumeric)) return { reason: `unsupported token "${token}"` }
      slots.push({ atoms: [token], units })
      continue
    }
    // a nested pattern is showable only as a `[a,b]` chord in one slot
    const chord = chordAtoms(el.source_, allowNumeric)
    if (!Array.isArray(chord)) return chord
    slots.push({ atoms: chord, units })
  }
  if (slots.length === 0) return { reason: 'empty group' }
  return slots
}

/** the atoms of a `[a,b]` chord — parallel single-atom voices, no nesting */
function chordAtoms(pat: KPattern, allowNumeric: boolean): string[] | Refused {
  if (pat.arguments_?.alignment !== 'stack') {
    return { reason: 'nested groups are beyond the editable subset' }
  }
  const atoms: string[] = []
  for (const voice of pat.source_) {
    // krill wraps each `,`-separated voice in its own fastcat pattern
    if (isAtom(voice as unknown as KAtom | KPattern)) {
      return { reason: 'stacked sub-sequences are beyond the editable subset' }
    }
    const vp = voice as unknown as KPattern
    if (vp.arguments_?.alignment !== 'fastcat' || vp.source_.length !== 1) {
      return { reason: 'stacked sub-sequences are beyond the editable subset' }
    }
    const el = vp.source_[0]
    const ops = el.options_?.ops ?? []
    if (!isAtom(el.source_) || (el.options_?.reps ?? 1) > 1 || ops.some((o) => o.type_ !== 'tail')) {
      return { reason: 'stacked sub-sequences are beyond the editable subset' }
    }
    const token = tokenOf(el.source_, ops)
    if (token === null) {
      return { reason: `a patterned ":" variant on "${el.source_.source_}" is beyond the editable subset` }
    }
    if (!isAtomToken(token, allowNumeric)) return { reason: `unsupported token "${token}"` }
    atoms.push(token)
  }
  return atoms
}

/**
 * One krill element → the step(s) it occupies. `!n` yields n SEPARATE steps
 * (unlike `*n`, which subdivides one), so this returns a list.
 */
function elementToSteps(el: KElement, allowNumeric: boolean): Step[] | Refused {
  const opts = el.options_ ?? {}
  const ops = opts.ops ?? []
  const reps = opts.reps ?? 1
  const rawWeight = opts.weight ?? 1
  const read = readOps(ops)
  if (!('mult' in read)) return read
  const { mult, euclid } = read

  // Upstream sets `weight = reps` for a replicate, so a replicated element's
  // weight carries no `@`. When the two disagree, an `@` was written next to a
  // `!` (`bd!3@2` → weight 4, reps 3) — a combination no view models.
  if (reps > 1 && rawWeight !== reps) {
    return { reason: '! combined with * or @ is beyond the editable subset' }
  }
  // Degenerate spans: `bd!0` queries to ZERO haps and `bd@0` to a zero-width
  // step (observed). Both are legal mini and both are silence — there is simply
  // no cell to draw, so the view declines rather than inventing one.
  if (reps < 1) return { reason: 'a zero replicate has nothing to show' }
  if (rawWeight <= 0) return { reason: 'a zero-width step has nothing to show' }
  const weight = reps > 1 ? 1 : rawWeight

  if (!isAtom(el.source_)) {
    const alignment = el.source_.arguments_?.alignment
    if (alignment === 'stack') {
      const chord = chordAtoms(el.source_, allowNumeric)
      if (!Array.isArray(chord)) return chord
      if (euclid) return { reason: 'euclid on a chord is beyond the editable subset' }
      if (reps > 1) return { reason: '! on a chord is beyond the editable subset' }
      if (mult > 1) {
        if (weight > 1) return { reason: '* combined with @ is beyond the editable subset' }
        // `[a,b]*n` ≡ the chord struck n times inside the one step
        return [
          {
            atoms: [],
            elongation: weight,
            sub: Array.from({ length: mult }, () => ({ atoms: [...chord], units: 1 })),
          },
        ]
      }
      return [{ atoms: chord, elongation: weight, sub: null }]
    }
    if (alignment !== 'fastcat') {
      return { reason: `"${String(alignment)}" is beyond the editable subset` }
    }
    // ── the view's own limits on a `[...]` group ──
    if (euclid) return { reason: 'euclid on a group is beyond the editable subset' }
    if (reps > 1) return { reason: '! on a group is beyond the editable subset' }
    if (mult > 1 && weight > 1) {
      return { reason: '* combined with @ is beyond the editable subset' }
    }
    const slots = groupSlots(el.source_, allowNumeric)
    if (!Array.isArray(slots)) return slots
    if (mult > 1) {
      // `[…]*n` ≡ the group's slots played n times within the step (n× faster)
      const sub: Slot[] = []
      for (let r = 0; r < mult; r++) {
        for (const s of slots) sub.push({ atoms: [...s.atoms], units: s.units })
      }
      return [{ atoms: [], elongation: weight, sub }]
    }
    if (slots.length === 1 && slots[0].units === 1) {
      // `[bd]` collapses to a bare atom
      return [{ atoms: slots[0].atoms, elongation: weight, sub: null }]
    }
    return [{ atoms: [], elongation: weight, sub: slots }]
  }

  const atom = el.source_
  const rest = isRestAtom(atom)
  if (rest && ops.some((o) => o.type_ === 'tail')) {
    return { reason: 'a ":" variant on a rest has nothing to name' }
  }
  const token = rest ? '' : tokenOf(atom, ops)
  if (token === null) {
    return { reason: `a patterned ":" variant on "${atom.source_}" is beyond the editable subset` }
  }
  if (!rest && !isAtomToken(token, allowNumeric)) {
    return { reason: `unsupported token "${token}"` }
  }
  const atoms = rest ? [] : [token]

  if (euclid) {
    if (mult > 1 || reps > 1 || weight > 1) {
      return { reason: 'euclid combined with * / ! / @ is beyond the editable subset' }
    }
    // `atom(k,n[,rot])` ≡ a sub-sequence of n single-unit slots: the atom at the
    // Bjørklund pulse positions (rotated by `rot`), rests everywhere else.
    const hits = rotateEuclid(bjorklund(euclid.k, euclid.n), euclid.rot)
    return [{ atoms: [], elongation: 1, sub: hits.map((on) => ({ atoms: on ? [...atoms] : [], units: 1 })) }]
  }
  if (reps > 1) {
    if (mult > 1) return { reason: '! combined with * or @ is beyond the editable subset' }
    // `atom!n` ≡ n SEPARATE plain steps of the atom (vs `*n`, one sub-step)
    return Array.from({ length: reps }, () => ({ atoms: [...atoms], elongation: 1, sub: null }))
  }
  if (mult > 1) {
    if (weight > 1) return { reason: '* combined with @ is beyond the editable subset' }
    // `atom*n` ≡ a sub-sequence of n single-unit slots of the atom
    return [
      {
        atoms: [],
        elongation: 1,
        sub: Array.from({ length: mult }, () => ({ atoms: [...atoms], units: 1 })),
      },
    ]
  }
  return [{ atoms, elongation: weight, sub: null }]
}

/**
 * Tokenize a flat sequence (one cycle / one stack part / one alternation slot).
 * The grammar is krill's; every refusal below is the VIEW's own.
 */
function tokenize(mini: string, allowNumeric = false): Tokenized {
  const src = mini.trim()
  if (src === '') return { ok: true, steps: [], elements: [] }
  let ast: KPattern
  try {
    ast = miniTree(src)
  } catch {
    return { ok: false, reason: 'unsupported mini-notation syntax' }
  }
  if (!ast || ast.type_ !== 'pattern' || !Array.isArray(ast.source_)) {
    return { ok: false, reason: 'unsupported mini-notation syntax' }
  }
  const alignment = ast.arguments_?.alignment
  if (alignment !== 'fastcat') {
    // Callers split a top-level `,` before this; reaching one means it sits
    // where the view cannot place it.
    return {
      ok: false,
      reason:
        alignment === 'stack'
          ? 'unsupported token ","'
          : `"${String(alignment)}" is beyond the editable subset`,
    }
  }
  const steps: Step[] = []
  const elements: ElementSpan[] = []
  for (const el of ast.source_) {
    const mapped = elementToSteps(el, allowNumeric)
    if (!Array.isArray(mapped)) return { ok: false, reason: mapped.reason }
    const loc = el.location_
    if (loc) {
      elements.push({
        start: loc.start.offset,
        end: loc.end.offset,
        weight: mapped.reduce((w, s) => w + s.elongation, 0),
      })
    }
    steps.push(...mapped)
  }
  // A span we can't place is a span we can't put back: if any element lacks a
  // location the tiling has a hole, and a partial tiling would copy the wrong
  // bytes through. All or nothing.
  const tiled = elements.length === ast.source_.length
  return { ok: true, steps, elements: tiled ? elements : [] }
}

/* ── drum grid ─────────────────────────────────────────────────── */

/** the grid has no time axis for `@n`, so any elongation rejects */
const gridHasElongation = (steps: Step[]): boolean =>
  steps.some((s) => s.elongation !== 1 || (s.sub?.some((slot) => slot.units !== 1) ?? false))

/**
 * What the reader knows about one column: the notes STARTING in it, each with its
 * own length in columns (#1010 P4b).
 *
 * As of #1010 P4c this is exactly `GridCell` — a source REGION now remembers the
 * lengths too, because the printer preserves them and a region whose only change is
 * a length has to read as changed (#1045). The two names stay because they answer
 * two questions — what the cell HOLDS versus what the region SHOWED — and only the
 * second is a model type others depend on.
 */
type ColumnNote = GridCell
type ColumnNotes = ColumnNote[][]

/** the display view of columns — the sounds and their lengths, in order, for a source region */
const tokensOf = (cols: ColumnNotes): GridCells => cols.map((c) => c.map((n) => ({ ...n })))

/**
 * Flatten steps to `div`-resolution trigger cells.
 *
 * A slot occupying `span` columns places its atoms in the first and leaves the rest
 * empty, and its note SOUNDS for the whole span — `bd [sd sd sd]` gives `bd` three
 * columns of six, and the engine agrees (`whole.end - whole.begin` = ½ cycle). That
 * agreement is not an argument, it is a gate: `cell-duration.test.ts` compares this
 * structural length against what the engine plays for every ON cell in the corpus,
 * on this path and the projected ones, and a disagreement fails.
 *
 * The elongation guard is what makes the span honest here — `@n` inside a step is
 * refused upstream (`gridHasElongation`), so a slot's own `units` never stretch it
 * past the columns it owns.
 */
function toCells(steps: Step[], div: number): ColumnNotes {
  const cells: ColumnNotes = []
  for (const step of steps) {
    const slots = step.sub ?? [{ atoms: step.atoms, units: 1 }]
    const total = stepUnits(step)
    for (const slot of slots) {
      const span = (div / total) * slot.units
      cells.push(slot.atoms.map((token) => ({ token, duration: span })))
      for (let j = 1; j < span; j++) cells.push([])
    }
  }
  return cells
}

/**
 * Derive lanes (one per distinct sound, first-appearance order) from cells.
 *
 * A sound appears at most once per column — the cell shows it once — so where a
 * column holds the same token twice, the FIRST one wins the cell, matching how
 * `deriveColumn` picks the displayed atom's span and length. The dedupe is a
 * display rule and lives only here; nothing upstream of this loses a note to it.
 */
function lanesFromCells(cells: ColumnNotes, part?: number): StepLane[] {
  const order: string[] = []
  for (const cell of cells) {
    for (const n of cell) if (!order.includes(n.token)) order.push(n.token)
  }
  return order.map((sound) => ({
    sound,
    ...(part !== undefined ? { part } : {}),
    cells: cells.map((cell) => {
      const note = cell.find((n) => n.token === sound)
      return note ? cellOn(note.duration) : false
    }),
  }))
}

/**
 * Pair each source element with the columns it produced, so the writer can put
 * unedited ones back verbatim (#913 for the grid, #916 for the roll).
 *
 * An element owns `weight * div` columns, in source order — see
 * `ElementSpan.weight`. `content` answers what the view showed there; that is
 * the only part of this that is a view's business.
 *
 * Returns null unless the spans TILE — concatenating them reproduces the source
 * exactly — AND the columns add up to the grid the model reports. Both hold for
 * every flat mini in the real corpus, and both are checked rather than trusted:
 * the whole mechanism is "copy the bytes we did not touch", so a hole in the
 * tiling would copy the WRONG bytes, silently. Cheaper to verify than to debug,
 * and a failure here just means the caller writes the way it always did.
 */
function buildRegions<C>(
  src: string,
  elements: ElementSpan[],
  div: number,
  total: number,
  content: (from: number, to: number) => C,
): SourceRegion<C>[] | null {
  if (elements.length === 0) return null
  const regions: SourceRegion<C>[] = []
  let col = 0
  for (const el of elements) {
    const raw = src.slice(el.start, el.end)
    const leading = /^\s*/.exec(raw)?.[0] ?? ''
    const trailing = /\s*$/.exec(raw.slice(leading.length))?.[0] ?? ''
    const to = col + el.weight * div
    regions.push({ raw, leading, trailing, from: col, to, weight: el.weight, content: content(col, to) })
    col = to
  }
  if (col !== total) return null
  if (regions.map((r) => r.raw).join('') !== src) return null
  return regions
}

/**
 * Lay played onsets out as columns of notes — what `toCells` is for the syntactic
 * core, for the paths that read the pattern's behaviour instead of its syntax.
 * Returns null when an onset does not land on a column of this grid (the caller
 * refuses; it is the same `irrational-onset` this always reported).
 *
 * THE UNIT CONVERSION, and it is the only one in the file: `Onset.durs` is in
 * CYCLES and a cell's length is in COLUMNS, so a length is scaled by `perBar` — the
 * number of columns one cycle covers. `[hh ~]!16` plays sixteen notes of 1/32 cycle
 * on a 16-column grid, which is 0.5 columns each: half a cell, exactly as heard.
 *
 * Reads the DISPLAY view (`atoms`/`durs`) rather than `occ`, so a column showing one
 * sound twice takes the same first-occurrence length the displayed atom's span comes
 * from. Where the two disagree is #1032's business, not a place to invent a rule.
 */
function columnsFromOnsets(perCycle: Onset[][], perBar: number, bars: number): ColumnNotes | null {
  const cols: ColumnNotes = Array.from({ length: perBar * bars }, () => [])
  for (let b = 0; b < bars; b++) {
    for (const o of perCycle[b]) {
      const c = Math.round(o.pos * perBar)
      if (c < 0 || c >= perBar) return null
      cols[b * perBar + c] = o.atoms.map((token, i) => {
        const dur = o.durs[i]
        // `null` is NOT KNOWN, and only synthetic onsets carry it — probe columns and
        // anchor predictions, neither of which is ever projected into a model. One
        // column is the honest reading if one ever arrived here, and
        // `cell-duration.test.ts` compares every cell against the engine, so a wrong
        // length would fail rather than sit there looking plausible.
        return { token, duration: dur === null ? 1 : dur * perBar }
      })
    }
  }
  return cols
}

/**
 * the grid's view of a span of columns — the sounds in each with their lengths,
 * deduped on (sound, length) (see `SourceRegion` and `gridCellKey`)
 */
const gridContent =
  (cells: GridCells) =>
  (from: number, to: number): GridCells =>
    cells.slice(from, to).map((c) => [...new Map(c.map((n) => [gridCellKey(n), n])).values()])

/**
 * The roll's view of a span of columns: the notes STARTING in it.
 *
 * Start decides ownership, so a held `c4@2` belongs to the element that wrote
 * it and not also to the one it sustains over. `gain` is deliberately dropped —
 * velocity lives in a separate `.gain(…)` argument, so nudging it must not make
 * the notation look edited.
 */
const rollContent =
  (notes: RollNote[]) =>
  (from: number, to: number): RollNote[] =>
    notes
      .filter((n) => n.start >= from && n.start < to)
      .map((n) => ({ pitch: n.pitch, start: n.start, duration: n.duration }))

/**
 * The one-part source shared by the flat and alternation paths: the whole mini
 * is a single part on the shared grid, so its columns ARE the grid's columns
 * (`factor` 1) and it carries no separator.
 */
function singlePart<C>(
  src: string,
  elements: ElementSpan[],
  div: number,
  total: number,
  content: (from: number, to: number) => C,
): SourcePart<C>[] | null {
  const regions = buildRegions(src, elements, div, total, content)
  return regions ? [{ part: 0, div, factor: 1, before: '', after: '', regions }] : null
}

/* ── `<...>` as a sequence element (#920) ──────────────────────── */

/**
 * The per-cycle alternatives of a `<...>` element — the elements of the single
 * inner fastcat krill nests under `polymeter_slowcat` (`<a b>` parses as
 * slowcat[ fastcat[a, b] ], one slot per cycle). null when `el` is not a plain
 * `<...>` alternation (an atom, or a `.`/`|` variant we don't bar-expand).
 */
function altAlternatives(el: KElement): KElement[] | null {
  const p = el.source_
  if (isAtom(p) || p.arguments_?.alignment !== 'polymeter_slowcat') return null
  // An op on the alternation ITSELF — `<a b>*2`, `<a b>/2`, `<a b>@2`, `<a b>!2` —
  // changes the column math (a stretch speeds the whole alternation, an elongation
  // holds it across bars) and is beyond phase 1. Decline so it refuses cleanly
  // rather than dropping the op and reshaping the line.
  const o = el.options_
  if (o && ((o.weight ?? 1) !== 1 || (o.reps ?? 1) !== 1 || (o.ops?.length ?? 0) > 0)) return null
  const inner = p.source_[0] as unknown as KPattern | undefined
  if (!inner || inner.type_ !== 'pattern' || inner.arguments_?.alignment !== 'fastcat') return null
  return inner.source_
}

/** the bar-expansion of a fastcat that contains `<...>` alternation elements */
interface AltExpansion {
  bars: number
  div: number
  perBarCols: number
  perBarSteps: Step[][]
  /** each single-cycle top-level element: its bytes and its width (`weight * div` columns) */
  elemSpans: { start: number; end: number; weight: number }[]
}

/**
 * Expand `bd <sd hh>` into one cycle per alternation slot: `bars` = LCM of the
 * alternation lengths, and bar b takes each alternation's (b mod n)-th slot. The
 * source stays a single cycle — its top-level elements tiling it — so the writer
 * puts unchanged ones back verbatim (see AltSource).
 *
 * A single global `div` (LCM across every bar) keeps all bars on one column grid,
 * so a clean rectangle is exactly "every bar the same step count". Returns:
 *   null    → not this shape (no alternation element, or not a fastcat) — the
 *             caller's flat path takes over;
 *   Refused → a real limit: a branch of a different expanded length (the
 *             reconciliation case, deferred to phase 1b), a nested `<...>` inside
 *             a branch, or a blow-up past MAX_STEPS. The panel stays closed
 *             rather than open a grid the writer can't put back.
 */
function expandAltElements(mini: string, allowNumeric: boolean): AltExpansion | Refused | null {
  const src = mini.trim()
  let ast: KPattern
  try {
    ast = miniTree(src)
  } catch {
    return null
  }
  if (!ast || ast.type_ !== 'pattern' || ast.arguments_?.alignment !== 'fastcat') return null
  const topEls = ast.source_
  if (!topEls.some((el) => altAlternatives(el) !== null)) return null

  let bars = 1
  for (const el of topEls) {
    const alts = altAlternatives(el)
    if (alts) {
      if (alts.length === 0) return { reason: 'empty alternation' }
      bars = lcm(bars, alts.length)
    }
  }

  const perBarSteps: Step[][] = []
  const elemWeight: number[] = []
  for (let b = 0; b < bars; b++) {
    const barSteps: Step[] = []
    for (let i = 0; i < topEls.length; i++) {
      const alts = altAlternatives(topEls[i])
      const node = alts ? alts[b % alts.length] : topEls[i]
      const st = elementToSteps(node, allowNumeric)
      if (!Array.isArray(st)) return { reason: st.reason }
      // Every bar must lay the same element down at the same WIDTH, or its
      // columns won't line up bar-to-bar. Width is the summed elongation (a step
      // count is only that when nothing carries `@n` — right for the grid, wrong
      // for the roll where `c4@2` is one step spanning two columns). A branch that
      // expands to a different width (`!n`, `@n`, a wider group) is the
      // reconciliation case — declined here, deferred to phase 1b.
      const w = st.reduce((s, step) => s + step.elongation, 0)
      if (b === 0) elemWeight[i] = w
      else if (w !== elemWeight[i]) {
        return { reason: 'alternation branches of different lengths are beyond the editable subset' }
      }
      barSteps.push(...st)
    }
    perBarSteps.push(barSteps)
  }

  // No location on an element means a hole in the tiling — a hole would copy the
  // wrong bytes back, so refuse rather than guess.
  if (topEls.some((el) => !el.location_)) return { reason: 'unsupported mini-notation syntax' }
  // An element wider than one step (`c4@2`, `[a b]@2`) can't be re-emitted through
  // the per-bar `<...>` wrapper without changing its weight — `c4@2` edited would
  // come back `<d4@2 c4@2>`, which is weight 1, re-dividing the cycle and shifting
  // every neighbour. Preserving the weight (`<d4 c4>@2`) is the reconciliation case
  // (phase 1b); until then, an alt pattern carrying any elongated element stays
  // code-only rather than risk wrong bytes on edit.
  if (elemWeight.some((w) => w > 1)) {
    return { reason: 'an elongated element in an alternation pattern is beyond the editable subset' }
  }
  const div = perBarSteps.reduce((d, steps) => lcm(d, division(steps)), 1)
  const perBarCols = elemWeight.reduce((n, c) => n + c, 0) * div
  if (perBarCols * bars > MAX_STEPS) {
    return { reason: `the alternation expands past ${MAX_STEPS} steps` }
  }
  const elemSpans = topEls.map((el, i) => ({
    start: el.location_!.start.offset,
    end: el.location_!.end.offset,
    weight: elemWeight[i],
  }))
  return { bars, div, perBarCols, perBarSteps, elemSpans }
}

/**
 * Regions for an alt-element source: one per single-cycle top-level element,
 * tiling the source, each carrying its per-bar view content. Returns null if the
 * spans don't reconstruct the source or the columns don't add up — then the
 * caller declines rather than open a grid it cannot put back.
 */
function buildAltRegions<C>(
  src: string,
  elemSpans: { start: number; end: number; weight: number }[],
  div: number,
  perBarCols: number,
  content: (from: number, to: number) => C[],
): AltRegion<C>[] | null {
  const regions: AltRegion<C>[] = []
  let col = 0
  for (const es of elemSpans) {
    const raw = src.slice(es.start, es.end)
    const leading = /^\s*/.exec(raw)?.[0] ?? ''
    const trailing = /\s*$/.exec(raw.slice(leading.length))?.[0] ?? ''
    const to = col + es.weight * div
    regions.push({ raw, leading, trailing, from: col, to, perBar: content(col, to) })
    col = to
  }
  if (col !== perBarCols) return null
  if (regions.map((r) => r.raw).join('') !== src) return null
  return regions
}

/**
 * `bd <sd hh>` — a `<...>` alternation sitting inside the sequence. Each bar is
 * one cycle of the expansion; the source stays the single cycle the user wrote.
 * null → not this shape (the flat path handles it).
 *
 * ── DRAWING IT FINER (#1117) ──────────────────────────────────────────────────
 * The bar widths come from the alternation's own branches, which is why this path
 * could not simply inherit #1116's threading. But there IS one multipliable
 * quantity: `div`, the column division every element shares, with
 * `perBarCols = totalWeight × div`. Both `toCells` and `buildAltRegions` derive
 * every column they emit from it, so scaling `div` scales the whole layout
 * uniformly and the region tiling stays exact (`Σ weight × kd = k × perBarCols`).
 *
 * Every gate above the multiplication is scale-FREE — `expandAltElements` (which
 * carries the document's own `MAX_STEPS` ceiling) and the elongation guard both
 * read the notation, never the view. So ownership is already decided at the
 * parameter's identity value here without a separate pass ([[PV262]]), and the
 * only refusal the scale can add is the VIEW's ceiling.
 */
function gridFromAltElements(
  mini: string,
  viewScale: ViewScale = UNREFINED,
): ParseResult<StepGridModel> | null {
  const exp = expandAltElements(mini, false)
  if (exp === null) return null
  if ('reason' in exp) return { ok: false, reason: exp.reason }
  const { bars, div: documentDiv, perBarCols: documentPerBarCols, perBarSteps, elemSpans } = exp
  if (perBarSteps.some(gridHasElongation)) {
    return { ok: false, reason: 'elongation is beyond the drum-grid subset' }
  }
  // The VIEW's ceiling, asked of what would be DRAWN. The DOCUMENT's ceiling was
  // already applied to the unscaled columns inside `expandAltElements`; a refine
  // expands nothing in the notation, so asking `MAX_STEPS` again here would be the
  // category error `viewResolution.ts` argues against (#1055).
  if (!viewScaleFits(documentPerBarCols, bars, viewScale)) {
    return { ok: false, reason: gateReason('view-resolution', 'grid'), gate: 'view-resolution' }
  }
  const div = documentDiv * viewScale
  const perBarCols = documentPerBarCols * viewScale
  const cells: ColumnNotes = []
  for (const steps of perBarSteps) cells.push(...toCells(steps, div))
  const lanes = lanesFromCells(cells)
  const src = mini.trim()
  const regions = buildAltRegions<GridCells>(src, elemSpans, div, perBarCols, (from, to) => {
    const perBar: GridCells[] = []
    for (let b = 0; b < bars; b++) {
      perBar.push(
        tokensOf(cells.slice(from + b * perBarCols, to + b * perBarCols)).map((c) => [
          ...new Set(c),
        ]),
      )
    }
    return perBar
  })
  if (!regions) return { ok: false, reason: 'unsupported mini-notation syntax' }
  return {
    ok: true,
    // ⚠ RECORDING THE SCALE IS NOT OPTIONAL ([[P417]]). The entry check reads this
    // self-report, so a path that multiplies correctly and stays silent is refused —
    // and refusal is the safe direction, so nothing looks broken while the reach
    // quietly disappears. Whoever multiplies by the scale also declares it.
    model: {
      steps: cells.length,
      bars,
      ...(viewScale === UNREFINED ? {} : { viewScale }),
      lanes,
      altSource: { perBar: perBarCols, bars, div, regions },
    },
  }
}

/* ── behaviour projection: the inherited fallback (#922) ────────── */

/** smallest denominator `d` (≤ cap) with `x·d` integral, or 0 if none */
function denom(x: number, cap = MAX_STEPS): number {
  for (let d = 1; d <= cap; d++) if (Math.abs(x * d - Math.round(x * d)) < 1e-9) return d
  return 0
}

/**
 * Cycles probed when establishing a pattern's period (#930).
 *
 * A pattern that has not repeated by here is treated as non-repeating — `irand`,
 * `shuffle`, a `/n` slower than the window — and refused. Projecting a prefix of
 * it would show a grid that stops being true on the very next cycle, which is
 * worse than an honest refusal.
 */
const PERIOD_PROBE = 24

/**
 * The most bars the projection will bar-expand across.
 *
 * Bounded by re-emit READABILITY, not by the column arithmetic: `spliceAltGrid`
 * writes an edited element as `<b0 b1 …>`, one slot per bar, so a large period
 * turns a single cell toggle into a wall of alternation. `MAX_STEPS` still caps
 * the `perBar × bars` product independently, and is the binding constraint for
 * anything but a coarse bar.
 */
const MAX_PROJECT_BARS = 4

/**
 * The same bound for the LEAF-anchored projections, per surface (#991).
 *
 * The cap above is the ELEMENT writer's, and its readability rationale is not
 * this path's: `serializeStepGrid`/`serializePianoRoll` branch on
 * `model.leafSource` FIRST and that branch is terminal, so a leaf edit never
 * reaches `spliceAltGrid`'s `<b0 b1 …>` re-emit. Replacing one token's bytes and
 * copying the rest costs the same at twelve bars as at one. So the leaf path is
 * free to look further — where looking further is measured to BUY something.
 *
 * GRID 12. The measurement behind the 12 is GATED, not written here (#1041) —
 * `grid-cap-sweep.test.ts` and `GRID-CAP-SWEEP.md` sweep 4/6/8/10/12 on BOTH
 * populations this constant governs, per ask rather than by netting totals, with
 * a floor per population that reddens when the cap goes backwards. What the raise
 * buys is real reach on the population production reaches today, and the views it
 * opens are slow single samples — `hacking/8`, `drm/9`, `<vox1 - [vox2] ->/2` —
 * which expand to eight or nine columns TOTAL and where every sounding cell
 * accepts an edit. Both claims are re-derived on every run; the figures live in
 * the generated table.
 *
 * ⚠ THIS PARAGRAPH USED TO CARRY THE FIGURE, AND IT WAS STALE BOTH TIMES ANYONE
 * CHECKED. It read "+9 (95 → 104)" from #991, then "+17 (109 → 126)" from #1038.
 * Neither pair of endpoints survives on this tree, and the second pair went stale
 * without the headline moving at all: #1242 widened the corpus underneath the line
 * and shifted both terms by nearly the same amount. A DELTA is exactly the shape a
 * population change preserves, so the number most likely to be quoted here was the
 * one least likely to look stale — a reader who confirmed the gain would have
 * confirmed the one part of the line that drift cannot touch, and walked away
 * having certified two wrong figures. Today's values are deliberately absent from
 * this comment: read them off the generated table, which cannot disagree with the
 * run that produced it.
 *
 * ⚠ Second edge, for anyone hunting stale copies of these dead figures: this line's
 * old cap-4 projection collides with a live reading elsewhere in the sweep, so
 * searching by digits pairs the wrong two things. Enumerate by meaning.
 *
 * The mechanism is unchanged and is why the gain held up rather than eroding:
 * #1022 taught the probe to advance to the first bar that sounds, and alternations
 * whose first cycle is silent are where long-period patterns live, which is the
 * only material this cap governs. And the raise is additive: the sweep diffs PER
 * ASK and no ask moves to a worse outcome at any swept value, on either
 * population — the leaf path is structurally incapable of changing a length it
 * was not asked to change.
 *
 * ROLL 4, deliberately unchanged — and written as a literal, not as an alias of
 * `MAX_PROJECT_BARS`. The two are equal today by coincidence of measurement, not
 * because this path follows the element writer; aliasing them would re-make the
 * very mistake this constant exists to undo, and would move the roll silently the
 * next time the element cap moves for a re-emit reason.
 *
 * The measurement behind the 4 is GATED, not written here — `roll-cap-sweep.test.ts`
 * and `ROLL-CAP-SWEEP.md` (#1020/#1024) re-swept caps 4/6/8/12 on BOTH populations
 * this constant governs, per ask rather than by netting totals. On the population
 * this path serves in production (core-REFUSED) reach does not move by one ask at
 * any cap: it is **75** at 4, 6, 8 and 12 alike. The extra views it would open are
 * 13–58% live (`<[0@6 -3@1 -2@1]!1 …>`: three of thirteen notes respond).
 *
 * ⚠ This paragraph used to carry that figure inline as "it stays at 73", measured
 * before the probe widening (#1022) — the count is 75 now and the CONCLUSION is
 * unchanged, which is exactly why an inline number was the wrong place for it. It
 * lives in a gate that fails on movement instead (#1038).
 *
 * The reason the reach is flat: the roll's long-period patterns are built out of
 * `!n`/`@n` repetition, so their notes SHARE leaves, and a shared leaf whose notes
 * disagree is refused by the bijection. Opening a mostly-dead sixty-four-column
 * roll for no reach is the trade `leafRollViewUsable` exists to refuse, one step
 * coarser. What the sweep DID find is that the other population — the 414 asks the
 * core serves today — gains 13 transfers at cap 12, which is why raising it belongs
 * to #1012 and not here.
 *
 * Neither may exceed `PROJECTION_PERIOD_BOUNDS.maxVerifiedBars` — see below for why
 * that is a derived number and not a written-down one.
 *
 * `MAX_STEPS` still caps `perBar × bars` independently and stays the binding
 * constraint: at twelve bars a pattern may be no finer than five steps to the bar,
 * which is why this buys back coarse long-period patterns only.
 */
const LEAF_PROJECT_BARS: Record<Surface, number> = { grid: 12, roll: 4 }

/**
 * The period caps, and the one bound every single one of them obeys (#1025).
 *
 * THE BOUND: `detectPeriod` confirms a period by finding a repeat among the probed
 * cycles, so a period `p` is only VERIFIED once `2p` cycles were probed. At `p = 16`
 * against a probe of 24, cycles 8–15 are checked against nothing and a period-32
 * pattern masquerades as period-16 — a view that silently stops being true one cycle
 * past its own width, which no onset oracle observes. The shared `detectPeriod`
 * (ir/songAnalysis.ts, #1931) holds the same line itself — it never answers above
 * half the cycles it is given — so a cap set past the bound reads as no period
 * rather than as a wrong one.
 *
 * DERIVED, NOT RESTATED. This used to be the literal `12` written into a doc comment
 * here and into a test assertion in the app package, while `PERIOD_PROBE` stayed
 * private — so raising the probe (a perfectly reasonable change, since it is what
 * limits how long a period can be detected at all) would have left both copies stale
 * AND GREEN. A guard that can only ever be observed passing is not a guard. Exported
 * so the gates check the relationship instead of a number that agrees with it today.
 */
export const PROJECTION_PERIOD_BOUNDS = Object.freeze({
  /** cycles probed when establishing a period */
  probe: PERIOD_PROBE,
  /** the largest period any projection may admit — half the probe, because of the doubling */
  maxVerifiedBars: Math.floor(PERIOD_PROBE / 2),
  /** the element writer's cap, bounded by re-emit readability rather than by this */
  element: MAX_PROJECT_BARS,
  /** the leaf writers' caps, per surface */
  leaf: Object.freeze({ ...LEAF_PROJECT_BARS }),
})

/* ── refusal gates (#990) ──────────────────────────────────────────────────── */

/**
 * a projection's outcome: a model, or the gate that stopped it — with what the pattern
 * plays beside the gate when editing is the only thing that gate refused (#1975)
 */
type Projection<M> = { ok: true; model: M } | { ok: false; gate: Gate; lookOnly?: M }

/** decline at `gate` — the only way a projection says no */
const no = (gate: Gate): { ok: false; gate: Gate } => ({ ok: false, gate })

/** the onsets a surface read, or the gate that stopped the read */
type Read<T> = { ok: true; onsets: T } | { ok: false; gate: Gate }

/** which view is speaking — only `wrong-surface` needs to name the other one */
type Surface = 'grid' | 'roll'

/** the sentence a gate says, in the voice of the view that declined */
function gateReason(gate: Gate, surface: Surface): string {
  switch (gate) {
    case 'wrong-surface':
      return surface === 'grid'
        ? 'the pattern plays numbers, which the piano roll shows, not the step grid'
        : 'the pattern plays sound names, which the step grid shows, not the piano roll'
    case 'no-note-content':
      return 'the pattern plays no placeable notes'
    case 'unstable-period':
      // the LEAF cap, because `refused` reports the leaf writer's gate — quoting
      // the element writer's stricter cap here would name a bound that did not
      // stop this pattern (#991)
      return `the pattern does not repeat within ${LEAF_PROJECT_BARS[surface]} bars`
    case 'mixed-pitch-domain':
      // deliberately NOT the core's "…is beyond the editable subset" phrasing:
      // the gate vocabulary has to be distinguishable from the syntactic core's,
      // or "did the reason come from a gate?" stops being answerable
      return 'the pattern mixes numeric and note-name pitches'
    case 'irrational-onset':
      return 'an onset does not land on any step column'
    case 'resolution':
      return `the pattern needs more than ${MAX_STEPS} steps`
    case 'view-resolution':
      // The DOCUMENT is fine here and the magnification is not, so the sentence has
      // to blame the view rather than the pattern — a user who refined twice should
      // read this as "too far in", not as "your pattern is unsupported" (#1055).
      return `showing this pattern that finely needs more than ${MAX_VIEW_STEPS} columns`
    case 'element-tiling':
      // The ELEMENT writer's own vocabulary, and currently never surfaced —
      // `refused` reports the leaf writer's gate, and the leaf writer has no
      // notion of tiling. Kept because it is what that writer actually means at
      // each of its refusal points, and because the two writers unify later;
      // deliberately not deleted into a vaguer shared label that would make its
      // refusals unreadable in the meantime.
      return 'the source elements do not line up with the columns the pattern plays'
    case 'no-leaf-anchor':
      return 'a played note has no source token of its own to edit'
    case 'note-crosses-bar':
      return 'a played note does not fit inside the bar it starts in'
    case 'edit-unsafe':
      return 'an edit here would not write back the pattern as shown'
    case 'view-unusable':
      return 'nothing in this view could be edited on its own'
    case 'no-finer-view':
      // Says nothing about the pattern being unsupported — the owner answered, it
      // just cannot draw this one any finer. Kept surface-neutral because the
      // total gate that raises it is generic over both models (#1132).
      return 'this pattern does not offer a finer view yet'
    case 'escaped-source':
      // Says what is observable in the STRING, not what only the reader could know.
      // For a double-quoted literal the backslash is ours — the transpiler reified
      // the cooked value and we sliced the document — while for a backtick it is
      // genuinely in the pattern. Both are true of this sentence; a sentence about
      // the editor and the engine disagreeing would be false of the second (#1254).
      return 'the source spells this content with a backslash escape, which mini-notation has no syntax for'
    case 'not-a-pattern':
      return 'unsupported mini-notation syntax'
  }
}

/**
 * The refusal a caller sees once every writer has declined.
 *
 * The reported gate is the LEAF projection's, and that choice is the whole point
 * of #990. The leaf writer is the GENERAL write-back — it needs only that each
 * played note own a disjoint source token — while the element re-emit it
 * supersedes additionally needs the source's top-level elements to tile the
 * played columns. So the leaf writer's obstruction is the answer to "what would
 * have to change for this pattern to be editable", and the element writer's is a
 * fact about a specialization.
 *
 * Measured over the 1500-unit corpus, reporting the DEEPEST gate across both
 * writers instead is actively misleading: the element writer checks for a
 * whole-cycle `<…>` BEFORE it reads a single hap, so 144 units reported a tiling
 * problem while the truth — read one line later by the leaf writer — was that 65
 * of them are the wrong surface entirely and 58 never repeat. A gate that fires
 * before the values are even read is not progress.
 *
 * When nothing reified there is no projection verdict worth having, and the
 * syntactic core's own message — which names the actual syntax — is kept.
 */
function refused<M>(
  surface: Surface,
  core: { ok: false; reason: string },
  gate: Gate,
  src: string,
  lookOnly?: M,
): ParseResult<M> {
  if (gate === 'not-a-pattern') {
    // ⚠ ONE EXCEPTION TO "KEEP THE CORE'S MESSAGE" (#1254). Nothing reified, so the
    // core's own message normally wins — it names the actual syntax. It cannot be the
    // better answer when the offending character is a backslash, because mini-notation
    // has no backslash syntax at all (asked of krill, which refuses one anywhere,
    // comments included) and because for a double-quoted literal the backslash is not
    // in the pattern the engine plays: the transpiler reifies `node.value`, the cooked
    // string, while we model the document slice. "Unsupported syntax" then points the
    // author at notation they did not write.
    //
    // `src` is REQUIRED rather than defaulted on purpose. A default would make this
    // invisible at every call site that forgot it, and the refusal would silently go
    // back to being anonymous — which is exactly the failure this gate exists to end.
    if (src.includes('\\')) {
      return { ok: false, reason: gateReason('escaped-source', surface), gate: 'escaped-source' }
    }
    return core
  }
  return { ok: false, reason: gateReason(gate, surface), gate, ...(lookOnly ? { lookOnly } : {}) }
}

/**
 * The three gates that refuse EDITING and nothing else (#1975). A look-only view can be
 * built for these alone, and the type is what holds that: a caller with some other gate
 * in hand has to narrow it first, so "which refusals get a view" is decided where the
 * refusal is made and cannot widen by accident.
 */
type EditGate = Extract<Gate, 'no-leaf-anchor' | 'edit-unsafe' | 'view-unusable'>

/**
 * What a look-only view says about itself, to the person looking at it (#1975).
 *
 * NOT `gateReason`, on purpose. That vocabulary was written for refusals nobody outside
 * a measurement ever read — the panel showed one generic hint — so it speaks in the
 * parser's terms ("no source token of its own"). This is the first sentence of a gate
 * that reaches a musician, and it has to be true in their terms: what is drawn is what
 * plays, and here is why a hit cannot be changed from the picture. The refusal's own
 * `reason` is left exactly as it was.
 */
function lookOnlyWhy(gate: EditGate, surface: Surface): string {
  const one = surface === 'grid' ? 'hit' : 'note'
  switch (gate) {
    case 'view-unusable':
      return `every ${one} here comes from the same piece of text, so none can be changed on its own`
    case 'no-leaf-anchor':
      return `some ${one}s here have no text of their own to change`
    case 'edit-unsafe':
      return `changing one ${one} here would not come back the way it is drawn`
  }
}

/**
 * THE LOOK-ONLY VIEW OF A GRID (#1975): what the pattern plays, laid out as the leaf
 * projection would have drawn it, handed back beside a refusal that is only about
 * EDITING — `no-leaf-anchor`, `edit-unsafe`, `view-unusable`. Those three all say the
 * same thing from different ends: the hits are real and land on columns, and no single
 * one can be written back on its own (`[hh ~]!16` is one `[hh ~]` played sixteen times;
 * a euclid generates its hits). "Cannot edit" was being answered as "cannot show".
 *
 * Built from the played columns ALONE — no anchors, no source of any kind — and marked
 * `lookOnly`, which every writer declines on. So this is not a fourth writer and
 * cannot become one: there is nothing here to write through, and the old whole-pattern
 * respell these patterns used to get (a rebuild from the cells) is exactly what the
 * mark forbids.
 *
 * The gate is passed through untouched. A layout the columns cannot hold comes back
 * with no view and the same gate as before.
 */
function gridLookOnly(
  gate: EditGate,
  perCycle: Onset[][],
  perBar: number,
  bars: number,
): { ok: false; gate: Gate; lookOnly?: StepGridModel } {
  const played = columnsFromOnsets(perCycle, perBar, bars)
  if (played === null) return no(gate)
  // EVERY HIT MUST BE DRAWN, or this is not a view of what plays. A cell shows a sound
  // once per column (`lanesFromCells`), so two hits of one sound in one column share a
  // cell — which draws both only when they are the same length. Where they differ
  // (`[C G], <D Fb B C A>*[0.5,2]` plays a one-column D and a four-column D together)
  // one hit's length would be missing, and an editable grid's display rule is not a
  // licence for a look-only one to leave a hit out. Asked of `occ`, the column's truth.
  for (const o of perCycle.flat()) {
    for (const hit of o.occ) {
      const shown = o.occ.find((x) => x.token === hit.token)
      if (shown && Math.abs((shown.dur ?? 0) - (hit.dur ?? 0)) > 1e-9) return no(gate)
    }
  }
  return {
    ok: false,
    gate,
    lookOnly: {
      steps: perBar * bars,
      ...(bars > 1 ? { bars } : {}),
      lanes: lanesFromCells(played),
      lookOnly: { gate, reason: lookOnlyWhy(gate, 'grid') },
    },
  }
}

/**
 * What a pattern plays, bar by bar: the probed cycles up to the period they repeat
 * at, or the refusal (#1931). The four projections share it and differ only in how a
 * cycle's onsets are read, how two cycles are compared, and the bar cap.
 *
 * The period is the area's one rule, `detectPeriod` (ir/songAnalysis.ts — the Song
 * view asks it too): the smallest `p` at which every probed cycle equals the one `p`
 * ahead, with two full repeats seen. A pattern that varies at cycle 2p is not
 * period-p, and bar-expanding it would silently drop the divergence.
 *
 * A pattern that plays nothing is refused as `no-note-content` BEFORE the period is
 * asked: every silent cycle trivially repeats, and saying so would read as a period
 * rather than as nothing to show. A period above `cap` reads as no period.
 */
function playedBars<T>(
  pat: MiniPattern,
  read: (pat: MiniPattern, cycle: number) => Read<T[]>,
  key: (onsets: T[]) => string,
  cap: number,
): { ok: true; perCycle: T[][] } | { ok: false; gate: Gate } {
  const cycles: T[][] = []
  for (let c = 0; c < PERIOD_PROBE; c++) {
    const cc = read(pat, c)
    if (!cc.ok) return cc
    cycles.push(cc.onsets)
  }
  if (cycles.every((c) => c.length === 0)) return no('no-note-content')
  const period = detectPeriod(cycles.map(key))
  if (period === null || period > cap) return no('unstable-period')
  return { ok: true, perCycle: cycles.slice(0, period) }
}

/**
 * True when the whole pattern is a single `<…>` alternation element (`<a b>*8`,
 * `<a b c>`). Those belong to the alternation path (bars, #920) — one region per
 * bar so an edit stays byte-local — not to the flat projection, which owns the
 * whole `<…>` as one span and would FLATTEN it on edit, losing the compact form
 * (caught by the edit-locality gate). Decline and leave it to the alternation
 * work rather than offer a grid that isn't byte-local per bar.
 */
function isWholeAlternation(src: string): boolean {
  let ast: MiniGroup
  try {
    ast = miniShape(src)
  } catch {
    return false
  }
  if (ast.alignment !== 'fastcat') return false
  if (ast.children.length !== 1) return false
  const only = ast.children[0]
  if (only.kind !== 'element') return false
  const inner = only.content
  return inner.kind === 'group' && inner.alignment === 'polymeter_slowcat'
}

/** top-level fastcat elements from krill: byte span + unit weight, or null */
function topLevelSpans(src: string): ElementSpan[] | null {
  let ast: MiniGroup
  try {
    ast = miniShape(src)
  } catch {
    return null
  }
  if (ast.alignment !== 'fastcat') return null
  const out: ElementSpan[] = []
  for (const el of ast.children) {
    if (el.kind !== 'element' || !el.span) return null
    const weight = el.reps > 1 ? el.reps : el.weight
    if (!Number.isInteger(weight) || weight < 1) return null
    out.push({ start: el.span.start, end: el.span.end, weight })
  }
  return out
}

/**
 * A leaf atom's OWN source span, in `src`-space (offsets into the inner mini
 * string), read from a hit's locations. Strudel's `mini()` calls
 * `.withLoc` on each atom pure (`mini.mjs` `patternifyAST` → `pattern.mjs`
 * `withLoc`), so a nested atom carries its own token span, not its container's:
 * `s("a [b c]")` gives the `c` hap the span of `c`, never `[b c]`. This is the
 * anchor #986 P1 writes back through — span surgery at the note's own leaf loc
 * instead of the top-level element span — so structures with internal structure
 * (`[a [b c]]`, `[a b]*2`) stop breaking the cell↔leaf-span bijection.
 *
 * Lives in `model.ts` (the write-back models carry it); re-exported here because
 * this is where the haps are read.
 */
export type { LeafSpan }

/**
 * The span a hit is anchored on: the text of the NOTE that wrote it, in `src`-space —
 * the one written atom among the places Strudel lists for the hit, as the adapter's
 * joined tree settles it (`strudelMini/joined.ts`). `null` when the hit has no single
 * written note: it named no place, or none that is a note, or more than one.
 *
 * It was once the FIRST place Strudel lists (#986). That is the note for `*2` and a
 * euclid, but `sd:2`, `0 .. 3` and `{a b c}%4` list the op's argument first, and a token
 * followed by a newline or a tab has a place one longer than its text (measured for
 * #1973: 2,192 of 52,498 corpus hits were not the note). The leaf writer replaces the
 * bytes of this span, so a span on an argument is a write onto the wrong text; the
 * admission checks turned those patterns away, which is why none ever opened.
 * Verified token-for-token against krill in `leafLoc.test.ts`.
 */
function noteSpan(atom: MiniAtom | null): LeafSpan | null {
  return atom ? { start: atom.span.start, end: atom.span.end } : null
}

/**
 * The source text a hap's `:`-variant value was written as (#1019).
 *
 * krill lowers `bd:3` to the ARRAY `["bd", 3]` — NOT a string and NOT the `{s,n}`
 * object our readers were first written against, which only appears once a CONTROL
 * has resolved it (`s("bd:3")`). A bare mini string — exactly what `parseStepGrid`
 * and `parsePianoRoll` receive — never produces that object.
 *
 * Joining on `:` is not a new rule, it is the exact inverse of the ONE construction
 * path: the `tail` op is the only thing that builds an array value, and it ACCRETES
 * (`@strudel/mini/mini.mjs:50-52` — `Array.isArray(a) ? [...a, b] : [a, b]`), so
 * `bd:3:0.5` arrives as `["bd", 3, 0.5]` and rejoins to its own source text. That is
 * what makes the token safe to write straight back out, since `cellToken` emits
 * atoms verbatim.
 *
 * Members can be strings as well as numbers — `piano:x:.5` is real corpus notation,
 * so this is not an integer-index rule.
 *
 * Returns null for any array that is not that shape, so an unfamiliar value is
 * REFUSED rather than stringified into something that would not re-parse.
 *
 * BOTH guards are DEFENSIVE, measured rather than assumed: over the 10183
 * array-valued haps the corpus plays across a 24-cycle window, **0** are shorter
 * than 2 members and **0** carry a non-scalar member. That follows from the
 * construction — `tail` seeds at `[a, b]` and only ever appends — so neither can
 * occur today. They are kept because the failure they prevent is silent: joining an
 * unexpected member would emit `[object Object]` into the document, and a guard
 * whose absence would be invisible is exactly the one to keep after measuring that
 * it does not fire. What is NOT defensive is the `join` covering the whole array:
 * 1372 of those haps have three members, so a `v[0] + ':' + v[1]` naming would
 * silently truncate `sd:0:0.5` to `sd:0`.
 */
export function tailToken(v: unknown[]): string | null {
  if (v.length < 2) return null
  if (!v.every((p) => typeof p === 'string' || typeof p === 'number')) return null
  return v.join(':')
}

/**
 * The sample a lane token names: the head of the tuple `tailToken` joined (#1941).
 *
 * Strudel registers `s` as the tuple `['s', 'n', 'gain']` (`@strudel/core`
 * controls.mjs, `registerControl(['s', 'n', 'gain'], 'sound')`), so `bd:3` plays
 * sample `bd`, index 3, and `bd:5:0.7` adds a gain. Krill builds that tuple: its
 * `:` operator starts an array and appends to it (mini.mjs, `case 'tail'`), and no
 * member can contain a `:`, because `step_char` does not admit one (krill.pegjs).
 * So the text before the first `:` IS the tuple's head, for every token
 * `tailToken` can produce, and a token with no `:` is its own sample name.
 *
 * It answers only "which sample would this play as an `s` value". A token in a
 * lane that is not a sound (`G:major`, `0.5:0.01:0.5`) still has a head, and it
 * is the caller's lookup that decides whether that head means anything.
 */
export function sampleNameOf(token: string): string {
  const colon = token.indexOf(':')
  return colon === -1 ? token : token.slice(0, colon)
}

/**
 * ONE hap that sounded at a column — the whole of what the engine said about it.
 *
 * WHY THIS EXISTS RATHER THAN MORE PARALLEL ARRAYS (#1034). The column used to be
 * three index-aligned arrays filled inside one guard, `if (!atoms.includes(token))`.
 * That predicate is about IDENTITY — a cell shows a sound once, which is true — and
 * it was silently deciding what the reader RETAINS:
 *
 *     "bd*2, sd"   atoms=["bd","sd"]  spans=[{0,2},{6,8}]  durs=[0.5,1.0]
 *     "bd*2, bd"   atoms=["bd"]       spans=[{0,2}]        durs=[0.5]   ← part B gone
 *
 * Same stack, same two haps; the only difference is whether the two tokens happen
 * to be spelled alike. Duration was the second axis caught in that guard and the
 * SPAN — the write-back anchor — was the first, collapsing there since before
 * duration was read at all. Neither was noticed at the time, because parallel
 * arrays make "stay index-aligned" the invariant the code advertises, so adding a
 * fourth `push` beside the others preserves it while importing a collapse rule
 * that was only ever justified for `atoms`.
 *
 * One array of records cannot go out of alignment, and leaves no guard for the
 * next axis to be added inside — gain (#1027) and `part` (#1028) become fields
 * here, with no predicate between them and the reader.
 */
export interface Occurrence {
  token: string
  /** this note's OWN leaf span — the write-back anchor; `null` where none was carried */
  span: LeafSpan | null
  /**
   * How long this note SOUNDS, in cycles. `null` means NOT KNOWN — a synthetic
   * onset predicted by an edit-safety check rather than read from the engine.
   * Never `0` for "unknown": a later consumer reads `0` as a zero-length note.
   */
  dur: number | null
}

export interface Onset {
  pos: number
  /**
   * Every hap that sounded at this column, in engine arrival order, nothing
   * collapsed. This is the column's TRUTH; the three arrays below are views of it.
   */
  occ: Occurrence[]
  /**
   * DERIVED from `occ`: distinct tokens, first occurrence wins — what the cell
   * DISPLAYS. A grid cell shows a sound once, so this one really is deduped.
   *
   * `atoms`/`spans`/`durs` are derived by literally the loop that used to build them
   * in place, so every consumer sees byte-identical values.
   *
   * P4a predicted they would RETIRE in P4b as consumers moved to `occ`. They did not,
   * and the reason is worth keeping: what a CELL needs is exactly this — the display
   * view, one length and one anchor per distinct sound, first occurrence winning.
   * Retiring these would mean re-deriving that dedupe at every call site instead of
   * once here. `occ` is still the column's truth and the only thing that keeps a
   * second note of the same name; these three stay as its display projection. The
   * place where one column's two same-named notes stop being a choice at all is one
   * internal note representation for both surfaces (#1032).
   */
  atoms: string[]
  /** DERIVED from `occ`: leaf span of each atom's FIRST occurrence */
  spans: (LeafSpan | null)[]
  /**
   * DERIVED from `occ`: how long each atom's FIRST occurrence SOUNDS, in cycles
   * (#1010 P4a). `null` where the onset is synthetic and no length is known.
   *
   * The grid used to read only `whole.begin` and drop this — its hap type did not
   * even declare `end`. That is where every duration loss starts: a reader that
   * never picks the axis up leaves the writer nothing to preserve, so a re-emit
   * re-derives each length at the grid's resolution and `[hh ~]!16` comes back as
   * sixteen notes of twice the length. The roll has always kept it
   * (`whole.end - whole.begin`, `readRollNotes`) and has never produced one of
   * these losses; this closes that asymmetry at the source.
   *
   * Same units as `pos` — cycle-relative — so a column's width in cycles is
   * directly comparable and no caller has to know the grid's resolution to read it.
   */
  durs: (number | null)[]
}

/**
 * The DISPLAY view of a column: distinct tokens in arrival order, first occurrence
 * winning the span and the length.
 *
 * This is verbatim the loop that used to populate the three arrays in place —
 * kept identical on purpose, so that moving the truth into `occ` cannot move a
 * single downstream value. The difference is entirely in what is now RETAINED
 * alongside it: the dedupe still decides what the cell shows and no longer
 * decides what the reader keeps.
 */
function deriveColumn(occ: Occurrence[]): Pick<Onset, 'atoms' | 'spans' | 'durs'> {
  const atoms: string[] = []
  const spans: (LeafSpan | null)[] = []
  const durs: (number | null)[] = []
  for (const o of occ) {
    if (atoms.includes(o.token)) continue
    atoms.push(o.token)
    spans.push(o.span)
    durs.push(o.dur)
  }
  return { atoms, spans, durs }
}

/**
 * Read what a step-grid pattern PLAYS, one cycle, as onset columns — inherited
 * from Strudel (`miniPattern(...).hits(cycle)`), never re-derived here. The value the
 * engine yields IS the ground truth for "what sound fires when"; the display
 * token is `s` (+`:n` when a sample index rides along). Returns null when the
 * pattern isn't a plain sound grid the view can show — a numeric value (that is
 * the roll's, not the grid's), a `.gain`/signal-only hap, or a query that throws.
 */
export function gridOnsets(pat: MiniPattern, cyc: number): Onset[] | null {
  const r = readGridOnsets(pat, cyc)
  return r.ok ? r.onsets : null
}

/**
 * `gridOnsets`, saying WHY when it declines (#990).
 *
 * The distinction the plain `null` could not make, and the one that dominates
 * every refusal count: a pattern that plays NUMBERS is not a broken grid, it is
 * the piano roll's (`wrong-surface`), while a pattern whose haps carry params or
 * a signal has nothing placeable at all (`no-note-content`). Reporting both as
 * one failure is what made a drum pattern politely declining the roll read as an
 * editability gap.
 */
/* exported for `gridOnsetDuration.test.ts` — the axis-dropping boundary is worth
   being able to interrogate directly; see that file for why. */
export function readGridOnsets(pat: MiniPattern, cyc: number): Read<Onset[]> {
  // A hit's `end` is read for `Onset.durs` (#1010 P4a). It was once absent from the hap
  // type declared here, which is the literal form the dropped-duration defect took:
  // the axis could not be read because it was not declared. The type is the adapter's
  // `MiniHit` now, one shape for the grid and the roll — read here as `JoinedHit.hit`,
  // beside the note that wrote it (#1974).
  let haps: JoinedHit[]
  try {
    haps = joinedCycle(pat, cyc).hits
  } catch {
    return no('no-note-content')
  }
  const byCol = new Map<number, Occurrence[]>()
  for (const { hit: h, atom } of haps) {
    // A bare mini string reifies to raw token VALUES (`"bd"`), not superdough
    // params — that is what `parseStepGrid` receives (the inner string of
    // `s("…")`). THREE shapes arrive, not two: a string token, a number, and an
    // ARRAY for a `:`-variant (`bd:3` → `["bd", 3]`). The `{s,n}` object is a
    // fourth, and only a CONTROL produces it (`s("bd:3")`) — a bare mini never
    // does, so that branch is for callers reifying in sound context.
    const v = h.value as string | number | unknown[] | { s?: unknown; n?: unknown } | null
    let token: string
    if (typeof v === 'string') token = v
    else if (typeof v === 'number') return no('wrong-surface') // a pitch, not a sound
    else if (Array.isArray(v)) {
      // a `:`-variant — krill's ARRAY value (#1019). Checked BEFORE the object
      // branch, because `typeof [] === 'object'` and an array has no `.s`, so it
      // used to fall through to `no-note-content` and take the whole pattern with
      // it: every `bd:3` in the corpus was invisible to both derived projections.
      const t = tailToken(v)
      if (t === null) return no('no-note-content')
      token = t
    } else if (v && typeof v === 'object' && typeof v.s === 'string') {
      token = v.s + (v.n != null ? ':' + String(v.n) : '')
    } else return no('no-note-content')
    if (NUMERIC.test(token)) return no('wrong-surface') // a bare number is the roll's
    const pos = h.begin.valueOf() - cyc
    const key = Math.round(pos * ONSET_GRID)
    // EVERY hap is recorded, unconditionally (#1034). The note's own leaf loc is
    // the #986 write-back anchor and its length is read the way the roll reads it,
    // so the two surfaces cannot disagree about what a note's length IS.
    //
    // This used to sit behind `if (!cell.atoms.includes(token))`. A `*n`/euclid
    // element yields the same leaf at several columns (N cells, one span), and a
    // `,`-stack lands two leaves on ONE column — and where those two leaves spell
    // the same token, that guard dropped the second one entirely, span and length
    // together, picking the survivor by hap arrival order. The dedupe is a display
    // rule and now applies only where display is derived (`deriveColumn`).
    const cell = byCol.get(key) ?? []
    cell.push({
      token,
      span: noteSpan(atom),
      dur: h.end.valueOf() - h.begin.valueOf(),
    })
    byCol.set(key, cell)
  }
  return {
    ok: true,
    onsets: [...byCol.entries()].map(([k, occ]) => ({
      pos: k / ONSET_GRID,
      occ,
      ...deriveColumn(occ),
    })),
  }
}

const onsetKey = (o: Onset[]): string =>
  JSON.stringify(o.map((x) => [Math.round(x.pos * ONSET_GRID), [...x.atoms].sort()]).sort())

/**
 * The inherited fallback for the step grid (#922): when the syntactic parse
 * refuses, PROJECT the pattern's haps onto a cell grid instead of modelling its
 * syntax. Any pattern that plays a stable, rational, single-cycle grid becomes
 * editable — nested groups, `[…]`-with-ops, a static `<…>*n` — regardless of how
 * the syntax nests, because the grid shows what it PLAYS.
 *
 * The write-back is unchanged: the top-level element spans (krill) tile the
 * source, so `serializeStepGrid`'s span surgery copies unedited elements verbatim
 * and re-emits only the edited one. Returns null (keep the caller's refusal) when
 * the pattern isn't a static single-cycle sound grid — a `,`-stack, a per-cycle
 * alternation (that is the bars path, and projecting cycle 0 would DROP the other
 * cycles), a blow-up past the step ceiling, or spans that don't tile.
 *
 * Deliberately NOT exported: no caller may pick a writer directly, because the
 * selection ORDER is the contract ([[PK58]]) and every decline in it re-routes
 * work to the next writer. Anything outside this module that needs the derived
 * chain asks `projectStepGridDerived`, which is that order.
 */
function projectStepGrid(src0: string, viewScale: ViewScale = UNREFINED): Projection<StepGridModel> {
  const src = src0.trim()
  if (src === '') return no('not-a-pattern')
  let pat: MiniPattern
  try {
    pat = miniPattern(src)
  } catch {
    return no('not-a-pattern')
  }
  // A whole-cycle `<…>` is not the FLAT projection's to take — owning it as one
  // region would re-spell the whole pattern on the first edit. It is still worth
  // projecting, just bar-wise, with the branches as regions (#930 phase B). A
  // `<…>` carrying trailing ops (`<a b>*2`) has no branch tiling to write back
  // through, so it stays refused.
  const whole = isWholeAlternation(src) ? unwrapAlternation(src) : null
  if (isWholeAlternation(src) && whole === null) return no('element-tiling')
  // What it PLAYS, cycle by cycle, and the period it repeats at. A pattern that
  // varies across cycles is no longer refused (#930): each cycle becomes a bar and
  // the source stays the single cycle the user wrote, so an edit re-emits one
  // element as `<b0 b1 …>` and leaves every other byte alone.
  const probed = playedBars(pat, readGridOnsets, onsetKey, MAX_PROJECT_BARS)
  if (!probed.ok) return probed
  const perCycle = probed.perCycle
  const bars = perCycle.length
  // a whole-cycle `<…>`: bars are its branches, not a flat sequence's columns. It
  // carries the scale as of #1117 — the branch widths do come from the alternation,
  // but the columns WITHIN a branch come from `perBar`, and that is what a refine
  // multiplies. `projectAltBars` decides ownership at the identity value first.
  if (whole !== null) {
    return bars > 1 ? projectAltBars(src, whole, perCycle, bars, viewScale) : no('element-tiling')
  }
  const spans = topLevelSpans(src)
  if (!spans) return no('element-tiling')
  const totalWeight = spans.reduce((s, e) => s + e.weight, 0)
  // element boundaries (cumulative weight) must land on integer columns too, or
  // the regions can't tile the grid
  const bounds: number[] = []
  let accW = 0
  for (const e of spans) {
    bounds.push(accW / totalWeight)
    accW += e.weight
  }
  // One column resolution shared by every bar: the alt writer indexes a region as
  // `from + b * perBar`, so bars that disagreed on width could not be strided.
  let documentPerBar = 1
  for (const x of [...perCycle.flat().map((o) => o.pos), ...bounds]) {
    const d = denom(x)
    if (d === 0) return no('irrational-onset')
    documentPerBar = lcm(documentPerBar, d)
  }
  // THE DOCUMENT'S OWN ceiling, asked of the UNSCALED quantity: `MAX_STEPS` guards a
  // combinatorial blow-up in the notation, which a view refine does not cause (#1055).
  if (documentPerBar * bars > MAX_STEPS) return no('resolution')
  // …and the VIEW's ceiling, asked of what would actually be drawn. At `UNREFINED`
  // this cannot fire — the line above already bounded the document at 64 and
  // `MAX_VIEW_STEPS` is 256 — which is what makes this parameter inert until Phase 4
  // writes a scale other than 1.
  if (!viewScaleFits(documentPerBar, bars, viewScale)) return no('view-resolution')
  const perBar = documentPerBar * viewScale
  if (perBar % totalWeight !== 0) return no('element-tiling')
  const divPerUnit = perBar / totalWeight
  const cells = columnsFromOnsets(perCycle, perBar, bars)
  if (cells === null) return no('irrational-onset')
  const lanes = lanesFromCells(cells)

  if (bars === 1) {
    // The single-cycle projection, unchanged: a flat `source` the span writer
    // splices. Kept as its own branch so #930 cannot move what #922 already ships.
    const parts = singlePart(src, spans, divPerUnit, perBar, gridContent(tokensOf(cells)))
    if (!parts) return no('element-tiling')
    const model: StepGridModel = {
      steps: perBar,
      ...(viewScale === UNREFINED ? {} : { viewScale }),
      lanes,
      source: { prefix: '', suffix: '', parts },
    }
    const cols0 = parts[0].regions.map((r) => r.from)
    if (!projectionEditSafe(model, perBar, 1, perCycle, cols0)) return no('edit-unsafe')
    return { ok: true, model }
  }

  // Bar-expanded: the SAME source shape the `<…>`-as-element path builds (#920), so
  // `spliceAltGrid` writes it back with no writer change — each single-cycle element
  // owns a within-bar column span and remembers what it showed in each bar.
  const regions = buildAltRegions<GridCells>(src, spans, divPerUnit, perBar, (from, to) =>
    Array.from({ length: bars }, (_, b) =>
      tokensOf(cells.slice(from + b * perBar, to + b * perBar)).map((c) => [...new Set(c)]),
    ),
  )
  if (!regions) return no('element-tiling')
  const model: StepGridModel = {
    steps: perBar * bars,
    bars,
    ...(viewScale === UNREFINED ? {} : { viewScale }),
    lanes,
    altSource: { perBar, bars, div: divPerUnit, regions },
  }
  // each region is a within-bar span, so it is probed once per bar
  const cols = regions.flatMap((r) =>
    Array.from({ length: bars }, (_, b) => b * perBar + r.from),
  )
  if (!projectionEditSafe(model, perBar, bars, perCycle, cols)) return no('edit-unsafe')
  return { ok: true, model }
}

/**
 * A whole-cycle `<…>` the syntactic alternation path refused (#930 phase B).
 *
 * The flat projection declines these because it would own the entire `<…>` as ONE
 * region and re-spell all of it on the first edit. Projected as BARS the shape is
 * right: the alternation's own branches are the regions, one per bar, exactly as
 * `gridFromAlternation` lays them out — so an edit rewrites the branch it touched
 * and every other branch rides back byte-for-byte.
 *
 * Content still comes from what the pattern PLAYS, which is the point: the branch
 * bytes may be syntax the model cannot parse (a nested group, a euclid with ops),
 * and they never have to be parsed — only preserved.
 */
function projectAltBars(
  src: string,
  inner: string,
  perCycle: Onset[][],
  bars: number,
  viewScale: ViewScale = UNREFINED,
): Projection<StepGridModel> {
  const innerSrc = inner.trim()
  const spans = topLevelSpans(innerSrc)
  if (!spans) return no('element-tiling')
  // one top-level element per BAR — a branch repeated `!n` claims n of them, and
  // the bar count has to come out exactly or the branches don't line up with cycles
  if (spans.reduce((s, e) => s + e.weight, 0) !== bars) return no('element-tiling')
  let documentPerBar = 1
  for (const o of perCycle.flat()) {
    const d = denom(o.pos)
    if (d === 0) return no('irrational-onset')
    documentPerBar = lcm(documentPerBar, d)
  }
  // THE DOCUMENT'S OWN ceiling, asked of the UNSCALED quantity: a refine expands
  // nothing in the notation, so `MAX_STEPS` is the wrong question about a view (#1055).
  if (documentPerBar * bars > MAX_STEPS) return no('resolution')
  // …and the VIEW's own, asked of what would be drawn.
  if (!viewScaleFits(documentPerBar, bars, viewScale)) return no('view-resolution')
  const perBar = documentPerBar * viewScale

  // ⚠ NO IDENTITY-VALUE PRE-PASS HERE, and that is a decision rather than an omission.
  // Ownership at this seam must be settled at the parameter's identity value
  // ([[PV262]], [[P418]]) — but it already is, one layer up: `projectStepGridDerived`
  // picks the owner from `projectStepGrid(mini)` at `UNREFINED` and only then re-asks
  // that owner for the refined view. Repeating the rule inside each path is the
  // per-path shape [[P414]] argues against, and it was MEASURED inert here: building
  // the identity model first and gating on it changed no verdict on the corpus, and
  // break-testing it moved nothing at all. The reason is worth recording — the span
  // writer copies UNEDITED regions verbatim, so `serializeStepGrid(model) === src`
  // holds at every scale, which makes the byte round-trip gate below scale-insensitive
  // rather than scale-fatal as it first appears.
  const cells = columnsFromOnsets(perCycle, perBar, bars)
  if (cells === null) return no('irrational-onset')
  // a branch spans one bar's worth of columns, so the per-unit division IS perBar
  const parts = singlePart(innerSrc, spans, perBar, perBar * bars, gridContent(tokensOf(cells)))
  if (!parts) return no('element-tiling')
  const model: StepGridModel = {
    steps: perBar * bars,
    bars,
    ...(viewScale === UNREFINED ? {} : { viewScale }),
    lanes: lanesFromCells(cells),
    source: {
      parts,
      prefix: '<' + (/^\s*/.exec(inner)?.[0] ?? ''),
      suffix: (/\s*$/.exec(inner)?.[0] ?? '') + '>',
    },
  }
  // regions already sit one per bar, so each is probed once, at its own start
  const cols = parts[0].regions.map((r) => r.from)
  if (!projectionEditSafe(model, perBar, bars, perCycle, cols)) return no('edit-unsafe')
  // the writer must reproduce the user's bytes before we offer the view at all
  if (serializeStepGrid(model) !== src.trim()) return no('edit-unsafe')
  return { ok: true, model }
}

/**
 * Marker sounds/pitches for the edit self-verify — improbable in real content, and
 * (the part that bit us) a SINGLE ATOM wherever they land.
 *
 * The probe is spliced into the middle of a pattern, so it has to survive being
 * lexed next to its neighbours. `__stave_probe__` did not: `_` is mini's elongation
 * token, so its two leading underscores bound to the element BEFORE it — krill reads
 * `- __stave_probe__ - sd` as `-` with weight 3 followed by an atom `stave_probe__`.
 * The probe then compared a 6-slot sequence against the 4-slot original-plus-marker,
 * failed, and the projection declined `edit-unsafe` — 45 perfectly editable patterns
 * refused for a property of the marker (#994). It misfired only away from the start
 * of a string, where there is no preceding element to elongate, which is why the
 * first column of every pattern probed clean and nothing looked systematically wrong.
 *
 * So the constraint is the GRAMMAR's, not the sample library's: no character that
 * mini gives a meaning to. The probe-token contract in `krillContract.test.ts`
 * holds that property against krill itself, in leading and non-leading position,
 * so the next distinctive-looking marker cannot bring the bug back.
 */
export const PROBE_SOUND = 'zzstaveprobezz'

/**
 * The projection may only OFFER a grid the writer can reproduce under edit. Probe
 * every source region — overlay a marker in its first column, serialize, re-query
 * — and require the haps to be exactly the originals plus that marker. Declines
 * the patterns whose span re-emit breaks (a `_` sustain whose span ate the
 * separator merges tokens on edit — the #904 class), so the projection never
 * shows a grid that would corrupt on the first click. Uses the REAL writer and
 * the REAL engine, so it can't drift from either.
 */
function projectionEditSafe(
  model: StepGridModel,
  perBar: number,
  bars: number,
  base: Onset[][],
  probeCols: number[],
): boolean {
  // Columns are ABSOLUTE model columns, supplied by the caller, because the two
  // bar-expanded shapes index differently: an alt-element source's regions are
  // within-bar spans repeated across bars, a whole-alternation's regions are the
  // branches and already sit one per bar.
  for (const col of probeCols) {
    const b = Math.floor(col / perBar)
    const t = (col % perBar) / perBar
    const lanes = model.lanes.map((l) => ({ ...l, cells: [...l.cells] }))
    let probe = lanes.find((l) => l.sound === PROBE_SOUND)
    if (!probe) {
      probe = { sound: PROBE_SOUND, cells: Array<StepCell>(perBar * bars).fill(false) }
      lanes.push(probe)
    }
    // The probe's own length is one column: it is written as a plain cell token, and
    // the check only asks which sounds come back at which position. Nothing reads a
    // probe's duration today; when the printer starts to (P4c) one column is what it
    // should spell.
    probe.cells[col] = cellOn()
    const out = serializeStepGrid({ ...model, lanes })
    if (out == null) return false
    let edited: MiniPattern
    try {
      edited = miniPattern(out)
    } catch {
      return false
    }
    // Every bar must come back unchanged except the probed one — an edit that
    // leaks into a neighbouring bar is exactly the silent multi-cycle data loss
    // this projection exists to avoid.
    const expectedFor = (bb: number): Onset[] => {
      const want = base[bb]
      if (bb !== b) return want
      const hit = want.find((o) => Math.abs(o.pos - t) < 1e-9)
      // Synthetic probe onsets — only `onsetKey` (pos + atoms) reads these. The
      // probe atom has no source span and no length that was ever played, so both
      // are `null` = NOT KNOWN. The duration used to be a placeholder `0`, which a
      // consumer reading `durs` later would take for a zero-length note (#1034).
      //
      // The display arrays are written out here rather than derived from `occ`,
      // because this appends the probe UNCONDITIONALLY — a pattern that already
      // plays `PROBE_SOUND` gets it twice, and `onsetKey` sorts atoms without
      // deduping, so deriving would silently change the key for that one case.
      const probeOcc: Occurrence = { token: PROBE_SOUND, span: null, dur: null }
      const out2 = want.map((o) =>
        o === hit
          ? {
              pos: o.pos,
              occ: [...o.occ, probeOcc],
              atoms: [...o.atoms, PROBE_SOUND],
              spans: [...o.spans, null],
              durs: [...o.durs, null],
            }
          : o,
      )
      if (!hit) {
        out2.push({ pos: t, occ: [probeOcc], atoms: [PROBE_SOUND], spans: [null], durs: [null] })
      }
      return out2
    }
    for (let bb = 0; bb < bars; bb++) {
      const got = gridOnsets(edited, bb)
      if (got === null) return false
      if (onsetKey(got) !== onsetKey(expectedFor(bb))) return false
    }
    // …and it must still REPEAT at `bars`, or the grid the view shows stops being
    // true one cycle past its own width. Cycle `bars` is cycle 0 again, probe and
    // all, so it is checked against bar 0's expectation rather than its base.
    const wrap = gridOnsets(edited, bars)
    if (wrap === null) return false
    if (onsetKey(wrap) !== onsetKey(expectedFor(0))) return false
  }
  return true
}

/* ── leaf-anchored projection: write-back without a printer (#986) ─ */

/**
 * Where each REST sits — the span of the `~` (or `-`) occupying a column, per column.
 *
 * WHY THIS IS NOT PART OF `leafAnchors`. An anchor is an atom the grid SHOWS, and
 * lanes are built from the anchor set; a rest shows nothing and must not become a
 * lane. Rests are also invisible to `leafAnchors`'s input by construction — it reads
 * ENGINE ONSETS, and a rest produces no hap, which is exactly why an add landing on a
 * `~` was refused for want of a span (#1154). So they are indexed alongside, in their
 * own field, and consumed by the one write branch that needs them.
 *
 * THE COLUMN IS OBSERVED, NEVER COMPUTED. Working out which column a `~` occupies from
 * the AST would mean re-deriving Strudel's timing — weights, `*n`, nesting, alternation
 * — in our own arithmetic, which is the hand-rolled-grammar mistake this whole file
 * exists to have stopped making. Instead each rest is replaced by a DISTINCT sounding
 * sentinel and the engine is asked where it lands. The engine decides; we read.
 *
 * All rests are probed in ONE substituted string rather than one probe each, so this
 * costs the same `bars` queries however many rests a unit has.
 *
 * Returns nulls throughout (not a refusal) whenever anything is unclear — an
 * unparseable probe, a sentinel that did not sound, two rests claiming one column. A
 * missing rest span only means the pre-#1154 refusal still stands for that column, so
 * being wrong in this direction costs reach and never correctness.
 */
function restSpansByColumn(
  src: string,
  perBar: number,
  bars: number,
): (LeafSpan | null)[] | null {
  let ast: MiniGroup
  try {
    ast = miniShape(src)
  } catch {
    return null
  }
  // Collect every rest atom's own tight span. The ELEMENT's recorded start is
  // untrustworthy — krill's padding lands on either side by syntax — so the token is
  // re-found from the first non-space at or after it, and its length is the atom's own
  // text. (Counted from the element, as it always was, and checked against the text.)
  const spans: LeafSpan[] = []
  const walk = (node: MiniGroup['children'][number] | MiniGroup): void => {
    if (node.kind === 'group') {
      for (const child of node.children) walk(child)
      return
    }
    const inner = node.content
    if (inner.kind === 'group') {
      walk(inner)
      return
    }
    if (isRest(inner) && node.span) {
      let s = node.span.start
      while (s < src.length && /\s/.test(src[s])) s++
      if (src.slice(s, s + inner.text.length) === inner.text) spans.push({ start: s, end: s + inner.text.length })
    }
  }
  walk(ast)
  if (spans.length === 0) return null

  // One probe string, each rest a distinct sentinel. Substituted back-to-front so the
  // earlier spans keep their offsets.
  const SENTINEL = (i: number): string => `qzrest${i}`
  let probeSrc = src
  const ordered = [...spans].sort((a, b) => b.start - a.start)
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i]
    probeSrc = probeSrc.slice(0, s.start) + SENTINEL(i) + probeSrc.slice(s.end)
  }
  let probePat: MiniPattern
  try {
    probePat = miniPattern(probeSrc)
  } catch {
    return null
  }
  // The FORWARD map (rest → the columns it sounds in) is what the engine tells us and
  // is reliable. The map the writer needs is the INVERSE, and that is only a function
  // where exactly one rest reaches a column — so claims are collected per column and
  // resolved afterwards, never first-one-wins.
  const size = perBar * bars
  const claims: Array<Set<number>> = Array.from({ length: size }, () => new Set())
  const located = new Set<number>()
  for (let b = 0; b < bars; b++) {
    const read = readGridOnsets(probePat, b)
    if (!read.ok) return null
    for (const o of read.onsets) {
      const c = b * perBar + Math.round(o.pos * perBar)
      if (c < 0 || c >= size) continue
      for (const atom of o.atoms) {
        const m = /^qzrest(\d+)$/.exec(atom)
        if (!m) continue
        const idx = Number(m[1])
        if (idx >= ordered.length) continue
        claims[c].add(idx)
        located.add(idx)
      }
    }
  }
  // ── Two guards, and their measured cost is recorded because only one of them has
  //    a price. Both were break-tested against the full corpus sweep (#1154).
  //
  // (a) EVERY rest must have been located, or the inverse map is built from a partial
  //     picture: a column can look unambiguous while an unseen rest also sits there.
  //     A rest inside an alternation arm that does not sound within the detected
  //     period is exactly such a rest.
  //     MEASURED: removing this changes NOTHING on the corpus — same 72 restored, same
  //     zero losses. It is kept as DEFENSIVE, not as a fix for an observed defect, and
  //     it is honest to say so: it costs no reach, and the hazard it names is real and
  //     silent. Do not cite it as the thing that fixed a bug; it is not.
  if (located.size !== ordered.length) return null
  // (b) A column reached by TWO different rests cannot say which one a delete blanked,
  //     and picking either would write the user's note into a different voice of their
  //     own stack.
  //     MEASURED, and this one has a price: first-of-set instead of unambiguous
  //     restores 76 asks rather than 72, all byte-exact, losing nothing on this corpus.
  //     Kept anyway — four extra asks are not worth a rule whose correctness I can only
  //     state as "it happened to pick right four times out of four". Attributing a rest
  //     to the stack PART whose lane is being written would earn those four back with a
  //     reason; that is a widening for its own measurement, not a guess to make here.
  return claims.map((s) => (s.size === 1 ? ordered[[...s][0]] : null))
}

/**
 * The LAST fallback for the step grid: project what the pattern plays and anchor
 * every cell to the ATOM's own source span, so an edit replaces that note's bytes
 * and touches nothing else.
 *
 * Why a third path. The region projection above pairs columns with the source's
 * TOP-LEVEL elements, so an edited element is re-spelled by `reemitRegion` — a
 * mini-notation printer of our own, which can only write flat or one-level output.
 * Patterns whose elements have internal structure (`<c2 eb2 f2 g2>*2`, a `,`-stack
 * of nested groups) therefore either fail to tile into regions or fail the edit
 * probe, and are refused. Anchoring on the LEAF removes the printer from the loop
 * entirely: every structural byte — `[` `]` `<` `>` `*n` `@n` `!` `,` whitespace —
 * is COPIED from the source, never generated, so this writer is incapable of
 * inventing syntax. What it cannot express as a byte replacement (a hit where no
 * leaf exists) it REFUSES; that refusal is what keeps it an adapter.
 *
 * Runs only after `projectStepGrid` declines, so nothing that opens today changes
 * shape: this path can only turn refusals into views, never the reverse.
 */
function projectStepGridByLeaf(src0: string): Projection<StepGridModel> {
  const src = src0.trim()
  if (src === '') return no('not-a-pattern')
  let pat: MiniPattern
  try {
    pat = miniPattern(src)
  } catch {
    return no('not-a-pattern')
  }
  const probed = playedBars(pat, readGridOnsets, onsetKey, LEAF_PROJECT_BARS.grid)
  if (!probed.ok) return probed
  const perCycle = probed.perCycle
  const bars = perCycle.length
  let perBar = 1
  for (const o of perCycle.flat()) {
    const d = denom(o.pos)
    if (d === 0) return no('irrational-onset')
    perBar = lcm(perBar, d)
  }
  if (perBar * bars > MAX_STEPS) return no('resolution')
  const anchored = leafAnchors(src, perCycle, perBar, bars)
  if (!anchored.ok) {
    // only the bijection's refusal is about editing; a note outside its bar has no
    // column to be drawn in either
    return anchored.gate === 'no-leaf-anchor' ? gridLookOnly(anchored.gate, perCycle, perBar, bars) : anchored
  }
  // The lanes come from the ANCHORS — that atom set is what this path can write back
  // — and the lengths from what was PLAYED, matched per column. The anchors are total
  // over drawn cells (`leaf-anchor-sweep`: a drawn cell with no anchor is a control
  // that does nothing), so every anchor has an onset to take a length from.
  const played = columnsFromOnsets(perCycle, perBar, bars)
  if (played === null) return no('irrational-onset')
  // ONE DERIVATION, TWO CONSUMERS (#1235). The length lands on the ANCHOR and the lane
  // cell is projected from it, rather than each reading `played` for itself. The writer
  // compares those two to decide whether a length changed, and a comparison between two
  // independently-derived numbers establishes nothing — it is exactly the mistake
  // `anchorsDescribe` makes when an overlay's width is checked against a model's ([[PV319]]).
  // This is the shape the roll has always had: its model's notes ARE its anchors.
  const cols: LeafAnchor[][] = anchored.cols.map((col, i) =>
    col.map((a) => ({
      ...a,
      duration: played[i].find((n) => n.token === a.atom)?.duration ?? 1,
    })),
  )
  // Indexed alongside the anchors, never into them (#1154). A null here costs reach
  // and nothing else, so this never turns a projection down.
  const rests = restSpansByColumn(src, perBar, bars)
  const model: StepGridModel = {
    steps: perBar * bars,
    ...(bars > 1 ? { bars } : {}),
    lanes: lanesFromCells(
      cols.map((col) => col.map((a) => ({ token: a.atom, duration: a.duration }))),
    ),
    leafSource: { src, cols, attachedSteps: perBar * bars, ...(rests ? { rests } : {}) },
  }
  if (!leafEditSafe(model, perBar, bars)) return gridLookOnly('edit-unsafe', perCycle, perBar, bars)
  if (!leafViewUsable(model)) return gridLookOnly('view-unusable', perCycle, perBar, bars)
  return { ok: true, model }
}

/**
 * Only offer a grid the writer can honour at least one edit on.
 *
 * A pattern that is ONE token played many times (`<bd>*4`, `sd!15(10,30)`) has a
 * single leaf under every column, so clearing any one cell disagrees with the
 * others and is refused — correctly, but the result is a grid where nothing the
 * user clicks moves. That reads as broken, which is worse than the honest
 * code-only refusal it replaces. Asked of the REAL writer, one clear per sounding
 * column, so the check cannot drift from what an actual click does.
 */
function leafViewUsable(model: StepGridModel): boolean {
  for (let c = 0; c < model.steps; c++) {
    const on = model.lanes.find((l) => isCellOn(l.cells[c]))
    if (!on) continue
    const lanes = model.lanes.map((l) =>
      l === on ? { ...l, cells: l.cells.map((v, j) => (j === c ? false : v)) } : l,
    )
    if (serializeStepGrid({ ...model, lanes }) !== null) return true
  }
  return false
}

/**
 * THE BIJECTION, STATED ONCE (#986 P2).
 *
 * A played note is view-editable exactly when it maps to a source span that is
 * its OWN and that no other note's span partly claims. Everything the leaf
 * writers refuse is one of those two clauses failing, and both surfaces ask this
 * function rather than spelling the rule twice — the grid per atom in a column,
 * the roll per note. The ~25 syntactic guards in the core above are the same rule
 * detected feature-by-feature; this is it stated as a property of what the
 * pattern PLAYS, which is why it needs no case for nesting, for `*n`, or for any
 * spelling at all.
 *
 * Clause 1 — the span must BE the token. `loc[0]` is the leaf for a bare reified
 * mini but not for every value the engine can synthesise: a `..` range gives each
 * generated note the RANGE END's location, a patterned operator (`*<8 [4 16]>`)
 * puts its own argument first, and a `.` phrase separator can pad a span with a
 * trailing space. Splicing any of those rewrites bytes belonging to something
 * else. Checked per parse rather than trusted — 0 mismatches across the grid's
 * 8449 corpus spans and 861 across the roll's, so the check is load-bearing on
 * one surface and cheap insurance on the other.
 *
 * Clause 2 — spans may be IDENTICAL but never partly overlapping. Sharing is
 * fine and common (`bd*4` is one token played four times); the writer then
 * requires the sharers to AGREE on the result. Partial overlap is the case no
 * byte replacement can satisfy, because the two notes disagree about who owns
 * the bytes in between.
 *
 * Returns the gate that refused, or the CLAIMED span on success — narrowed, so a
 * caller cannot end up putting a missing span into an anchor and the invariant is
 * the compiler's rather than an assertion. On success the span also joins `seen`,
 * so the caller's loop accumulates the claim set as it goes.
 *
 * `fold` is the roll's: it case-folds note names for its row maths, so it must
 * compare on that footing. The anchor still points at the user's own bytes and
 * the writer puts THOSE back.
 */
function claimLeafSpan(
  src: string,
  span: LeafSpan | null | undefined,
  token: string,
  seen: LeafSpan[],
  fold = false,
): { ok: true; span: LeafSpan } | { ok: false; gate: Gate } {
  const no = { ok: false, gate: 'no-leaf-anchor' } as const
  if (!span) return no
  const bytes = src.slice(span.start, span.end)
  const isOwn = fold ? bytes.toLowerCase() === token.toLowerCase() : bytes === token
  if (!isOwn) return no
  for (const s of seen) {
    const identical = s.start === span.start && s.end === span.end
    if (!identical && s.end > span.start && span.end > s.start) return no
  }
  seen.push(span)
  return { ok: true, span }
}

/** an anchor before its length is attached — see `leafAnchors` */
type Unmeasured = Omit<LeafAnchor, 'duration'>

/**
 * Pair every column with the atoms sounding there and each atom's own leaf span.
 *
 * The refusals are `claimLeafSpan`'s — the bijection — plus one that is NOT it:
 * an onset outside the grid it was measured for is a LAYOUT refusal, reported as
 * `note-crosses-bar` so the anchor count stays an honest measure of the
 * write-back guard (#990).
 *
 * Returns anchors WITHOUT their lengths — the caller adds those from
 * `columnsFromOnsets`, which owns the file's one cycles→columns conversion, so the
 * length reaches the anchor and the lane cell from a single expression (#1235).
 */
function leafAnchors(
  src: string,
  perCycle: Onset[][],
  perBar: number,
  bars: number,
): { ok: true; cols: Unmeasured[][] } | { ok: false; gate: Gate } {
  const cols: Unmeasured[][] = Array.from({ length: perBar * bars }, () => [])
  const seen: LeafSpan[] = []
  for (let b = 0; b < bars; b++) {
    for (const o of perCycle[b]) {
      const c = b * perBar + Math.round(o.pos * perBar)
      // an onset outside the grid it was measured for is a LAYOUT refusal, not
      // an anchor one — kept distinct so the anchor count stays an honest
      // measure of the write-back guard (#990)
      if (c < 0 || c >= perBar * bars) return { ok: false, gate: 'note-crosses-bar' }
      for (let i = 0; i < o.atoms.length; i++) {
        const claim = claimLeafSpan(src, o.spans[i], o.atoms[i], seen)
        if (!claim.ok) return claim
        cols[c].push({ atom: o.atoms[i], span: claim.span })
      }
    }
  }
  return { ok: true, cols }
}

/**
 * The leaf writer's own edit probe — the sibling of `projectionEditSafe`, shaped
 * to the edits this writer actually performs.
 *
 * The region probe overlays a NEW sound, because its writer re-emits a region and
 * can therefore add one. The leaf writer never adds; its two edits are RENAME a
 * leaf and CLEAR it (`~`). Both are probed at every leaf, through the REAL writer
 * and the REAL engine, and every bar must come back as predicted — so a span that
 * is subtly wrong (or a `~` the surrounding syntax won't take) makes the view
 * refuse to open rather than corrupt on the first click.
 */
function leafEditSafe(model: StepGridModel, perBar: number, bars: number): boolean {
  const ls = model.leafSource
  if (!ls) return false
  const probes = new Map<string, LeafAnchor>()
  for (const col of ls.cols) {
    for (const a of col) probes.set(`${a.span.start}:${a.span.end}`, a)
  }
  for (const anchor of probes.values()) {
    for (const text of [PROBE_SOUND, '~']) {
      const out = serializeByLeaf(ls.src, [{ span: anchor.span, text }])
      let edited: MiniPattern
      try {
        edited = miniPattern(out)
      } catch {
        return false
      }
      const want = leafExpected(ls.cols, perBar, bars, anchor.span, text === '~' ? null : text)
      for (let b = 0; b < bars; b++) {
        const got = gridOnsets(edited, b)
        if (got === null || onsetKey(got) !== onsetKey(want[b])) return false
      }
      // …and it must still REPEAT at `bars`, or the grid stops being true one
      // cycle past its own width — cycle `bars` is cycle 0 again.
      const wrap = gridOnsets(edited, bars)
      if (wrap === null || onsetKey(wrap) !== onsetKey(want[0])) return false
    }
  }
  return true
}

/** the onsets the anchors predict once `span`'s leaf becomes `text` (null = cleared) */
function leafExpected(
  cols: LeafAnchor[][],
  perBar: number,
  bars: number,
  span: LeafSpan,
  text: string | null,
): Onset[][] {
  const out: Onset[][] = []
  for (let b = 0; b < bars; b++) {
    const bar: Onset[] = []
    for (let i = 0; i < perBar; i++) {
      const atoms = new Set<string>()
      for (const a of cols[b * perBar + i]) {
        const hit = a.span.start === span.start && a.span.end === span.end
        if (hit && text === null) continue
        atoms.add(hit ? text! : a.atom)
      }
      // Predicted onsets, compared through `onsetKey` (pos + atoms) only. These
      // are what the anchors SAY will sound, not something the engine played, so
      // no span and no length is known — `null` each, rather than guessed (#1034).
      // Aligned with `atoms` now that the arrays are derived from one record; they
      // used to be left empty, which quietly broke the alignment the type promises.
      if (atoms.size > 0) {
        const occ: Occurrence[] = [...atoms].map((a) => ({ token: a, span: null, dur: null }))
        bar.push({ pos: i / perBar, occ, ...deriveColumn(occ) })
      }
    }
    out.push(bar)
  }
  return out
}

/**
 * True when the element writer's locality promise buys the user nothing here.
 *
 * That writer keeps an edit local by re-spelling ONLY the region it touched and
 * copying the rest. When a single region covers the whole cycle there is no rest:
 * `amen/4` is one element over four bars, so clearing its only cell re-emits the
 * entire pattern as `<~ ~ ~ ~>` and the `/4` the user wrote is gone. The leaf
 * writer splices `~/4` instead — the same bytes back, minus the note.
 *
 * So this does not DECLINE the element model; it only lets the leaf writer go
 * first where it has something to offer. `bd*<1 2>` matches this shape too and the
 * leaf writer cannot serve it (one shared `bd` leaf under three columns), so the
 * element model still wins and #930's view is unchanged. It is a preference
 * between two writers that can both do the job, not a new refusal (#994).
 *
 * Asked of the `AltSource` both surfaces build, because the property belongs to
 * the source shape and not to the view — but applied only by the GRID, and that
 * asymmetry is measured, not assumed. See `parsePianoRoll`: the same preference
 * costs the roll a unit of committed writer-reach, while the 13 grid units the
 * element writer would otherwise claim move across with no verdict changing.
 */
/**
 * Overlay the leaf spans onto a view the ELEMENT writer owns, so a delete can be
 * written as byte surgery while everything the view IS stays the element projection
 * (#1010 P4d).
 *
 * The view is not touched — same columns, same lanes, same placements, same view
 * scale — so this cannot change what the panel offers. It only gives the writer a
 * second, better way to answer, and `serializeStepGridWithExtent` falls back to the
 * element paths for any edit surgery cannot express (`serialize.ts`, where the
 * asymmetry between this field and `leafSource` is stated).
 *
 * ⚠ WHY THIS IS NOT THE ROUTING CHANGE P4d WAS FILED AS. Handing these views to the
 * leaf PROJECTION was measured over the corpus and it is a real trade in both
 * directions: 17 documents come back strictly more faithful, and the same views lose
 * 1,763 placements (a leaf view takes a new note only where a rest was indexed, #1154)
 * and the finer view (the leaf path has no span to subdivide, #1058). Both halves
 * follow from deciding ONCE PER MODEL what both writers answer PER EDIT. Overlaying
 * asks per edit and gives up neither half.
 *
 * ⚠ AND IT MUST NOT BE APPLIED WHERE THE LEAF PROJECTION ALREADY OWNS THE VIEW. There
 * a refusal is the promise — see `serializeStepGridWithExtent`.
 *
 * Asked only where the element writer already owns the view, so the leaf projection's
 * cost is paid on the derived path alone and never for a pattern the syntactic core
 * answers (783 of the 958 corpus units that open a grid).
 *
 * WHAT THAT COSTS, measured rather than asserted — the claim above is about WHERE the
 * cost lands and says nothing about its size, which is the half a reader will assume:
 *
 *     path          without overlay   with overlay
 *     core-opened        62.3us           60.4us     unchanged (noise)
 *     derived           2396us           3816us      +59%
 *
 * A second full projection of the same mini is most of it. The core path is untouched,
 * which is the property this placement was chosen for, and the derived path was already
 * the expensive one — but +59% of 2.4ms is a real number and belongs beside the claim
 * rather than in a commit message. Memoising the projection per mini is the obvious
 * lever if it ever matters; it is not taken here because nothing has shown it does.
 *
 * ⚠ ATTACHED AT EVERY SCALE, AND USABLE ONLY AT THE DOCUMENT'S — which is one fact,
 * not two, because the spans index the document's own bytes and carry one entry per
 * DOCUMENT column. At a refined width `anchorsDescribe` refuses them and the element
 * writer answers, exactly as today. After `collapseStepGridToDocument` the model is
 * back at that width and they fit again, which is what makes the same edit spell the
 * same whether or not the user zoomed (#1121). Attaching only at the unrefined scale
 * broke that: five units wrote surgically when edited plainly and re-emitted when
 * edited through a ×2 view. Nothing here decides when the spans apply — the width
 * guard both leaf writers already call does.
 */
/**
 * The width an overlay's spans belong to: the DOCUMENT's columns, one span entry each.
 * For a model drawn per bar (#1827) those are the SHARED grid's columns, not the drawn
 * ones — the writer converts back to the shared grid before it asks for surgery, and a
 * stamp of the drawn width there refuses every splice (roll surgical deletes fell 365 →
 * 364 on `writer-reach` until this was stamped at the width the writer actually holds).
 */
function overlayWidth(model: { steps: number; viewScale?: number; barSteps?: number[] }): number {
  return model.barSteps ? model.barSteps.length * lcmOf(model.barSteps) : documentSteps(model)
}

function withSurgery(mini: string, r: ParseResult<StepGridModel>): ParseResult<StepGridModel> {
  if (!r.ok) return r
  // ⚠ THE ATTACHED WIDTH IS RE-STAMPED, and it is the one field that must not travel
  // through unchanged (#1235). It arrives describing the LEAF model's layout; overlaid, it
  // has to describe the model it is being attached to, or the writer's validity check
  // compares the leaf projection's width against the element projection's — two numbers
  // derived from different premises, whose equality says nothing ([[PV319]]).
  //
  // ⚠⚠ AND IT IS THE DOCUMENT'S WIDTH, NEVER `model.steps`. These spans hold one entry per
  // DOCUMENT column, so the width they belong to must not depend on how closely the user
  // happens to be looking. Stamping the drawn width instead makes the overlay valid only
  // at the scale it was parsed at: after `collapseStepGridToDocument` the model is back at
  // the document's width and the stamp still says the refined one, so surgery refuses and
  // the same edit spells differently through a refined view — #1121's equivalence, broken
  // on 5 corpus units, caught by `1117-refined-round-trip` and by nothing else.
  return {
    ok: true,
    model: { ...r.model, surgical: lazyGridLeaf(mini, overlayWidth(r.model)) },
  }
}

/**
 * How many times a surgical overlay has actually run its deferred projection (#1237).
 *
 * WHY THIS SHIPS. The memo in `lazyGridLeaf`/`lazyRollLeaf` is the whole reason #1233 is
 * affordable, and it is the one property of the overlay whose regression is otherwise
 * INVISIBLE: an edit that makes `spans()` re-project per call changes no output, no
 * count and no verdict — it puts 1459.8us back on a parse that re-runs on every
 * keystroke, and every suite stays green. Laziness has the same shape. So the witness
 * cannot read the models; it has to read the WORK, and the honest reading of work here
 * is a discrete invocation count rather than a wall clock. A timing assertion on a
 * developer machine would be flaky, and a flaky gate teaches people to ignore it.
 *
 * ⚠ IT COULD NOT LIVE IN THE TEST. Both projections are defined in this module and
 * called from the thunks in this module, so the call never crosses a module boundary and
 * no mock can intercept it. The alternative — injecting a projector into the two lazy
 * helpers — would gate the helpers while going blind to `withSurgery`/`withRollSurgery`,
 * which is where the attachment that has to stay lazy actually happens ([[P540]]).
 *
 * ⚠ READ IT AS A DELTA, NEVER AS AN ABSOLUTE. There is deliberately no reset: a resettable
 * global is shared state between arms, and a delta needs nothing from its neighbours.
 * `surgicalMemo.test.ts` is the gate.
 *
 * ⚠ IT COSTS THE SHIPPED RUNTIME NOTHING, and that is a fact about the BARREL rather than
 * about this file. `surgicalProjectionCount` is not re-exported from `src/index.ts`, so
 * nothing the bundle retains ever reads the variable and tsup drops it along with both
 * increments: rebuilding after this change left `dist/index.js` and `dist/index.cjs`
 * BYTE-IDENTICAL, with only the sourcemaps and the emitted docs moving. Export the
 * accessor from the barrel and that stops being true — the increments start shipping.
 */
let surgicalProjections = 0

/** See `surgicalProjections` — a monotonic count, to be read as a delta around the work. */
export function surgicalProjectionCount(): number {
  return surgicalProjections
}

/**
 * The grid's leaf projection of `mini`, run at most once and only if someone asks (#1233).
 *
 * The contract, the memo and both hazards are on `SurgicalOverlay` (`model.ts`); this is
 * the grid's instance of it. Two things are worth reading HERE rather than there:
 *
 * ⚠ THE RE-STAMP HAPPENS ON THE WAY OUT, so every consumer of `spans()` gets a source
 * whose `attachedSteps` describes the model the overlay was attached to rather than the
 * leaf model it was projected from. That keeps the width rule in `anchorsAreFor` alone
 * ([[PV319]]) — no caller has to remember it, and there is no second place to forget it.
 *
 * ⚠ A PRESENT `surgical` NO LONGER MEANS SPANS EXIST. Attaching used to run the
 * projection and skip the field when it failed, so the field's presence answered both
 * questions. It cannot, now: knowing whether spans exist IS the expensive projection this
 * shape exists to defer. Presence means "an overlay was offered here"; whether it can
 * spell anything is `spans()`. Anything counting attachments is counting the offer.
 */
function lazyGridLeaf(mini: string, attachedSteps: number): LazyLeafSource {
  let computed = false
  let spans: LeafSource | undefined
  return {
    attachedSteps,
    spans: () => {
      if (!computed) {
        computed = true
        surgicalProjections++
        const leaf = projectStepGridByLeaf(mini)
        spans = leaf.ok && leaf.model.leafSource
          ? { ...leaf.model.leafSource, attachedSteps }
          : undefined
      }
      return spans
    },
  }
}

function vacuousLocality(a: AltSource<unknown> | undefined): boolean {
  if (!a || a.bars <= 1 || a.regions.length !== 1) return false
  return a.regions[0].from === 0 && a.regions[0].to === a.perBar
}

/**
 * THE DERIVED WRITERS FOR THE GRID, in the order `parseStepGrid` asks them — the
 * whole chain BELOW the syntactic core, and the only place that order is written.
 *
 * Split out for the writer census (#1009), which has to ask the counterfactual
 * "what would serve this if the core were deleted" — a question `parseStepGrid`
 * cannot answer, because the core answers first and wins. Re-deriving the order
 * inside the census would make it a second oracle that can only agree with
 * itself ([[PV192]]), and the ORDER is the contract ([[PK58]]): every decline
 * here re-routes work to the next writer.
 *
 * `fallbackReason` is what to say when nothing below the core opened it. The
 * live caller passes the core's own refusal, because `refused` returns it
 * verbatim for `not-a-pattern` (the mini did not even reify, so no derived gate
 * is meaningful). The census passes a synthetic one: in its world the core
 * SUCCEEDED, so there is no core refusal to report.
 */
export function projectStepGridDerived(
  mini: string,
  fallbackReason: { ok: false; reason: string },
  viewScale: ViewScale = UNREFINED,
): ParseResult<StepGridModel> {
  // the inherited behaviour projection (#922), then the leaf-anchored projection
  // (#986) for the notation no re-emit can spell.
  //
  // ⚠ ONLY THE ELEMENT PATH CARRIES THE VIEW SCALE (#1055). The leaf path anchors
  // each note to its own source span, so a finer view has no span to subdivide —
  // that is #1058's subject, not this phase's ([[PV261]]: the leaf path offers no
  // resolution op at all, so nothing goes dark). A leaf model therefore records no
  // `viewScale` and the entry refuses a refine on it rather than drawing the
  // document's own layout for one.
  //
  // ⚠ WHICH of the two owns the pattern is asked at `UNREFINED`, for the same reason
  // `parseStepGrid` asks it there (#1116): `projectStepGrid`'s own gates read the
  // DRAWN column count — `perBar % totalWeight`, `vacuousLocality`, the edit-safety
  // probe — so at a finer scale the element path can start succeeding where it
  // declined, and the leaf writer that owned the user's bytes is silently replaced by
  // an element re-emit. Measured: one corpus unit did exactly that, and it was found
  // only because the shape it came back in changed.
  const owner = projectStepGrid(mini)
  // Re-ask the OWNING path for the refined view. A decline here is the owner's own
  // gate — `view-resolution` past the ceiling, or a scaled layout it cannot tile —
  // and it is reported as such rather than handed on to the next writer.
  const asOwner = (ok: { ok: true; model: StepGridModel }): ParseResult<StepGridModel> => {
    if (viewScale === UNREFINED) return ok
    const scaled = projectStepGrid(mini, viewScale)
    return scaled.ok ? scaled : refused('grid', fallbackReason, scaled.gate, mini)
  }
  if (owner.ok && !vacuousLocality(owner.model.altSource)) return withSurgery(mini, asOwner(owner))
  const leaf = projectStepGridByLeaf(mini)
  if (leaf.ok) return leaf
  if (owner.ok) return asOwner(owner)
  // …and if nothing opened it, report the gate that actually stopped the general
  // write-back (#990) — not the core's syntactic message, which names the first
  // writer to decline
  return refused('grid', fallbackReason, leaf.gate, mini, leaf.lookOnly)
}

/**
 * THE PUBLIC ENTRY, and the only place a caller can express a view resolution.
 *
 * #1055 threaded `ViewScale` into the DERIVED projections. But the core answers first
 * and answers for most patterns — 783 of the 958 corpus units that open the grid,
 * including `bd ~ sn ~`, the case #1052 is named after — so a scale that stopped at
 * the derived path could not reach 94% of the free-zone offers it exists to serve
 * (#1116). The core now carries it too, and the scale enters HERE so both halves get
 * the same number from the same caller.
 *
 * The order is unchanged and deliberately so ([[PK58]]): core, then derived. A view
 * scale must NOT re-route a pattern to a different projection, because the core and
 * the derived path build different `source` structures and therefore hand the document
 * to different writers — zooming would silently swap the writer that owns the user's
 * bytes. The finer view has to come from whichever writer already owns the pattern.
 *
 * ⚠ THAT GUARANTEE IS WHY OWNERSHIP IS ASKED AT `UNREFINED`, ALWAYS, and the first
 * version of this entry did not have it. Asking the core AT THE SCALE conflates two
 * different noes: "I do not own this pattern" (fall through to the derived path) and
 * "I own it but cannot draw it finer yet" (the alt-element path's refusal). Both
 * arrive as `ok: false`, so the scale refusal fell through and the derived projection
 * answered instead — measured, **20 grid and 17 roll units changed writer on a zoom**,
 * and 36 of the 37 were faithful magnifications that would have shipped in silence.
 * Routing is a property of the PATTERN, so it is decided at the pattern's own
 * resolution and the scale is applied only by the path that already owns it.
 */
export function parseStepGrid(
  mini: string,
  viewScale: ViewScale = UNREFINED,
): ParseResult<StepGridModel> {
  // ⚠ THE CORE-OPENED HALF GETS THE OVERLAY HERE, AND NOT INSIDE THE CORE (#1233).
  // `parseStepGridCore` stays a pure description of what the syntactic core read, which is
  // what lets `writer-census.test.ts` keep asking whether the shipped path hands back the
  // core's own result: the two now differ by exactly this field and by nothing else, and
  // that gate asserts precisely that. Attaching inside the core would make the difference
  // vanish by putting it on both sides — a green gate bought with blindness rather than
  // with sameness.
  //
  // The 805 deletes this half still answered through the region splice are what #1233 is
  // for: 505 of them re-emit the same bytes surgery would write (the splice already copies
  // everything outside the touched element), 195 have no leaf spans at all, 33 the overlay
  // refuses — and 41 come back DIFFERENT, moving 101 bytes where the splice moves 427.
  // Those 41 are the destruction class this arc exists for: `[C Eb]` re-emitted as
  // `[~ ~ ~ Eb _ _]` against surgery's `[~ Eb]`.
  const owner = parseStepGridCore(mini)
  if (viewScale === UNREFINED) {
    return owner.ok ? withSurgery(mini, owner) : projectStepGridDerived(mini, owner, UNREFINED)
  }
  const result = owner.ok
    ? withSurgery(mini, parseStepGridCore(mini, viewScale))
    : projectStepGridDerived(mini, owner, viewScale)
  return honoursViewScale(result, viewScale, 'grid')
}

/**
 * THE TOTAL GATE: a model handed back for a refined request must actually BE refined.
 * ONE rule, both surfaces — the property is about the model's own report, and nothing
 * in it is grid- or roll-specific, so writing it twice would be two things to keep
 * in step ([[PV200]]).
 *
 * One projection legitimately does not carry a view scale: the leaf path anchors each
 * note to its own source span and so has no span to subdivide (#1058, [[PV261]]).
 * Measured over the corpus before this check existed, 202 of 958 grid units reached a
 * scale-blind path, and every one answered a refine request with the DOCUMENT's own
 * layout and no error: the control appears to work and draws exactly what it drew
 * before — the silent wrong layout this whole parameter exists to make impossible.
 *
 * The four bar-expanding projections were in that population until #1117 taught them
 * the scale, and this comment is the reason they could be: the gate never enumerated
 * who was allowed to refine, so teaching a path made it start passing with no edit
 * here. That is the property the next such path inherits for free.
 *
 * Asked HERE rather than in each projection on purpose. A per-path refusal is a rule
 * every future path must remember to fire; this is one check that no new path can
 * escape, because it reads the model's own report of what it did. A projection that
 * later learns the scale starts passing it with no change here ([[PV260]]: prefer the
 * shape in which the wrong state cannot be built over the rule that must detect it).
 *
 * ⚠ THE OBLIGATION THIS CHECK CREATES, and it was discharged in the wrong half first.
 * Reading a self-report makes *failing to report* indistinguishable from *failing to
 * refine* — so a path that honours the scale and stays silent is REFUSED, and that
 * refusal is invisible because it is the safe direction. Measured on the first version
 * of this gate: 96 of its 198 "honest refusals" were models the element projection had
 * already drawn at exactly k× the columns, faithfully, and thrown away for saying
 * nothing. Whoever multiplies by the scale must also record it.
 */
function honoursViewScale<M extends { viewScale?: ViewScale }>(
  result: ParseResult<M>,
  viewScale: ViewScale,
  surface: Surface,
): ParseResult<M> {
  if (!result.ok || viewScale === UNREFINED) return result
  if ((result.model.viewScale ?? UNREFINED) === viewScale) return result
  // Named, not just worded (#1132). This is the largest refusal class the refined
  // entry produces, and it carried no `gate` at all — so every consumer attributing
  // by gate had to read it as "no projection spoke", which is the opposite of what
  // happened here: a projection spoke and came back unrefined.
  return { ok: false, reason: gateReason('no-finer-view', surface), gate: 'no-finer-view' }
}

export function parseStepGridCore(
  mini: string,
  viewScale: ViewScale = UNREFINED,
): ParseResult<StepGridModel> {
  const alt = unwrapAlternation(mini)
  if (alt !== null) return gridFromAlternation(alt, viewScale)

  const parts = splitTopLevel(mini)
  if (parts.length > 1) return gridFromStack(parts, viewScale)

  // Carries the scale as of #1117: the bar expansion shares one global `div`, and
  // scaling that scales every column it emits. It refuses only the VIEW's own
  // ceiling now, never the request itself.
  const altEl = gridFromAltElements(mini, viewScale)
  if (altEl !== null) return altEl

  const tok = tokenize(mini)
  if (!tok.ok) return tok
  if (gridHasElongation(tok.steps)) {
    return { ok: false, reason: 'elongation is beyond the drum-grid subset' }
  }
  // THE DOCUMENT'S OWN resolution and its own ceiling, both asked of the UNSCALED
  // quantity — `MAX_STEPS` guards a combinatorial blow-up in the NOTATION, which a
  // view refine does not cause (#1055, #1116).
  const documentDiv = division(tok.steps)
  const documentCols = tok.steps.length * documentDiv
  if (documentCols > MAX_STEPS) {
    return { ok: false, reason: `sub-sequences expand the grid past ${MAX_STEPS} steps` }
  }
  // …and the VIEW's ceiling, asked of what would actually be drawn.
  if (!viewScaleFits(documentCols, 1, viewScale)) {
    // one gate, one sentence (#1132): this is the VIEW's ceiling, the same refusal
    // `gateReason` already words — it was simply spelled a second way here.
    return { ok: false, reason: gateReason('view-resolution', 'grid'), gate: 'view-resolution' }
  }
  // `toCells` is LINEAR in `div` (a slot's span is `(div / total) * units`), so
  // scaling it draws the same notation on a finer grid without moving any onset.
  const div = documentDiv * viewScale
  const cells = toCells(tok.steps, div)
  const src = mini.trim()
  const sourceParts = singlePart(src, tok.elements, div, cells.length, gridContent(tokensOf(cells)))
  return {
    ok: true,
    model: {
      steps: cells.length,
      ...(viewScale === UNREFINED ? {} : { viewScale }),
      lanes: lanesFromCells(cells),
      ...(sourceParts
        ? { source: { prefix: '', suffix: '', parts: sourceParts } }
        : {}),
    },
  }
}

/**
 * `<[bd ~ sd ~] [bd bd sd ~]>` — one slot per bar.
 *
 * `inner` is the text between the angle brackets, so the regions tile it and
 * the brackets (plus whatever padding the user left inside them) are carried as
 * the wrapper. Each element is a bar and owns `div` columns, exactly as in the
 * flat case — the alternation is the same tiling with `<`…`>` around it.
 */
function gridFromAlternation(
  inner: string,
  viewScale: ViewScale = UNREFINED,
): ParseResult<StepGridModel> {
  const tok = tokenize(inner)
  if (!tok.ok) return tok
  if (tok.steps.length === 0) return { ok: false, reason: 'empty alternation' }
  if (gridHasElongation(tok.steps)) {
    return { ok: false, reason: 'elongation is beyond the drum-grid subset' }
  }
  // the DOCUMENT's ceiling on the unscaled expansion, then the VIEW's own on what is
  // drawn — here each of `tok.steps.length` bars owns `div` columns (#1055, #1116)
  const documentDiv = division(tok.steps)
  // Bars whose counts do not nest are drawn each at its own count (#1827) — see the
  // roll's alternation path, which asks the same two ceilings for the same reason.
  const perBar = perBarLayout(tok.steps.map(stepUnits))
  const layout = viewScale === UNREFINED ? perBar : null
  const tooWide = layout
    ? layout.some((n) => n > MAX_STEPS) || tok.steps.length * documentDiv > MAX_SHARED_STEPS
    : tok.steps.length * documentDiv > MAX_STEPS
  if (tooWide) {
    // the roll's rule: opens per bar at ×1, so a refined refusal is the VIEW's ceiling
    if (perBar && !layout) {
      return { ok: false, reason: gateReason('view-resolution', 'grid'), gate: 'view-resolution' }
    }
    return { ok: false, reason: `the alternation expands the grid past ${MAX_STEPS} steps` }
  }
  if (!layout && !viewScaleFits(documentDiv, tok.steps.length, viewScale)) {
    // one gate, one sentence (#1132): this is the VIEW's ceiling, the same refusal
    // `gateReason` already words — it was simply spelled a second way here.
    return { ok: false, reason: gateReason('view-resolution', 'grid'), gate: 'view-resolution' }
  }
  const div = documentDiv * viewScale
  const cells = toCells(tok.steps, div)
  const src = inner.trim()
  const parts = singlePart(src, tok.elements, div, cells.length, gridContent(tokensOf(cells)))
  const model: StepGridModel = {
    steps: cells.length,
    bars: tok.steps.length,
    ...(viewScale === UNREFINED ? {} : { viewScale }),
    lanes: lanesFromCells(cells),
    ...(parts
      ? {
          source: {
            parts,
            prefix: '<' + (/^\s*/.exec(inner)?.[0] ?? ''),
            suffix: (/\s*$/.exec(inner)?.[0] ?? '') + '>',
          },
        }
      : {}),
  }
  if (!layout) return { ok: true, model }
  const drawn = toDrawnGrid(model, layout)
  if (drawn) return { ok: true, model: drawn }
  return cells.length > MAX_STEPS
    ? { ok: false, reason: `the alternation expands the grid past ${MAX_STEPS} steps` }
    : { ok: true, model }
}

/**
 * `bd ~ sd ~, hh hh hh hh` — parallel parts on a shared grid, part preserved.
 *
 * Each part keeps its OWN resolution: the shared grid is the finest of them, so
 * a part's columns map onto it every `factor` columns. The regions stay in the
 * part's own column space and the `,` (with whatever padding the user put
 * around it) is carried verbatim as the part's `before`.
 */
function gridFromStack(
  parts: string[],
  viewScale: ViewScale = UNREFINED,
): ParseResult<StepGridModel> {
  const partCells: ColumnNotes[] = []
  const divs: number[] = []
  const elements: ElementSpan[][] = []
  // a part read by the lone-part chain brings its own regions (#1849)
  const given: (SourceRegion<GridCells>[] | null)[] = []
  // …and, for a whole `<…>` part, its bars and its own `<`/`>` (#1849's `<…>` half)
  const partBars: number[] = []
  const wraps: { prefix: string; suffix: string }[] = []
  // The DOCUMENT's own shared width, needed for the unscaled ceiling below. Every
  // part's column count scales by exactly `viewScale`, and `lcm(k·a, k·b) = k·lcm(a, b)`,
  // so the shared total scales by the same factor — which is why the guard can be
  // asked once, of the document, before any scaling happens (#1116).
  let documentTotal = 1
  for (const part of parts) {
    if (part.trim() === '') return { ok: false, reason: 'empty stack part' }
    const tok = tokenize(part)
    const flatRefusal: { ok: false; reason: string } | null = !tok.ok
      ? tok
      : gridHasElongation(tok.steps)
        ? { ok: false, reason: 'elongation is beyond the drum-grid subset' }
        : null
    if (flatRefusal || !tok.ok) {
      // THE PART ALONE, ASKED THE WHOLE CHAIN (#1849). A part the flat reading turns
      // away — `bd@3 sd`, `d6*2@2 f#6 e6` — is exactly what the lone-part chain was
      // built to read, and it already answers when that part is written by itself.
      // Only its flat-shaped answer fits a stack part: one part, no wrapper, not
      // bar-wise. Anything else refuses as before.
      const lone = loneGridPart(part.trim(), viewScale)
      if (!lone) {
        // A part that reads at the document's own resolution and not at this scale was
        // stopped by the VIEW's ceiling, and says so — the stack owns the pattern at ×1,
        // so its refinement refusal must name the gate rather than the part's syntax.
        if (viewScale !== UNREFINED && loneGridPart(part.trim(), UNREFINED)) {
          return { ok: false, reason: gateReason('view-resolution', 'grid'), gate: 'view-resolution' }
        }
        return flatRefusal ?? { ok: false, reason: 'unsupported mini-notation syntax' }
      }
      documentTotal = lcm(documentTotal, lone.steps / viewScale)
      divs.push(lone.div)
      elements.push([])
      partCells.push(lone.cells)
      given.push(lone.regions)
      partBars.push(lone.bars)
      wraps.push({ prefix: lone.prefix, suffix: lone.suffix })
      continue
    }
    given.push(null)
    partBars.push(1)
    wraps.push({ prefix: '', suffix: '' })
    const documentDiv = division(tok.steps)
    documentTotal = lcm(documentTotal, tok.steps.length * documentDiv || 1)
    const div = documentDiv * viewScale
    divs.push(div)
    elements.push(tok.elements)
    partCells.push(toCells(tok.steps, div))
  }
  if (partBars.some((b) => b > 1)) {
    return gridFromBarStack(parts, viewScale, { partCells, partBars, divs, elements, given, wraps })
  }
  if (documentTotal > MAX_STEPS) {
    return { ok: false, reason: `the stack expands the grid past ${MAX_STEPS} steps` }
  }
  if (!viewScaleFits(documentTotal, 1, viewScale)) {
    // one gate, one sentence (#1132): this is the VIEW's ceiling, the same refusal
    // `gateReason` already words — it was simply spelled a second way here.
    return { ok: false, reason: gateReason('view-resolution', 'grid'), gate: 'view-resolution' }
  }
  const total = partCells.reduce((l, cells) => lcm(l, cells.length || 1), 1)
  const lanes: StepLane[] = []
  partCells.forEach((cells, part) => {
    const factor = total / (cells.length || 1)
    // A part coarser than the shared grid has its columns spread out every `factor`
    // of them — and its notes are `factor` times as long in the SHARED grid's columns
    // as in its own. `E2` beside `A2 A2` is one note over a two-column grid: two
    // columns long, not one. Missed on the first cut of P4b and caught by
    // `cell-duration.test.ts` on its first run, which is what that gate is for.
    const stretched: ColumnNotes = Array.from({ length: total }, (_, c) =>
      c % factor === 0
        ? (cells[c / factor] ?? []).map((n) => ({ ...n, duration: n.duration * factor }))
        : [],
    )
    lanes.push(...lanesFromCells(stretched, part))
  })
  return {
    ok: true,
    model: {
      steps: total,
      ...(viewScale === UNREFINED ? {} : { viewScale }),
      lanes,
      ...(stackSource(parts, divs, elements, partCells, total, given) ?? {}),
    },
  }
}

/**
 * `<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8` — a stack that plays for more bars than
 * some of its parts are written over (#1849's `<…>` half).
 *
 * Strudel asks every `,`-part for the same cycle (`mini.mjs` `case 'stack'` →
 * `strudel.stack`), and a `<…>` answers with the element for THAT cycle (`slowcat`,
 * `pats[cycle mod n]`). So the stack's length is the lcm of its parts' bars, and a part
 * written over fewer bars plays them again — it repeats, it is not stretched. The shared
 * grid is laid out bar by bar: each bar is the lcm of the parts' columns-per-bar, a part's
 * bar `b` shows its written bar `b mod bars`, and a part's columns spread every `factor`
 * shared columns within a bar, as in the one-bar stack.
 *
 * Each part keeps the regions its own reading gave it and its own `<`/`>` in its
 * `before`/`after`, so the writer re-emits only a part that changed and copies the rest.
 * Past `MAX_PROJECT_BARS` it refuses, and the pattern reads as it did before.
 */
function gridFromBarStack(
  parts: string[],
  viewScale: ViewScale,
  read: {
    partCells: ColumnNotes[]
    partBars: number[]
    divs: number[]
    elements: ElementSpan[][]
    given: (SourceRegion<GridCells>[] | null)[]
    wraps: { prefix: string; suffix: string }[]
  },
): ParseResult<StepGridModel> {
  const { partCells, partBars, divs, elements, given, wraps } = read
  const bars = partBars.reduce((l, b) => lcm(l, b), 1)
  if (bars > MAX_PROJECT_BARS) {
    return { ok: false, reason: `the stack does not repeat within ${MAX_PROJECT_BARS} bars` }
  }
  const perBar = partCells.map((cells, i) => cells.length / partBars[i])
  if (perBar.some((n) => !Number.isInteger(n) || n < 1)) {
    return { ok: false, reason: 'a part does not split into whole bars' }
  }
  const width = perBar.reduce((l, n) => lcm(l, n), 1)
  const total = bars * width
  // the DOCUMENT's own ceiling on the unscaled grid, then the VIEW's (#1055, #1116)
  if (total / viewScale > MAX_STEPS) {
    return { ok: false, reason: `the stack expands the grid past ${MAX_STEPS} steps` }
  }
  if (!viewScaleFits(width / viewScale, bars, viewScale)) {
    return { ok: false, reason: gateReason('view-resolution', 'grid'), gate: 'view-resolution' }
  }
  const lanes: StepLane[] = []
  const factors = perBar.map((n) => width / n)
  partCells.forEach((cells, part) => {
    const factor = factors[part]
    const shown: ColumnNotes = Array.from({ length: total }, (_, c) => {
      const within = c % width
      if (within % factor !== 0) return []
      const own = (Math.floor(c / width) % partBars[part]) * perBar[part] + within / factor
      return (cells[own] ?? []).map((n) => ({ ...n, duration: n.duration * factor }))
    })
    lanes.push(...lanesFromCells(shown, part))
  })
  const out: SourcePart<GridCells>[] = []
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]
    const leading = /^\s*/.exec(raw)?.[0] ?? ''
    const after = /\s*$/.exec(raw.slice(leading.length))?.[0] ?? ''
    const regions =
      given[i] ??
      buildRegions(raw.trim(), elements[i], divs[i], partCells[i].length, gridContent(tokensOf(partCells[i])))
    // no regions → no writer that keeps the other parts' bytes: refuse, and the pattern
    // reads as it did before this path existed rather than handing the rebuild a stack
    if (!regions) return { ok: false, reason: 'a stack part could not be tiled' }
    out.push({
      part: i,
      div: divs[i],
      factor: factors[i],
      bars: partBars[i],
      before: (i > 0 ? ',' : '') + leading + wraps[i].prefix,
      after: wraps[i].suffix + after,
      regions,
    })
  }
  const model: StepGridModel = {
    steps: total,
    bars,
    ...(viewScale === UNREFINED ? {} : { viewScale }),
    lanes,
  }
  // the parts must reassemble the line exactly — `stackSource`'s check, one level up
  const rebuilt = out.map((p) => p.before + p.regions.map((r) => r.raw).join('') + p.after).join('')
  if (rebuilt !== parts.join(',')) return { ok: false, reason: 'a stack part could not be tiled' }
  return { ok: true, model: { ...model, source: { prefix: '', suffix: '', parts: out } } }
}

/**
 * A `,`-part the flat reading turned away, read the way the same text is read on its
 * own (#1849) — `parseStepGrid`, the whole chain — and kept only when its answer has
 * the shape a stack part holds: one flat part of regions, no `<`…`>` wrapper, one bar,
 * at the scale asked. Returns the part's own columns (the `ColumnNotes` the flat
 * reading would have produced, rebuilt from the lanes it drew) and its regions.
 */
function loneGridPart(
  part: string,
  viewScale: ViewScale,
): {
  steps: number
  div: number
  cells: ColumnNotes
  regions: SourceRegion<GridCells>[]
  /** the bars the part is written over — more than 1 only for a whole `<…>` */
  bars: number
  /** the part's own `<` … `>` wrapper, with the padding inside it, verbatim */
  prefix: string
  suffix: string
} | null {
  const r = parseStepGrid(part, viewScale)
  if (!r.ok) return null
  const m = r.model
  const src = m.source
  if (!src || src.parts.length !== 1) return null
  if (m.altSource || m.barSteps || (m.viewScale ?? UNREFINED) !== viewScale) return null
  const bars = m.bars ?? 1
  // ONE BAR, NO WRAPPER — or A WHOLE `<…>`, ONE ELEMENT PER BAR (#1849): the lone reading
  // `gridFromAlternation` gives `<[bd ~ bd ~] [bd ~ ~ bd]>`, whose `<`/`>` sit outside the
  // regions exactly as a stack part's `,` does. Any other multi-bar answer is refused.
  const wrapped = bars > 1 && src.prefix.startsWith('<') && src.suffix.endsWith('>')
  if (!wrapped && (bars !== 1 || src.prefix !== '' || src.suffix !== '')) return null
  if (m.steps % bars !== 0) return null
  const cells: ColumnNotes = Array.from({ length: m.steps }, (_, c) =>
    m.lanes.flatMap((l) => {
      const cell = l.cells[c]
      return isCellOn(cell) ? [{ token: l.sound, duration: cell.duration }] : []
    }),
  )
  return {
    steps: m.steps,
    div: src.parts[0].div,
    cells,
    regions: src.parts[0].regions,
    bars,
    prefix: src.prefix,
    suffix: src.suffix,
  }
}

/**
 * The per-part source for a `,`-stack. All or nothing: one part we can't tile
 * means the writer can't reassemble the line, so none of it is used.
 */
function stackSource(
  parts: string[],
  divs: number[],
  elements: ElementSpan[][],
  partCells: ColumnNotes[],
  total: number,
  given: (SourceRegion<GridCells>[] | null)[] = [],
): { source: NotationSource<GridCells> } | null {
  const out: SourcePart<GridCells>[] = []
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]
    const leading = /^\s*/.exec(raw)?.[0] ?? ''
    const after = /\s*$/.exec(raw.slice(leading.length))?.[0] ?? ''
    const regions = given[i] ?? buildRegions(
      raw.trim(),
      elements[i],
      divs[i],
      partCells[i].length,
      gridContent(tokensOf(partCells[i])),
    )
    if (!regions) return null
    out.push({
      part: i,
      div: divs[i],
      factor: total / (partCells[i].length || 1),
      before: (i > 0 ? ',' : '') + leading,
      after,
      regions,
    })
  }
  // the parts must reassemble the line exactly, or we are not putting back what
  // we read — same check as the per-part tiling, one level up
  const rebuilt = out.map((p) => p.before + p.regions.map((r) => r.raw).join('') + p.after).join('')
  if (rebuilt !== parts.join(',')) return null
  return { source: { prefix: '', suffix: '', parts: out } }
}

/* ── velocity (.gain) read-back ────────────────────────────────── */

/** a flat gain token: a non-negative number, or `~` (no gain event there) */
const GAIN_TOKEN = /^\d+(\.\d+)?$/

/**
 * Parse a FLAT `.gain("…")` mini into `count` per-position velocities — the
 * one-token-per-column shape the step grid writes. Returns null when the gain
 * pattern isn't that shape (wrong token count, an `@`/`*`/`[` we didn't write,
 * a non-numeric token, a broadcast `.gain("0.8")`); the caller then leaves the
 * model neutral and flags the gain foreign so it's never rewritten or deleted.
 * A `~` position reads as neutral `1` (its column is a rest — no audible gain).
 */
export function parseGainMini(mini: string, count: number): number[] | null {
  const tokens = mini.trim().split(/\s+/).filter((t) => t !== '')
  if (tokens.length !== count) return null
  const out: number[] = []
  for (const t of tokens) {
    if (t === '~') {
      out.push(1)
      continue
    }
    if (!GAIN_TOKEN.test(t)) return null
    out.push(parseFloat(t))
  }
  return out
}

/**
 * Apply an existing `.gain` to a freshly-parsed step model. A scalar
 * `.gain(0.4)` reads as a UNIFORM base (every column 0.4); a string `.gain("…")`
 * reads per-column. A `.gain` we don't manage (`foreign`) or a string that
 * doesn't align to the columns flags `gainForeign` (hands off). `.gain(1)` is
 * neutral and leaves the model bare.
 */
export function applyStepGain(model: StepGridModel, gain: ChunkGain): StepGridModel {
  if (gain.foreign) return { ...model, gainForeign: true }
  if (gain.numeric !== null) {
    return gain.numeric === 1 ? model : { ...model, gains: Array<number>(model.steps).fill(gain.numeric) }
  }
  if (gain.mini === null) return model
  // READ AT THE DOCUMENT'S RESOLUTION, THEN EXPAND (#1057). `.gain` is written at
  // whatever resolution the notation is written at, so on a model drawn `k×` finer
  // than the file the mini has the DOCUMENT's token count, not `model.steps`.
  // Asking for `model.steps` tokens made a perfectly ordinary gain look foreign the
  // moment the user refined, which silently retired the velocity lane for as long
  // as they stayed zoomed in. Expanding across each drawn column is the same
  // embedding the notation gets, and the ÷k write collapses it back exactly.
  const docSteps = documentSteps(model)
  const docGains = parseGainMini(gain.mini, docSteps)
  if (docGains === null) return { ...model, gainForeign: true }
  const k = model.steps / docSteps
  // ⚠ THE GAIN GOES ON THE GROUP'S FIRST COLUMN AND THE REST STAY NEUTRAL — the
  // same shape `scaleStepGrid` ×2 produces ("keeps each hit gain, inserts neutral
  // odd columns"). Filling every drawn column instead puts a non-neutral value on
  // a sustain column, which the ÷k guard reads as data it would drop, so the model
  // stops collapsing and every write respells the file again. Measured, not
  // reasoned: the flood-fill version refused to collapse even UNMODIFIED.
  const gains =
    k === 1
      ? docGains
      : docGains.flatMap((g) => [g, ...Array<number>(k - 1).fill(1)])
  return { ...model, gains }
}

/**
 * Apply an existing `.gain("…")` string to a freshly-parsed roll model. Walks
 * the gain mini the same way `parsePianoRoll` walks notes (so `@n` holds and
 * rests line up), building a start-column → gain map, then assigns each note the
 * gain at its start (chord members at one start share it). Flags `gainForeign`
 * — leaving the `.gain` byte-identical — when the gain can't be cleanly mapped
 * (multi-bar, non-numeric token, a total that doesn't match the note grid, or a
 * non-neutral value at a column where no note starts).
 */
export function applyRollGain(model: PianoRollModel, gain: ChunkGain): PianoRollModel {
  if (gain.foreign) return { ...model, gainForeign: true }
  if (gain.numeric !== null) {
    // scalar `.gain(0.4)` → uniform base on every note
    return gain.numeric === 1
      ? model
      : { ...model, notes: model.notes.map((n) => ({ ...n, gain: gain.numeric as number })) }
  }
  if (gain.mini === null) return model
  // The gain mini is a FLAT sequence the roll serializer emits: a number, a
  // `~` rest, or `num@dur` for a held note. (The note tokenizer can't read it —
  // it requires letter-start atoms.) Anything else → foreign, hands off.
  let mini = gain.mini
  if (model.bars != null) {
    // Multi-bar gain is managed only when each bar is a single column
    // (`perBar === 1`, steps === bars) — there bars ≡ columns, so the gain is a
    // flat sequence wrapped in `<...>`, mirroring serializeRollGain (#632). The
    // inner is read exactly like the single-bar flat sequence below. Subdivided
    // bars (perBar > 1) need a nested gain mini and stay unmanaged → hand off.
    const inner = model.steps === model.bars ? unwrapAlternation(mini) : null
    if (inner === null) return { ...model, gainForeign: true }
    mini = inner
  }
  const byStart = new Map<number, number>()
  // THE CURSOR WALKS IN DOCUMENT COLUMNS, THE NOTES SIT IN DRAWN ONES (#1057).
  // `.gain` is written at the resolution the notation is written at, so on a model
  // drawn `k×` finer every token spans `k` drawn columns. Stepping by 1 would land
  // each gain on the wrong note and then fail the grid-total check below, turning
  // an ordinary gain foreign the moment the user refined.
  const k = model.steps / documentSteps(model)
  let col = 0
  for (const t of mini.trim().split(/\s+/).filter((s) => s !== '')) {
    if (t === '~') {
      col += k
      continue
    }
    const m = t.match(/^(\d+(?:\.\d+)?)(?:@(\d+))?$/)
    if (!m) return { ...model, gainForeign: true }
    byStart.set(col, parseFloat(m[1]))
    col += (m[2] ? parseInt(m[2], 10) : 1) * k
  }
  if (col !== model.steps) return { ...model, gainForeign: true } // grid mismatch
  const noteStarts = new Set(model.notes.map((n) => n.start))
  for (const [c, v] of byStart) {
    // a non-neutral gain at a column with no note onset isn't ours to manage
    if (v !== 1 && !noteStarts.has(c)) return { ...model, gainForeign: true }
  }
  return {
    ...model,
    notes: model.notes.map((n) => {
      const v = byStart.get(n.start)
      return v != null && v !== 1 ? { ...n, gain: v } : n
    }),
  }
}

/* ── piano roll ────────────────────────────────────────────────── */

/**
 * `0 <2 3> 5` in the piano roll — the roll's half of the grid's alt-element path.
 * The shared bar-expansion is reused verbatim; only "what a column shows" (notes,
 * not cells) and the numeric/named check are the roll's own. null → not this
 * shape (the flat path handles it).
 */
function rollFromAltElements(
  mini: string,
  viewScale: ViewScale = UNREFINED,
): ParseResult<PianoRollModel> | null {
  const exp = expandAltElements(mini, true)
  if (exp === null) return null
  if ('reason' in exp) return { ok: false, reason: exp.reason }
  const { bars, div: documentDiv, perBarCols: documentPerBarCols, perBarSteps, elemSpans } = exp
  // The grid's half of this argues the reasoning in full (#1117): `div` is the one
  // multipliable quantity, every gate above it is scale-free, and only the VIEW's
  // ceiling is a refusal the scale can add. A note's span here is
  // `elongation × div × units / total`, so it magnifies with `div` exactly as the
  // grid's columns do — the roll needs no separate rule.
  if (!viewScaleFits(documentPerBarCols, bars, viewScale)) {
    return { ok: false, reason: gateReason('view-resolution', 'roll'), gate: 'view-resolution' }
  }
  const div = documentDiv * viewScale
  const perBarCols = documentPerBarCols * viewScale
  const notes: RollNote[] = []
  let col = 0
  let sawNumeric = false
  let sawNamed = false
  for (const barSteps of perBarSteps) {
    for (const step of barSteps) {
      const slots = step.sub ?? [{ atoms: step.atoms, units: 1 }]
      const total = stepUnits(step)
      for (const slot of slots) {
        const span = (step.elongation * div * slot.units) / total
        for (const token of slot.atoms) {
          const isNum = /^-?\d+$/.test(token)
          if (!isNum && pitchToMidi(token) === null) {
            return { ok: false, reason: `"${token}" is not a note name` }
          }
          if (isNum) sawNumeric = true
          else sawNamed = true
          notes.push({ pitch: isNum ? token : token.toLowerCase(), start: col, duration: span })
        }
        col += span
      }
    }
  }
  if (sawNumeric && sawNamed) {
    return { ok: false, reason: 'mixed numeric and note-name tokens are beyond the editable subset' }
  }
  const src = mini.trim()
  const regions = buildAltRegions<RollNote[]>(src, elemSpans, div, perBarCols, (from, to) => {
    const perBar: RollNote[][] = []
    for (let b = 0; b < bars; b++) {
      const lo = from + b * perBarCols
      const hi = to + b * perBarCols
      perBar.push(
        notes
          .filter((n) => n.start >= lo && n.start < hi)
          .map((n) => ({ pitch: n.pitch, start: n.start - b * perBarCols, duration: n.duration })),
      )
    }
    return perBar
  })
  if (!regions) return { ok: false, reason: 'unsupported mini-notation syntax' }
  return {
    ok: true,
    model: {
      steps: col,
      bars,
      notes,
      ...(sawNumeric ? { numeric: true } : {}),
      ...(viewScale === UNREFINED ? {} : { viewScale }),
      altSource: { perBar: perBarCols, bars, div, regions },
    },
  }
}

/* ── behaviour projection: the roll's inherited fallback (#924) ── */

export interface RollOnset {
  pos: number
  dur: number
  pitch: string
  numeric: boolean
  /** the note's own leaf span (src-space), the #986 write-back anchor; `null` if none carried */
  loc: LeafSpan | null
}

/**
 * Read what a melodic pattern PLAYS, one cycle, as pitched onsets with DURATION —
 * inherited from Strudel (`miniPattern(...).hits(cycle)`), never re-derived. Unlike the
 * grid's `gridOnsets`, the roll keeps each hap's length (`whole.end - whole.begin`):
 * a note's `@n` hold is part of what it plays and the writer must put it back. The
 * value the engine yields is the ground truth — a number is a numeric pitch
 * (`note("60")` MIDI / `n("0")` degree), a string is a note name. Returns null when
 * a hap isn't a placeable pitch (a sound token, a signal/params value, a zero-length
 * hap) or the query throws.
 */
export function rollOnsets(pat: MiniPattern, cyc: number): RollOnset[] | null {
  const r = readRollOnsets(pat, cyc)
  return r.ok ? r.onsets : null
}

/**
 * `rollOnsets`, saying WHY when it declines — the roll's half of
 * `readGridOnsets` (#990), and the surface where the distinction matters most:
 * a drum pattern asked of the piano roll plays SOUND names, which is not a
 * broken roll but the wrong view, and counting it as a failure is what inflated
 * every editability denominator we quoted.
 */
function readRollOnsets(pat: MiniPattern, cyc: number): Read<RollOnset[]> {
  let haps: JoinedHit[]
  try {
    haps = joinedCycle(pat, cyc).hits
  } catch {
    return no('no-note-content')
  }
  const out: RollOnset[] = []
  for (const { hit: h, atom } of haps) {
    const v = h.value
    let pitch: string
    let numeric: boolean
    if (typeof v === 'number' && Number.isFinite(v)) {
      pitch = String(v)
      numeric = true
    } else {
      // A `:`-variant arrives as krill's ARRAY (`["bd", 3]`, #1019). Rejoined to its
      // own source text and judged as the token it was WRITTEN as — which for the
      // roll is a reclassification, not new reach, and deliberately so:
      //   `bd:3` is a sound with a sample index — the grid's surface.
      //   `c4:2` is a pitch the roll still cannot serve, because its write-back
      //          replaces the leaf span and has nowhere to carry the `:2`; opening
      //          it would silently drop the index, and a view that opens and
      //          corrupts is worse than one that never opened.
      // `pitchToMidi` is fully anchored, so BOTH land in `wrong-surface` below.
      // Before #1019 both were reported as `no-note-content` — "this pattern plays
      // nothing placeable" said about a pattern that plays perfectly well, which is
      // the same conflation #990 split the two reasons apart to stop.
      const s = typeof v === 'string' ? v : Array.isArray(v) ? tailToken(v) : null
      if (s === null) return no('no-note-content') // params / a signal has no note to place
      if (NUMERIC.test(s)) {
        pitch = s
        numeric = true
      } else if (pitchToMidi(s.toLowerCase()) !== null) {
        // fold case like the core does — the row math is case-blind, and the
        // convention has no business riding back out into the document
        pitch = s.toLowerCase()
        numeric = false
      } else return no('wrong-surface') // a sound token — the grid's, not the roll's
    }
    const pos = h.begin.valueOf() - cyc
    const dur = h.end.valueOf() - h.begin.valueOf()
    if (dur <= 0) return no('no-note-content')
    out.push({ pos, dur, pitch, numeric, loc: noteSpan(atom) })
  }
  return { ok: true, onsets: out }
}

// #2159 — the same order a bare `.sort()` gives (each tuple compared as its
// `String()`), with that string built once per note instead of on every
// comparison: a 100-part roll spent ~43% of its parse in this sort.
const rollKey = (o: Array<{ pos: number; dur: number; pitch: string }>): string =>
  JSON.stringify(
    o
      .map((x) => [Math.round(x.pos * ONSET_GRID), Math.round(x.dur * ONSET_GRID), x.pitch] as const)
      .map((t) => ({ t, s: String(t) }))
      .sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0))
      .map(({ t }) => t),
  )

/** the roll's probe pitches — same single-atom requirement as `PROBE_SOUND` (#994) */
export const PROBE_NOTE = 'c9'
export const PROBE_NUM = '999'

/**
 * The roll's `projectionEditSafe`. The projection may only offer a roll the writer
 * can reproduce under edit — and for the roll that must include DURATION, the axis
 * the grid doesn't have. (This line used to size that with "the 71→44 writer-reach
 * gap", a figure from before the probe widening (#1022) and the duration axis
 * (#1026); the surfaces now read 126 step / 75 roll and the two are not comparable
 * as a "gap" at all, since they are measured over different refusal populations —
 * 697 grid asks against 1086 roll. The number is dropped rather than restated:
 * nothing here turns on its size, only on duration being an axis the roll must
 * preserve. #1038.) Probe
 * every region by swapping its first note's pitch (an overlap-free edit — a placed
 * note could land under a sustain, which the grid never has), serialize through the
 * REAL writer, re-query the REAL engine, and require the haps to be the model's
 * notes with that one pitch changed: same onsets, same durations. A region whose
 * re-emit drops an `@n` hold fails here and the projection declines, never corrupts.
 */
function projectionRollEditSafe(
  model: PianoRollModel,
  perBar: number,
  bars: number,
  numeric: boolean,
  probes: Array<{ from: number; to: number }>,
): boolean {
  const probePitch = numeric ? PROBE_NUM : PROBE_NOTE
  // Spans are ABSOLUTE model columns from the caller, for the same reason as the
  // grid's: an alt-element source repeats a within-bar span across bars, while a
  // whole-alternation's regions already sit one per bar.
  for (const { from, to } of probes) {
    const idx = model.notes.findIndex((n) => n.start >= from && n.start < to)
    if (idx < 0) continue // an all-rest region has nothing to re-emit; identity covers it
    const edited: PianoRollModel = {
      ...model,
      notes: model.notes.map((n, i) => (i === idx ? { ...n, pitch: probePitch } : n)),
    }
    const out = serializePianoRoll(edited)
    if (out == null) return false
    let pat: MiniPattern
    try {
      pat = miniPattern(out)
    } catch {
      return false
    }
    // every bar must come back with its own notes — onsets AND durations — and only
    // the probed pitch changed. Comparing cycle 0 alone would miss an edit that
    // rewrites a later bar, which is the multi-cycle loss this has to refuse.
    for (let bb = 0; bb < bars; bb++) {
      const got = rollOnsets(pat, bb)
      if (got === null) return false
      const expected = edited.notes
        .filter((n) => n.start >= bb * perBar && n.start < (bb + 1) * perBar)
        .map((n) => ({
          pos: (n.start - bb * perBar) / perBar,
          dur: n.duration / perBar,
          pitch: n.pitch,
        }))
      if (rollKey(got) !== rollKey(expected)) return false
    }
    // …and it must still repeat at `bars`
    const wrap = rollOnsets(pat, bars)
    if (wrap === null) return false
    const wrap0 = edited.notes
      .filter((n) => n.start < perBar)
      .map((n) => ({ pos: n.start / perBar, dur: n.duration / perBar, pitch: n.pitch }))
    if (rollKey(wrap) !== rollKey(wrap0)) return false
  }
  return true
}

/**
 * The inherited fallback for the piano roll (#924): when the syntactic parse
 * refuses, PROJECT the pattern's pitched haps — pitch, onset AND duration — onto a
 * roll instead of modelling its syntax. Any melodic pattern that plays a stable,
 * rational, single-cycle grid becomes editable regardless of how it nests, because
 * the roll shows what it PLAYS. The write-back tiles krill's top-level element spans
 * (`serializePianoRoll`'s span surgery), so unedited elements ride back verbatim and
 * only the edited one is re-emitted, at its own weight.
 *
 * Returns null (keep the caller's refusal) when the pattern isn't a static
 * single-cycle melodic grid — a sound pattern (that is the grid's), a `,`-stack or
 * per-cycle `<…>` (their own paths; projecting cycle 0 would drop the rest), mixed
 * numeric/named tokens, a blow-up past the step ceiling, or spans that don't tile.
 */
function projectPianoRoll(
  src0: string,
  viewScale: ViewScale = UNREFINED,
): Projection<PianoRollModel> {
  const src = src0.trim()
  if (src === '') return no('not-a-pattern')
  let pat: MiniPattern
  try {
    pat = miniPattern(src)
  } catch {
    return no('not-a-pattern')
  }
  // A whole-cycle `<…>` is projected bar-wise with its branches as regions (#938),
  // never flat — owning the whole `<…>` as one region would re-spell all of it on
  // the first edit. One carrying trailing ops has no branch tiling to write through.
  const whole = isWholeAlternation(src) ? unwrapAlternation(src) : null
  if (isWholeAlternation(src) && whole === null) return no('element-tiling')
  // What it PLAYS each cycle, and the period it repeats at (#938). A melodic pattern
  // that varies is bar-expanded rather than refused.
  const probed = playedBars(pat, readRollOnsets, rollKey, MAX_PROJECT_BARS)
  if (!probed.ok) return probed
  const perCycle = probed.perCycle
  const bars = perCycle.length
  const all = perCycle.flat()
  // mixed numeric/named tokens are rejected like the core — checked across EVERY
  // bar, since a later bar can introduce the token that breaks the convention
  const numeric = all.some((o) => o.numeric)
  if (numeric && all.some((o) => !o.numeric)) return no('mixed-pitch-domain')
  // Carries the scale as of #1117, the roll's twin of the grid's whole-cycle branch:
  // the columns WITHIN a branch come from `perBar`, and that is what a refine
  // multiplies. Ownership is decided at the identity value inside.
  if (whole !== null) {
    return bars > 1
      ? projectAltRollBars(src, whole, perCycle, numeric, viewScale)
      : no('element-tiling')
  }
  const spans = topLevelSpans(src)
  if (!spans) return no('element-tiling')
  const totalWeight = spans.reduce((s, e) => s + e.weight, 0)
  const bounds: number[] = []
  let accW = 0
  for (const e of spans) {
    bounds.push(accW / totalWeight)
    accW += e.weight
  }
  // onsets, DURATIONS and element boundaries must all land on integer columns —
  // the duration is the roll's extra term the grid's projection omits
  let documentPerBar = 1
  for (const x of [...all.map((o) => o.pos), ...all.map((o) => o.dur), ...bounds]) {
    const d = denom(x)
    if (d === 0) return no('irrational-onset')
    documentPerBar = lcm(documentPerBar, d)
  }
  // the document's blow-up guard, then the view's own ceiling — see the grid's twin
  // of this pair and `viewResolution.ts` for why they are different questions (#1055)
  if (documentPerBar * bars > MAX_STEPS) return no('resolution')
  if (!viewScaleFits(documentPerBar, bars, viewScale)) return no('view-resolution')
  const perBar = documentPerBar * viewScale
  if (perBar % totalWeight !== 0) return no('element-tiling')
  const divPerUnit = perBar / totalWeight
  const notes = barNotes(perCycle, perBar)
  if (notes === null) return no('element-tiling')

  if (bars === 1) {
    // the single-cycle projection, unchanged (#924)
    const parts = singlePart(src, spans, divPerUnit, perBar, rollContent(notes))
    if (!parts) return no('element-tiling')
    const model: PianoRollModel = {
      steps: perBar,
      ...(viewScale === UNREFINED ? {} : { viewScale }),
      notes,
      ...(numeric ? { numeric: true } : {}),
      source: { prefix: '', suffix: '', parts },
    }
    const probes0 = parts[0].regions.map((r) => ({ from: r.from, to: r.to }))
    if (!projectionRollEditSafe(model, perBar, 1, numeric, probes0)) return no('edit-unsafe')
    return { ok: true, model }
  }

  // bar-expanded: the alt-element source shape, written back by `spliceAltRoll`
  const regions = buildAltRegions<RollNote[]>(src, spans, divPerUnit, perBar, (from, to) =>
    Array.from({ length: bars }, (_, b) =>
      notes
        .filter((n) => n.start >= from + b * perBar && n.start < to + b * perBar)
        .map((n) => ({ pitch: n.pitch, start: n.start - b * perBar, duration: n.duration })),
    ),
  )
  if (!regions) return no('element-tiling')
  const model: PianoRollModel = {
    steps: perBar * bars,
    bars,
    ...(viewScale === UNREFINED ? {} : { viewScale }),
    notes,
    ...(numeric ? { numeric: true } : {}),
    altSource: { perBar, bars, div: divPerUnit, regions },
  }
  const probes = regions.flatMap((r) =>
    Array.from({ length: bars }, (_, b) => ({
      from: b * perBar + r.from,
      to: b * perBar + r.to,
    })),
  )
  if (!projectionRollEditSafe(model, perBar, bars, numeric, probes)) return no('edit-unsafe')
  return { ok: true, model }
}

/**
 * Lay each bar's played onsets onto `perBar` columns, offset into that bar.
 *
 * A note must FIT inside its own bar: the alt writer filters a region's notes by
 * start and rebases them per bar, so a note sustaining across the bar line has no
 * single bar to belong to. Refusing here keeps that ambiguity out of the writer.
 */
function barNotes(perCycle: RollOnset[][], perBar: number): RollNote[] | null {
  const notes: RollNote[] = []
  for (let b = 0; b < perCycle.length; b++) {
    for (const o of perCycle[b]) {
      const start = Math.round(o.pos * perBar)
      const duration = Math.round(o.dur * perBar)
      if (start < 0 || duration < 1 || start + duration > perBar) return null
      notes.push({ pitch: o.pitch, start: b * perBar + start, duration })
    }
  }
  return notes
}

/**
 * The roll's `projectAltBars` — a whole-cycle `<…>` the syntactic path refused,
 * projected bar-wise with the alternation's own BRANCHES as regions so an edit
 * rewrites one branch and the others ride back byte-for-byte.
 */
function projectAltRollBars(
  src: string,
  inner: string,
  perCycle: RollOnset[][],
  numeric: boolean,
  viewScale: ViewScale = UNREFINED,
): Projection<PianoRollModel> {
  const bars = perCycle.length
  const innerSrc = inner.trim()
  const spans = topLevelSpans(innerSrc)
  if (!spans) return no('element-tiling')
  if (spans.reduce((s, e) => s + e.weight, 0) !== bars) return no('element-tiling')
  const all = perCycle.flat()
  let documentPerBar = 1
  for (const x of [...all.map((o) => o.pos), ...all.map((o) => o.dur)]) {
    const d = denom(x)
    if (d === 0) return no('irrational-onset')
    documentPerBar = lcm(documentPerBar, d)
  }
  // the DOCUMENT's ceiling, on the unscaled quantity — the grid's half argues why
  if (documentPerBar * bars > MAX_STEPS) return no('resolution')
  // …and the VIEW's own. Ownership is settled one layer up at `UNREFINED`, exactly as
  // for the grid — see `projectAltBars` for why no identity pre-pass belongs here.
  if (!viewScaleFits(documentPerBar, bars, viewScale)) return no('view-resolution')
  const perBar = documentPerBar * viewScale

  const notes = barNotes(perCycle, perBar)
  if (notes === null) return no('element-tiling')
  const parts = singlePart(innerSrc, spans, perBar, perBar * bars, rollContent(notes))
  if (!parts) return no('element-tiling')
  const model: PianoRollModel = {
    steps: perBar * bars,
    bars,
    notes,
    ...(numeric ? { numeric: true } : {}),
    ...(viewScale === UNREFINED ? {} : { viewScale }),
    source: {
      parts,
      prefix: '<' + (/^\s*/.exec(inner)?.[0] ?? ''),
      suffix: (/\s*$/.exec(inner)?.[0] ?? '') + '>',
    },
  }
  const probes = parts[0].regions.map((r) => ({ from: r.from, to: r.to }))
  if (!projectionRollEditSafe(model, perBar, bars, numeric, probes)) return no('edit-unsafe')
  if (serializePianoRoll(model) !== src.trim()) return no('edit-unsafe')
  return { ok: true, model }
}

/**
 * The LEAF-anchored roll projection (#986 P1b) — the roll's half of
 * `projectStepGridByLeaf`, and the last thing tried.
 *
 * Where `projectPianoRoll` pairs the view with the source's top-level ELEMENTS and
 * re-emits an edited one, this pairs each note with its OWN pitch token and writes an
 * edit as a byte replacement there. Nothing about the grammar is authored, so the
 * notation an element re-emit cannot spell — internal structure, a patterned operator,
 * a `*n` over a group — stops being a reason to refuse the view.
 *
 * Runs LAST for the same reason the grid's does: it can only turn refusals into
 * views, never take one away from the writer that already handles it.
 */
function projectPianoRollByLeaf(src0: string): Projection<PianoRollModel> {
  const src = src0.trim()
  if (src === '') return no('not-a-pattern')
  let pat: MiniPattern
  try {
    pat = miniPattern(src)
  } catch {
    return no('not-a-pattern')
  }
  const probed = playedBars(pat, readRollOnsets, rollKey, LEAF_PROJECT_BARS.roll)
  if (!probed.ok) return probed
  const perCycle = probed.perCycle
  const bars = perCycle.length
  const all = perCycle.flat()
  // mixed numeric/named tokens are rejected like the core, across EVERY bar
  const numeric = all.some((o) => o.numeric)
  if (numeric && all.some((o) => !o.numeric)) return no('mixed-pitch-domain')
  // onsets AND durations must land on integer columns — the duration is the roll's
  // extra term the grid's projection has no equivalent of
  let perBar = 1
  for (const x of [...all.map((o) => o.pos), ...all.map((o) => o.dur)]) {
    const d = denom(x)
    if (d === 0) return no('irrational-onset')
    perBar = lcm(perBar, d)
  }
  if (perBar * bars > MAX_STEPS) return no('resolution')
  const anchored = rollAnchors(src, perCycle, perBar, bars)
  if (!anchored.ok) {
    // the grid's rule, the roll's half: only the bijection's refusal is about editing
    return anchored.gate === 'no-leaf-anchor'
      ? rollLookOnly(anchored.gate, perCycle, perBar, bars, numeric)
      : anchored
  }
  const anchors = anchored.anchors
  const model: PianoRollModel = {
    steps: perBar * bars,
    ...(bars > 1 ? { bars } : {}),
    // the notes ARE the anchors — one source of truth, so the view and the spans
    // that write it back can never describe different music
    notes: anchors.map((a) => ({ pitch: a.pitch, start: a.start, duration: a.duration })),
    ...(numeric ? { numeric: true } : {}),
    leafSource: { src, anchors, steps: perBar * bars, attachedSteps: perBar * bars },
  }
  if (!leafRollEditSafe(model, perBar, bars, numeric)) {
    return rollLookOnly('edit-unsafe', perCycle, perBar, bars, numeric)
  }
  if (!leafRollViewUsable(model)) return rollLookOnly('view-unusable', perCycle, perBar, bars, numeric)
  return { ok: true, model }
}

/**
 * Where a played note sits inside its own bar, in columns — or null when it does not
 * fit there. The roll's one cycles→columns conversion, asked by the anchors and by the
 * look-only view so the two cannot lay the same note out differently.
 */
function rollNoteInBar(o: RollOnset, perBar: number): { start: number; duration: number } | null {
  const start = Math.round(o.pos * perBar)
  const duration = Math.round(o.dur * perBar)
  return start < 0 || duration < 1 || start + duration > perBar ? null : { start, duration }
}

/**
 * THE LOOK-ONLY VIEW OF A ROLL (#1975) — `gridLookOnly` for the pitched surface, and
 * the same contract: the played notes alone, no anchors, marked so every writer
 * declines. A note that does not fit its bar gives no view and the gate unchanged.
 */
function rollLookOnly(
  gate: EditGate,
  perCycle: RollOnset[][],
  perBar: number,
  bars: number,
  numeric: boolean,
): { ok: false; gate: Gate; lookOnly?: PianoRollModel } {
  const notes: RollNote[] = []
  for (let b = 0; b < bars; b++) {
    for (const o of perCycle[b]) {
      const at = rollNoteInBar(o, perBar)
      if (at === null) return no(gate)
      notes.push({ pitch: o.pitch, start: b * perBar + at.start, duration: at.duration })
    }
  }
  return {
    ok: false,
    gate,
    lookOnly: {
      steps: perBar * bars,
      ...(bars > 1 ? { bars } : {}),
      notes,
      ...(numeric ? { numeric: true } : {}),
      lookOnly: { gate, reason: lookOnlyWhy(gate, 'roll') },
    },
  }
}

/**
 * Pair every played note with its own pitch token's span.
 *
 * The refusals are `claimLeafSpan`'s — the same bijection the grid asks, case-folded
 * because the roll folds note names for its row maths. This surface is where clause 1
 * earns its keep: the grid rejects numeric values upstream and so never meets an
 * engine-synthesised location, while numbers are the roll's whole point and 861 of
 * the corpus's ~7949 roll spans do not slice to their pitch.
 *
 * The one refusal that is NOT the bijection: a note that does not fit inside its own
 * bar has no single bar to belong to, and it is reported as its own gate because such
 * a note HAS a good source token — counting it here would overstate the write-back
 * guard (#990).
 */
function rollAnchors(
  src: string,
  perCycle: RollOnset[][],
  perBar: number,
  bars: number,
): { ok: true; anchors: RollLeafAnchor[] } | { ok: false; gate: Gate } {
  const out: RollLeafAnchor[] = []
  const seen: LeafSpan[] = []
  for (let b = 0; b < bars; b++) {
    for (const o of perCycle[b]) {
      // A note that does not fit inside its own bar is a LAYOUT refusal, not an
      // anchor one — it has a perfectly good source token, there is just no
      // single bar to hang it on. Kept distinct so the anchor count stays an
      // honest measure of the write-back guard (#990).
      const at = rollNoteInBar(o, perBar)
      if (at === null) return { ok: false, gate: 'note-crosses-bar' }
      const claim = claimLeafSpan(src, o.loc, o.pitch, seen, true)
      if (!claim.ok) return claim
      out.push({ pitch: o.pitch, start: b * perBar + at.start, duration: at.duration, span: claim.span })
    }
  }
  return { ok: true, anchors: out }
}

/**
 * The leaf roll writer's own edit probe — `leafEditSafe` for the pitched surface.
 *
 * The writer's two edits are RENAME a note's pitch and CLEAR it (`~`); duration is
 * deliberately not among them, because a held note's `@n` never appears in its hap's
 * locations and so has no span to write through. Both edits are probed at every leaf,
 * through the REAL serializer and the REAL engine, and every bar must come back as
 * predicted — so a span that is subtly wrong (or a `~` the surrounding syntax will not
 * take, `~@2` among them) makes the view refuse to open rather than corrupt on the
 * first drag.
 */
function leafRollEditSafe(
  model: PianoRollModel,
  perBar: number,
  bars: number,
  numeric: boolean,
): boolean {
  const ls = model.leafSource
  if (!ls) return false
  const probePitch = numeric ? PROBE_NUM : PROBE_NOTE
  const probes = new Map<string, RollLeafAnchor>()
  for (const a of ls.anchors) probes.set(`${a.span.start}:${a.span.end}`, a)
  for (const anchor of probes.values()) {
    for (const text of [probePitch, '~']) {
      const out = serializeByLeaf(ls.src, [{ span: anchor.span, text }])
      let edited: MiniPattern
      try {
        edited = miniPattern(out)
      } catch {
        return false
      }
      const want = leafRollExpected(
        ls.anchors,
        perBar,
        bars,
        anchor.span,
        text === '~' ? null : text,
      )
      for (let b = 0; b < bars; b++) {
        const got = rollOnsets(edited, b)
        if (got === null || rollKey(got) !== rollKey(want[b])) return false
      }
      // …and it must still REPEAT at `bars`, or the roll stops being true one cycle
      // past its own width — cycle `bars` is cycle 0 again.
      const wrap = rollOnsets(edited, bars)
      if (wrap === null || rollKey(wrap) !== rollKey(want[0])) return false
    }
  }
  return true
}

/** the notes the anchors predict once `span`'s leaf becomes `text` (null = cleared) */
function leafRollExpected(
  anchors: RollLeafAnchor[],
  perBar: number,
  bars: number,
  span: LeafSpan,
  text: string | null,
): Array<Array<{ pos: number; dur: number; pitch: string }>> {
  const out: Array<Array<{ pos: number; dur: number; pitch: string }>> = []
  for (let b = 0; b < bars; b++) out.push([])
  for (const a of anchors) {
    // a leaf shared by several notes changes at every one of them — that is the whole
    // meaning of "one token, played more than once"
    const hit = a.span.start === span.start && a.span.end === span.end
    const pitch = hit ? text : a.pitch
    if (pitch === null) continue // this note is the cleared one
    const b = Math.floor(a.start / perBar)
    if (b < 0 || b >= bars) continue
    out[b].push({
      pos: (a.start - b * perBar) / perBar,
      dur: a.duration / perBar,
      pitch,
    })
  }
  return out
}

/**
 * Only offer a roll the writer can honour at least one edit on.
 *
 * The roll's `leafViewUsable`: a pattern that is ONE token sounding many times has a
 * single leaf under every note, so deleting any one disagrees with the rest and is
 * refused — correctly, but the result is a roll where nothing the user drags moves.
 * That reads as broken, which is worse than the honest code-only refusal it replaces.
 * Asked of the REAL writer, one delete per note, so it cannot drift from a real click.
 */
function leafRollViewUsable(model: PianoRollModel): boolean {
  for (const n of model.notes) {
    if (serializePianoRoll({ ...model, notes: model.notes.filter((x) => x !== n) }) !== null) {
      return true
    }
  }
  return false
}

/**
 * Overlay the leaf spans onto a roll view the ELEMENT writer owns, so a delete can be
 * written as byte surgery while everything the view IS stays the element projection
 * (#1010 P4e). The roll's twin of `withSurgery`, and deliberately a separate function
 * rather than a shared generic: the two surfaces carry different anchor shapes
 * (`LeafSource.cols` per column, `RollLeafSource.anchors` per note) and have already
 * answered the same routing question with opposite signs, so a shared helper would be
 * the first place a future asymmetry gets silently flattened.
 *
 * The view is not touched — same notes, same columns, same view scale — so this cannot
 * change what the panel offers. It only gives the writer a second, better way to
 * answer, and `serializePianoRollWithExtent` falls back to the element paths for any
 * edit surgery cannot express (`serialize.ts`, where the asymmetry against `leafSource`
 * is stated).
 *
 * ⚠ AND IT MUST NOT BE APPLIED WHERE THE LEAF PROJECTION ALREADY OWNS THE VIEW. There a
 * refusal is the promise, not a fall-through — see `serializePianoRollWithExtent`. This
 * is reached only on the `owner.ok` branch below, which is exactly the case where the
 * element writer was already the incumbent.
 *
 * ⚠ ASKED ONLY WHERE THE ELEMENT WRITER OWNS THE VIEW, so the second projection's cost
 * is paid on the derived path alone and never for a pattern the roll's syntactic core
 * answers (412 of the 544 corpus units that open a roll are core-parsed). The
 * core-opened half is a cost problem rather than a routing one and is #1233's subject,
 * not this one's: on the grid the same overlay measured x25.5 on the core path against
 * +59% on the derived one, because a roughly constant absolute cost lands on bases an
 * order of magnitude apart. Nothing about that figure transfers to this surface
 * unmeasured — it is recorded here as the reason for the placement, not as this path's
 * price.
 */
function withRollSurgery(
  mini: string,
  r: ParseResult<PianoRollModel>,
): ParseResult<PianoRollModel> {
  if (!r.ok) return r
  // the attached width is re-stamped for the model it lands on, at the DOCUMENT's width
  // rather than the drawn one — see `withSurgery` for both halves and what each costs (#1235)
  return {
    ok: true,
    model: { ...r.model, surgical: lazyRollLeaf(mini, overlayWidth(r.model)) },
  }
}

/** The roll's half of `lazyGridLeaf`, with the same contract — see there and `SurgicalOverlay`. */
function lazyRollLeaf(mini: string, attachedSteps: number): LazyRollLeafSource {
  let computed = false
  let spans: RollLeafSource | undefined
  return {
    attachedSteps,
    spans: () => {
      if (!computed) {
        computed = true
        surgicalProjections++
        const leaf = projectPianoRollByLeaf(mini)
        spans = leaf.ok && leaf.model.leafSource
          ? { ...leaf.model.leafSource, attachedSteps }
          : undefined
      }
      return spans
    },
  }
}

/**
 * THE DERIVED WRITERS FOR THE ROLL, in the order `parsePianoRoll` asks them — the
 * roll's counterpart to `projectStepGridDerived`, and the only place this order is
 * written. See that function for why the census needs it split out; note that the
 * two orders DIFFER (the grid takes the `vacuousLocality` exception and the roll
 * does not), which is exactly why neither may be re-derived by a caller.
 */
export function projectPianoRollDerived(
  mini: string,
  fallbackReason: { ok: false; reason: string },
  viewScale: ViewScale = UNREFINED,
): ParseResult<PianoRollModel> {
  // the inherited behaviour projection (#924), then the leaf-anchored projection
  // (#986) for the notation no re-emit can spell
  //
  // ⚠ OWNERSHIP AT `UNREFINED`, the roll's twin of the grid's: `projectPianoRoll`'s
  // gates read the DRAWN column count, so asking at the scale would let a zoom hand a
  // leaf-anchored pattern to the element re-emit (#1116).
  const owner = projectPianoRoll(mini)
  const asOwner = (ok: { ok: true; model: PianoRollModel }): ParseResult<PianoRollModel> => {
    if (viewScale === UNREFINED) return ok
    const scaled = projectPianoRoll(mini, viewScale)
    return scaled.ok ? scaled : refused('roll', fallbackReason, scaled.gate, mini)
  }
  // NOT gated on `vacuousLocality` the way the grid is, and that asymmetry is
  // measured rather than assumed: preferring the leaf writer here costs the roll
  // reach outright, because a shared leaf it declines is an edit the element writer
  // completes. Reach is the invariant under contract; locality does not buy a unit
  // of it (#994).
  //
  // ⚠ RE-MEASURED at #1010, and the old figure did not survive. This comment used
  // to record the cost as one unit (73 → 72), taken at #994 on an oracle that
  // compared ONSETS ONLY. On the duration-aware oracle the same flip costs TEN:
  // 75 → 65. The original number was not wrong when it was written; it was taken
  // with an instrument that could not see the axis the flip moves, so it never
  // transferred. Re-measure a figure before reusing it across an instrument change
  // rather than carrying it forward — the grid's own answer to this same flip
  // (+5 reach, 16 fewer silent length rewrites) is the opposite sign, which is why
  // the two surfaces are decided separately and never by analogy.
  if (owner.ok) return withRollSurgery(mini, asOwner(owner))
  const leaf = projectPianoRollByLeaf(mini)
  if (leaf.ok) return leaf
  // …and if nothing opened it, report the gate that actually stopped the general
  // write-back (#990)
  return refused('roll', fallbackReason, leaf.gate, mini, leaf.lookOnly)
}

/**
 * THE PUBLIC ENTRY for the roll, and the only place a caller can express a view
 * resolution — the roll's twin of `parseStepGrid`, for the same reason and with the
 * same ordering guarantee (#1116). 412 of the 544 corpus units that open a roll are
 * core-parsed, so a scale that stopped at the derived projection was unreachable for
 * 93% of the free-zone offers it exists to serve.
 *
 * Core, then derived, unchanged: a view scale must not re-route a pattern to a
 * different projection, because the two build different `source` structures and so
 * hand the document to different writers. Ownership is therefore asked at `UNREFINED`
 * — see `parseStepGrid` for the measurement that forced this, and for why a core that
 * refuses the SCALE must not read as a core that refuses the PATTERN.
 */
export function parsePianoRoll(
  mini: string,
  viewScale: ViewScale = UNREFINED,
): ParseResult<PianoRollModel> {
  // Attached HERE and not in the core, for the reason spelled out on `parseStepGrid`.
  // The roll's core-opened half was enumerated with the grid's (#1231): of its 129 deletes
  // that move more than the note, asking the writer per unit gives 69 with no spans, 25 the
  // overlay refuses, and 35 winnable — of which #1232 shipped the 21 on the derived path
  // and these are the rest.
  const owner = parsePianoRollCore(mini)
  if (viewScale === UNREFINED) {
    return owner.ok ? withRollSurgery(mini, owner) : projectPianoRollDerived(mini, owner, UNREFINED)
  }
  const result = owner.ok
    ? withRollSurgery(mini, parsePianoRollCore(mini, viewScale))
    : projectPianoRollDerived(mini, owner, viewScale)
  return honoursViewScale(result, viewScale, 'roll')
}

// exported for the projection stress gate — it sweeps only patterns the CORE
// refuses, so it must be able to ask which those are (a projected-only filter)
export function parsePianoRollCore(
  mini: string,
  viewScale: ViewScale = UNREFINED,
): ParseResult<PianoRollModel> {
  const alt = unwrapAlternation(mini)
  // A top-level `,`-stack = parallel note lanes (independent durations / overlap,
  // #628). Only when NOT an alternation — multi-bar `<...>` lanes are out of scope.
  if (alt === null) {
    const parts = splitTopLevel(mini)
    if (parts.length > 1) return parseRollLanes(parts, viewScale)
    // Carries the scale as of #1117, exactly as the grid's `gridFromAltElements`
    // does: the bar expansion's one global `div` is what a refine multiplies.
    const altEl = rollFromAltElements(mini, viewScale)
    if (altEl !== null) return altEl
  }
  const tok = tokenize(alt ?? mini, /* allowNumeric */ true)
  if (!tok.ok) return tok
  if (alt !== null && tok.steps.length === 0) return { ok: false, reason: 'empty alternation' }

  // THE DOCUMENT'S OWN resolution and its own ceiling, both asked of the UNSCALED
  // quantity — `MAX_STEPS` guards a combinatorial blow-up in the NOTATION, which a
  // view refine does not cause (#1055, #1116, [[P412]]).
  const documentDiv = division(tok.steps)
  const bars = tok.steps.reduce((b, s) => b + s.elongation, 0)
  // BARS WHOSE STEP COUNTS DO NOT NEST are drawn each at its own count (#1827), so the
  // ceiling is asked of what is DRAWN — each bar's own count — with a separate, much
  // higher one on the shared grid the writers still spell from. Only one entry per
  // bar (no `@n` spanning bars), and only unrefined: a refine multiplies one global
  // grid, which is exactly what this layout does not have.
  const perBar =
    alt !== null && tok.steps.every((st) => st.elongation === 1) ? perBarLayout(tok.steps.map(stepUnits)) : null
  const layout = viewScale === UNREFINED ? perBar : null
  const tooWide = layout
    ? layout.some((n) => n > MAX_STEPS) || bars * documentDiv > MAX_SHARED_STEPS
    : (documentDiv > 1 || alt !== null) && bars * documentDiv > MAX_STEPS
  if (tooWide) {
    // A pattern the document draws per bar but whose REFINED view has to be one shared
    // grid is refused by the view's ceiling, not the notation's: at ×1 it opens.
    if (perBar && !layout) {
      return { ok: false, reason: gateReason('view-resolution', 'roll'), gate: 'view-resolution' }
    }
    return { ok: false, reason: `sub-sequences expand the roll past ${MAX_STEPS} steps` }
  }
  // …and the VIEW's ceiling, asked of what would actually be drawn. The columns this
  // path emits are `bars × div` — each step contributes `elongation × div` across its
  // slots — so the drawn width is exactly `bars × documentDiv × viewScale`. A per-bar
  // layout draws its own counts, already held to the cap above.
  if (!layout && !viewScaleFits(documentDiv, bars, viewScale)) {
    // one gate, one sentence (#1132): this is the VIEW's ceiling, the same refusal
    // `gateReason` already words — it was simply spelled a second way here.
    return { ok: false, reason: gateReason('view-resolution', 'roll'), gate: 'view-resolution' }
  }
  // Every note's `start` and `duration` is derived from `div` by multiplication
  // (`span = elongation × div × slot.units / total`), so scaling `div` magnifies the
  // whole roll uniformly: no onset moves relative to the bar, and no duration changes
  // relative to a column.
  const div = documentDiv * viewScale
  const notes: RollNote[] = []
  let col = 0
  // A pattern is numeric (`note("60 62")` / `n("0 1 2")`) or note-named
  // (`c3 e3`), never both — mixing is rejected. New/dragged notes must emit
  // the same convention so the pattern round-trips (#469).
  let sawNumeric = false
  let sawNamed = false
  for (const step of tok.steps) {
    const slots = step.sub ?? [{ atoms: step.atoms, units: 1 }]
    const total = stepUnits(step)
    for (const slot of slots) {
      const span = (step.elongation * div * slot.units) / total
      for (const token of slot.atoms) {
        const isNum = /^-?\d+$/.test(token)
        if (!isNum && pitchToMidi(token) === null) {
          return { ok: false, reason: `"${token}" is not a note name` }
        }
        if (isNum) sawNumeric = true
        else sawNamed = true
        // numbers have no case; only fold note names
        notes.push({ pitch: isNum ? token : token.toLowerCase(), start: col, duration: span })
      }
      col += span
    }
  }
  if (sawNumeric && sawNamed) {
    return { ok: false, reason: 'mixed numeric and note-name tokens are beyond the editable subset' }
  }
  // An alternation's regions tile the text INSIDE the brackets, so the brackets
  // (and whatever padding the user left in them) ride along as the wrapper —
  // exactly as in the grid's `<...>` path.
  const src = (alt ?? mini).trim()
  const parts = singlePart(src, tok.elements, div, col, rollContent(notes))
  const model: PianoRollModel = {
    steps: col,
    ...(alt !== null ? { bars } : {}),
    ...(viewScale === UNREFINED ? {} : { viewScale }),
    notes,
    ...(sawNumeric ? { numeric: true } : {}),
    ...(parts
      ? {
          source: {
            parts,
            prefix: alt !== null ? '<' + (/^\s*/.exec(alt)?.[0] ?? '') : '',
            suffix: alt !== null ? (/\s*$/.exec(alt)?.[0] ?? '') + '>' : '',
          },
        }
      : {}),
  }
  if (!layout) return { ok: true, model }
  // Built on the shared grid like every other roll, then drawn per bar LAST, so every
  // line above is the path it always was.
  const drawn = toDrawnRoll(model, layout)
  if (drawn) return { ok: true, model: drawn }
  return col > MAX_STEPS
    ? { ok: false, reason: `sub-sequences expand the roll past ${MAX_STEPS} steps` }
    : { ok: true, model }
}

/**
 * Parse a top-level `,`-stack of parallel note lanes into one model (#628). Each
 * part is an independent single-bar roll; the lanes must share a step grid
 * (Strudel normalizes each comma-part to its own width, so unequal widths would
 * misalign the grids) and one numeric/named convention. Notes union across lanes
 * — cross-lane overlap is the point; each part is itself overlap-free by parse.
 */
function parseRollLanes(
  parts: string[],
  viewScale: ViewScale = UNREFINED,
): ParseResult<PianoRollModel> {
  let models: PianoRollModel[] = []
  for (const part of parts) {
    // a comma-part stays on the core path — projecting individual lanes is out of
    // scope, the same way `projectStepGrid`/`projectPianoRoll` decline `,`-stacks.
    // The scale rides down with it: every part is refined by the same factor, so the
    // shared-width check below is asked of like against like, and a part that cannot
    // honour the scale refuses here and takes the whole stack with it (#1116).
    let r = parsePianoRollCore(part.trim(), viewScale)
    if (!r.ok) {
      // the grid's rule (#1849): the part alone, asked the whole chain, kept only when
      // its answer is one flat part — see `loneGridPart`
      const lone = parsePianoRoll(part.trim(), viewScale)
      const src = lone.ok ? lone.model.source : undefined
      const flat =
        lone.ok &&
        !!src &&
        src.parts.length === 1 &&
        src.prefix === '' &&
        src.suffix === '' &&
        !lone.model.altSource &&
        lone.model.bars == null &&
        (lone.model.viewScale ?? UNREFINED) === viewScale
      if (!flat) return r
      r = lone
    }
    if (r.model.bars != null) {
      return { ok: false, reason: 'multi-bar parallel note lanes are beyond the editable subset' }
    }
    models.push(r.model)
  }
  // PARTS OF DIFFERENT WIDTHS SHARE THE FINEST GRID (#1849), as the grid's stack does:
  // Strudel fits every `,`-part to the cycle, so `c3 e3 g3, c5 [d5 e5] f5 g5 a5` is 3
  // and 10 columns over one bar — 30 shared. The roll's writer indexes every part in
  // ONE column space (`rollStackSource`), so a narrower part is scaled INTO it here —
  // its notes, its regions and its `div` — rather than carrying a `factor` the writer
  // does not read. Asked of the document's own widths, the ceiling the grid uses.
  //
  // ⚠ ONLY WHOLE WIDTHS SHARE A GRID. A roll's width can be fractional (`c4@1.5 e4@1.2`
  // is 2.7 columns), and the writer lays a moved note across comma-lanes of exactly that
  // width — `~ c4@1.5 ~@0.2, ~ ~@0.5 e4@1.2` — which the gesture then reads back. There
  // is no common multiple of 2.7 and 2.7 to build, so equal widths pass untouched, as
  // they always did, and unequal fractional ones are refused as before. Caught by
  // `piano-roll-fractional-width.spec.ts`: the lcm came back huge, the read-back refused,
  // and the drag was declined.
  const widths = models.map((m) => m.steps / viewScale)
  if (!widths.every((w) => w === widths[0])) {
    if (!widths.every((w) => Number.isInteger(w))) {
      return { ok: false, reason: 'parallel note lanes must share a step grid' }
    }
    const documentTotal = widths.reduce((l, w) => lcm(l, Math.max(1, w)), 1)
    if (documentTotal > MAX_STEPS) {
      return { ok: false, reason: `the stack expands the roll past ${MAX_STEPS} steps` }
    }
    const shared = documentTotal * viewScale
    models = models.map((m) => scaleRoll(m, shared / m.steps))
  }
  const steps = models[0].steps
  const numeric = models.some((m) => m.numeric)
  if (numeric && models.some((m) => !m.numeric && m.notes.length > 0)) {
    return { ok: false, reason: 'mixed numeric and note-name lanes are beyond the editable subset' }
  }
  const notes = models.flatMap((m) => m.notes)
  return {
    ok: true,
    model: {
      steps,
      ...(viewScale === UNREFINED ? {} : { viewScale }),
      notes,
      ...(numeric ? { numeric: true } : {}),
      ...(rollStackSource(parts, models) ?? {}),
    },
  }
}

/** a roll part drawn `f` times finer: every column-valued field times `f` (#1849) */
function scaleRoll(m: PianoRollModel, f: number): PianoRollModel {
  if (f === 1) return m
  const note = (n: RollNote): RollNote => ({ ...n, start: n.start * f, duration: n.duration * f })
  return {
    ...m,
    steps: m.steps * f,
    notes: m.notes.map(note),
    ...(m.source
      ? {
          source: {
            ...m.source,
            parts: m.source.parts.map((p) => ({
              ...p,
              div: p.div * f,
              regions: p.regions.map((r) => ({ ...r, from: r.from * f, to: r.to * f, content: r.content.map(note) })),
            })),
          },
        }
      : {}),
  }
}

/**
 * The per-part source for a roll `,`-stack, reassembled from each part's own —
 * every part was parsed by `parsePianoRoll` above and already carries the
 * regions tiling its own text, so this only has to re-index them and carry the
 * `,` (with the user's padding) as the part's `before`.
 *
 * `factor` is 1 throughout, and structurally so: the caller has already refused
 * the pattern unless every part reports the same step count, so a roll's parts
 * cannot be at different resolutions the way `bd sd, hh*4` is in the grid.
 *
 * All or nothing, like the grid's: one part we can't tile means the writer can't
 * reassemble the line, so none of it is used.
 */
function rollStackSource(
  parts: string[],
  models: PianoRollModel[],
): { source: NotationSource<RollNote[]> } | null {
  const out: SourcePart<RollNote[]>[] = []
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]
    const leading = /^\s*/.exec(raw)?.[0] ?? ''
    const after = /\s*$/.exec(raw.slice(leading.length))?.[0] ?? ''
    const own = models[i].source
    // a part is a flat sequence — an alternation part is refused upstream, and
    // a wrapper here would mean these regions don't tile what we think they do
    if (!own || own.parts.length !== 1 || own.prefix !== '' || own.suffix !== '') return null
    out.push({
      part: i,
      div: own.parts[0].div,
      factor: 1,
      before: (i > 0 ? ',' : '') + leading,
      after,
      regions: own.parts[0].regions,
    })
  }
  // the parts must reassemble the line exactly, or we are not putting back what
  // we read — same check as the per-part tiling, one level up
  const rebuilt = out.map((p) => p.before + p.regions.map((r) => r.raw).join('') + p.after).join('')
  if (rebuilt !== parts.join(',')) return null
  return { source: { prefix: '', suffix: '', parts: out } }
}

/**
 * The regions of a whole bar written as ONE `[…]` element (#1855, #1942): the content
 * inside the brackets, read as a step grid, or null.
 *
 * `<[bd ~ bd ~] [bd ~ ~ bd]>` spells each bar as one bracketed element, because an entry
 * of `<…>` is one bar; the Pattern tab draws that bar's steps the way its content is cut.
 * Whether `raw` IS one bracketed sequence is krill's answer, not its first and last
 * characters: exactly one element, a `[…]` sequence (`fastcat`), weight 1, no `*`, `!`,
 * `?` or other op. Then the content must read as one flat part, with no prefix, suffix
 * or bars of its own.
 */
export function bracketedBarRegions(
  raw: string,
): NonNullable<StepGridModel['source']>['parts'][number]['regions'] | null {
  const text = raw.trim()
  let ast: MiniGroup
  try {
    ast = miniShape(text)
  } catch {
    return null
  }
  if (ast.children.length !== 1) return null
  const el = ast.children[0]
  if (el.kind !== 'element' || el.content.kind !== 'group' || el.content.alignment !== 'fastcat') return null
  if (el.weight !== 1 || el.reps !== 1 || el.ops.length > 0 || !el.span) return null
  // the element's bytes, less its brackets
  const start = el.span.start
  const end = el.span.end
  const inner = parseStepGrid(text.slice(start + 1, end - 1))
  if (!inner.ok) return null
  const src = inner.model.source
  if (!src || src.parts.length !== 1 || src.prefix || src.suffix || inner.model.bars) return null
  return src.parts[0].regions
}
