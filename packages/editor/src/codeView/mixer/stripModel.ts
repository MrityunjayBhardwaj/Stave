/**
 * stripModel.ts — the channel-strip Mixer's read-model.
 *
 * A `StripModel` is one editable, addressable track projected from one detected
 * chunk: its name, source, gain, pan, sends — everything a strip shows. The
 * whole array is a PURE function of the document (`detectAllChunks` →
 * `buildStripModels`), with no React and no audio, so it unit-tests directly and
 * the strips are a trustworthy projection: close the Mixer, reopen it,
 * re-derive from text → identical (invariant V-mixer-1).
 *
 * S0 is read-only — the model carries the ranges every control will later write
 * to (S1 fader/pan, S3 mute, …), but builds nothing that needs a live engine.
 * The `captureId` join to the analyser map is a CANDIDATE here (the documented
 * numbering rule); it is verified against the engine in S2 (grounding gate GR1)
 * before any meter trusts it.
 */
import { detectAllChunks } from '../chunkDetect'
import type { ChunkInfo, ChainCall } from '../chunkDetect'
import { patternKind } from '../patternKind'
import { readChainMethod, readNumberCall } from '../chainMethod'
import { readSoundArg } from '../soundArg'
import { trackIdentity } from '../trackColor'
import { type GainState, readGainState } from './gain'
import { NON_TRACK_HEADS } from '../ir/statementHeads'
import { trackIdsFromLabels, isMutedLabel, labelName, shownTrackName } from '../ir/trackId'
import { parseStrudel } from '../ir/parseStrudel'

/** which surface a strip's pattern belongs to (mirrors `ChunkType` + groups). */
export type StripKind = 'step' | 'roll' | 'group' | 'unknown'

export interface StripModel {
  /**
   * STABLE identity across edits: the `$:`/`d1` label, or `#<k>` (position among
   * ALL anonymous tracks, muted included) when anonymous. Unlike `captureId`,
   * this does NOT shift when another track is muted — muting only prefixes a `_`,
   * it never reorders, adds or removes a statement, so the index is invariant.
   * This is the
   * key all non-document UI state hangs on (expand/solo sets, the write-path
   * lookup, the React key, `data-mixer-strip-id`) so that state stays attached to
   * the right strip across a mute toggle (#555). DISTINCT from `captureId`: the
   * engine join must be positional-over-unmuted, this must be stable.
   */
  id: string
  /** position among top-level statements (source order) */
  index: number
  kind: StripKind
  /** the `$:`/`d1` label, or null for an anonymous `$:` */
  label: string | null
  /** display name = the strip's canonical display key (V-track-1, #579): the
   * label (`d1`), else the instrument sample (`hh`) the Song Timeline lanes by,
   * else the head fn / `Track N`. Matches the Timeline lane header for the track. */
  name: string
  /** what the strip SHOWS (#2151): `Track 1` for an unnamed `d1`, else `name`.
   * Text only — colour and saved per-track settings stay keyed by `name`. */
  shownName: string
  /** head function (`s`, `note`, `stack`, …) — drives the source summary line */
  headFn: string | null
  /** the head call's mini-notation string, for the summary line */
  miniString: string | null
  /** the assigned instrument/kit (`.sound`/`.s` for melody, `.bank` for drums) */
  source: string | null
  /**
   * the distinct names `source` plays (#2226): one for a plain name, several for
   * a pattern (`"piano gm_electric_guitar_muted"`), empty when there is no source
   */
  sounds: readonly string[]
  /** how the fader reads this track's `.gain` (scalar / managed / foreign / absent) */
  gain: GainState
  /** `.pan` scalar (0=L, 0.5=C, 1=R), or null when absent/foreign */
  pan: number | null
  /** true when `.pan` is present but a signal/pattern — the control hands off */
  panForeign: boolean
  /** aux sends — `.room` / `.delay` scalars, or null */
  sends: { room: number | null; delay: number | null }
  /** mute state — true when the statement carries the `_`-prefix mute marker (S3) */
  muted: boolean
  /** whether this strip can be muted — only labelled statements (`$:`/`d1:`) can
   * take the `_` marker; a bare expression statement can't (`_s(...)` would parse
   * as a call to a different identifier), so its mute control is disabled. */
  muteable: boolean
  /** indicator colour — the shared `colorForTrack(id)` (V-track-1, #579), so the
   * strip dot matches the Song Timeline lane for the same track. */
  color: string
  /** the full method chain → the expand drawer (S4) */
  chain: ChainCall[]
  /** the pattern expression span, excl. the `$:` label — write anchor */
  exprRange: [number, number]
  /** the whole statement span — the freshness/write anchor */
  statementRange: [number, number]
  /**
   * Join key to the per-track analyser (`StrudelEngine` captureIds: `"d1"` for a
   * named statement, `"$<n>"` for the nth UNMUTED anonymous `$:`). POSITIONAL by
   * design — it counts only unmuted anonymous tracks, exactly mirroring the
   * engine's `anonIndex` (which skips `_`-muted ids), so it shifts in lockstep
   * with the engine when a sibling is muted and the meter join stays correct.
   * This is why it is DISTINCT from `id` (#555): the engine join must move with
   * the engine; the strip's UI identity must not. Verified against
   * `getTrackSchedulers()` in S2 (GR1).
   */
  captureId: string
}


/** the `_`-prefix mute marker (S3, design §6.4): a statement is muted when its
 * label starts (or, #1679, ends) with `_`. Strudel's engine skips `_`-prefixed/-suffixed ids
 * (`StrudelEngine.ts:735`) → no scheduler → silent + a dark meter, all without
 * touching `.gain` (orthogonal to the fader — V-mixer-2). Grounded: acorn parses
 * `_$:`/`_d1:` as labelled statements, so the marker rides on `chunk.label`. */
function isMuted(label: string | null): boolean {
  // #1679 — a trailing `_` too; `trackId.ts` owns what a marker is.
  return label != null && isMutedLabel(label)
}


/**
 * Whether a detected chunk is a playable track (→ gets a strip) or a global
 * transport/config statement (→ filtered out, #559). A labelled statement
 * (`$:`, `_$:`, `d1:`) is ALWAYS a track — the user explicitly declared one. An
 * unlabelled bare expression is a track unless its head is a known config call;
 * the denylist is conservative on purpose, so an unknown head still shows a strip
 * (today's behaviour) rather than risk hiding a real track.
 *
 * ⚠ THE LIST IS SHARED WITH `parseStrudel`, and that is the point (#1178). This
 * side decides whether a strip is DRAWN; the parser's side decides whether the
 * IR declares a Track for the same statement. A bare document's meter joins the
 * two on a POSITIONAL key, so they must count the same population — agreeing on
 * the rule is not enough if the rule is applied to different sets. They kept
 * separate lists until now and disagreed for 14 of 55 bare corpus documents,
 * which showed up as the Mixer naming a random-seed call `d1` while the Song
 * timeline gave `d1` to the music under it.
 */
export function isTrackChunk(chunk: ChunkInfo): boolean {
  if (chunk.label !== null) return true
  return chunk.headFn === null || !NON_TRACK_HEADS.has(chunk.headFn)
}

/**
 * Capture id for the pattern a document with NO `.p()` call plays (#1094).
 *
 * `$0` is the id an anonymous `$:` in first position would have taken, and that
 * is the whole point: the timeline's hap→lane join maps `$N` onto the positional
 * `d{N+1}`, so haps captured under it land on `d1` — the lane the IR already
 * produces for a bare statement.
 */
export const BARE_CAPTURE_ID = '$0'

/**
 * A captureId no live scheduler can ever be filed under, for an unlabelled
 * statement whose id would be a GUESS (#1174). Indexed by source position so two
 * such statements never collide.
 *
 * The engine writes only user labels and `$<n>`; a `~` prefix is not a legal
 * identifier start, so this can never equal a real key, and the meter simply
 * paints dark — the documented behaviour for a captureId with no scheduler.
 */
function unjoinableId(index: number): string {
  return `~$${index}`
}

/**
 * The captureId an UNLABELLED statement joins the engine on, or null when the
 * document gives no unambiguous answer (#1097).
 *
 * ⚠ THIS IS THE ONLY PLACE THAT DECIDES IT, and the engine reads it from here
 * rather than computing its own. The two used to be derived independently and
 * that is precisely how they drifted: a view's join key and the map key feeding
 * it have to come from one rule, or they agree for a while and then silently
 * stop, with a dead meter as the only symptom.
 *
 * Every track unlabelled → the LAST one, `$<n-1>`. Strudel plays the document's
 * last expression when nothing registered, so that is the statement the captured
 * pattern belongs to; a single-track document is the same rule at n = 1.
 *
 * Any LIVE labelled track → null. A label is what makes a statement reach
 * `.p()`, so the repl plays the registry rather than a bare expression and this
 * decision does not apply. A `_`-muted label never registers (#1686), so it
 * does not count — but it is still a statement, so it holds its place in `n`.
 *
 * ⚠ WHY THIS CAN NAME A SLOT AT ALL, given #1174 made an unlabelled statement
 * take none. That rule exists so this side counts the population the engine's
 * `anonIndex` counts. In an all-unlabelled document `anonIndex` never
 * increments — nothing reaches `.p()` — so the `$<n>` namespace is unused and
 * this is its only writer. The exemption is not new: it is exactly why `$0` was
 * safe for the single-track case.
 *
 * ⚠ IT REFUSED THE MULTI-TRACK CASE UNTIL #1096, and the reason it can stop is
 * worth stating, because "the strips number from the first while strudel plays
 * the last" is still true. What changed is that the IR now declares a Track per
 * statement, so `d<n>` is a lane that exists — the id names a real row instead
 * of pointing past the end of a one-row document. Naming the last strip was
 * never the hard part; having something for it to name was.
 *
 * The id is positional, so it depends on both sides counting the same
 * statements. That is what the shared head list is for (#1178), and the two
 * documents where detection still disagrees are recorded there.
 */
export function bareCaptureIdFor(tracks: readonly ChunkInfo[]): string | null {
  if (tracks.length === 0) return null
  // #1686 — a LIVE label. A `_`-muted one returns silence without registering
  // (`@strudel/core` repl.mjs:171-174), so a document whose labels are all muted
  // still plays its last expression, and that statement's meter must join.
  if (tracks.some((t) => t.label !== null && !isMutedLabel(t.label))) return null
  // The LAST track, because that is the expression strudel plays. `$0` for a
  // single-track document is this same rule at n = 1, not a separate case.
  // When that last statement is itself a muted label, what plays is silence
  // and no strip owns it.
  if (tracks[tracks.length - 1].label !== null) return null
  return `$${tracks.length - 1}`
}

/** the combinator heads whose statement is a group of voices (sub-strips in S6) */
const GROUP_HEADS = new Set(['stack', 'cat', 'layer', 'arrange'])

function stripKind(chunk: ChunkInfo): StripKind {
  const k = patternKind(chunk)
  if (k) return k
  if (chunk.headFn && GROUP_HEADS.has(chunk.headFn)) return 'group'
  return 'unknown'
}

/** the instrument/kit a strip shows — `.sound`/`.s` for melody, `.bank` for drums. */
function readSource(chunk: ChunkInfo, kind: StripKind): string | null {
  if (kind === 'step') return readChainMethod(chunk, ['bank'])?.value ?? null
  if (kind === 'roll') return readChainMethod(chunk, ['sound', 's'])?.value ?? null
  return readChainMethod(chunk, ['sound', 's', 'bank'])?.value ?? null
}

/** the names a source argument plays, in written order (#2226) */
function soundNames(source: string): string[] {
  const arg = readSoundArg(source)
  return arg.kind === 'one' ? [arg.name] : arg.names
}

/** a scalar numeric chain method (`.pan(0.3)` → 0.3); null when absent/foreign. */
function readScalar(chunk: ChunkInfo, name: string): number | null {
  const n = readNumberCall(chunk, [name])
  return typeof n === 'number' ? n : null
}

/** true when the playing `name` call is written but not as a number (a signal). */
function isForeign(chunk: ChunkInfo, name: string): boolean {
  return readNumberCall(chunk, [name]) === null
}

/**
 * The strip's DISPLAY key (V-track-1, #579) — the ONE canonical key both the
 * strip NAME and the strip COLOUR derive from, chosen to equal what the Song
 * Timeline shows for the same track so the two views never diverge:
 *
 *  - **Named track** (`bass:`, `lead:`) → its label. The user explicitly named
 *    it; honour that. (The Timeline resolves its positional key back to this
 *    label too, so both read `bass`.)
 *  - **Anonymous `$:`** → `d{ordinal}`, its 1-based position among tracks — the
 *    SAME positional id the engine gives the hap (`trackId`) that the Timeline
 *    lanes by. So an unnamed track is `d1`/`d2`/… identically in both views, and
 *    both show it as `Track 1`/`Track 2`/… (`shownName`, #2151).
 *
 * `d{ordinal}` is deliberately NOT descriptive — it is the friction that nudges
 * the user to rename the track (write a `name:` label) when they want a
 * meaningful name. The display never mutates the code; renaming is the user's
 * own explicit edit (a later slice). Two same-sample tracks therefore stay
 * distinct (`d1`/`d2`), name AND colour, with no auto-naming.
 *
 * DISTINCT from the strip's stable UI `id` (`#k` for anon, mute-safe per #555)
 * and from the engine-join `captureId` (`$k`): those serve identity/metering;
 * this serves DISPLAY and matches the Timeline.
 *
 * ⚠ UNIQUENESS IS A PROPERTY OF THE DOCUMENT, SO THE KEYS ARE ASSIGNED FOR THE
 * DOCUMENT (#1667). `d{ordinal}` is distinct from the other positional keys but
 * not from a label the user wrote: `d2: … / $: …` made two strips called `d2`,
 * in the same colour (the key is its own colour seed), and #1648's stem files
 * had to de-duplicate them. The assignment is the IR's own
 * `trackIdsFromLabels` — the same rule that names the Song timeline's lanes, so
 * the two views still read one name per track, which is the whole point of
 * V-track-1. Non-colliding documents keep byte-identical keys.
 */
function displayKeys(trackChunks: readonly ChunkInfo[], doc: string): string[] {
  // #1678 / #1682 — THE TIMELINE'S NAMES, NOT A SECOND NUMBERING. The two views
  // used to count different statements: the parser keeps a Track for a
  // `//`-commented label (so numbers hold still when a line is toggled) and this
  // list never sees one; and this list counts statements the parser does not
  // (`await initHydra()`, `cpm = 110`, `await samples(…)`, a bare helper call).
  // Either way every unnamed track after the difference got a different `d{N}`
  // in the Mixer than on the timeline — 242 strips in 59 of 558 archived
  // documents.
  //
  // So a strip reads its name from the parsed IR: the top-level Track whose
  // label line holds the strip's statement — the same Track `declaredTracks`
  // hands the timeline. That covers named, anonymous and bare documents alike
  // with no rule of our own to keep in step. A labelled Track's `loc` is the
  // LINE start, indentation included, while a chunk starts at the label itself;
  // in a document with no labels the parser anchors each Track at the statement
  // instead, so an indented bare statement is found only there (#1685). Both
  // anchors are looked up — two statements cannot share either.
  const idAtLine = trackIdsByLine(doc)
  const taken = new Set(idAtLine.values())
  return trackChunks.map((chunk, i) => {
    let line = chunk.statementRange[0]
    while (line > 0 && (doc[line - 1] === ' ' || doc[line - 1] === '\t')) line--
    const id = idAtLine.get(line) ?? idAtLine.get(chunk.statementRange[0])
    if (id !== undefined) return id
    // No Track for this statement. A statement that never plays has no strip
    // to name (#1682), so this is a document with no live label: a single bare
    // expression, whose Track carries no location, or a statement the parser
    // leaves out of a bare document. (The statement that plays when every label
    // is commented out or muted has a Track of its own since #1686, named by
    // this same next-free rule.) It keeps a positional name no real track has.
    let n = i + 1
    while (taken.has(`d${n}`)) n++
    taken.add(`d${n}`)
    return `d${n}`
  })
}

/**
 * The IR's top-level Track ids by label-line offset, for ONE document text,
 * cached on that text. Several hooks rebuild the strips for the same text on
 * every edit (colour bars, folding, the silenced set, the Mixer itself); parsing
 * once per text keeps that at one parse per edit (measured over the archive:
 * median 0.28 ms, p95 3.5 ms, 33 ms for a 42 KB document).
 */
let cachedDoc: string | null = null
let cachedIds: ReadonlyMap<number, string> = new Map()
function trackIdsByLine(doc: string): ReadonlyMap<number, string> {
  if (doc === cachedDoc) return cachedIds
  const ir = parseStrudel(doc)
  const roots = ir.tag === 'Stack' ? ir.tracks : [ir]
  const ids = new Map<number, string>()
  for (const node of roots) {
    if (node.tag !== 'Track') continue
    const at = node.loc?.[0]?.start
    if (typeof at === 'number' && !ids.has(at)) ids.set(at, node.trackId)
  }
  cachedDoc = doc
  cachedIds = ids
  return ids
}

function buildStripModel(
  chunk: ChunkInfo,
  index: number,
  displayKey: string,
  id: string,
  captureId: string,
): StripModel {
  const kind = stripKind(chunk)
  const source = readSource(chunk, kind)
  // Centralized track identity (V-track-1, #579): the strip's NAME and COLOUR
  // both derive from ONE display key via the shared `trackIdentity` resolver, so
  // they can't diverge from each other or from the Song Timeline. A named track
  // keys on its label (`bass`); an anonymous `$:` keys on `d{ordinal}` — the same
  // positional id the engine gives the hap the Timeline lanes by — so an unnamed
  // track is `d1`/`d2` identically in both views, shown as `Track 1`/`Track 2`
  // (#2151), and stays distinct from a same-sample sibling. The marker-stripped
  // label is still kept for the `label`/muted/muteable fields.
  const identity = trackIdentity(displayKey)
  return {
    id,
    index,
    kind,
    label: labelName(chunk.label), // the strip's stable identity across a mute toggle
    name: identity.name,
    shownName: shownTrackName(identity.name, labelName(chunk.label)),
    headFn: chunk.headFn,
    miniString: chunk.miniString,
    source,
    sounds: source === null ? [] : soundNames(source),
    gain: readGainState(chunk),
    pan: readScalar(chunk, 'pan'),
    panForeign: isForeign(chunk, 'pan'),
    sends: { room: readScalar(chunk, 'room'), delay: readScalar(chunk, 'delay') },
    muted: isMuted(chunk.label),
    muteable: chunk.label != null,
    color: identity.color,
    chain: chunk.chain,
    exprRange: chunk.exprRange,
    statementRange: chunk.statementRange,
    captureId,
  }
}

/**
 * Project every detected chunk into a strip, in source order, assigning each TWO
 * distinct keys — a stable UI identity (`id`) and a positional engine-join key
 * (`captureId`) — because the two have opposite requirements under a mute (#555):
 *
 *  - **`id` (stable identity):** a named statement → its bare label `d1`; an
 *    anonymous `$:` (muted or not) → `#<index>`, the ABSOLUTE statement position.
 *    Invariant across any mute toggle — muting only prefixes a `_`, it never
 *    reorders/adds/removes a statement — so UI state keyed by `id` (expand/solo
 *    sets, the write lookup, the React key) stays attached to the same strip.
 *
 *  - **`captureId` (engine join):** a named statement → its bare label `d1`; an
 *    UNMUTED anonymous `$:` → `$<k>`, k counting only unmuted anonymous tracks —
 *    exactly the engine's `anonIndex` numbering, which also skips `_`-muted ids
 *    (`StrudelEngine.ts:735-739`); a MUTED anonymous `_$:` → `_$<index>`, never a
 *    live scheduler key (the engine skipped it) → a dark meter. POSITIONAL on
 *    purpose: it shifts in lockstep with the engine so the meter join stays
 *    correct when a sibling is muted.
 *
 * Both are unique: labels are unique; `#<index>` is unique by position and never
 * collides with a name (JS labels can't start with `#`) nor a captureId (`$`/`_$`).
 */
/**
 * `doc` is the text `chunks` were detected from. It is required, not optional:
 * the display names come from the parser's track list for that text (#1678),
 * and a caller that could leave it out would silently fall back to a numbering
 * the timeline does not share.
 */
export function buildStripModels(chunks: ChunkInfo[], doc: string): StripModel[] {
  let anonAll = 0 // ALL anonymous tracks (muted + unmuted) → the stable id index
  let anonLive = 0 // UNMUTED anonymous `$:` only → the engine captureId index
  let ordinal = 0 // 1-based position among tracks → the `d{N}` display key
  const models: StripModel[] = []
  // The bare-capture id, decided once for the whole document (#1174/#1096), and
  // the ONE statement it belongs to. Strudel plays the last expression, so the
  // id names the LAST track and every other unlabelled statement stays
  // unjoinable — a document with three bare statements has one sounding pattern,
  // not three, and giving them all the same key would meter the same audio on
  // every strip.
  //
  // #1682 — ONCE ANY STATEMENT REGISTERS, AN UNLABELLED ONE NEVER PLAYS. Strudel
  // stacks only what reached `.p()` and throws away the evaluated value of every
  // other statement (`@strudel/core` `repl.mjs:238-257`), and a `_`-muted label
  // returns silence without registering (`repl.mjs:171-174`). So in a document
  // with a live label, `await initHydra()`, `cpm = 110` or a helper call is not a
  // track, and a strip for it was a fader over nothing. The parser declares no
  // Track for these either: over the 558 archived documents, 0 of the 223 such
  // strips had one, and no labelled strip lacked one. A document with no live
  // label keeps every statement — strudel plays its last expression then.
  const registers = chunks.some((c) => c.label !== null && !isMutedLabel(c.label))
  const trackChunks = chunks.filter(
    (c) => isTrackChunk(c) && (c.label !== null || !registers),
  )
  const drawn = new Set(trackChunks)
  // Display keys, decided for the whole document (#1667) — a positional key has
  // to see the labels it must not repeat. Indexed by `ordinal - 1`, which counts
  // exactly `trackChunks` in the same order.
  const keys = displayKeys(trackChunks, doc)
  const bareId = bareCaptureIdFor(trackChunks)
  const bareOwner = bareId === null ? null : trackChunks[trackChunks.length - 1]
  chunks.forEach((chunk, index) => {
    // Transport/config statements (`setcps`, `samples`, …) are not tracks — skip
    // them BEFORE numbering so the remaining anonymous tracks get `$0…$n` that
    // line up with the engine's anonIndex (#559). `index` stays the true
    // source-order position (preserving its documented meaning).
    if (!isTrackChunk(chunk)) return
    // #1688 — a statement that never plays draws no strip (#1682) but KEEPS its
    // place in the `#k` numbering. Whether it plays depends on whether any label
    // is live, so muting the last live track brings its strip back; if it did
    // not hold its place, that mute would renumber every anonymous strip after
    // it, and the UI state keyed on those ids would jump to another strip.
    if (!drawn.has(chunk)) {
      anonAll++
      return
    }
    ordinal++ // 1-based, counts every track in source order (config already skipped),
    // matching the engine's `d{N}` hap numbering the Timeline displays.
    const bare = labelName(chunk.label)
    // Stable identity: name, else position among ALL anonymous tracks (muted
    // included). Invariant across a mute toggle — muting prefixes a `_` but never
    // adds/removes an anonymous statement, so this index never shifts on mute.
    const id = bare ?? `#${anonAll++}`
    // Positional engine-join key, counting the SAME population the engine's
    // `anonIndex` counts — which is the whole correctness condition here, and
    // what this used to get wrong (#1174).
    //
    // The engine increments only inside the `.p()` wrapper, and only for an id
    // containing `$` that is not `_`-prefixed (`StrudelEngine.ts:835-839`). So:
    //   named label  → `.p("drums")`, no `$`  → no increment. Keyed by name.
    //   muted `_$:`  → refused outright      → no increment. `_$<index>`.
    //   anon `$:`    → `$<anonIndex>`        → increment.
    //   UNLABELLED   → never reaches `.p()`  → NO INCREMENT.
    //
    // That last line is the fix. A bare statement was consuming a slot the
    // engine never assigns, so every track after it joined one slot high and
    // metered its neighbour — measured as a drum strip showing the hi-hat's
    // level while the hi-hat sat dark. It was reachable two ways (a bare
    // statement above a labelled one, and a transport call the head denylist
    // had not heard of), which is why the repair belongs on the counter rather
    // than on the list.
    let captureId: string
    if (bare !== null) captureId = bare
    else if (isMuted(chunk.label)) captureId = `_$${index}`
    else if (chunk.label === null)
      captureId = bareId !== null && chunk === bareOwner ? bareId : unjoinableId(index)
    else captureId = `$${anonLive++}`
    models.push(buildStripModel(chunk, index, keys[ordinal - 1], id, captureId))
  })
  return models
}

/**
 * Char offset of the top-level statement whose instrument (`.sound`/`.s`/
 * `.bank`) is `source`, or null when none matches. Used to LOCATE a per-hap
 * runtime error (e.g. a soundfont out-of-range note) back to its owning track's
 * line when the error's own stack is bundle-only and the hap's `loc` is
 * degenerate (#567). Reuses the strips' own source-extraction so the locate
 * agrees with what the Mixer shows. First match wins (rare: two tracks, one
 * instrument). A hap carries the ONE sound it played, so a track whose source is
 * a pattern of sounds matches on any of them (#2226).
 */
export function statementOffsetForSource(doc: string, source: string): number | null {
  const strip = buildStripModels(detectAllChunks(doc), doc).find(
    (s) => s.source === source || s.sounds.includes(source),
  )
  return strip ? strip.statementRange[0] : null
}

/**
 * The display names of every track in `doc` EXCEPT the statement starting at
 * `selfStatementStart` — the set a rename checks against to reject a duplicate
 * (#585). Keys off the SAME `buildStripModels` projection the Mixer renders, so
 * the names match exactly what `renameEdit`'s `takenNames` must compare against
 * (and what the colour-override store is keyed by). Used by the Song Timeline
 * rename handler, which has only the code text (the Mixer/Pattern chip pass their
 * already-derived `strips` instead). Excludes the renamed track by its statement
 * offset so renaming an anon `d{N}` to its own positional name isn't a self-
 * collision.
 */
export function otherTrackNames(doc: string, selfStatementStart: number): string[] {
  return buildStripModels(detectAllChunks(doc), doc)
    .filter((s) => s.statementRange[0] !== selfStatementStart)
    .map((s) => s.name)
}

/**
 * The strip that OWNS a given source offset — the top-level statement whose
 * `statementRange` contains `offset`. Strips are one-per-top-level-statement, so
 * this resolves BOTH a top-level active chunk (anchor == the strip's own start)
 * AND a NESTED chunk (a `pickRestart` section / `stack` arm / `arrange` arm,
 * whose `statementRange` is the nested span, `chunkDetect.ts:122-128`) back to
 * its owning track (#727). An exact-start match only handled the top-level case,
 * so the Pattern-tab chip lost the name whenever the cursor sat inside a nested
 * pattern. Statements don't overlap → at most one strip contains any offset.
 */
export function stripContainingOffset(
  strips: StripModel[],
  offset: number,
): StripModel | undefined {
  return strips.find(
    (s) => s.statementRange[0] <= offset && offset < s.statementRange[1],
  )
}
