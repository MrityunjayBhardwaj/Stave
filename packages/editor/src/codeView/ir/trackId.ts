/**
 * trackId — the names a user writes, and the SINGLE rule that turns a track's
 * source label into its stable IR identity (`trackId`), read by `parseStrudel` —
 * and so by the Inspector's views, which are derived from its record since #1387.
 *
 * ── WHAT A NAME IS (#1921) ──────────────────────────────────────────────────
 * A track label (`drums:`) and a section binding (`arrange([4, verse])`) are both
 * JavaScript identifiers, and any identifier will do — `節奏` and `café` as much
 * as `drums` (#1683). `isIdentifier` is that rule, once; every reader of a name
 * (the label at a statement, the name of an arrange arm, the rename validators,
 * the line scanners) stands on it. They used to carry their own copies, in an
 * ASCII spelling and a Unicode one, so a section called `前奏` was drawn `§1`
 * while a track called `前奏` kept its name.
 *
 * Two properties, both load-bearing for the Song timeline's lane identity:
 *
 *  1. MUTE-INVARIANT (#737). Mute is a `_` prefix on the label (`$:`→`_$:`,
 *     `drums:`→`_drums:`, design §6.4 / writeStrip.ts) — or a `_` SUFFIX
 *     (`drums_:`, `$_:`), which Strudel mutes too (#1679, `splitMuteMarker`). The marker is a DISPLAY
 *     concern — orthogonal to identity — so it is stripped here before the id is
 *     derived. Without the strip, every muted `_$:` collapses onto the single id
 *     `_$` (all anon muted tracks become ONE lane) and a muted `_drums:` becomes
 *     a NEW lane `_drums` instead of staying `drums` — the track loses its place.
 *     Stripping mirrors the DISPLAY deriver `labelAtOffset` below, through
 *     the same `labelName`, so identity and display agree (closes the P235 laneKey-carries-`_` trap).
 *
 *  2. ANON → POSITIONAL. `$:` (bare label `$`, and thus muted `_$:` after the
 *     strip) keeps the synthetic `d{index+1}` numbering, so existing multi-`$:`
 *     tunes are byte-identical and each anon track owns a distinct positional
 *     lane. A real `name:` label becomes the id verbatim.
 *
 * `index` is the track's 0-based position among the `$:`/`name:` statements
 * (single-track callers pass 0 → `d1`). PURE — no IR, no barrel — so it stays
 * out of the vitest CJS-`gifenc` trap (P172) and is freely unit-testable.
 *
 * ⚠ PROPERTY 2 IS ONLY TRUE OF A DOCUMENT, NOT OF A TRACK (#1667): `d{index+1}`
 * is distinct from its siblings' positional ids, but a user may have written
 * `d2:` as a real label, and then the two ids are the same string. A caller with
 * more than one track uses `trackIdsFromLabels` below, which assigns them
 * together and can see the collision; this per-track entry point is for the
 * single-track case (index 0), where there are no siblings to collide with.
 */
export function trackIdFromLabel(label: string | undefined, index: number): string {
  return labelName(label) ?? `d${index + 1}`
}

/**
 * The name a track SHOWS on screen (#2151): `Track N` for an unnamed track, else
 * its name. `name` is the track's id-shaped name (`d1`, `bass`); `label` is the
 * name the user wrote, or null when they wrote none.
 *
 * ⚠ DISPLAY ONLY. `name` stays the key for everything else — the id, the
 * deterministic colour, the saved custom colour and lane type (`setTrackMeta`),
 * the faded-lane set — so none of that moves. A space can't appear in a label,
 * so `Track 1` never reads like a name the user could have written; and a
 * written `d2:` has a label, so it keeps showing `d2`.
 */
export function shownTrackName(name: string, label: string | null | undefined): string {
  if (label) return name
  const positional = /^d([1-9]\d*)$/.exec(name)
  return positional ? `Track ${positional[1]}` : name
}

/** One JavaScript identifier, as a regex source (#1683) — `節奏` as much as `drums`. */
const IDENTIFIER = String.raw`[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*`
const WHOLE_IDENTIFIER = new RegExp(`^${IDENTIFIER}$`, 'u')

/** Is `text` exactly one JavaScript identifier? The one rule for a name (#1921). */
export function isIdentifier(text: string): boolean {
  return WHOLE_IDENTIFIER.test(text)
}

/**
 * Words a rename must never write, though each is an identifier by shape: as a
 * label (`return: …`) or a binding (`const class = …`) they are syntax errors.
 * Config heads (`setcps`, `hush`, …) are NOT here — they are plain identifiers,
 * and `setcps: s("bd")` parses; the label never invokes the function.
 *
 * The strict-mode words are a conservative choice, not a parse requirement:
 * Strudel's transpiler parses a script (`ecmaVersion: 2022`, no `sourceType`),
 * where `static: …` would pass. Refusing them costs a rename and writing one
 * would put the song one strict context away from not evaluating.
 */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'await', 'let',
  'implements', 'interface', 'package', 'private', 'protected', 'public', 'static',
])

/**
 * A name a rename may write — as a track label or a section binding: an
 * identifier that is not a reserved word. The track and the section renames
 * both ask this, so neither can write `class` again (#1924).
 */
export function isWritableName(text: string): boolean {
  return isIdentifier(text) && !RESERVED_WORDS.has(text)
}

/**
 * The head of a labelled statement at the start of a string: the label (group 1,
 * mute marker and all) followed by `:`. For the line scanners, which read the
 * raw label because their keys must equal the engine's `.p('節奏')`.
 */
export const LABEL_HEAD = new RegExp(`^(${IDENTIFIER})\\s*:`, 'u')

/**
 * The name a track's label claims OUTRIGHT, or null when the label names nothing
 * (an anonymous `$:`, muted or not) and the id has to be positional. The `_`
 * strip (property 1) and the `$`/empty test (property 2) both live here so the
 * per-track rule above, the whole-document rule below and the Mixer's strip
 * identity cannot read a label different ways.
 */
export function labelName(label: string | null | undefined): string | null {
  const bare = label == null ? undefined : splitMuteMarker(label).bare
  return bare && bare !== '$' ? bare : null
}

/**
 * The name of the labelled statement at `offset` in `code`, or null when the
 * track is anonymous (`$:`) or the offset doesn't resolve to a `<label>:` head.
 *
 * `offset` is a statement start — the `dollarPos` the engine stamps on every
 * event — so from there the source reads `<label>: <expr>`; leading whitespace
 * is tolerated. The mute marker is stripped (`labelName`), so a muted `_bass:`
 * still reads `bass` and a muted `_$:` is still anonymous.
 */
export function labelAtOffset(code: string, offset: number): string | null {
  if (!Number.isFinite(offset) || offset < 0 || offset >= code.length) return null
  let i = offset
  while (i < code.length && /\s/.test(code[i]!)) i++
  const m = LABEL_HEAD.exec(code.slice(i))
  return m ? labelName(m[1]!) : null
}

/**
 * The section name written at `range`, or null when the arm is an inline
 * expression with no name to read.
 *
 * Handles both arm shapes there are: an `arrange` arm's `[n, pattern]` tuple
 * (reduced to its pattern half) and a `cat`/`slowcat` arm, or an arrange arm's
 * pattern range, which is the pattern alone. Only a bare identifier is a name:
 * `arrange([4, s("bd*4")])` has none, and a caption derived from the music is
 * what #1391 was filed to remove.
 *
 * ⚠ NOT A PARSER. It reads a range the IR or the arrange parser already located;
 * it never goes looking for arrangements in text.
 */
export function sectionNameAt(code: string, range: readonly [number, number]): string | null {
  const [start, end] = range
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end > code.length || end <= start) return null
  let text = code.slice(start, end).trim()
  if (text.startsWith('[') && text.endsWith(']')) {
    const comma = text.indexOf(',')
    if (comma < 0) return null
    text = text.slice(comma + 1, -1).trim()
  }
  return isIdentifier(text) ? text : null
}

/**
 * A label split into its bare name and its mute markers (#1679) — the ONE
 * reading of what a mute marker is. Identity (above), `isMutedLabel` (below), the
 * Mixer's strips and edits, and the timeline's display name all call this.
 *
 * Strudel mutes an id that starts OR ends with `_` (`@strudel/core`
 * repl.mjs:172, "allows muting a pattern x with x_ or _x"), and the engine's
 * capture hook mirrors both (`StrudelEngine.ts`, the `.p()` wrapper). Every other
 * reader used to know only the prefix, so `drums_:` was a silent track the rest
 * of the app called `drums_` and showed as unmuted, and two `$_:` lines shared
 * one id.
 *
 * The prefix is read first, so a lone `_` is one marker naming nothing
 * (`bare: ''`), not a prefix and a suffix.
 */
export function splitMuteMarker(label: string): { bare: string; prefix: boolean; suffix: boolean } {
  const prefix = label.startsWith('_')
  const rest = prefix ? label.slice(1) : label
  const suffix = rest.endsWith('_')
  return { bare: suffix ? rest.slice(0, -1) : rest, prefix, suffix }
}

/**
 * Every track's id, assigned for the WHOLE document at once (#1667).
 *
 * ⚠ THE POSITIONAL RULE CANNOT BE DECIDED ONE TRACK AT A TIME, which is the
 * thing `trackIdFromLabel` above quietly assumes. `d{index+1}` is unique only
 * while no user has written `d{N}:` as a real label — and nothing stops them:
 *
 *     d2: s("bd*2")
 *     $:  s("hh*4")     // position 2 → `d2` → the SAME id as the track above
 *
 * That is not a display blemish. Two tracks under one id is one track as far as
 * every consumer keyed by id is concerned: `declaredTracks` de-dupes by id and
 * DROPS the second (trackOrder.ts), so the Song timeline loses its row outright,
 * and `laneKeyOf` folds both tracks' events into one lane. The mixer showed two
 * strips called `d2` in the same colour, which is how it was found (#1648's stem
 * names had to de-duplicate them).
 *
 * The rule: a positional id starts at its own position — so EVERY document whose
 * names do not collide keeps byte-identical ids, which is the whole safety
 * property here — and counts up to the first `d{N}` nothing else has taken. The
 * taken set is seeded with every label-claimed id and grows with each positional
 * id assigned, because two positional ids can collide with each other once
 * skipping is in play (labels `d2`,`d3` over four statements sends position 2 to
 * `d4`, which position 4 would otherwise take as its own).
 *
 * Labels are NOT auto-renamed and the document is never rewritten: the user's
 * `d2:` keeps `d2`, and only the id the tool made up moves. Which track has to
 * move is a consequence of where the user wrote the label, not a choice.
 *
 * ⚠ A COMMENTED-OUT TRACK IS A SLOT, NOT A CLAIM (#1673). `//p1: …` keeps a
 * `Track` of its own so the numbering holds still when a line is toggled — but
 * written above a live `p1: …` it took the name verbatim, and `declaredTracks`
 * kept the FIRST `p1`: the row was anchored on the comment and the statement
 * the user was editing had none. Every duplicate id in the 558-document archive
 * was this shape. So names are claimed in two rounds: every LIVE label first,
 * then each commented label in source order if its name is still free (so
 * commenting out a track with no live twin keeps its identity, and the first of
 * two commented copies keeps the name). A commented label that loses falls back
 * to a positional id exactly as `$:` does. A document with no such pair is
 * assigned exactly what it was before.
 *
 * `labels` is in source order, one per `$:`/`name:` statement; `commented[i]`
 * marks a `//`-commented one (absent = live). Same purity as above — no IR, no
 * barrel.
 */
export function trackIdsFromLabels(
  labels: readonly (string | undefined)[],
  commented: readonly boolean[] = [],
): string[] {
  const claimed = labels.map(labelName)
  const taken = new Set<string>()
  for (let i = 0; i < claimed.length; i++) {
    const id = claimed[i]
    if (id !== null && !commented[i]) taken.add(id)
  }
  // #1673 — a COMMENTED label claims its name only where nothing live holds it,
  // and the first commented copy wins. Settled here, before any positional id is
  // handed out, so a positional id can never take a name a label still wants.
  const named = claimed.map((id, i) => {
    if (id === null || !commented[i]) return id
    if (taken.has(id)) return null
    taken.add(id)
    return id
  })
  return named.map((id, index) => {
    if (id !== null) return id
    let n = index + 1
    while (taken.has(`d${n}`)) n++
    taken.add(`d${n}`)
    return `d${n}`
  })
}

/**
 * Is this label's track MUTED? (#1488)
 *
 * The other half of the same fact `trackIdFromLabel` above deliberately throws
 * away. Identity must not carry the marker — a muted `_drums:` is still the
 * `drums` lane — but "does this track sound?" is a real question with real
 * consumers, and until this existed the only way to answer it was to read the
 * character at the statement's source offset, which meant handing the document
 * text to anything that needed to know.
 *
 * Lives here, beside the strip, so the two readings of the `_` prefix can never
 * disagree about what a mute marker is.
 *
 * ⚠ A statement with NO label cannot be muted — muting is a prefix ON a label,
 * so a bare `s("bd*4")` has nothing to prefix. `undefined` is therefore false,
 * not unknown (`trackOrder.ts` measured that across every spelling).
 */
export function isMutedLabel(label: string | undefined): boolean {
  if (label === undefined) return false
  const { prefix, suffix } = splitMuteMarker(label)
  return prefix || suffix
}
