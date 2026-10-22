/**
 * Continuous automation a track declares, read off the static IR (#1464 Stage 1).
 *
 * `.cutoff(saw.slow(4).range(200, 2000))` is a parameter that MOVES, and until
 * #1478/#1482 it reached the IR as an opaque `Code` — the timeline could not see
 * that anything was modulated at all. Those two landed the three legs #1464 names
 * as its prerequisite, so the shape, the rate and the range are now plain field
 * reads off a nested node:
 *
 *   Param{key:'cutoff', value: Range{lo:200, hi:2000,
 *                                body: Slow{factor:4,
 *                                       body: Signal{kind:'saw'}}}}
 *
 * This module turns that into what a lane needs to DRAW one, plus — since Stage 2
 * (#1464 option 2) — WHERE each leg is written, so a control can edit it in place.
 * It still emits no source and holds no inverse: `SignalSpans` carries source
 * COORDINATES, and the byte-verbatim round-trip #1482 established stays preserved
 * by construction here, because nothing in this file can produce text. What
 * changes is that a caller now has somewhere precise to write, which is exactly
 * the leverage Stage 2 needs and the whole of what this file lends it.
 *
 * Mirrors `trackOrder.ts`: pure and structural, no eval and no source scanning,
 * producing an IR-derived input for `buildTimelineScene` (which is documented
 * PURE — no IR walk) rather than reaching into the IR from inside the scene.
 */
import type { PatternIR } from './PatternIR'
import type { SourceLocation } from './IREvent'
import { isSectionWindow, placementsTimeAt, playableParameters, type TimeStep } from './parameterRoutes'

type SignalNode = PatternIR & { tag: 'Signal' }
export type SignalKind = SignalNode['kind']

/**
 * A signal's NATURAL output range, when it has one — what the curve spans before
 * any `.range()` is applied.
 *
 * Grounded in `@strudel/core@1.2.6/signal.mjs` rather than inferred from the
 * names: the `2`-suffixed kinds are literally `x.toBipolar()` and the unsuffixed
 * ones are unipolar, which is a rule the source states rather than a convention
 * we are reading into it —
 *   saw     = signal((t) => t % 1)              → 0..1   (signal.mjs:35)
 *   saw2    = saw.toBipolar()                   → -1..1  (signal.mjs:42)
 *   sine2   = signal((t) => sin(2*PI*t))        → -1..1  (signal.mjs:70)
 *   sine    = sine2.fromBipolar()               → 0..1   (signal.mjs:80)
 *   square2 = square.toBipolar()                → -1..1  (signal.mjs:114)
 *   tri2    = fastcat(saw2, isaw2)              → -1..1  (signal.mjs:131)
 *   itri2   = fastcat(isaw2, saw2)              → -1..1  (signal.mjs:148)
 *   rand2   = rand.toBipolar()                  → -1..1  (signal.mjs:453)
 *   perlin  = "in the range 0..1" (its own doc) → 0..1   (signal.mjs:661)
 *
 * ⚠ `unbounded` is the load-bearing member. `time` is `signal(id)` — it returns
 * the cycle position and GROWS without limit (signal.mjs:155) — and the
 * `cyclesPer`/`per`/`perCycle`/`perx` family measure durations, so none of them
 * has a range to draw between. They are not a gap in this table: a lane that
 * guessed 0..1 for `time` would draw a confidently wrong curve, which is worse
 * than drawing nothing. They ABSTAIN, and a `.range()` does not change that: `range`
 * scales what enters it without bounding it (#1614).
 */
type Polarity = 'unipolar' | 'bipolar' | 'unbounded'

/**
 * The kinds with no natural range: `time` grows, and `cyclesPer`/`per`/`perCycle`/`perx`
 * are set by the rhythm they are applied to (`signal.mjs:986-1017`).
 *
 * A TYPE rather than a list, so both places that classify a kind — `POLARITY` below and
 * the timeline's drawing table — have to agree on it when they compile (#1494). `Extract`
 * drops a misspelt member, and `POLARITY` then refuses to call that kind unbounded.
 */
export type UnboundedSignalKind = Extract<SignalKind, 'time' | 'cyclesPer' | 'per' | 'perCycle' | 'perx'>

/**
 * Every kind's polarity, WRITTEN OUT (#1494).
 *
 * This was a rule: unbounded if listed, bipolar if the name ends in `2`, unipolar
 * otherwise. A rule answers for a kind nobody has looked at, and here in the worst
 * direction — a new signal with no natural range, left off the list, would be read as
 * 0..1 and drawn, the confident wrong curve #1614 removed. Keyed by `SignalKind`, a kind
 * added to the IR does not compile until someone decides.
 *
 * Every bipolar signal in signal.mjs is the `2`-suffixed spelling of a unipolar one,
 * produced by `.toBipolar()`: `sine2`/`cosine2`/`saw2`/`isaw2`/`tri2`/`itri2`/`square2`/
 * `rand2`, the whole set.
 */
const POLARITY: { readonly [K in SignalKind]: K extends UnboundedSignalKind ? 'unbounded' : 'unipolar' | 'bipolar' } = {
  sine: 'unipolar',
  cosine: 'unipolar',
  saw: 'unipolar',
  isaw: 'unipolar',
  tri: 'unipolar',
  itri: 'unipolar',
  square: 'unipolar',
  sine2: 'bipolar',
  cosine2: 'bipolar',
  saw2: 'bipolar',
  isaw2: 'bipolar',
  tri2: 'bipolar',
  itri2: 'bipolar',
  square2: 'bipolar',
  perlin: 'unipolar',
  berlin: 'unipolar',
  rand: 'unipolar',
  brand: 'unipolar',
  rand2: 'bipolar',
  mousex: 'unipolar',
  mousey: 'unipolar',
  mouseX: 'unipolar',
  mouseY: 'unipolar',
  time: 'unbounded',
  cyclesPer: 'unbounded',
  per: 'unbounded',
  perCycle: 'unbounded',
  perx: 'unbounded',
}

function polarityOf(kind: SignalKind): Polarity {
  return POLARITY[kind]
}

/** One drawable continuous automation: which track, which parameter, and the
 *  three legs (#1464's own words) needed to plot it. */
export interface SignalAutomation {
  /** The lane this belongs to — the same `trackId` `declaredTracks` keys on. */
  readonly trackId: string
  /** The automated control: `cutoff`, `gain`, `pan`, … (the `Param`'s key). */
  readonly paramKey: string
  /** The signal's SHAPE. */
  readonly kind: SignalKind
  /** The signal's RATE, as the cycles one full period spans. `sine` is 1;
   *  `.slow(4)` makes it 4; `.fast(2)` makes it 0.5. Always finite and > 0. */
  readonly periodCycles: number
  /** The bars one period of the curve spans ON THE LANE (#1464 Stage 3):
   *  `periodCycles` with every whole-track time change on its route applied — under
   *  `.slow(2)`, `saw.slow(4)` repeats every 8 (engine-checked). A section does not
   *  scale it: a section plays its own cycles one bar to a bar. Null when the routes
   *  disagree (one binding under two different time changes), which leaves no one
   *  number for a lane to show or a control to edit. */
  readonly lanePeriodCycles: number | null
  /** The signal's RANGE — the floor and ceiling the engine PLAYS, which is not always
   *  what a `.range()` call spells (#1610, see `boundsOf`). `lo` is where the signal's
   *  own low point lands, so a range written high-to-low reads `lo > hi`. */
  readonly lo: number
  readonly hi: number
  /** True when the chain carries an explicit `.range()`; false when `lo`/`hi` are the
   *  signal's natural polarity. Kept because it is the difference between a number the
   *  user wrote and one this module supplied, and a lane that ever labels the axis must
   *  not present the second as the first. */
  readonly ranged: boolean
  /** True when a bound typed into this curve reads back as typed (#1610): the values
   *  entering the range an edit writes — the outermost `.range()`, or one inserted at
   *  `chainEnd` — run exactly 0..1, so that call's arguments ARE the curve's bounds.
   *  False on a bipolar signal (`sine2.range(200, 2000)` plays −1600..2000) and under an
   *  inner range that is not 0..1, where writing the typed pair plays another one. */
  readonly boundsAsWritten: boolean
  /** Source offset of the `Param` call site, or null. The same coordinate the
   *  lanes already carry, so a later stage can bind this to the editor without a
   *  second provenance channel invented for it. */
  readonly offset: number | null
  /** WHERE each leg is written (#1464 Stage 2). Read the type's own doc. */
  readonly spans: SignalSpans
  /**
   * Where the curve plays, one entry per route to it: the arrangement sections
   * (#1590) and whole-track time changes (#1595) that route passes through,
   * OUTERMOST FIRST — the same shape the stepped reader carries. `[[]]` for a curve
   * under neither.
   */
  readonly placements: readonly (readonly TimeStep[])[]
}

/**
 * Where each of the three legs is SPELLED in the source (#1464 Stage 2).
 *
 * ⚠ THIS IS THE ONLY WAY A CONTROL CAN WRITE, and the reason is structural, not
 * stylistic. `Range` regenerates from `rawArgs` and `Param` from its own
 * `rawArgs` (`toStrudel.ts:226`, `:196`) — that is what buys the byte-verbatim
 * round-trip #1482 established. The consequence is that setting `lo`/`hi` on an
 * IR node and re-emitting writes NOTHING: the raw text wins. So every Stage 2
 * edit is a source-offset replacement over these spans, on the same path every
 * other edit surface in this codebase uses.
 *
 * A span is `null` when the leg is not spelled — `sine` with no `.range()` names
 * no numbers to replace. That is not a gap to paper over: it is a DIFFERENT edit
 * (insert a call at `chainEnd`), and the two must not be confused, because one
 * preserves every other byte and the other lengthens the document.
 *
 * Measured over the sweep corpus (`loadCorpus`, 150 documents, 133 drawable
 * automations since #1595): range spelled 118 (89%), rate spelled 78 (59%),
 * NEITHER 12 (9%). #1595 added 14 curves under a whole-track slow, 12 of which
 * spell no rate of their own — the slow is the track's. Before that, #1590 took it
 * from 204 (184 / 130 / 16) to 119 (105 / 76 / 11) by declining curves drawn on the
 * wrong clock, and the shares held.
 * (#1468 moved the first three by +4/+4/+2: two documents whose top-level
 * bindings were discarded by the old leading-run rule now resolve, so their
 * chains are readable. The shares are unchanged.)
 * ⚠ Those figures are OWNED BY A GATE, not transcribed here and left to rot:
 * `packages/app/tests/parity-corpus/signal-span-census.test.ts` derives them
 * from these spans and pins them, so the comment and the corpus cannot drift
 * apart silently. Update both together or neither. The 8% is what makes
 * `captionEdit`'s insert path real rather than defensive.
 */
export interface SignalSpans {
  /** The signal identifier itself — `sine`, `perlin`. Replacing this text is the
   *  whole of a shape change. */
  readonly shape: SourceLocation | null
  /** The single `.slow(n)` / `.fast(n)` call site.
   *
   *  ⚠ NULL when the chain carries MORE THAN ONE rate arm, not only when it
   *  carries none. `sine.slow(2).fast(4)` has a well-defined rate (the product)
   *  and no well-defined place to write a new one — editing either arm produces
   *  the asked-for rate while silently changing what the user wrote elsewhere.
   *  Abstaining is the same discipline `readChain` already applies to shapes it
   *  cannot account for. */
  readonly rate: SourceLocation | null
  /** The `.range(lo,hi)` call site whose bounds WON — the outermost one, which
   *  is the one `readChain` adopted. An inner `.range()` it supersedes is dead
   *  in the document already and is not what a control should edit. */
  readonly range: SourceLocation | null
  /** Offset just past the whole signal expression, where an ABSENT leg's call
   *  would be inserted: `sine` + `.range(0,1)` at `chainEnd`. Null when the
   *  outermost node carries no source range, in which case no edit is possible
   *  and a control must be offered as disabled rather than as broken. */
  readonly chainEnd: number | null
}

/** The transform arms this module understands between a `Param` and its
 *  `Signal`. ANYTHING else ends the descent without an automation — see
 *  `readChain`. Deliberately tiny: `Range` is the range leg, `Slow`/`Fast` are
 *  the rate leg, and those are exactly the three #1464 asks for. */
const CHAIN_TAGS: ReadonlySet<string> = new Set(['Range', 'Slow', 'Fast'])

/** Source-coordinate keys — arrays of `{start,end}`, never IR. Skipped so the
 *  reflective walk does not wade through them on every node. */
const SKIP_KEYS: ReadonlySet<string> = new Set(['loc', 'keyLoc', 'callSiteRange'])

interface ChainRead {
  readonly signal: SignalNode
  readonly periodCycles: number
  /** Every `.range(lo, hi)` in the chain, OUTERMOST FIRST (descent order). */
  readonly ranges: readonly { readonly lo: number; readonly hi: number }[]
  /** #1464 Stage 2 — see `SignalSpans`. Collected on the same descent that
   *  reads the values, because the node carrying a value and the node carrying
   *  its source range are the same node; a second walk to find them again could
   *  disagree with this one about which `Range` won. */
  readonly spans: SignalSpans
}

/**
 * Descend a `Param`'s value looking for a signal underneath a chain of
 * transforms this module can account for.
 *
 * ⚠ ABSTAINS RATHER THAN GUESSES. The descent only walks `Range`/`Slow`/`Fast`;
 * meeting any other tag returns null and the parameter simply draws nothing. That
 * is the conservative direction here: this is a VIEW, so a missing curve is a
 * lane that shows less than it could, while a wrong curve is the editor lying
 * about what the document does. `.gain(sine.add(saw))` is real, has no closed
 * form this module can plot, and must therefore fall out rather than be
 * approximated by whichever leg the walk happened to reach first.
 *
 * EVERY `Range` is kept, outermost first, because ranges COMPOSE rather than
 * supersede (#1610): `range` is an affine map over what enters it, so
 * `sine.range(0, 2).range(2, 3)` plays 2..4, not the outer 2..3 (measured).
 * `boundsOf` folds them. The span is the outermost one's — the call an edit writes.
 * Descent order is application order reversed, so the first met is the last applied.
 */
function readChain(node: PatternIR): ChainRead | null {
  let cur: PatternIR = node
  let periodCycles = 1
  const ranges: { lo: number; hi: number }[] = []
  let rangeSpan: SourceLocation | null = null
  // Every rate arm met, not the first — the count is what decides whether a
  // control may write one at all. See `SignalSpans.rate`.
  //
  // ⚠ ARMS AND SPANS ARE COUNTED SEPARATELY. The safety condition is about the
  // ARMS: two rate arms compose, so writing `.slow(n)` to one of them gives the
  // asked-for rate while silently changing what the other means. Counting spans
  // instead would let a two-arm chain in which only ONE arm carries a source
  // range read as "one arm, safe to write".
  //
  // Today's parser attaches a range to every arm it builds, so that tree does
  // not arise from parsing — this is a latent hole rather than an observed
  // defect, closed because the cost is one integer and the failure would be a
  // silently wrong document.
  let rateArms = 0
  const rateSpans: SourceLocation[] = []
  // The OUTERMOST node's end: the insertion point for a leg the source omits.
  // Taken on the first iteration, before any descent, because that node is the
  // whole expression as written — `sine.slow(4).range(200,2000)` ends where
  // `.range(200,2000)`'s own call site ends.
  const chainEnd = spanOf(node)?.end ?? null

  // Bounded by the IR's own depth; the guard is against a malformed cyclic node
  // rather than against legal input.
  for (let depth = 0; depth < 64; depth++) {
    if (!cur || typeof cur !== 'object' || typeof cur.tag !== 'string') return null

    if (cur.tag === 'Signal') {
      return {
        signal: cur as SignalNode,
        periodCycles,
        ranges,
        spans: {
          shape: spanOf(cur),
          rate: rateArms === 1 && rateSpans.length === 1 ? rateSpans[0] : null,
          range: rangeSpan,
          chainEnd,
        },
      }
    }
    if (!CHAIN_TAGS.has(cur.tag)) return null

    if (cur.tag === 'Range') {
      // A range whose bounds are not numbers maps its input somewhere this module
      // cannot say, and every range outside it inherits that — so the curve abstains.
      // Latent today: the parser builds a `Range` only from two numeric literals
      // (`parseStrudel.ts`, `isNumericLiteral`) and leaves anything else opaque.
      if (!Number.isFinite(cur.lo) || !Number.isFinite(cur.hi)) return null
      // The first one met is the outermost: the call a typed bound replaces.
      if (ranges.length === 0) rangeSpan = spanOf(cur)
      ranges.push({ lo: cur.lo, hi: cur.hi })
    } else if (cur.tag === 'Slow') {
      if (!Number.isFinite(cur.factor) || cur.factor <= 0) return null
      periodCycles *= cur.factor
      rateArms++
      const span = spanOf(cur)
      if (span) rateSpans.push(span)
    } else if (cur.tag === 'Fast') {
      if (!Number.isFinite(cur.factor) || cur.factor <= 0) return null
      periodCycles /= cur.factor
      rateArms++
      const span = spanOf(cur)
      if (span) rateSpans.push(span)
    }

    const body: unknown = (cur as { body?: unknown }).body
    if (!body || typeof body !== 'object') return null
    cur = body as PatternIR
  }
  return null
}

/**
 * #1610 — the floor and ceiling the engine PLAYS, and whether a typed bound reads back.
 *
 * `range(lo, hi)` is `pat.mul(hi − lo).add(lo)` (`@strudel/core/pattern.mjs:1771`): an
 * affine map over whatever enters it, whose own doc assumes that input runs 0..1. Its
 * arguments are its output only then. So the signal's natural range is carried through
 * every range in the chain, innermost first — measured through the engine,
 * `sine2.range(200, 2000)` plays −1600..2000 and `sine.range(0, 2).range(2, 3)` 2..4.
 *
 * ⚠ WRITTEN `a·(1 − t) + b·t`, NOT `a + t·(b − a)`. The two agree as arithmetic and
 * not as floats: at t = 1 the first is exactly `b`, while `0.1 + (0.3 − 0.1)` is
 * `0.30000000000000004`. That noise would be the automation's own number, and
 * `captionEdit` writes the untouched bound from it — so the second form would put a
 * number nobody typed into the document on the next edit of the other bound.
 *
 * ⚠ An UNBOUNDED signal never reaches here. It has no natural range for a range to map,
 * so under one it still abstains (#1614).
 */
function boundsOf(
  polarity: Polarity,
  ranges: readonly { readonly lo: number; readonly hi: number }[],
): { lo: number; hi: number; boundsAsWritten: boolean } {
  let lo = polarity === 'bipolar' ? -1 : 0
  let hi = 1
  // What enters the OUTERMOST range — or, with none, what an inserted one would meet.
  let enteringLo = lo
  let enteringHi = hi
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]
    enteringLo = lo
    enteringHi = hi
    lo = r.lo * (1 - enteringLo) + r.hi * enteringLo
    hi = r.lo * (1 - enteringHi) + r.hi * enteringHi
  }
  return { lo, hi, boundsAsWritten: enteringLo === 0 && enteringHi === 1 }
}

/** A node's own source range, or null. `loc` is an ARRAY because some nodes are
 *  assembled from several source sites; the chain arms this module walks are
 *  each one call, so the first entry is the whole of it. */
function spanOf(node: PatternIR): SourceLocation | null {
  const loc = (node as { loc?: SourceLocation[] }).loc
  const first = loc?.[0]
  if (!first) return null
  return Number.isFinite(first.start) && Number.isFinite(first.end) ? first : null
}

/**
 * Every child IR node of `node`, found by REFLECTION rather than by a tag switch.
 *
 * ⚠ This is the deliberate choice in this file. An exhaustive `switch` over tags
 * is the house style for the semantic paths, but it carries a known cost: a new
 * IR tag inherits whatever the `default` arm does, silently, from every consumer
 * that was written before it existed. This consumer only needs to FIND `Param`
 * nodes — it makes no claim about what any tag means — so reading children
 * structurally makes it correct for tags that do not exist yet, and there is no
 * `default` arm to forget to update. The semantic judgement is confined to
 * `readChain`, which allowlists and abstains.
 */
function childNodes(node: PatternIR): PatternIR[] {
  const out: PatternIR[] = []
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 12) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof (value as PatternIR).tag === 'string') {
      // A node. Yield it; its own children are found when IT is walked.
      out.push(value as PatternIR)
      return
    }
    // An UNTAGGED container — pass straight through it. `Code.via` and
    // `NamedPick.entries` both hold real sub-IR behind a plain object, so a
    // reflection that only stepped into tagged values stopped dead at them and
    // silently lost everything underneath. Measured: walking only tagged values
    // reached 142 of the corpus's 362 distinct signal-carrying Params.
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEYS.has(key)) continue
      visit(child, depth + 1)
    }
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (SKIP_KEYS.has(key)) continue
    visit(value, 0)
  }
  return out
}

/**
 * `SignalAutomation.lanePeriodCycles`. A warp hands the curve `t · times / per`, so
 * it comes back round `per / times` times as late — the scaling `songPeriodOf`
 * applies to a stepped parameter (#1595). That function answers a different
 * question (when the whole SONG repeats, sections folded in as passes); this one is
 * what one lane shows repeating inside the bars it plays.
 */
function lanePeriodOf(periodCycles: number, placements: readonly (readonly TimeStep[])[]): number | null {
  let agreed: number | null = null
  for (const placement of placements) {
    let p = periodCycles
    for (const step of placement) if (!isSectionWindow(step)) p = (p * step.per) / step.times
    if (agreed !== null && agreed !== p) return null
    agreed = p
  }
  return agreed
}

type Playable = ReturnType<typeof playableParameters> extends Iterable<infer T> ? T : never

/** One closed-form curve on a control, before anything asks whether a lane can draw it. */
interface ReadCurve {
  readonly trackId: Playable['trackId']
  readonly param: Playable['param']
  readonly placements: Playable['placements']
  readonly read: ChainRead
  readonly polarity: Polarity
}

/**
 * The curves both readers below start from: every closed-form curve on a control, played
 * at a time a lane can draw. `signalAutomations` (what a lane DRAWS) and `signalWriters`
 * (what WRITES a control) share it so they cannot disagree about which curves exist; they
 * differ only on polarity, because an unbounded signal writes its control and cannot be
 * drawn (#1614).
 */
function readCurves(ir: PatternIR | null | undefined): ReadCurve[] {
  const out: ReadCurve[] = []
  for (const { trackId, param, placements } of playableParameters(ir)) {
    if (placements.some((p) => p.some((step) => !isSectionWindow(step) && step.shift < 0))) continue
    const value: unknown = param.value
    if (!value || typeof value !== 'object' || typeof (value as PatternIR).tag !== 'string') continue
    const read = readChain(value as PatternIR)
    if (!read) continue
    out.push({ trackId, param, placements, read, polarity: polarityOf(read.signal.kind) })
  }
  return out
}

/**
 * Every continuous automation the document declares, by track, in the order the
 * shared walk meets them. Empty for a document with none — which is most of them,
 * and is why the drawing side must treat absence as ordinary.
 *
 * ⚠ ONLY WHERE THE CURVE IS HANDED A TIME A LANE CAN DRAW (#1590). A curve under
 * `.early(0.5)`, `cpm`, or `jux(x => x.late(.25))` plays at a time the song's clock
 * does not give (measured through the engine: off by up to 0.917), and one
 * overridden by a later same-key call plays nothing at all. Those decline, by the
 * same walk the stepped reader uses (`parameterRoutes.ts`). A curve inside an
 * arrangement section, or under a whole-track `.slow`/`.fast` (#1595), is kept with
 * its placements and drawn at the time they hand it (`signalTimeAt`).
 *
 * ⚠ A LATER SHIFT DECLINES (#1595). `.late(o)` hands the curve `t − o`, which is
 * negative before bar `o`, and there the engine evaluates `saw = t % 1` with the
 * sign kept (`signal.mjs:35`): `saw.slow(3)` under `.late(0.5)` plays −0.1667 at
 * song time 0 (measured), below the floor a lane wraps its phase to. An earlier
 * shift (`.late(−o)`) never goes negative and is kept.
 */
export function signalAutomations(ir: PatternIR | null | undefined): readonly SignalAutomation[] {
  const out: SignalAutomation[] = []
  for (const { trackId, param, placements, read, polarity } of readCurves(ir)) {
    // ⚠ AN UNBOUNDED SIGNAL ABSTAINS WITH OR WITHOUT A RANGE (#1614). Without one there is
    // nothing to plot between. With one, `range` is an affine map (`boundsOf`): it scales
    // the signal and does not bound it. Measured through the engine,
    // `cutoff(time.range(200, 800))` plays 200..9762.5 over 16 cycles, while the lane —
    // which wraps a curve's phase every period — drew a 200→800 saw that agreed with it
    // only in the first cycle. It still writes its control (`signalWriters`).
    if (polarity === 'unbounded') continue
    const ranged = read.ranges.length > 0
    const { lo, hi, boundsAsWritten } = boundsOf(polarity, read.ranges)
    const start = param.loc?.[0]?.start
    out.push({
      trackId,
      paramKey: param.key,
      kind: read.signal.kind,
      periodCycles: read.periodCycles,
      lanePeriodCycles: lanePeriodOf(read.periodCycles, placements),
      lo,
      hi,
      ranged,
      boundsAsWritten,
      offset: typeof start === 'number' && Number.isFinite(start) ? start : null,
      spans: read.spans,
      placements,
    })
  }
  return out
}

/** One curve that writes a control — see `signalWriters`. */
export interface SignalWriter {
  readonly trackId: string
  readonly paramKey: string
  readonly kind: SignalKind
}

/**
 * Every closed-form curve that WRITES a control, whether or not a lane can draw it
 * (#1614): what `signalAutomations` reads, plus the unbounded signals it declines.
 *
 * ⚠ ASK THIS, NOT THE DRAWING READER, HOW MANY CURVES SHARE A CONTROL. A stand-in that
 * replaces a control's values on a lane replaces every writer's (`previewShapeSwap`), so
 * the count must not depend on which of them happens to be drawable. Counting only the
 * drawn ones let a `time` on the same control go unseen.
 */
export function signalWriters(ir: PatternIR | null | undefined): readonly SignalWriter[] {
  return readCurves(ir).map(({ trackId, param, read }) => ({ trackId, paramKey: param.key, kind: read.signal.kind }))
}

/**
 * The time a curve is handed at song time `time` — the argument its signal is
 * evaluated at — or null when its section is silent then (#1590). A curve under no
 * section is handed the song's time itself. The lane samples `kind` at
 * `signalTimeAt(a, t) / periodCycles` and lifts the pen where this is null.
 */
export function signalTimeAt(a: SignalAutomation, time: number): number | null {
  return placementsTimeAt(a.placements, time)
}

/**
 * Every parameter KEY whose argument carries a signal anywhere (#1465).
 *
 * ⚠ THIS IS A DIFFERENT QUESTION FROM `signalAutomations`, ON THE SAME IR, and
 * the difference is the point rather than an oversight. That reader asks "can I
 * PLOT this?" and abstains on anything without a closed form. This one asks "does
 * this control MOVE?" — and `.gain(sine.add(saw))` has no closed form, cannot be
 * drawn, and absolutely does make every cycle differ.
 *
 * Measured over the sweep's own corpus (`loadCorpus`, 142 documents that
 * evaluate), before #1590: the closed-form reader saw 199 signal-carrying `Param`
 * nodes and this one 239. Answering the period question with the drawing reader
 * would silently under-report by those 40 — and by far more since #1590, which
 * made the drawing reader decline every curve the song does not hand its own
 * clock (the span census counted 119 drawable automations there after #1590, and
 * 133 once #1595 drew the whole-track slows back). This reader is unchanged by
 * either: a curve under `.early(0.5)` still makes its control move.
 *
 * Returns KEYS rather than nodes because that is what the consumer needs: the
 * cycle fingerprint reads an event's whole value partition (`eventValueKey.ts` —
 * `{note, freq, s, gain, velocity, color} ∪ params`), and a key is how a
 * dimension is named there. `cutoff`/`resonance`/`pan`/`room` arrive via
 * `params`; `gain` has a dedicated slot. Both are addressed by key.
 *
 * Structural and horizon-FREE, which is the property that matters. An earlier
 * attempt at this exclusion derived it by watching a probe window, so a field
 * whose period exceeded that window read as unstable and got dropped — it
 * discarded `note` and `s` in ~75 documents. `Param{value: …Signal}` is the same
 * fact at horizon 4 and at horizon 256, so it cannot drift with the horizon it
 * feeds.
 */
export function signalCarryingParamKeys(ir: PatternIR | null | undefined): ReadonlySet<string> {
  return paramKeysCarrying(ir, ANY_SIGNAL)
}

/**
 * Does any control here move by a signal that never comes back round — `rand`,
 * `perlin`, `time`, the mouse (#2109)?
 *
 * The same unconditional reader as `signalCarryingParamKeys`, asked of the kind:
 * `stack(s("bd").gain(sine.slow(8)), s("hh").gain(time.range(.2, .8)))` has a `time`
 * no curve reader draws, and it keeps the song from ever repeating all the same.
 */
export function carriesUnrepeatingSignal(
  ir: PatternIR | null | undefined,
  // A shape-swap preview (#1611) asks about the song AFTER the swap: the curve whose
  // shape starts at `at` is read as `kind`.
  swap?: { readonly at: number; readonly kind: SignalKind },
): boolean {
  const kindOf = (n: SignalNode): SignalKind =>
    swap !== undefined && n.loc?.[0]?.start === swap.at ? swap.kind : n.kind
  return paramKeysCarrying(ir, (n) => !hasTruePeriod(kindOf(n))).size > 0
}

const ANY_SIGNAL = (): boolean => true

function paramKeysCarrying(
  ir: PatternIR | null | undefined,
  match: (signal: SignalNode) => boolean,
): ReadonlySet<string> {
  const keys = new Set<string>()
  if (!ir) return keys
  const stack: PatternIR[] = [ir]
  const seen = new Set<PatternIR>()
  while (stack.length > 0) {
    const node = stack.pop() as PatternIR
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (node.tag === 'Param' && typeof node.key === 'string' && node.key.length > 0) {
      const value: unknown = node.value
      if (value && typeof value === 'object' && carriesSignal(value, match)) keys.add(node.key)
    }
    for (const child of childNodes(node)) stack.push(child)
  }
  return keys
}

/** Does this subtree contain a `Signal` (one `match` accepts) anywhere? Deliberately
 *  unconditional — no allowlist, no closed-form requirement — because ANY signal
 *  underneath a control means that control moves. */
function carriesSignal(value: unknown, match: (signal: SignalNode) => boolean, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 24) return false
  if (Array.isArray(value)) return value.some((v) => carriesSignal(v, match, depth + 1))
  const o = value as Record<string, unknown>
  if (o.tag === 'Signal' && match(o as unknown as SignalNode)) return true
  for (const [key, child] of Object.entries(o)) {
    if (SKIP_KEYS.has(key)) continue
    if (carriesSignal(child, match, depth + 1)) return true
  }
  return false
}

/**
 * Signals whose output actually REPEATS, listed rather than derived (#1465).
 *
 * The song period rule folds a signal's rate into the song's period, and that is
 * only meaningful for a signal that comes back to where it started. `sine.slow(4)`
 * repeats every 4 cycles; `rand` and `perlin` sample new values forever, `time`
 * grows without bound, and `mouseX` is live input. Sampling any of those longer
 * never yields a repeat, so there is no rate to fold — a document automated only
 * by those has no true period at all, and the analysis must say so rather than
 * invent one.
 *
 * ⚠ AN ALLOWLIST, DELIBERATELY, and the direction of the default is the reason.
 * A kind added to `PatternIR` later and forgotten here is treated as NOT
 * periodic, which costs a fold the analysis could have made — the period stays
 * the structural one, which is the answer production already gives. The denylist
 * spelling fails the other way: a new noise source would be folded as though it
 * repeated, and the song would be handed a definite length its audio does not
 * have. One direction under-promises, the other lies.
 *
 * The membership is `@strudel/core@1.2.6/signal.mjs` read directly, the same
 * source `polarityOf` above is grounded in: the periodic set is the waveform
 * family (`sine`/`cosine`/`saw`/`isaw`/`tri`/`itri`/`square`) in both its
 * unipolar and `2`-suffixed bipolar spellings, and nothing else.
 */
const PERIODIC_KINDS: ReadonlySet<string> = new Set([
  'sine', 'cosine', 'saw', 'isaw', 'tri', 'itri', 'square',
  'sine2', 'cosine2', 'saw2', 'isaw2', 'tri2', 'itri2', 'square2',
])

/** Does this signal's output repeat, so that `periodCycles` names a real period
 *  rather than just a rate? See `PERIODIC_KINDS` for why this is an allowlist. */
export function hasTruePeriod(kind: SignalKind): boolean {
  return PERIODIC_KINDS.has(kind)
}

/** The shapes a curve can be switched between, most used first (558 archive documents:
 *  sine 113, tri 21, saw 14, cosine 2, square 1, isaw 1; perlin 82, rand 60). */
const REPEATING_SHAPES: readonly SignalKind[] = ['sine', 'tri', 'saw', 'cosine', 'square', 'isaw', 'itri']
const REPEATING_BIPOLAR_SHAPES: readonly SignalKind[] = ['sine2', 'tri2', 'saw2', 'cosine2', 'square2', 'isaw2', 'itri2']
const NOISE_SHAPES: readonly SignalKind[] = ['perlin', 'rand']
/** Noise a curve may be switched AWAY from. `rand2` is left out: no other noise has a
 *  bipolar spelling, so it has nothing to switch to. */
const NOISE_KINDS: ReadonlySet<string> = new Set(['perlin', 'rand', 'berlin', 'brand'])

/**
 * The shapes a curve of `kind` can be switched to by replacing its identifier and nothing
 * else (#1464), most used first, never `kind` itself. Empty when there is none.
 *
 * ⚠ ONE CLASS AT A TIME, and each half of the class is load-bearing:
 *  - SAME POLARITY. `range(lo, hi)` is `mul(hi − lo).add(lo)` and assumes 0..1 input
 *    (`pattern.mjs:1771`), so `sine2.range(200, 2000)` plays −1600..2000 (measured).
 *    A swap across polarity moves the output the caption promises.
 *  - SAME PERIODICITY. The song's length folds in the period of every signal that
 *    repeats and nothing from noise (`signalDimensionsOf`): `sine.slow(4)` folds `[4]`,
 *    `perlin.slow(4)` folds `[]`. A swap between the two can change how long the song
 *    is, so it is offered apart from these, with that length said first
 *    (`crossClassShapes`, #1611).
 * Inside one class the range, the rate and the song's length all stay as they were.
 *
 * `time` and the mouse signals are their own classes and offer nothing.
 */
export function shapeAlternatives(kind: SignalKind): readonly SignalKind[] {
  const family = hasTruePeriod(kind)
    ? polarityOf(kind) === 'bipolar' ? REPEATING_BIPOLAR_SHAPES : REPEATING_SHAPES
    : NOISE_KINDS.has(kind) ? NOISE_SHAPES : []
  return family.filter((k) => k !== kind)
}

/**
 * The shapes a curve of `kind` can be switched to ACROSS periodicity (#1611): a repeating
 * waveform to noise, or noise to a repeating waveform, most used first.
 *
 * Same polarity still, for `shapeAlternatives`' first reason — so only a unipolar curve
 * has a partner: the only bipolar noise is `rand2`, and a repeating bipolar curve would
 * have nothing to become.
 *
 * ⚠ A SWAP FROM THIS LIST CAN CHANGE HOW LONG THE SONG IS, both ways: `sine.slow(16)`
 * beside a 4-bar line repeats at 16 and `perlin.slow(16)` there at 4 (measured through
 * the engine). Offer one only with the song's length after it said first
 * (`previewShapeSwap`).
 */
export function crossClassShapes(kind: SignalKind): readonly SignalKind[] {
  if (polarityOf(kind) !== 'unipolar') return []
  if (hasTruePeriod(kind)) return NOISE_SHAPES
  return isNoiseKind(kind) ? REPEATING_SHAPES : []
}

/** Is `kind` one of the noise signals a curve may be switched away from — values with no
 *  waveform period (they do come back, but only after 300 of their own cycles: see
 *  `songAnalysis`' `NOISE_SEED_CYCLES`)? The same set the menus offer from (`NOISE_KINDS`). */
export function isNoiseKind(kind: SignalKind): boolean {
  return NOISE_KINDS.has(kind)
}
