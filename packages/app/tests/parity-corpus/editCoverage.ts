/**
 * editCoverage.ts — the view-editability ORACLE, extracted so it can be gated.
 *
 * This is the measurement core `edit-coverage.spec.ts` runs in both its corpus
 * and live-Bakery modes. It lives in its own hermetic module (no vitest, no
 * env, no fs) for one reason: a `.spec.ts` is maintainer-only and never runs in
 * CI, so while the oracle lived inside it NOTHING guarded editability against
 * regression. `parity.test.ts` gates the timeline parser (`ir/parseStrudel`);
 * nothing gated `codeView/notation/parse.ts`, and the 55-fixture corpus was
 * the only thing that ever caught a real editability regression.
 *
 * Importing this module — rather than re-deriving the verdict — is the point:
 * a second copy of the oracle would answer confidently and diverge silently,
 * which is the failure this corpus exists to detect.
 *
 * Consumers:
 *   - `edit-coverage.spec.ts` — corpus + live measurement, writes the reports
 *   - `edit-parity.test.ts`   — the CI gate: per-fixture verdicts, snapshotted
 */
import {
  detectAllChunks,
  detectChunk,
  docParses,
  parseTopLevel,
  type ChunkInfo,
} from '../../../editor/src/codeView/chunkDetect'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import { hasStructure } from '../../../editor/src/codeView/notation/model'
import { chunkSurface } from '../../../editor/src/codeView/surface/surfaceRoute'
import { detectAllArrangeCalls } from '../../../editor/src/codeView/arrange/parse'
import { detectAllPickControls } from '../../../editor/src/codeView/pickControl/parse'
import { detectMasterAll } from '../../../editor/src/codeView/mixer/masterEdit'

// Bare-identifier combinators whose direct arguments are themselves patterns —
// their nested voices ARE separately editable (the app binds them via
// detectChunk at a cursor inside the voice, #395). `arrange` is deliberately
// excluded: it is edited as a CLIP control, not by descending into its arms.
const COMBINATOR_EXPAND = new Set(['stack', 'cat', 'slowcat', 'fastcat'])

// Non-musical setup/boilerplate statement heads — top-level expression
// statements that carry no editable musical content, excluded from the
// editability denominator (reported separately).
//
// NOTE `'await'` is NOT in this list, and deliberately so: `chunkDetect` does
// not unwrap `AwaitExpression`, so `await samples('github:…')` reports a null
// head and the entry could never have matched. That dead entry is what this
// list looked like when it was written by guessing at heads instead of reading
// units — `hostPlumbingRanges` below handles the await-wrapped case against the
// real AST instead. See #998.
const SETUP_HEADS = new Set([
  'samples', 'setcpm', 'setcps', 'setbpm', 'setVoicingRange', 'useRNG',
  'register', 'setGainCurve', 'setmidimap', 'aliasBank',
  'setCpm', 'setCps', 'setBpm', 'initAudio', 'setGain', 'setVolume',
])

// Host/runtime and visual calls: they start a renderer, load a video, or draw —
// they never denote a pattern, so no grid or roll could exist for them however
// good our editors get.
//
// DERIVED FROM THE UNITS, never extended speculatively: every name here was
// observed as a top-level statement in the corpus + 150 real Bakery tunes. A
// speculative entry is invisible when it is wrong, which is exactly how the
// dead `'await'` above survived.
const HOST_CALL_HEADS = new Set([
  'initHydra', 'initBytebeat', 'initVideo', 'dough', 'render', 'src', 'enableMotion',
])

/**
 * The head name of a call chain's ROOT call — `src(s0).kaleid(…).out()` is
 * headed by `src`, and `s1.initVideo('…')` by `initVideo`, matching how
 * `chunkDetect` names heads.
 */
function rootHead(node: any): string | null {
  let n = node
  while (n) {
    if (n.type === 'TaggedTemplateExpression') return n.tag?.type === 'Identifier' ? n.tag.name : null
    if (n.type === 'CallExpression') {
      const c = n.callee
      if (c?.type === 'Identifier') return c.name
      if (c?.type === 'MemberExpression') {
        if (c.object?.type === 'CallExpression' || c.object?.type === 'MemberExpression') {
          n = c.object
          continue
        }
        return c.property?.type === 'Identifier' ? c.property.name : null
      }
      return null
    }
    if (n.type === 'MemberExpression') {
      n = n.object
      continue
    }
    return null
  }
  return null
}

/** `typeof X !== 'undefined' && X(…)` — a load guard, not a track. */
function isTypeofGuard(e: any): boolean {
  if (!e || e.type !== 'LogicalExpression') return false
  let l = e.left
  while (l && (l.type === 'LogicalExpression' || l.type === 'BinaryExpression')) l = l.left
  return l?.type === 'UnaryExpression' && l.operator === 'typeof'
}

/**
 * Top-level statements that are HOST PLUMBING rather than music — the second
 * half of the coverage fraction, and the half nobody had audited (#998).
 *
 * A coverage number is `editable / musical units`. Statements that start hydra,
 * load a video, log, guard a load, or re-export a helper to `window` carry no
 * note content and never could — counting them in the denominator both deflates
 * the number and, worse, files them under `code-only`, which reads as "we have
 * no view for this YET" when the truth is "this is not a musical unit."
 *
 * THE RULE IS DELIBERATELY NARROW, and errs toward counting things AGAINST us:
 *   - only `ExpressionStatement`s. Declarations are out of scope because
 *     `detectAllChunks` never yields a chunk for one (`chunkDetect.ts:263-266`,
 *     deliberately, to avoid a duplicate strip) — so a `const x = <pattern>`
 *     line is not a unit here at all and this rule must not pretend to judge it.
 *   - an assignment is excluded only when its right-hand side is an identifier
 *     or a number/boolean — a re-export or a knob. `window.foo = "<<C E>:…>"`
 *     stays IN, because its value could carry music.
 *   - `silence`, `all(x => …)`, `chord(…)`, `seq(…)`, `pick(…)`, `mask(…)` all
 *     stay IN. They are musical units with no view yet, and must keep counting
 *     against us — that residual is the roadmap.
 */
function hostPlumbingRanges(doc: string): { setup: Overlap[]; nonMusical: Overlap[] } {
  const setup: Overlap[] = []
  const nonMusical: Overlap[] = []
  for (const stmt of parseTopLevel(doc) ?? []) {
    if (stmt.type !== 'ExpressionStatement') continue
    const range: Overlap = [stmt.start, stmt.end]
    let e = stmt.expression
    if (e?.type === 'AwaitExpression') e = e.argument

    if (isTypeofGuard(e)) {
      nonMusical.push(range)
      continue
    }
    if (e?.type === 'AssignmentExpression') {
      const r = e.right
      const bare =
        r?.type === 'Identifier' ||
        (r?.type === 'Literal' && (typeof r.value === 'number' || typeof r.value === 'boolean'))
      if (bare) nonMusical.push(range)
      continue
    }
    if (e?.type === 'CallExpression' && e.callee?.type === 'MemberExpression' && e.callee.object?.type === 'Identifier' && e.callee.object.name === 'console') {
      nonMusical.push(range)
      continue
    }
    const head = rootHead(e)
    if (head == null) continue
    if (SETUP_HEADS.has(head)) setup.push(range)
    else if (HOST_CALL_HEADS.has(head)) nonMusical.push(range)
  }
  return { setup, nonMusical }
}

type Overlap = [number, number]
const overlaps = (a: Overlap, b: Overlap) => a[0] < b[1] && b[0] < a[1]

/** Walk an ESTree node, invoking `fn` on every nested node. */
function walk(node: any, fn: (n: any) => void): void {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    const v = (node as any)[key]
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, fn)
  }
}

/**
 * Every editable UNIT in a doc: top-level chunks, plus the nested voices inside
 * stack/cat/slowcat/fastcat calls. Combinator-headed units are dropped (a
 * combinator is never a leaf editable unit — its voices are). Deduped by range.
 */
function collectUnits(doc: string): ChunkInfo[] {
  const units: ChunkInfo[] = []
  const seen = new Set<string>()
  const add = (c: ChunkInfo | null) => {
    if (!c) return
    const key = `${c.exprRange[0]}-${c.exprRange[1]}`
    if (seen.has(key)) return
    seen.add(key)
    units.push(c)
  }

  // Nested voices first. Reuse chunkDetect's own acorn parse (`parseTopLevel`)
  // — acorn is the editor's dep, not the app's, so we never import it here.
  for (const stmt of parseTopLevel(doc) ?? []) {
    walk(stmt, (n) => {
      if (
        n.type === 'CallExpression' &&
        n.callee?.type === 'Identifier' &&
        COMBINATOR_EXPAND.has(n.callee.name)
      ) {
        for (const arg of n.arguments ?? []) {
          if (arg && typeof arg.start === 'number') add(detectChunk(doc, arg.start))
        }
      }
    })
  }
  for (const c of detectAllChunks(doc)) add(c)

  // Nested stacks otherwise leak in as phantom 'code-only: stack' units.
  return units.filter((u) => !(u.headFn != null && COMBINATOR_EXPAND.has(u.headFn)))
}

export type UnitStatus =
  | { status: 'setup'; head: string }
  | { status: 'non-musical'; head: string }
  | { status: 'note'; kind: 'roll' | 'step' }
  | { status: 'note-single'; kind: 'roll' | 'step'; head: string }
  | { status: 'note-broken'; kind: 'roll' | 'step'; reason: string; gate?: string; head: string }
  | { status: 'clip'; kind: string }
  | { status: 'master' }
  | { status: 'knobs' }
  | { status: 'code-only'; head: string }

/**
 * ── THE THREE QUESTIONS `status === 'note'` USED TO ANSWER AT ONCE ──────────
 *
 * Until #1260 there was one notation verdict, so every consumer that wanted ANY
 * of these wrote `status === 'note'` and got all three for free:
 *
 *   1. a notation surface ROUTED for this unit            `routesToNotation`
 *   2. …and its parser returned a model, so the unit's
 *      content span is KNOWN                              `hasKnownContent`
 *   3. …and that model is worth drawing                   `status === 'note'`
 *
 * Term 3 splits them, and the split is the whole hazard of this change: three
 * `.test.ts` gates and the corpus harvest were asking questions 1 and 2 through
 * a string that now also answers question 3. Left alone, each of them would
 * have moved for a reason that has nothing to do with what it measures — the
 * calibration's known-content population would have fallen 600 → 446, the
 * census's "no view opens on this" set would have GROWN by the same 154, and
 * the next corpus refresh would have silently dropped those units' minis.
 *
 * So the two lower questions get names. A consumer that means "did a view open"
 * says so, and cannot be moved by a change to what counts as worth drawing.
 * ([[P572]]: ask what a rule is indexed BY before agreeing two uses are one.)
 */

/** A notation surface routed for this unit — the panel asked, whatever came back. */
export const routesToNotation = (s: UnitStatus): boolean =>
  s.status === 'note' || s.status === 'note-single' || s.status === 'note-broken'

/** …and the parser returned a model, so this unit's content span is known. */
export const hasKnownContent = (s: UnitStatus): boolean =>
  s.status === 'note' || s.status === 'note-single'

/**
 * How a broken unit is BUCKETED in the blocker histogram (#990).
 *
 * The parser's `gate` when it has one, the raw reason otherwise. The gate is the
 * cause; the reason string used to be whichever of the three stacked writers
 * declined FIRST, so a histogram keyed on it ranked subsystems that had nothing
 * to do with why the unit was unavailable — "nested groups" sat near the top of
 * this list for months while not one of those units was stopped by nesting.
 *
 * NOTE on `wrong-surface`: it means the values played belong to the other view.
 * In the both-surfaces gate sweep that is a routing fact and no failure at all —
 * a drum pattern SHOULD decline the roll. Here it is still an editability
 * failure, because this harness routes by HEAD (`note`/`n` → roll, `s`/`sound` →
 * grid) exactly as the app does: a `wrong-surface` unit is one whose head asks
 * for a view its own values cannot fill, and the user gets code. Same gate, two
 * honest readings — which is why the distinction is worth carrying.
 */
const blockerKey = (s: { kind: string; reason: string; gate?: string }): string =>
  `${s.kind}: ${s.gate ?? s.reason}`

function classifyUnit(
  u: ChunkInfo,
  arrangeRanges: Overlap[],
  pickRanges: Overlap[],
  plumbing: { setup: Overlap[]; nonMusical: Overlap[] },
  masterRanges: Overlap[],
): UnitStatus {
  const head = u.headFn
  const mini = u.miniString
  if (head != null && SETUP_HEADS.has(head)) return { status: 'setup', head }
  // Statement-level host plumbing (#998). Checked against the real AST rather
  // than the unit's head, because the head is null for the shapes that matter
  // (`await samples(…)`, `window.x = y`, a `typeof` guard).
  if (plumbing.setup.some((r) => overlaps(r, u.exprRange))) return { status: 'setup', head: head ?? '(await)' }
  if (plumbing.nonMusical.some((r) => overlaps(r, u.exprRange))) {
    return { status: 'non-musical', head: head ?? '(no-head)' }
  }
  // WHICH SURFACE, ASKED ONCE, OF THE FUNCTION THE PANEL ITSELF ASKS.
  //
  // This was three branches — `note`/`n` straight to the roll, `s`/`sound`
  // straight to the grid, and only the RESOLVER case routed through the shared
  // rule. That was safe exactly while the head decided everything, because then
  // the two agreed by construction. #1243 ends that: a melodic head whose roll
  // declines a chord chart on vocabulary now routes to the grid, and a harness
  // still reading the head would have scored those units as refusals while the
  // app drew them. Two derivations of one decision is the defect #1250 was, one
  // layer down ([[PV327]]) — so there is one derivation and the harness shares it.
  //
  // `chunkSurface` also carries the SCOPING, which is why the `miniVia` test is
  // gone from here rather than duplicated: a head-call literal on a non-content
  // head (`lpf("0 1 2")`) still answers null and still lands in knobs/code-only.
  const surface = mini !== null ? chunkSurface(u) : null
  if (surface !== null && mini !== null) {
    const r = surface === 'roll' ? parsePianoRoll(mini) : parseStepGrid(mini)
    if (!r.ok) {
      return { status: 'note-broken', kind: surface, reason: r.reason, gate: r.gate, head: head ?? '(no-head)' }
    }
    // INVARIANT 3'S THIRD TERM, ASKED HERE FOR THE FIRST TIME (#1256 → #1260).
    //
    // The two lines above are the invariant's first two terms — a surface
    // routed, and the string round-tripped into a model. That is all this
    // returned `note` for, and #1256 measured what it was letting through:
    // 154 of the 591 units it counted on 150 real tunes draw a single grey box
    // or a single dot. `s("piano")` is a correct model of a correct string and
    // is not a surface anyone can edit music in.
    //
    // The predicate is `hasStructure`, IMPORTED — it is the writer census's own
    // rule, given one home in #1259 precisely so this could ask it rather than
    // spell a fourth copy. Its grid/roll asymmetry is deliberate and documented
    // at the definition; the surface key selects the clause, and `surface` here
    // is the same value that chose the parser one line up, so the model and the
    // clause cannot come apart.
    return hasStructure(r.model, surface)
      ? { status: 'note', kind: surface }
      : { status: 'note-single', kind: surface, head: head ?? '(no-head)' }
  }
  if (arrangeRanges.some((r) => overlaps(r, u.exprRange))) return { status: 'clip', kind: 'arrange' }
  if (pickRanges.some((r) => overlaps(r, u.exprRange))) return { status: 'clip', kind: 'pick' }
  // A master `all(x => …)` line, edited through the mixer's master strip
  // (`detectMasterAll`). Checked BEFORE `knobs` because it is a real view edit —
  // the strip's fader, pan and insert chain — not a bare numeric argument, and
  // AFTER the note surfaces because those are strictly more specific. See #1003.
  //
  // `detectMasterAll` and not `detectMasterAudioAll`: the mute sentinel
  // (`x => silence`) and viz-only lines are master lines with their own editors
  // (the mute toggle, viz assignment), so the broader detector is the right
  // question here. The one shape this would over-count is a SECOND audio
  // `all(x => …)` line, which the mixer does not bind and the user could not
  // reach — measured across the corpus and 150 real tunes: 16 master lines, all
  // 16 the bound line, 0 unbound extras. Stated because it is an assumption,
  // not because it currently bites.
  //
  // `!u.nested` is DEFENSIVE, and says so because a guard that reads as
  // load-bearing when it never fires is a false claim about the code.
  // `collectUnits` expands stack/cat voices anywhere in the document, so voices
  // inside `all(x => x.add(stack(a, b)))` would lexically overlap the master
  // statement — but measured, they do not survive as distinct units:
  // `detectChunk` at those positions anchors on the enclosing statement and the
  // range-dedup collapses them. So this has zero firings today. It is kept
  // because crediting a voice to a strip that edits the whole LINE would be the
  // same over-count in the other direction, and the cost is one condition.
  if (!u.nested && masterRanges.some((r) => overlaps(r, u.exprRange))) return { status: 'master' }
  if (u.type === 'knobs') return { status: 'knobs' }
  return { status: 'code-only', head: head ?? '(no-head)' }
}

/**
 * Every musical unit in a doc paired with the verdict this harness gives it —
 * the unit model itself, exposed so a measurement can be taken PER UNIT without
 * re-deriving `collectUnits`/`classifyUnit` beside it. A second copy of the unit
 * model would answer confidently and diverge silently, which is the failure this
 * module's header names. `measureDocs` is the only other caller.
 */
export function unitsWithStatus(doc: string): { unit: ChunkInfo; status: UnitStatus }[] {
  if (!docParses(doc)) return []
  const arrangeRanges = detectAllArrangeCalls(doc).map((a): Overlap => a.callRange)
  const pickRanges = detectAllPickControls(doc).map((p): Overlap => p.callRange)
  const plumbing = hostPlumbingRanges(doc)
  const masterRanges = detectMasterAll(doc).map((m): Overlap => m.statementRange)
  return collectUnits(doc).map((unit) => ({
    unit,
    status: classifyUnit(unit, arrangeRanges, pickRanges, plumbing, masterRanges),
  }))
}

export interface TuneReport {
  file: string
  /** musical units only (setup/boilerplate AND host plumbing excluded) */
  units: number
  setup: number
  /** host plumbing: hydra init, video, render, logging, guards, re-exports (#998) */
  nonMusical: number
  /**
   * invariant 3's third term: a view opened and round-tripped, and holds a
   * single sound or a single note. Excluded from the denominator, NOT counted
   * as a failure — see the note above `measureDocs` (#1256/#1260).
   */
  noteSingle: number
  noteEditable: number
  clip: number
  /** master `all(x => …)` lines, edited through the mixer's master strip (#1003) */
  master: number
  noteBroken: number
  knobs: number
  codeOnly: number
  /** structurally editable = note OR clip OR master (real view editing, not just a knob) */
  structurallyEditable: number
  /**
   * ⚠ `no-musical-units` IS NOT A FAILURE CLASS, and separating it from
   * `code-only` is #998's own argument one level up (#1260).
   *
   * A tune whose every statement is setup, host plumbing, or a single sound has
   * nothing for this measurement to be about. Before term 3 that branch was
   * unreachable in the vendored corpus; wiring it made 5 fixtures land there,
   * and they were arriving as `code-only` — which reads as "we have no view for
   * this yet" and dropped the tune-level headline from 41/57 to 34/57 by
   * reclassifying tunes that contain no question.
   *
   * `code-only` still means what it always meant: this tune HAS musical units
   * and not one of them has a view. Two of the seven fixtures that moved really
   * are that, and they stay there.
   */
  tuneClass: 'fully' | 'partial' | 'knobs-only' | 'code-only' | 'no-musical-units' | 'unparseable'
}

/** One refused unit, kept so a reason can be checked against its inputs (#2152). */
export interface BrokenInput {
  file: string
  head: string
  mini: string
}

export interface Measurement {
  tunes: TuneReport[]
  brokenReasons: Map<string, number>
  /**
   * The units behind each `brokenReasons` count, under the same key, so the
   * list for a reason is exactly as long as its count. #903 audited this
   * histogram by adding temporary logging to see the strings; two "missing
   * features" turned out to work and a decimal point read as a feature. The
   * inputs are part of the output so that check needs no code change.
   */
  brokenInputs: Map<string, BrokenInput[]>
  codeOnlyHeads: Map<string, number>
}

/**
 * The measurement core — shared by corpus and live modes.
 *
 * ── WHY `note-single` LEAVES THE DENOMINATOR (#1256, shape B) ──────────────
 * A unit whose whole content is one sound or one note is not one we are FAILING
 * to serve. `s("piano")` is a timbre, and the thing that edits a timbre is the
 * mixer strip and the code line itself; there is no melody in it for a grid to
 * have drawn. Counting it in the denominator would mean the coverage number can
 * only be improved by building a view nobody wants for content that has none.
 *
 * That is exactly the argument #998 accepted when it took host plumbing out of
 * this same denominator, which is why the exclusion sits BESIDE `non-musical`
 * rather than folded into `knobs`: `knobs` means "a real musical unit we have
 * no view for yet, and it counts against us". These units DID get a view.
 *
 * ⚠ THE EXCLUSION IS THE PRODUCT CALL, NOT A ROUNDING. It moves the headline
 * both ways — numerator and denominator — so it is reported as its own column
 * everywhere the number appears, and never quietly netted off.
 */
export function measureDocs(docs: { name: string; code: string }[]): Measurement {
  const tunes: TuneReport[] = []
  const brokenReasons = new Map<string, number>()
  const brokenInputs = new Map<string, BrokenInput[]>()
  const codeOnlyHeads = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

  for (const { name, code } of docs) {
    if (!docParses(code)) {
      tunes.push({
        file: name, units: 0, setup: 0, nonMusical: 0, noteSingle: 0, noteEditable: 0, clip: 0, master: 0,
        noteBroken: 0, knobs: 0, codeOnly: 0, structurallyEditable: 0, tuneClass: 'unparseable',
      })
      continue
    }
    const allUnits = unitsWithStatus(code)

    let note = 0, clip = 0, master = 0, broken = 0, knobs = 0, codeOnly = 0, setup = 0, nonMusical = 0
    let noteSingle = 0
    for (const { unit, status: s } of allUnits) {
      switch (s.status) {
        case 'setup': setup++; break
        case 'non-musical': nonMusical++; break
        case 'note-single': noteSingle++; break
        case 'note': note++; break
        case 'clip': clip++; break
        case 'master': master++; break
        case 'knobs': knobs++; break
        case 'note-broken': {
          broken++
          const key = blockerKey(s)
          bump(brokenReasons, key)
          // `note-broken` is only returned once a mini string was parsed, so it is never null here.
          const list = brokenInputs.get(key) ?? []
          list.push({ file: name, head: s.head, mini: unit.miniString ?? '' })
          brokenInputs.set(key, list)
          break
        }
        case 'code-only': codeOnly++; bump(codeOnlyHeads, s.head); break
      }
    }
    const musical = allUnits.length - setup - nonMusical - noteSingle
    const structural = note + clip + master
    const tuneClass: TuneReport['tuneClass'] =
      musical === 0 ? 'no-musical-units'
      : structural === musical ? 'fully'
      : structural > 0 ? 'partial'
      : knobs > 0 ? 'knobs-only'
      : 'code-only'

    tunes.push({
      file: name, units: musical, setup, nonMusical, noteSingle, noteEditable: note, clip, master,
      noteBroken: broken, knobs, codeOnly, structurallyEditable: structural, tuneClass,
    })
  }
  return { tunes, brokenReasons, brokenInputs, codeOnlyHeads }
}

const pct = (x: number, d: number) => (d === 0 ? '0.0' : ((100 * x) / d).toFixed(1))
const rank = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])

/** Aggregate a Measurement into the headline numbers (pure). */
export function aggregate(m: Measurement) {
  const { tunes } = m
  const n = tunes.length
  const cls = (c: TuneReport['tuneClass']) => tunes.filter((t) => t.tuneClass === c).length
  const sum = (f: (t: TuneReport) => number) => tunes.reduce((a, t) => a + f(t), 0)
  const fully = cls('fully')
  const partial = cls('partial')
  const anyEditable = fully + partial
  const noMusicalUnits = cls('no-musical-units')
  // Shape B at TUNE level: a tune with no musical units leaves this denominator
  // for the same reason its statements left the unit one. `unparseable` stays
  // IN — a document we cannot read is a real failure, not an absent question.
  const measurable = n - noMusicalUnits
  const totalUnits = sum((t) => t.units)
  const uNote = sum((t) => t.noteEditable)
  const uClip = sum((t) => t.clip)
  const uMaster = sum((t) => t.master)
  return {
    n, measurable, fully, partial, anyEditable, noMusicalUnits,
    knobsOnly: cls('knobs-only'), codeOnlyTunes: cls('code-only'), unparseable: cls('unparseable'),
    totalUnits, uSetup: sum((t) => t.setup), uNonMusical: sum((t) => t.nonMusical),
    uNoteSingle: sum((t) => t.noteSingle), uNote, uClip,
    uMaster,
    uStructural: uNote + uClip + uMaster, uBroken: sum((t) => t.noteBroken),
    uKnobs: sum((t) => t.knobs), uCode: sum((t) => t.codeOnly),
    anyEditablePct: Number(pct(anyEditable, measurable)),
    structuralPct: Number(pct(uNote + uClip + uMaster, totalUnits)),
  }
}

export function summaryLines(label: string, m: Measurement): string[] {
  const a = aggregate(m)
  const lines = [
    `══════════ EDIT-COVERAGE (${label}) ══════════`,
    `tunes: ${a.n}`,
    `TUNE  any-editable: ${a.anyEditable}/${a.measurable} (${a.anyEditablePct}%)  ` +
      `[fully ${a.fully} · partial ${a.partial} · knobs ${a.knobsOnly} · code ${a.codeOnlyTunes} · unparse ${a.unparseable}]  ` +
      `(of ${a.n} tunes; ${a.noMusicalUnits} have no musical unit to measure)`,
    `UNIT  structural: ${a.uStructural}/${a.totalUnits} (${a.structuralPct}%)  ` +
      `[note ${a.uNote} · clip ${a.uClip} · master ${a.uMaster} · broken ${a.uBroken} · knobs ${a.uKnobs} · code ${a.uCode}]  ` +
      `(excluded: setup ${a.uSetup} · host plumbing ${a.uNonMusical} · single sound/note ${a.uNoteSingle})`,
    'top note-broken reasons:',
    ...rank(m.brokenReasons).slice(0, 6).map(([k, c]) => `   ${c}×  ${k}`),
    'top code-only heads:',
    ...rank(m.codeOnlyHeads).slice(0, 8).map(([k, c]) => `   ${c}×  ${k}`),
  ]
  return lines
}

export function renderMarkdown(m: Measurement, title: string): string {
  const a = aggregate(m)
  const md: string[] = []
  md.push(`# ${title}`)
  md.push('')
  md.push(`Generated by \`tests/parity-corpus/edit-coverage.spec.ts\`. ${a.n} tunes.`)
  md.push('')
  md.push('> **What "editable" means:** a unit is *structurally editable* when its note')
  md.push('> string round-trips into a StepGrid/PianoRoll model **that holds more than one')
  md.push('> thing** (the app\'s own `useGridModel` gate, plus invariant 3\'s third term —')
  md.push('> #1256), **or** it is an `arrange`/`pickRestart` clip control, **or** it is a')
  md.push('> master `all(x => …)` line the mixer\'s master strip edits.')
  md.push('> `note-broken` = the app would OFFER a grid/roll editor but the string does')
  md.push('> not round-trip (the "offered but blank" class). `knobs`-only = numeric')
  md.push('> params but no note/clip structure. Setup/boilerplate heads excluded, and so')
  md.push('> are units whose whole content is a single sound or a single note.')
  md.push('')
  md.push('## Tune-level')
  md.push('')
  md.push(`Percentages are over the **${a.measurable}** tunes that have at least one musical`)
  md.push(`unit. The other **${a.noMusicalUnits}** are setup, host plumbing, or a single sound`)
  md.push('end to end — they are listed below but are not a question this measurement can')
  md.push('answer, and filing them as `code-only` said we had no view for something that')
  md.push('has no content (#1260).')
  md.push('')
  md.push('| Class | Tunes | % |')
  md.push('|---|---:|---:|')
  md.push(`| Fully editable (every unit note/clip) | ${a.fully} | ${pct(a.fully, a.measurable)} |`)
  md.push(`| Partially editable (≥1 note/clip unit) | ${a.partial} | ${pct(a.partial, a.measurable)} |`)
  md.push(`| **Any editable surface (fully+partial)** | **${a.anyEditable}** | **${pct(a.anyEditable, a.measurable)}** |`)
  md.push(`| Knobs-only | ${a.knobsOnly} | ${pct(a.knobsOnly, a.measurable)} |`)
  md.push(`| Code-only (no view edit) | ${a.codeOnlyTunes} | ${pct(a.codeOnlyTunes, a.measurable)} |`)
  md.push(`| Unparseable | ${a.unparseable} | ${pct(a.unparseable, a.measurable)} |`)
  md.push(`| *No musical unit — excluded from the above* | *${a.noMusicalUnits}* | — |`)
  md.push('')
  md.push('## Unit-level')
  md.push('')
  md.push(`Total musical units (top-level chunks + stack/cat voices): **${a.totalUnits}**`)
  md.push('')
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
  md.push(`Excluded from that denominator: **${plural(a.uSetup, 'setup/boilerplate statement')}**`)
  md.push(`and **${plural(a.uNonMusical, 'host-plumbing statement')}** — hydra`)
  md.push('`initHydra`/`initVideo`/`render`/`src`, `console.*`, `typeof` load guards, and')
  md.push('`window.x = y` re-exports. These carry no note content and no view could ever open')
  md.push('them, so counting them would both deflate the percentage and file them under')
  md.push('`code-only`, which reads as "no view for this yet" (#998). Deliberately still')
  md.push('counted AGAINST us: `silence`, `all(x => …)`, `chord(…)`, `seq(…)`, `pick(…)` and')
  md.push('`mask(…)` — real musical units with no view yet.')
  md.push('')
  md.push(`Also excluded: **${plural(a.uNoteSingle, 'single-sound/single-note unit')}** —`)
  md.push('invariant 3\'s third term (#1256). A view opened for these and the string')
  md.push('round-tripped, and what it drew is one grey box (`s("piano")`) or one dot')
  md.push('(`note("C3")`). There is no melody in them for a grid to have drawn, so they are')
  md.push('not units we are failing to serve — the mixer strip and the code line are their')
  md.push('editor, which is the same argument #998 used for host plumbing. Reported as its')
  md.push('own column, never netted off, because the exclusion moves the fraction both ways.')
  md.push('')
  md.push('| Status | Units | % |')
  md.push('|---|---:|---:|')
  md.push(`| note-editable (round-trips) | ${a.uNote} | ${pct(a.uNote, a.totalUnits)} |`)
  md.push(`| clip (arrange/pick) | ${a.uClip} | ${pct(a.uClip, a.totalUnits)} |`)
  md.push(`| master strip (\`all(x => …)\`) | ${a.uMaster} | ${pct(a.uMaster, a.totalUnits)} |`)
  md.push(`| **structurally editable** | **${a.uStructural}** | **${pct(a.uStructural, a.totalUnits)}** |`)
  md.push(`| note-broken (offered, no round-trip) | ${a.uBroken} | ${pct(a.uBroken, a.totalUnits)} |`)
  md.push(`| knobs-only | ${a.uKnobs} | ${pct(a.uKnobs, a.totalUnits)} |`)
  md.push(`| code-only | ${a.uCode} | ${pct(a.uCode, a.totalUnits)} |`)
  md.push('')
  md.push('## Blocker histogram — `note-broken` (offered a grid/roll but no round-trip)')
  md.push('')
  md.push('> Bucketed by the **gate that actually stopped the write-back**, not by the')
  md.push('> first writer to decline (#990). Three writers stack behind one parse call')
  md.push('> — syntactic core → element projection → leaf projection — and the reason')
  md.push('> string used to be whichever spoke first, which is how "nested groups" led')
  md.push('> this list while not one of those units was stopped by nesting.')
  md.push('>')
  md.push('> `wrong-surface` = the values played belong to the other view. Under this')
  md.push('> harness\'s head routing (`note`/`n` → roll, `s`/`sound` → grid, as the app')
  md.push('> does) that is still an editability failure: the head asks for a view its')
  md.push('> own values cannot fill. It is only a non-failure in a sweep that asks BOTH')
  md.push('> surfaces of every unit — there, a drum pattern *should* decline the roll.')
  md.push('')
  md.push('| Count | kind: gate |')
  md.push('|---:|---|')
  for (const [k, c] of rank(m.brokenReasons)) md.push(`| ${c} | ${k} |`)
  if (m.brokenReasons.size === 0) md.push('| — | none |')
  md.push('')
  md.push('## Blocker histogram — `code-only` head functions')
  md.push('')
  md.push('| Count | head |')
  md.push('|---:|---|')
  for (const [k, c] of rank(m.codeOnlyHeads)) md.push(`| ${c} | ${k} |`)
  if (m.codeOnlyHeads.size === 0) md.push('| — | none |')
  md.push('')
  md.push('## Per-tune')
  md.push('')
  md.push('| Tune | units | note | clip | master | broken | knobs | code | single | class |')
  md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const t of m.tunes) {
    md.push(
      `| ${t.file} | ${t.units} | ${t.noteEditable} | ${t.clip} | ${t.master} | ${t.noteBroken} | ${t.knobs} | ${t.codeOnly} | ${t.noteSingle} | ${t.tuneClass} |`,
    )
  }
  md.push('')
  return md.join('\n')
}

export function resultJson(m: Measurement, extra: Record<string, unknown> = {}) {
  const a = aggregate(m)
  return {
    ...extra,
    tunes: a.n,
    tuneLevel: {
      measurable: a.measurable, fully: a.fully, partial: a.partial, anyEditable: a.anyEditable,
      knobsOnly: a.knobsOnly, codeOnly: a.codeOnlyTunes, unparseable: a.unparseable,
      noMusicalUnits: a.noMusicalUnits,
      anyEditablePct: a.anyEditablePct,
    },
    unitLevel: {
      totalUnits: a.totalUnits, note: a.uNote, clip: a.uClip, master: a.uMaster,
      structurallyEditable: a.uStructural,
      noteBroken: a.uBroken, knobs: a.uKnobs, codeOnly: a.uCode, setup: a.uSetup,
      nonMusical: a.uNonMusical, noteSingle: a.uNoteSingle,
      structurallyEditablePct: a.structuralPct,
    },
    brokenReasons: Object.fromEntries(rank(m.brokenReasons)),
    // Same keys, same order as `brokenReasons`.
    brokenInputs: Object.fromEntries(rank(m.brokenReasons).map(([k]) => [k, m.brokenInputs.get(k) ?? []])),
    codeOnlyHeads: Object.fromEntries(rank(m.codeOnlyHeads)),
    perTune: m.tunes,
  }
}
