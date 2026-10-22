/**
 * blockScan — the single source of truth for "where does one top-level `$:`
 * block end and the next begin?", shared by the engine's inline-viz line
 * computation (`StrudelEngine.buildVizRequestsWithLines`) and the editor's
 * live re-anchor pass (`viewZones.reAnchorZones`).
 *
 * Why this exists (#569): the solo monitor overlay (`applyMonitorOverlay`)
 * silences non-soloed top-level statements WITHOUT touching the file — labelled
 * tracks get a `_` prefix (`$:` → `_$:`, the P-MIX-5 mute idiom) and a bare
 * non-muteable expression is wrapped in a `/* … *​/` block comment. The engine
 * then computes each inline viz's `afterLine` from that overlaid source.
 *
 * A block-end scan that only recognizes `$:`/`setcps` as boundaries treats the
 * silenced `_$:` / `/*` lines as CONTINUATION of the preceding block, so a
 * soloed track greedily absorbs every following silenced line, its end line
 * overruns to EOF, and the inline viz zone re-anchors under an unrelated track.
 * Recognizing the silenced forms here keeps each zone pinned to its own track.
 */
// the dependency-free leaves, not the entry: see boundary.exceptions.json (#1921, #1927)
import { LABEL_HEAD } from '../codeView/ir/trackId'
import { TEMPO_SETTERS } from '../codeView/ir/statementHeads'

/** A tempo setter call at the head of the line, by whole name: `setcpm(` yes, `setcpsfoo(` no. */
const TEMPO_SETTER_HEAD = new RegExp(`^(?:${TEMPO_SETTERS.join('|')})\\s*\\(`)

/**
 * True when a trimmed source line begins a NEW top-level statement — counting
 * the silenced forms the solo/mute overlay produces. Used to detect the END of
 * the current `$:` block (the next boundary), NOT to assign block identity:
 *
 *   `$: …`      audible anonymous track
 *   `_$: …`     muted / soloed-out anonymous track (`_`-prefix mute idiom)
 *   `$_: …`     the same, suffix spelling — Strudel mutes `x_` too (#1679)
 *   `setcps(…)` transport statement — its own top-level block; likewise
 *               `setCps`, `setcpm`, `setCpm`, the same setter (`TEMPO_SETTERS`)
 *   `all(x=>…)` master-bus statement — stacks every `$:`/named pattern and
 *               applies the transform (master fader / global backdrop, #792).
 *               A top-level statement in its own right, so it MUST end the
 *               preceding block; otherwise a `$:`-with-inline-viz above it
 *               greedily absorbs the `all()` line and the zone anchors below it.
 *   `/* …`      bare expression wrapped by the solo overlay (non-muteable)
 *
 * NOTE: block-IDENTITY keying (which positional `$N` a zone is) must stay on the
 * bare `$:` form so it agrees with the engine capture side, which skips
 * `_`-prefixed ids. This predicate is only for boundary detection — `all(…)` is
 * a boundary but never a track (it fails `startsNamedTrack`: no leading `ident:`).
 */
export function startsTopLevelBlock(trimmed: string): boolean {
  return (
    /^_?\$_?:/.test(trimmed) || // `$:`, `_$:`, and `$_:` — Strudel mutes `x_` too (#1679)
    TEMPO_SETTER_HEAD.test(trimmed) || // all four names Strudel gives the setter (#1927)
    /^all\s*\(/.test(trimmed) ||
    trimmed.startsWith('/*')
  )
}

/**
 * True when a RAW (untrimmed) line begins a NAMED top-level track — a column-0
 * labeled statement `ident:`. Strudel's transpiler rewrites `x: y` to `y.p('x')`
 * (transpiler.mjs:468), so a top-level `drums: …` is a real named track exactly
 * as `$:` is an anonymous one.
 *
 * Column-0 is the discriminator: the regex is `^`-anchored to an identifier
 * character, so an INDENTED object-literal property inside a block (`verse:` /
 * `chorus:` in a `pickRestart({ … })`) does NOT match and is never mistaken for
 * a new track. `$:` / `_$:` also satisfy this regex; a caller that must
 * DISTINGUISH the anonymous form (positional `$N` key) from a named one (name
 * key) tests `$:` first — this predicate is for boundary detection only.
 *
 * KNOWN LIMIT (narrow-patch, #725): a multi-line object arg written at column 0
 * (un-indented `verse:`) would be misread as a track boundary. The robust fix
 * reuses the transpiler's AST-based `widgets` offsets (adapter doc §9.1, P5).
 */
export function startsNamedTrack(rawLine: string): boolean {
  return LABEL_HEAD.test(rawLine) // any JS identifier (#1683, #1921)
}

/**
 * Boundary predicate over a RAW line: true when the line starts a NEW top-level
 * block — the anonymous / tempo-setter / soloed forms (over the trimmed line) OR a
 * named track (over the raw line). The single source of truth for "where does
 * one top-level block end?" once named tracks are in scope; keeps the engine's
 * `scanVizRequestLines` and the editor's re-anchor in agreement (#569).
 */
export function startsTopLevelBlockRaw(rawLine: string): boolean {
  return startsTopLevelBlock(rawLine.trim()) || startsNamedTrack(rawLine)
}
