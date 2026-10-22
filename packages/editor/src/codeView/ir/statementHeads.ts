/**
 * statementHeads — the ONE list of top-level heads that are not tracks (#1178).
 *
 * A top-level statement is either a track the user can hear, see and mix, or a
 * call that configures global transport / loads a resource and plays nothing.
 * Two places need that answer and they used to keep separate lists:
 *
 *   - `parseStrudel` — decides whether the statement declares a Track in the IR,
 *     and therefore whether the Song timeline draws a row for it.
 *   - `stripModel.buildStripModels` — decides whether the Mixer draws a strip.
 *
 * Neither list was a superset of the other: the Mixer's had `setbpm`/`setBpm`/
 * `hush` and lacked `useRNG`/`setVoicingRange`/`initAudio`/`aliasBank`; the
 * parser's had the reverse. Measured over the `.strudel` fixture set, 14 of 55
 * bare documents had the two sides counting a DIFFERENT number of tracks, and
 * the visible cost was a strip for a random-seed call taking the `d1` name while
 * the Song timeline gave `d1` to the music underneath it (#1177).
 *
 * ── WHY ONE LIST MATTERS MORE THAN A COMPLETE ONE ────────────────────────────
 *
 * A bare document's meter joins the engine on a POSITIONAL key — the last
 * statement of N (#1096). A positional key needs both sides to agree on N, and
 * agreeing on the RULE is not enough if the rule is applied to two different
 * sets. That is the shape of the bug this prevents, and it is why the fix is one
 * list rather than one longer list.
 *
 * The property worth having is that the join is then correct BY CONSTRUCTION
 * EVEN WHEN THIS LIST IS WRONG. An unrecognised head (`cpm(120)`,
 * `await initHydra()`) counts as a track on BOTH sides, so the IR declares a
 * silent row for it and the meter still lands on the statement that sounds. An
 * incomplete list costs a spurious silent row, never a misrouted meter.
 *
 * ⚠ WHAT THIS LIST DOES NOT DECIDE, so it is not defended by hazards it no
 * longer prevents:
 *
 *   - It does NOT keep a phantom strip from consuming a `$<n>` slot and shifting
 *     every real track's join. That was real and was never this list's to
 *     prevent — an ordinary unlabelled pattern did it too, with no unknown head
 *     involved. It is fixed at the counter (#1174), so a head missing from here
 *     cannot misroute a meter.
 *   - It does NOT protect global tempo from the solo overlay. That described
 *     `soloOverlay.ts`, a file no longer in the tree: #735 made solo WRITE `_`
 *     mute markers, and only to `muteable` strips, which unlabelled statements
 *     are not.
 *   - It does NOT answer the general question "is this head a track?", which
 *     #1177 owns and which no name-based rule can answer — hydra and Strudel
 *     share spellings (`shape(2,0.01)` is hydra, `shape(0.3)` is a control), so
 *     only the value can separate them. This list is a conservative denylist of
 *     heads we have GROUNDED as side-effect-only; anything unknown is still
 *     treated as a track.
 *
 * ── GROUNDING ────────────────────────────────────────────────────────────────
 *
 * Upstream audited at Codeberg SHA f73b395648645aabe699f91ba0989f35a6fd8a3c (the
 * SHA pinned in `packages/app/tests/parity-corpus/CORPUS-SOURCE.md` and in
 * `parseStrudel`'s prelude provenance block). Local installed runtime:
 * @strudel/core@1.2.6, @strudel/tonal@1.2.6, @strudel/webaudio@1.3.0,
 * superdough@1.3.0. Return value DISCARDED at statement level in every case:
 *
 *   all              @strudel/core  repl.mjs:153-156  mutates allTransforms[]; returns silence
 *   samples          superdough     sampler.mjs:249-263  Promise<void>; registers samples
 *   setcps / setCps  @strudel/core  repl.mjs:117-120 + 215 alias  returns silence; mutates scheduler
 *   setcpm / setCpm  @strudel/core  repl.mjs:132-135 + 217 alias  returns silence; mutates scheduler
 *   useRNG           @strudel/core  signal.mjs:279  returns mode string; mutates RNG_MODE
 *   setVoicingRange  @strudel/tonal voicings.mjs:87  returns helper result; mutates registry
 *   initAudio        superdough     superdough.mjs:259-289  Promise<void>; boots audio context
 *   aliasBank        superdough     superdough.mjs:132  Promise<void>; registers aliases
 *   hush             @strudel/core  repl.mjs:84, exported at repl.mjs:212  stops playback, returns nothing
 *
 * ⚠ `setbpm` / `setBpm` are NOT grounded: they appear in NO installed @strudel
 * package or superdough (searched every `.mjs` outside `dist`). They came from
 * the Mixer's list and are kept rather than dropped — a document calling one
 * would be a runtime error either way, and keeping them costs nothing if a
 * future Strudel adds the alias. Stated so the next reader does not mistake
 * them for citations that were checked and held.
 *
 * R2 ANTI-DRIFT: hand-maintained (the upstream export list is not vendored).
 * The mechanism is this comment plus one corpus fixture per token.
 *
 * ⚠ RESIDUAL, measured and deliberately left: sharing the list took the two
 * sides from 14 disagreements out of 55 bare corpus documents down to 2, and the
 * two survivors are NOT list drift — they are DETECTION differences, so a longer
 * list cannot close them:
 *
 *   - `bakery-143-guarded-boot` — the defensive idiom
 *     `typeof X !== 'undefined' && X(...)`. The parser strips it as prelude via
 *     its own second classifier (#143); `detectAllChunks` reports a chunk with
 *     an empty head, which is not a name any list can hold.
 *   - `bakery-arrange-root` — the Mixer detects no chunk at all where the IR
 *     declares one, so the disagreement runs the other way.
 *
 * A consumer joining the two populations positionally must therefore still
 * VERIFY rather than assume they matched, and refuse when they did not — the
 * same posture #1097 took for an ambiguous id. Being right for 53 of 55
 * documents is not the same as being right by construction.
 *
 * ⚠ AND THE SIBLING LIST THAT IS NOT REDUNDANT WITH THIS ONE. `parseStrudel`
 * keeps `PRELUDE_CALL_RE` for a genuinely different question — "is this a
 * LEADING boot call I may strip before parsing?" — and it deliberately omits
 * `all` and `hush`, because `all(...)` takes a pattern transform and `hush()`
 * stops playback; neither is a prelude. Folding it into this set would strip
 * `all(...)` off the front of a document. Two lists that look alike are not
 * always one list, and the entries they differ on are where the reason lives.
 */

/**
 * Strudel's tempo setters: one setter under four names (`repl.mjs` defines `setCps`
 * and `setCpm` and exports each with a lowercase alias; see the table above).
 *
 * Read by `tempo.ts` (what a setter's argument means) and by
 * `visualizers/blockScan.ts` (a setter line ends the block above it). The scanner is
 * in the engine's import graph, which is one more reason this file imports nothing
 * (#1927).
 */
export const TEMPO_SETTERS = ['setcps', 'setCps', 'setcpm', 'setCpm'] as const

/**
 * Head names whose top-level statement configures or loads rather than plays.
 *
 * Read by BOTH sides of the track population — `parseStrudel` via
 * `NON_TRACK_HEAD_RE` (which matches raw statement text) and
 * `stripModel.isTrackChunk` (which looks up an already-extracted head name).
 * Each side keeps its own matching idiom; only the NAMES are shared, which is
 * what stops them drifting.
 */
export const NON_TRACK_HEADS: ReadonlySet<string> = new Set([
  'all',
  'samples',
  ...TEMPO_SETTERS,
  'setbpm',
  'setBpm',
  'hush',
  'useRNG',
  'setVoicingRange',
  'initAudio',
  'aliasBank',
])

/**
 * The same list as a statement-head matcher, for the caller that has raw
 * statement TEXT rather than an extracted head name.
 *
 * Built FROM the set rather than written out beside it — a second spelling is
 * exactly how the two lists drifted in the first place. Longest-first so no
 * shorter name can shadow a longer one sharing its prefix. The `^[ \t]*` is
 * defensive: statement text arrives trimmed, so it is a zero-behaviour prefix
 * that mirrors the neighbouring prelude matcher.
 */
export const NON_TRACK_HEAD_RE = new RegExp(
  `^[ \\t]*(?:${[...NON_TRACK_HEADS].sort((a, b) => b.length - a.length).join('|')})\\s*\\(`,
)
