/**
 * masterEdit — the MASTER strip's write decisions, as PURE functions.
 *
 * The master bus in Strudel is `all(x => …)`: it stacks every `$:`/named pattern
 * and applies the transform to the whole mix (`@strudel/core/repl.mjs:153`). So
 * the master strip's two round-tripped controls project to `all()` chains,
 * structurally identical to a channel line but scoped to the whole mix:
 *
 *   master fader   → all(x => x.mul(postgain(0.85)))
 *   master mute    → all(x => silence)      (a dedicated sentinel line)
 *   global backdrop→ all(x => x.viz("name", { backdrop: true }))
 *
 * By the SPLIT decision (design §9.4) gain and viz live on SEPARATE `all()`
 * lines — each edit function owns its own line, so they never coordinate on one
 * shared statement (`all()` transforms compose). The functions mirror
 * `writeStrip.ts`: pure `doc + value → OffsetEdit`, applied through the same
 * tagged `Writeback` seam every channel control uses (`MixerStrips.tsx`), so the
 * write-back is unit-testable without Monaco. The read path (code → live
 * backdrop / master gain) already ships in the engine — this is the write path.
 *
 * ⚠ THERE IS NO MASTER PAN CONTROL (#1719). `all(x => x.pan(v))` SETS pan on
 * every hap, so the control that wrote it threw away each track's own pan — 127
 * of 620 real documents set `.pan` on their tracks. The master fader's `mul`
 * trick does not carry over: pan is a position, not a level, and a key only the
 * master has is copied in as-is, so a track with no pan would take the master's
 * value rather than 0.5 plus it. Nor can a document reach the finished mix:
 * superdough pans each voice on its own (`superdough.mjs`), before the orbit's
 * reverb and delay, and the orbit's own output panner is fixed at centre. A
 * document's `all(x => x.pan(…))` line still PLAYS — it is simply no longer
 * written or read here.
 *
 * Robust to a hand-COMBINED chain: `masterGainEdit`/`masterVizEdit` bind to
 * whichever `all()` line already carries the relevant call, so a user who wrote
 * `all(x => x.mul(postgain(0.8)).viz("a",{backdrop:true}))` still gets surgical edits;
 * only a fresh materialization uses the split convention.
 *
 * WHY `mul(postgain(N))` AND NOT A PLAIN CONTROL (#1711). A Strudel control
 * method SETS its value on the hap — `.gain(a).gain(b)` plays at `b` — so a
 * master written as `all(x => x.gain(N))` replaced every track's own gain with N:
 * lowering the master made the quiet tracks LOUDER. Moving it to `postgain` (the
 * last gain stage, superdough `new GainNode(ac, { gain: postgain })`) is not
 * enough on its own: 55 of 620 real documents set `.postgain` on their tracks,
 * and a master `.postgain(N)` would overwrite those the same way. `mul` does
 * arithmetic KEY-WISE on control values (`@strudel/core` `_composeOp` →
 * `unionWithObj`): a key both sides have is multiplied, a key only the master
 * has is copied in. So a track's own postgain p plays at p·N, and a track with
 * none plays at N — which is 1·N, its default — every track scaled by the same
 * factor. Legacy `all(x => x.gain(N))` / `all(x => x.postgain(N))` lines are
 * still READ, so the fader shows what the document says, and moving the fader
 * rewrites that one call to `.mul(postgain(…))`; a document nobody touches is
 * never rewritten.
 */
import { parseTopLevel, collectChain, toArg, type ChainArg, type ChainCall, type ChunkInfo } from '../chunkDetect'
import { formatNumber } from '../writeback'
import type { OffsetEdit } from '../writeback'

/** unity gain — an untouched master reads unity from the ABSENCE of a line. */
export const MASTER_UNITY_GAIN = 1

/**
 * A top-level `all(<arrow>)` statement we can read/edit — an expression-body
 * arrow (`all(x => x.chain())`). Block-body arrows / non-arrow `all(fast(…))`
 * are master transforms too but carry no editable gain/viz chain, so the
 * detector skips them (a fresh gain/viz line is materialized alongside instead).
 */
export interface MasterAll {
  /** the whole `all(...)` ExpressionStatement span */
  statementRange: [number, number]
  /** the statement's exact source when detected — freshness (mirrors ChunkInfo) */
  statementText: string
  /** the arrow body expression (`x.gain(…)`) — append `.fx()` here */
  arrowBodyRange: [number, number]
  /** the chain in the arrow body, in source order (via the shared `collectChain`) */
  chain: ChainCall[]
}

/** The arrow node of `all(<arrow with expression body>)`, or null. */
function matchAllArrow(node: any): { body: any } | null {
  if (!node || node.type !== 'ExpressionStatement') return null
  const expr = node.expression
  if (
    !expr ||
    expr.type !== 'CallExpression' ||
    expr.callee.type !== 'Identifier' ||
    expr.callee.name !== 'all' ||
    expr.arguments.length < 1
  ) {
    return null
  }
  const arrow = expr.arguments[0]
  if (!arrow || arrow.type !== 'ArrowFunctionExpression') return null
  // Only expression-body arrows (`x => x.gain()`); a block body (`x => { … }`)
  // has no single chain expression to read.
  if (arrow.body.type === 'BlockStatement') return null
  return { body: arrow.body }
}

/** Every editable master `all(x => …)` statement, in source order. Pure. */
export function detectMasterAll(doc: string): MasterAll[] {
  return detectMasterAllWithBodies(doc).map((l) => l.m)
}

/** `detectMasterAll`, keeping each arrow body's AST node for reads that need
 *  more than the flat chain (the literal nested in `.mul(postgain(N))`). */
function detectMasterAllWithBodies(doc: string): { m: MasterAll; body: any }[] {
  const statements = parseTopLevel(doc)
  if (!statements) return []
  const out: { m: MasterAll; body: any }[] = []
  for (const node of statements) {
    const arrow = matchAllArrow(node)
    if (!arrow) continue
    const headOut = { ref: null as any }
    const chain = collectChain(doc, arrow.body, headOut)
    out.push({
      m: {
        statementRange: [node.start, node.end],
        statementText: doc.slice(node.start, node.end),
        arrowBodyRange: [arrow.body.start, arrow.body.end],
        chain,
      },
      body: arrow.body,
    })
  }
  return out
}

/** The control the master fader scales — see the header for why, and why by `mul`. */
const MASTER_GAIN_CONTROL = 'postgain'

/** Controls a pre-#1711 master line SET directly. Still read, and rewritten to
 *  the scaling form when the fader moves. */
const LEGACY_MASTER_CONTROLS = ['gain', MASTER_GAIN_CONTROL] as const

/**
 * Where the master gain lives in one `all()` line.
 *  - `scale`: `.mul(postgain(N))` — `call` is the `.mul(...)` call, `arg` the N
 *    inside it (its own range, so the fader patches just the literal);
 *  - `legacy`: `.gain(N)` / `.postgain(N)` — `arg` is N, and a fader move
 *    replaces the whole `call` with the scaling form.
 */
interface MasterGainSite {
  kind: 'scale' | 'legacy'
  call: ChainCall
  arg: ChainArg | undefined
}

/** `.mul(postgain(N))` in an arrow body, read off the AST so the nested literal
 *  gets a real range. Only a `mul` whose ONE argument is a `postgain(…)` call with
 *  one argument counts — any other `mul` is the user's own arithmetic. */
function findScaleSite(doc: string, body: any, chain: ChainCall[]): MasterGainSite | undefined {
  let node = body
  while (node && node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    const callee = node.callee
    const inner = node.arguments[0]
    if (
      !callee.computed &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'mul' &&
      node.arguments.length === 1 &&
      inner.type === 'CallExpression' &&
      inner.callee.type === 'Identifier' &&
      inner.callee.name === MASTER_GAIN_CONTROL &&
      inner.arguments.length === 1
    ) {
      const dot = doc.lastIndexOf('.', callee.property.start)
      const call = chain.find((c) => c.name === 'mul' && c.range[0] === dot)
      if (call) return { kind: 'scale', call, arg: toArg(doc, inner.arguments[0]) }
    }
    node = callee.object
  }
  return undefined
}

/** The master gain site on ONE line: the scaling form first, else a legacy set. */
function gainSiteOf(doc: string, m: MasterAll, body: any): MasterGainSite | undefined {
  const scale = findScaleSite(doc, body, m.chain)
  if (scale) return scale
  for (const name of LEGACY_MASTER_CONTROLS) {
    const call = m.chain.find((c) => c.name === name)
    if (call) return { kind: 'legacy', call, arg: call.args[0] }
  }
  return undefined
}

/** The master gain site for the document: a scaling line anywhere wins over a
 *  legacy one, so a half-migrated document reads the line the fader now owns. */
function findMasterGainSite(doc: string): MasterGainSite | undefined {
  const lines = detectMasterAllWithBodies(doc)
  for (const { m, body } of lines) {
    const scale = findScaleSite(doc, body, m.chain)
    if (scale) return scale
  }
  for (const { m, body } of lines) {
    const site = gainSiteOf(doc, m, body)
    if (site) return site
  }
  return undefined
}


/** The arrow body's source text, trimmed — used to spot the mute sentinel line
 *  `all(x => silence)`, whose body is the bare identifier `silence` (empty chain). */
function arrowBodyText(doc: string, m: MasterAll): string {
  return doc.slice(m.arrowBodyRange[0], m.arrowBodyRange[1]).trim()
}

/** The master mute line — a top-level `all(x => silence)` (any arrow param name).
 *  This is the master analog of a channel's `_`-prefix: it collapses the whole
 *  stacked mix to `silence` (`@strudel/core/repl.mjs:262` applies the transform
 *  to the stacked pattern; `silence` is `gap(1)`, the empty pattern). Detected by
 *  the arrow BODY being exactly `silence` (an empty chain), so it never collides
 *  with a gain line — `readMasterGain` skips it (no such call). */
function findMuteLine(doc: string): MasterAll | undefined {
  return detectMasterAll(doc).find((m) => arrowBodyText(doc, m) === 'silence')
}

/** A backdrop-viz call: `.viz(<name>, { backdrop: true })`. The flag is what
 *  distinguishes a MASTER backdrop from a channel-scoped inline `.viz("name")`
 *  (design §4). Matched on the arg source (spacing-tolerant) — the object arg is
 *  raw text at this layer, and WE always emit the canonical `{ backdrop: true }`. */
function findVizBackdropCall(m: MasterAll): ChainCall | undefined {
  return m.chain.find(
    (c) => c.name === 'viz' && c.args.some((a) => /\bbackdrop\s*:\s*true\b/.test(a.raw)),
  )
}

/** The first string-literal arg of a call (the viz name), or undefined. Its
 *  `range` spans the quotes, so replacing it swaps the whole literal. */
function vizNameArg(c: ChainCall): ChainArg | undefined {
  return c.args.find((a) => /^['"`]/.test(a.raw))
}

/** the master gain the fader shows: the `all()` gain scalar, or unity when
 *  absent. `foreign` = a gain call whose arg is a signal/pattern (not a number),
 *  so the fader can't rewrite it and should disable (mirrors the channel fader). */
export interface MasterGainState {
  value: number
  foreign: boolean
}

export function readMasterGain(doc: string): MasterGainState {
  const site = findMasterGainSite(doc)
  if (!site) return { value: MASTER_UNITY_GAIN, foreign: false }
  const arg = site.arg
  if (!arg) return { value: MASTER_UNITY_GAIN, foreign: true } // empty call — can't drive
  if (arg.numeric === null) return { value: MASTER_UNITY_GAIN, foreign: true } // signal gain
  return { value: arg.numeric, foreign: false }
}

/** whether the master is muted — a top-level `all(x => silence)` line is present.
 *  Orthogonal to gain (V-mixer-2): mute never touches `.gain`, only this sentinel
 *  line, so unmute is the exact inverse and the fader value survives untouched. */
export function readMasterMute(doc: string): boolean {
  return findMuteLine(doc) !== undefined
}

/**
 * The master "audio" `all()` line — the one the EXPAND DRAWER binds its insert
 * chain to. It is the first expression-body `all(x => …)` that is NOT the mute
 * sentinel (`x => silence`) and NOT a pure backdrop-viz line (presentation, not
 * audio). Gain and effect inserts all live here, so the drawer's effects chain
 * and the fader act on ONE statement.
 */
export function detectMasterAudioAll(doc: string): MasterAll | undefined {
  return detectMasterAll(doc).find((m) => {
    if (arrowBodyText(doc, m) === 'silence') return false // the mute sentinel line
    // a line carrying ONLY backdrop-viz calls is presentation, not an audio chain
    if (m.chain.length >= 1 && m.chain.every((c) => c.name === 'viz')) return false
    return true
  })
}

/**
 * The edit that gives a document its master audio line — a bare `all(x => x)` as
 * the last line, for the expand drawer's first insert to append onto (#800). Null
 * when the document already has one: there is nothing to add, and a second base
 * line would only be a second place for the next effect to land.
 */
export function masterAudioLineEdit(doc: string): OffsetEdit | null {
  if (detectMasterAudioAll(doc)) return null
  return insertStatement(doc, 'all(x => x)')
}

/**
 * Adapt a master `all(x => …)` line to a `ChunkInfo` so the shared `MixerBody` /
 * `ExpandDrawer` can render + edit its insert chain exactly as for a channel.
 *
 * A channel's `chain[0]` is its HEAD call (`s("bd")`); the master arrow's base is
 * the bare param `x` (an identifier, not a call), so `collectChain` yields a chain
 * with NO head. We prepend a SYNTHETIC head at index 0 so the body's index math
 * matches a channel: `MixerBody` skips index 0 for effect add/remove (`i > 0`, so
 * it never deletes the base), and `knobsFromChunk` ignores it (no numeric args).
 * `exprRange` is the arrow body, so a new `.fx()` appends at the chain's end
 * (`x.gain(1)` → `x.gain(1).room(0.4)`). Gain carries a knob only where it is
 * surfaced (it is strip-owned — the fader), so the drawer shows the INSERTS.
 */
export function adaptMasterChunk(doc: string, m: MasterAll): ChunkInfo {
  const head: ChainCall = {
    name: 'x', // the arrow param — inert: index 0 is never edited by MixerBody
    args: [],
    range: [m.arrowBodyRange[0], m.arrowBodyRange[0]],
  }
  return {
    statementRange: m.statementRange,
    statementText: m.statementText,
    exprRange: m.arrowBodyRange,
    label: null,
    headFn: null,
    miniRange: null,
    miniString: null,
    miniVia: null,
    miniAnchor: null,
    chain: [head, ...m.chain],
    type: 'knobs',
    nested: false,
  }
}

/** the master backdrop the "set backdrop" UI shows: the `all()` backdrop-viz
 *  name, or null when no master backdrop is declared in code. */
export function readMasterViz(doc: string): { name: string } | null {
  for (const m of detectMasterAll(doc)) {
    const v = findVizBackdropCall(m)
    if (!v) continue
    const nameArg = vizNameArg(v)
    if (!nameArg) continue
    return { name: nameArg.raw.slice(1, -1) }
  }
  return null
}

/** The scaling call the fader writes, e.g. `.mul(postgain(0.8))`. */
function scaleCall(value: number): string {
  return `.mul(${MASTER_GAIN_CONTROL}(${formatNumber(value)}))`
}

/**
 * The edit the master fader makes for `value` (a linear factor that SCALES the
 * mix — #1711; "REPLACE" in #792 meant replacing the old synthetic output gain):
 *  - present `.mul(postgain(N))` → replace N;
 *  - legacy `.gain(N)` / `.postgain(N)` → rewrite that one call to the scaling
 *    form, so the line being edited stops overwriting track values (nothing
 *    else in the document changes);
 *  - absent → insert a fresh `all(x => x.mul(postgain(value)))` line (decision 4
 *    = write the literal, incl. a factor of 1 at unity, matching `gainEdit`);
 *  - foreign → null (a signal/empty gain — the fader disables).
 */
export function masterGainEdit(doc: string, value: number): OffsetEdit | null {
  const site = findMasterGainSite(doc)
  if (!site) return insertStatement(doc, `all(x => x${scaleCall(value)})`)
  const arg = site.arg
  if (!arg || arg.numeric === null) return null // foreign/empty — disabled
  if (site.kind === 'scale') return { range: arg.range, text: formatNumber(value) }
  // A member call's range is [dot, callEnd], so this swaps the whole `.gain(N)`.
  return { range: site.call.range, text: scaleCall(value) }
}

/**
 * The edit a master mute toggle makes — add/remove the `all(x => silence)` line
 * (design: the master analog of a channel's `_`-prefix). Mute is ORTHOGONAL to
 * gain (V-mixer-2, P194): it never touches `.gain`, only this dedicated sentinel
 * line, so unmute is the exact inverse and the fader value round-trips untouched.
 *  - mute (true)  → insert `all(x => silence)` (no-op/null if already muted);
 *  - unmute (false)→ remove the whole `all(x => silence)` line (null if not muted).
 */
export function masterMuteEdit(doc: string, muted: boolean): OffsetEdit | null {
  const line = findMuteLine(doc)
  if (muted) return line ? null : insertStatement(doc, 'all(x => silence)')
  return line ? removeStatement(doc, line.statementRange) : null
}

/**
 * The edit the "set backdrop" UI makes (decision 2 = code is the single source):
 *  - set `name`  → replace the name literal in the existing master backdrop viz,
 *                  or insert a fresh `all(x => x.viz("name", { backdrop: true }))`
 *                  line;
 *  - clear (null)→ remove the master backdrop viz: the whole `all()` statement
 *                  when it holds nothing else, else just the `.viz(...)` call
 *                  (so a hand-combined `gain().viz()` keeps its gain).
 *
 * Returns null when clearing with no master backdrop present (nothing to do), or
 * when an existing backdrop viz has no string name to rewrite.
 */
export function masterVizEdit(doc: string, name: string | null): OffsetEdit | null {
  for (const m of detectMasterAll(doc)) {
    const v = findVizBackdropCall(m)
    if (!v) continue
    if (name === null) {
      // clear — drop the whole line if the viz is all it carries, else surgical
      if (m.chain.length === 1) return removeStatement(doc, m.statementRange)
      return { range: v.range, text: '' }
    }
    const nameArg = vizNameArg(v)
    if (!nameArg) return null // backdrop viz with no string name — nothing safe to patch
    return { range: nameArg.range, text: JSON.stringify(name) }
  }
  if (name === null) return null // nothing to clear
  return insertStatement(doc, `all(x => x.viz(${JSON.stringify(name)}, { backdrop: true }))`)
}

/** Append `statement` as the document's last line. Adds a single leading
 *  newline unless the doc is empty or already ends in one — never a materialize
 *  on render, only on a deliberate control gesture (design §7). */
function insertStatement(doc: string, statement: string): OffsetEdit {
  const pos = doc.length
  const lead = doc.length === 0 || doc.endsWith('\n') ? '' : '\n'
  return { range: [pos, pos], text: `${lead}${statement}` }
}

/** Remove a whole statement AND its own line (the preceding newline + any
 *  indentation, or the trailing newline for a first line) so clearing leaves no
 *  blank line behind. */
function removeStatement(doc: string, stmt: [number, number]): OffsetEdit {
  let start = stmt[0]
  let end = stmt[1]
  const prevNL = doc.lastIndexOf('\n', start - 1)
  if (prevNL >= 0 && doc.slice(prevNL + 1, start).trim() === '') {
    start = prevNL // consume the newline + indentation before the statement
  } else if (doc[end] === '\n') {
    end = end + 1 // first line — consume the trailing newline instead
  }
  return { range: [start, end], text: '' }
}
