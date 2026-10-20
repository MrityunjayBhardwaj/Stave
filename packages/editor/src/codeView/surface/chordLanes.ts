/**
 * chordLanes — is this step grid holding CHORD SYMBOLS rather than sound names?
 *
 * ── WHY THIS QUESTION HAS TO BE ASKED OF THE CONTENT ─────────────────────
 * The obvious cheaper answer is the route: the head is known when a chunk is
 * routed, so "the head did not say `s`" looks like it should mean "these are not
 * sample names". Measured across 207 documents, that is false. Of the 13 units
 * that reach the grid through the content fallback, SEVEN are ordinary drum
 * patterns whose head is silent because the sound is assigned further along the
 * chain:
 *
 *     "<sd hh>".fast("<2@3 4>")            lanes: sd, hh
 *     "hh*4".color('#673AB7')              lanes: hh
 *     "<bd!3 bd(3,4,3)>".color('#F5A623')  lanes: bd
 *
 * — plus a synth waveform (`sawtooth`), a sample name (`breaks165`) and a set of
 * `pick` keys (`polyrhythm · polymeter · both`). Routing on the head would
 * relabel all of those to fix the two that are chord charts. A silent head means
 * the sound assignment moved, not that the tokens stopped being sounds. So the
 * only thing that can answer is the tokens themselves (#1241).
 *
 * ── WHY A LIBRARY AND NOT A REGEX ────────────────────────────────────────
 * Chord spelling is a real grammar — `Gsus`, `Em11`, `Am9`, `Bm!3`, `C^7`, bare
 * `F` — and a hand-written pattern for it is a rule nobody can check. `@tonaljs`
 * already ships one and is already in this tree (`@strudel/tonal` depends on it,
 * which is what makes these chords SOUND). Measured on the real vocabulary from
 * both corpora at the version pinned here: 13 of 13 chord symbols recognised,
 * and of the 85 tokens in the curated drum + instrument catalogues, 84 rejected.
 *
 * ⚠ THE COLLISION IS NOT ONE TOKEN, AND THAT WAS THE DEFECT (#1257). The rule
 * below used to read: "the one collision is `cb` — Cowbell, also C-flat major;
 * where the two vocabularies overlap the DRUM one wins, because a grid's lanes
 * are sounds by default and a chord reading has to displace that rather than tie
 * with it." Every word of that principle is right. Its POPULATION was wrong by
 * two orders of magnitude, because it was counted against the drum catalogue
 * only, and the vocabulary a grid's lanes are actually drawn from is much wider
 * than that catalogue.
 *
 * The chord grammar reads a trailing digit as a chord QUALITY — `C5` is the
 * power chord, `C4` a sus4, `C6` a sixth, `C7` a dominant seventh — and every
 * one of those is also an ordinary note spelling. Measured over seven letters ×
 * three accidentals × ten octaves: **125 of 210 note-shaped tokens read as chord
 * symbols**, the carriers being exactly the digits that are chord qualities
 * (none, 2, 4, 5, 6, 7 accept; 0, 1, 3, 8 reject). So `["c3","e3","g3"]` was not
 * a chord chart and `["c4","e4","g4"]` was — the same music, one octave apart.
 * Across both corpora, 15 units were captioned and 12 of them were melodies.
 *
 * ── SO THE PRECEDENCE RULE IS APPLIED WHERE THE QUESTION IS ──────────────
 * NOT by teaching `isChordSymbol` that note names are not chords: `C` genuinely
 * is a legal chord symbol, `getChord` is right about it, and a predicate that
 * denied it would be a lie about the grammar to get a different answer out of
 * something else. The grammar was never the thing that was wrong. What was wrong
 * is that a LANE SET was called a chord chart on evidence that ties.
 *
 * A chord reading has to displace the default, so it needs a lane no other
 * reading explains — see `chordLanes` below. `cb` is then not a special case
 * with its own line; it is the smallest instance of the general rule, and it
 * keeps its own guard only because the drum catalogue is authoritative earlier
 * and more cheaply than anything else here.
 */
import { get as getChord } from '@tonaljs/chord'
import { isKnownDrumVoice } from './drumVoices'
import { pitchToMidi } from '../notation/pitch'

/**
 * Is one lane token a chord symbol?
 *
 * ⚠ NO try/catch, AND THAT IS A MEASUREMENT RATHER THAN AN OVERSIGHT. The first
 * draft wrapped the grammar call defensively — it is third-party code on a
 * render path, and an exception here would take the panel down with it. Then
 * the break-check could not be written: `Chord.get` was fed sixteen malformed
 * strings (empty, whitespace, `~`, `[`, `C#####`, 500 characters, `///`) and
 * five non-string values including `undefined` and `null`, and threw on none of
 * them. A guard whose failing case cannot be constructed is a comment with a
 * value attached, and it hides the one thing worth knowing: the grammar reports
 * refusal by returning `empty`, not by throwing. What would reopen this is an
 * UPGRADE whose throw surface differs — the pinned 4.x line already differs
 * from 6.x in what it accepts (6.x reads `cb` as C-flat major and 4.x does
 * not), so re-run the probe rather than assuming it travels.
 *
 * The drum vocabulary is consulted FIRST and is authoritative — see the `cb`
 * note above. The token is passed to the chord grammar RAW, with no `:variant`
 * stripping: `C:major` is a scale, not a chord, and the grammar rejects it,
 * which is the answer we want. (Stripping would turn it into a bare `C` and
 * silently promote a scale list into a chord chart.)
 */
export function isChordSymbol(token: string): boolean {
  if (isKnownDrumVoice(token)) return false
  return !getChord(token).empty
}

/**
 * Is this token a chord symbol that NOTHING ELSE explains? (#1257)
 *
 * The evidence clause. A lane a musician can only have meant as a chord —
 * `Gsus`, `Em7`, `am`, `Am9` — is a fact about the grid that no drum or pitch
 * reading accounts for. A lane that is equally a note spelling — `a4`, `C`,
 * `G7` — is a tie, and by this module's own precedence rule a tie goes to the
 * default, which on a step grid is "these are sounds".
 *
 * ⚠ THE PITCH QUESTION IS ASKED OF THE ROLL'S OWN AUTHORITY, deliberately.
 * `pitchToMidi` is what `notation/parse.ts` uses to decide which tokens the
 * PIANO ROLL will accept, so the two surfaces cannot come to different views
 * about what a pitch is. A fresh regex here would be a second oracle for a
 * question the tree already answers, and the answer it gives is not obvious —
 * bare `c` is a pitch (it maps to C3), which is why the sample lanes `a`, `b`,
 * `c` correctly stop being a chord chart too.
 */
export function forcesChordReading(token: string): boolean {
  return isChordSymbol(token) && pitchToMidi(token) === null
}

/**
 * Does this grid hold a CHORD CHART?
 *
 * Two clauses, and both are load-bearing in different directions:
 *
 *   EVERY lane is a chord symbol — all, not most, and not any. A drum kit that
 *   happens to contain one chord-shaped token stays a drum kit, since a real
 *   cowbell lane sits beside `bd`/`sd`/`hh`, none of which parse. A grid with no
 *   lanes is not a chord chart either; the empty case answers false rather than
 *   vacuously true.
 *
 *   and AT LEAST ONE lane forces the chord reading (#1257) — because "every lane
 *   COULD be a chord" is satisfied by any melody once the grammar reads octave
 *   digits as qualities, and it was: `a4 a4 a4 a4` on a `.sound("shaker_large")`
 *   captioned itself as a chord chart and withdrew its drum picker.
 *
 * MEASURED, both directions, before this clause was written. Over the vendored
 * corpus and 150 real tunes, 15 units were captioned; this keeps 3 and drops 12.
 * The 3 kept are the `<Gsus G7 Em7 D7>` charts, forced by `Gsus` and `Em7`. The
 * 12 dropped are nine `gm_trumpet`/`gm_french_horn` melodies, two shaker lines,
 * and one whose lanes are the sample names `a`, `b`, `c`. Across the 210
 * note-shaped tokens, 125 read as a chart before and 0 do now.
 *
 * ✅ AND AN INDEPENDENT SIGNAL AGREES ON EVERY ONE OF THE 12: the piano roll
 * would accept all of them and declines all 3 of the charts on vocabulary. Two
 * unrelated questions — "is any lane unambiguously a chord" and "does the other
 * surface claim this content" — partition the same 15 the same way, which is
 * what makes this a rule rather than a threshold that happened to fit.
 *
 * ⚠ THE KNOWN LIMIT, stated rather than discovered later. A progression spelled
 * entirely in bare major triads (`<C F G>`) is not captioned, because every one
 * of its lanes is equally a note spelling and nothing displaces the default.
 * That is the precedence rule working as written, not an oversight: `s("C F G")`
 * is exactly as readable as three samples. Zero units in either corpus have this
 * shape, so it costs nothing measurable today; what would change the answer is a
 * corpus where it appears, and the fix then is a signal that is not the tokens.
 * One such signal exists now: a `chord(…)` head, which the step grid takes as a
 * caption by itself (#2142). This function still answers for the tokens alone.
 */
export function chordLanes(laneSounds: readonly string[]): boolean {
  return (
    laneSounds.length > 0 && laneSounds.every(isChordSymbol) && laneSounds.some(forcesChordReading)
  )
}
