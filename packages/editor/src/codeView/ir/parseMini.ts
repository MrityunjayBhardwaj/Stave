/**
 * parseMini — mini-notation string → PatternIR, via the krill grammar.
 *
 * The mini-notation grammar is STRUDEL'S, so we ask Strudel for it: this file
 * lowers Strudel's own parse — handed over as plain nodes by
 * `../strudelMini/shape.ts` (#1972) — into PatternIR instead of re-tokenizing
 * the string ourselves. The hand-rolled tokenizer + byte-position operator
 * scanner it replaced (#943) was a second oracle of a grammar Strudel ships
 * complete and located — every "gap" in it was drift, never a missing feature,
 * and it shipped real bugs (a wrong bjorklund distribution, #907; `!`/`/`/`_`
 * silently mis-parsed). The notation layer (`codeView/notation/parse.ts`)
 * already parses the same mini via krill; this brings the IR world up to it.
 *
 * WHAT STAYS OURS is the LOWERING — krill's uniform ops model (`weight`/`reps`/
 * `ops[]` on every element) is lowered into PatternIR's structural tags:
 *   - `bd(3,8)`  → a flat Seq of Play/Sleep (euclid expanded via `bjorklund`)
 *   - `a*2`/`a/2`→ Fast / Slow      · `a?` → Choice      · `a@2` → Elongate
 *   - `a!3`      → three sibling Plays (replicate)        · `a:3` → slice param
 *   - `[a b]`    → Seq   · `[a,b]` → Stack (chord)
 *   - `<a b>`    → Cycle · `{a,b}` → Stack (polymeter)
 * Transform SEMANTICS are never modeled here — they run in Strudel; we only
 * shape the note tree and thread source `loc` back to it.
 *
 * loc: krill's element spans TILE the source (they include padding), so every loc
 * here is built from an ATOM's tight span (`MiniAtom.span`: the token itself, found
 * by the adapter) or from a delimiter found in the text — never from an element's
 * tiling end. `loc-fidelity.test.ts` (which slices each node's `[start,end]` out
 * of the source) is the gate that pins this.
 */

import {
  argAtom,
  isRest,
  miniShape,
  type MiniElement,
  type MiniGroup,
  type MiniOp,
} from '../strudelMini/shape'
import { IR, type PatternIR, type PlayParams } from './PatternIR'
import { bjorklund, rotateEuclid } from './euclid'

// The `bjorklund` distribution is re-exported for the euclid-authority + the
// integration tests that import it from here (its home is now `./euclid`).
export { bjorklund } from './euclid'

// ---------------------------------------------------------------------------
// The nodes this file lowers (`MiniGroup`, `MiniElement`, `MiniAtom`, `MiniOp`) and
// the call that produces them (`miniShape`) live in `../strudelMini/shape.ts` — the
// one place that reads krill's own fields (#1972). Three things this file used to
// work out for itself are answers there now: an atom's tight span (`atom.span`),
// whether an atom is silence (`isRest`: `~` and `-`, one branch upstream; `_` is
// NOT silence — it is sustain, already folded into the previous element's weight),
// and the atom an op's argument holds (`argAtom`: a euclid's numbers arrive wrapped
// in an element, a `*n` amount bare).
// ---------------------------------------------------------------------------

/**
 * The elements of a sequence. krill gives ELEMENTS to a plain sequence and one
 * PATTERN per layer to everything else; a layer standing where an element should be
 * (a top-level `a . b`) is a shape this file does not lower, and it says so the way
 * it always has — by throwing, which `parseMini` turns into an opaque node.
 */
function elementsOf(children: MiniGroup['children']): MiniElement[] {
  for (const c of children) if (c.kind !== 'element') throw new Error('parseMini: a layer where an element was expected')
  return children as MiniElement[]
}

/** the elements of ONE layer of `<…>`, `a,b`, `a|b` or `{…}` */
function layerElements(layer: MiniGroup['children'][number]): MiniElement[] {
  if (layer.kind !== 'group') throw new Error('parseMini: an element where a layer was expected')
  return elementsOf(layer.children)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse a mini-notation string. Returns Pure for empty input. Never throws.
 *
 * `baseOffset` — character offset of `input[0]` within the user's full source
 * code. Lets nodes carry `loc` so downstream consumers (Inspector
 * click-to-source, Monaco highlighting) map an event back to its source span.
 */
export function parseMini(
  input: string,
  isSample = false,
  baseOffset = 0,
): PatternIR {
  if (!input.trim()) return IR.pure()

  let ast: MiniGroup
  try {
    // krill throws on a few inputs (e.g. a lone `_` has nothing to extend); fall
    // back opaque.
    ast = miniShape(input)
  } catch {
    return IR.code(input)
  }

  try {
    // The top level is a pattern like any other — it carries an alignment too.
    // A top-level `,` is a STACK and a top-level `|` a random choice; the hand
    // parser only ever split commas INSIDE brackets, so it flattened both into
    // one sequence (playing a chord's notes one after another).
    const node = patternToNode(
      ast,
      [{ start: baseOffset, end: baseOffset + input.length }],
      isSample,
      baseOffset,
      input,
    )
    return node ?? IR.pure()
  } catch {
    return IR.code(input)
  }
}

/**
 * Any group → one PatternIR node, dispatched on its ALIGNMENT. Shared by
 * the top level and by every bracketed group, so `a,b` means the same thing
 * wherever it appears — the uniformity that the position-specific hand parser
 * could not have (it split commas only inside brackets).
 *
 * `loc` is the wrapper's span (the `[...]` bracket range, or the whole input at
 * top level); it is dropped when a single-child container unwraps.
 */
function patternToNode(
  pat: MiniGroup,
  loc: { start: number; end: number }[],
  isSample: boolean,
  baseOffset: number,
  input: string,
): PatternIR | null {
  const align = pat.alignment
  // A container's children are LAYERS (one per arm/voice), not elements.
  const voices = pat.children

  if (align === 'polymeter_slowcat' || align === 'rand') {
    // `<a b>` alternation, and `a|b` random choice. Both play exactly ONE arm
    // per cycle, so Cycle carries the right cardinality; the SELECTION rule
    // (rotate vs random) runs in Strudel and is never modeled here.
    const items: PatternIR[] = []
    for (const v of voices) items.push(...buildSeq(layerElements(v), isSample, baseOffset, input))
    return items.length === 0 ? null : { tag: 'Cycle', items, loc }
  }

  if (align === 'stack' || align === 'polymeter') {
    // `[a,b]` chord / `{a,b}` polymeter — parallel voices.
    const tracks = voices
      .map((v) => buildSeq(layerElements(v), isSample, baseOffset, input))
      .filter((s) => s.length > 0)
      .map((s) => (s.length === 1 ? s[0] : IR.seq(...s)))
    if (tracks.length === 0) return null
    // A single voice degrades to that voice (no Stack wrapper), matching the
    // hand parser — which produced a bare `IR.seq` here, carrying no loc.
    return tracks.length === 1 ? tracks[0] : { tag: 'Stack', tracks, loc }
  }

  // fastcat — a plain sequence. A single child unwraps (`[a]` ≡ `a`).
  const children = buildSeq(elementsOf(pat.children), isSample, baseOffset, input)
  if (children.length === 0) return null
  return children.length === 1 ? children[0] : { tag: 'Seq', children, loc }
}

// ---------------------------------------------------------------------------
// Lowering
// ---------------------------------------------------------------------------

/**
 * An element list → the sibling nodes it produces. `!n` (replicate) is why
 * this is not a 1:1 map — one element yields `reps` sibling steps.
 */
function buildSeq(
  elements: MiniElement[],
  isSample: boolean,
  baseOffset: number,
  input: string,
): PatternIR[] {
  const out: PatternIR[] = []
  for (const el of elements) {
    const node = buildElement(el, isSample, baseOffset, input)
    if (!node) continue
    const reps = el.reps
    if (reps > 1) for (let r = 0; r < reps; r++) out.push(node)
    else out.push(node)
  }
  return out
}

/**
 * One element → one PatternIR node (the caller replicates it for `!n`).
 * Builds the base (atom → Play/Sleep, pattern → Seq/Stack/Cycle), expands a
 * euclid, then wraps the single trailing modifier (`*`/`/` → Fast/Slow, `?` →
 * Choice, `@n` → Elongate).
 */
function buildElement(
  el: MiniElement,
  isSample: boolean,
  baseOffset: number,
  input: string,
): PatternIR | null {
  const src = el.content
  const { ops, weight, reps } = el

  let node: PatternIR
  let contentStart: number
  // byte position just after the base content (atom + `:slice`, or the closing
  // bracket of a group) — where a `?`/`@n` modifier begins.
  let afterContent: number

  if (src.kind === 'atom') {
    const span = src.span
    contentStart = span.start
    afterContent = span.end
    const loc = [{ start: baseOffset + span.start, end: baseOffset + span.end }]

    if (isRest(src)) {
      node = IR.sleep(1, { loc })
    } else {
      const params: Partial<PlayParams> = isSample ? { s: src.text } : {}
      // `bd:2` — krill splits the sample index into a `tail` op. Land the
      // numeric index in `params.slice`; advance past the tail token either way
      // (a word tail like `G:dominant` has no numeric slice but still consumes
      // those bytes, so a following `@n` is located correctly).
      const tail = ops.find((o) => o.kind === 'tail')
      const tailAtom = tail ? argAtom(tail.args.element) : null
      if (tailAtom) {
        const idx = parseInt(tailAtom.text, 10)
        if (!isNaN(idx) && idx >= 0) params.slice = idx
        afterContent = tailAtom.span.end
      }
      node = IR.play(src.text, isSample ? 1 : 0.25, params, loc)
    }
  } else {
    const group = buildGroup(src, isSample, baseOffset, input, el)
    if (!group) return null
    node = group.node
    contentStart = group.openPos
    afterContent = group.closePos + 1
  }

  // Euclid — expand the atom to a flat Seq of Play/Sleep slots (atom-scoped in
  // parseMini, matching Strudel's `atom(k,n)`). Comes before the modifiers.
  const euclid = ops.find((o) => o.kind === 'bjorklund')
  if (euclid && src.kind === 'atom' && !isRest(src)) {
    const expanded = expandEuclid(node, euclid, baseOffset, contentStart)
    if (expanded) {
      node = expanded.node
      afterContent = expanded.closeParen
    }
  }

  // A single trailing modifier. krill can carry several ops; parseMini's grid
  // only ever produced one per element, so the corpus never stacks them.
  const stretch = ops.find((o) => o.kind === 'stretch')
  if (stretch) {
    const amt = argAtom(stretch.args.amount)
    const factor = amt ? Number(amt.text) : NaN
    if (amt && !isNaN(factor) && factor > 0) {
      const s = amt.span
      // the operator char (`*`/`/`) sits exactly one byte before the amount.
      const modLoc = [{ start: baseOffset + s.start - 1, end: baseOffset + s.end }]
      node =
        stretch.args.type === 'slow'
          ? IR.slow(factor, node, { loc: modLoc })
          : IR.fast(factor, node, { loc: modLoc })
    }
  }

  if (ops.some((o) => o.kind === 'degradeBy')) {
    // `?` has no located amount; it sits at the end of the base content.
    const modLoc = [{ start: baseOffset + afterContent, end: baseOffset + afterContent + 1 }]
    node = IR.choice(0.5, node, IR.pure(), { loc: modLoc })
  }

  // Weight from `@n` → Elongate. `weight` also rises from `_` sustain and from
  // `!n` replicate (reps), which parseMini never lowered to Elongate — so only
  // an explicit `@` at the modifier position produces one. Reading the `@n`
  // extent from the source locates a token krill discarded the position of; it
  // does not re-decide the grammar (krill already ruled this a weight).
  if (reps <= 1 && weight > 1 && input[afterContent] === '@') {
    let j = afterContent + 1
    while (j < input.length && /[0-9.]/.test(input[j])) j++
    const modLoc = [{ start: baseOffset + afterContent, end: baseOffset + j }]
    node = IR.elongate(weight, node, { loc: modLoc })
  }

  return node
}

/**
 * A pattern element — `[...]` sub-sequence, `[a,b]` chord, `<...>` alternation,
 * or `{...}` polymeter. Returns the node plus the byte positions of its opening
 * and closing delimiters (so a trailing modifier lands correctly).
 */
function buildGroup(
  pat: MiniGroup,
  isSample: boolean,
  baseOffset: number,
  input: string,
  el: MiniElement,
): { node: PatternIR; openPos: number; closePos: number } | null {
  const openPos = firstNonWs(input, el.span?.start ?? 0)
  const closePos = matchBracket(input, openPos)
  const loc = [{ start: baseOffset + openPos, end: baseOffset + closePos + 1 }]
  const node = patternToNode(pat, loc, isSample, baseOffset, input)
  return node ? { node, openPos, closePos } : null
}

/**
 * Expand `atom(k,n,rot)` into a flat Seq of Play (onset) / Sleep (rest) slots —
 * the same distribution `.euclid()` runs, so the timeline draws what plays. The
 * onset Plays reuse the atom's node; rest slots are loc-less Sleeps. Returns the
 * Seq plus the byte position just after the closing `)`.
 */
function expandEuclid(
  play: PatternIR,
  op: MiniOp,
  baseOffset: number,
  contentStart: number,
): { node: PatternIR; closeParen: number } | null {
  const pulse = argAtom(op.args.pulse)
  const step = argAtom(op.args.step)
  if (!pulse || !step) return null
  const k = Number(pulse.text)
  const n = Number(step.text)
  if (isNaN(k) || isNaN(n)) return null
  const rotArg = argAtom(op.args.rotation)
  const rot = rotArg ? Number(rotArg.text) : 0

  let mask = bjorklund(k, n)
  if (rot) mask = rotateEuclid(mask, rot)

  const restSlot = IR.sleep(1)
  const slots = mask.map((on) => (on ? play : restSlot))
  // `)` sits one byte after the last present arg (rotation, else step).
  const closeParen = (rotArg ?? step).span.end + 1

  if (slots.length === 1) return { node: slots[0], closeParen }
  return {
    node: {
      tag: 'Seq',
      children: slots,
      loc: [{ start: baseOffset + contentStart, end: baseOffset + closeParen }],
    },
    closeParen,
  }
}

// ---------------------------------------------------------------------------
// Source helpers — byte positions only, never grammar (krill owns the grammar).
// ---------------------------------------------------------------------------

/** first non-whitespace byte at or after `from`. */
function firstNonWs(input: string, from: number): number {
  let i = from
  while (i < input.length && /\s/.test(input[i])) i++
  return i
}

/**
 * The matching close for the delimiter at `openPos`, by bracket-depth counting
 * over `[] {} <>`. krill has already validated the nesting, so this only locates
 * the byte — it does not parse.
 */
function matchBracket(input: string, openPos: number): number {
  let depth = 0
  for (let i = openPos; i < input.length; i++) {
    const c = input[i]
    if (c === '[' || c === '{' || c === '<') depth++
    else if (c === ']' || c === '}' || c === '>') {
      depth--
      if (depth === 0) return i
    }
  }
  return input.length - 1
}
