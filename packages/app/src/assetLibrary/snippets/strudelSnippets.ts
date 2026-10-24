/**
 * Built-in Strudel sketches for the Library (#2165) — written for Stave.
 *
 * Each one is a single idea, plays on its own with Stave's default sounds (the
 * Dirt-Samples drums, the built-in synths, the GM soundfonts, the Salamander
 * piano and the drum-machine banks), and opens with a comment saying what it
 * shows. `level` says who it is for; `topic` is the Library's category chip.
 *
 * Every sketch is evaluated in the real engine by the browser test
 * `library-snippets.spec.ts`: it must run, make events, and name only sounds
 * that exist.
 */

import type { SkillLevel } from "../types";

export interface StrudelSnippet {
  /** stable id; also the file name it is inserted as */
  readonly id: string;
  readonly name: string;
  readonly level: SkillLevel;
  /** the Library's category chip */
  readonly topic: SnippetTopic;
  readonly tags: readonly string[];
  readonly code: string;
}

export type SnippetTopic =
  | "Rhythm"
  | "Melody"
  | "Harmony"
  | "Bass"
  | "Sound design"
  | "Effects"
  | "Live controls"
  | "Structure"
  | "Visuals";

const s = (
  id: string,
  name: string,
  level: SkillLevel,
  topic: SnippetTopic,
  tags: readonly string[],
  code: string,
): StrudelSnippet => ({ id, name, level, topic, tags, code: code.trim() + "\n" });

export const STRUDEL_SNIPPETS: readonly StrudelSnippet[] = [
  // ── Beginner ────────────────────────────────────────────────────────────
  s("first-beat", "Your first beat", "beginner", "Rhythm", ["drums", "mini-notation"], `
// Your first beat: four sounds, one after another, every cycle.
// bd = bass drum, hh = hi-hat, sd = snare. Change a name and press play.
s("bd hh sd hh")
`),
  s("four-on-the-floor", "Four on the floor", "beginner", "Rhythm", ["drums", "house"], `
// Commas play patterns at the same time. *4 repeats a sound four times.
s("bd*4, ~ cp ~ cp, hh*8")
`),
  s("rests", "Rests make the groove", "beginner", "Rhythm", ["drums", "mini-notation"], `
// ~ is a rest. Where you leave space matters as much as where you hit.
s("bd ~ ~ bd ~ ~ sd ~, hh*8")
`),
  s("alternate", "A different sound each cycle", "beginner", "Rhythm", ["drums", "mini-notation"], `
// <a b> takes turns: one each cycle. [a a] squeezes two into one step.
s("bd <sd cp> bd <sd [sd sd]>, hh*8")
`),
  s("drum-machine", "Classic drum machines", "beginner", "Rhythm", ["drums", "bank", "808"], `
// .bank() swaps the kit. Try "RolandTR909" or "LinnDrum".
s("bd*2, ~ sd, hh*8, ~ ~ ~ oh").bank("RolandTR808")
`),
  s("first-melody", "Your first melody", "beginner", "Melody", ["piano", "notes"], `
// note() plays pitches by name; .s() picks the instrument.
note("c4 e4 g4 b4 a4 g4 e4 d4").s("piano")
`),
  s("scale-degrees", "Notes from a scale", "beginner", "Melody", ["scale", "notes"], `
// n() counts steps in a scale, so every number fits the key.
n("0 2 4 6 7 6 4 2").scale("C:minor").s("gm_kalimba")
`),
  s("slow-and-fast", "Slow down, speed up", "beginner", "Melody", ["tempo", "notes"], `
// .slow(2) stretches the pattern over two cycles; .fast(2) squeezes it.
note("c3 eb3 g3 bb3").s("gm_acoustic_bass").slow(2)
`),
  s("first-chords", "Chords with commas", "beginner", "Harmony", ["chords", "piano"], `
// Notes in [ , , ] sound together. <...> moves to the next chord each cycle.
note("<[c3,e3,g3] [a2,c3,e3] [f2,a2,c3] [g2,b2,d3]>").s("piano")
`),
  s("first-bassline", "A simple bass line", "beginner", "Bass", ["bass", "synth"], `
// A sawtooth with a low-pass filter makes a warm bass.
note("c2 c2 eb2 g1").s("sawtooth").lpf(600)
`),
  s("gain-and-pan", "Loud, soft, left, right", "beginner", "Effects", ["gain", "pan", "drums"], `
// gain sets volume per step; pan moves the sound left (0) to right (1).
s("hh*8").gain("1 .4 .7 .4").pan("0 1")
`),
  s("reverb", "Add some space", "beginner", "Effects", ["reverb", "piano"], `
// .room() adds reverb; .size() makes the room bigger.
note("c4 g4 e5 ~").s("piano").room(0.8).size(4)
`),
  s("echo", "Echo, echo", "beginner", "Effects", ["delay", "drums"], `
// delay repeats the sound: delaytime is the gap, delayfeedback how long it rings.
s("cp ~ ~ ~").delay(0.6).delaytime(0.25).delayfeedback(0.6)
`),
  s("filter-steps", "Open the filter", "beginner", "Sound design", ["filter", "synth"], `
// lpf cuts the highs. Higher numbers let more through.
note("c2*8").s("sawtooth").lpf("<300 800 2000 5000>")
`),
  s("two-tracks", "Two tracks at once", "beginner", "Structure", ["tracks", "drums", "melody"], `
// Each $: line is its own track. They play together.
$: s("bd sd bd sd, hh*8")
$: note("<c4 e4 g4 e4>*2").s("triangle")
`),
  s("instrument-swap", "Try other instruments", "beginner", "Sound design", ["gm", "instruments"], `
// The GM instruments: a new one each cycle.
note("c4 e4 g4 c5").s("<gm_vibraphone gm_marimba gm_flute gm_electric_guitar_clean>")
`),
  s("speed", "Play samples faster or slower", "beginner", "Sound design", ["samples", "speed"], `
// speed changes how fast a sample plays, and so its pitch. Below 0 plays it backwards.
s("bd*4, hh*8").speed("<1 2 0.5 -1>")
`),
  s("piano-roll", "See the notes", "beginner", "Visuals", ["viz", "pianoroll", "uses .viz"], `
// .viz() draws the pattern right under the line. This one is a piano roll.
note("c4 e4 g4 a4 g4 e4 [d4 c4] ~").s("piano").viz("pianoroll")
`),

  // ── Intermediate ────────────────────────────────────────────────────────
  s("euclid", "Euclidean rhythms", "intermediate", "Rhythm", ["drums", "euclid", "mini-notation"], `
// bd(3,8) spreads 3 hits as evenly as possible over 8 steps.
// The third number rotates the pattern.
s("bd(3,8), sd(2,8,2), hh(7,8), rim(5,16,3)")
`),
  s("polymeter", "Patterns of different lengths", "intermediate", "Rhythm", ["polymeter", "mini-notation"], `
// {a, b}%8 plays both at 8 steps a cycle, so a 3-step and a 5-step
// pattern drift against each other and meet again later.
s("{bd sd hh, cp ~ rim ~ ~}%8")
`),
  s("swing", "Swing it", "intermediate", "Rhythm", ["swing", "groove", "drums"], `
// swingBy delays every other step: here by a third, in groups of 4 per cycle.
s("bd ~ sd ~, hh*8").bank("RolandTR909").swingBy(1/3, 4)
`),
  s("chance", "Let chance play", "intermediate", "Rhythm", ["random", "drums"], `
// degradeBy drops hits at random; sometimesBy changes some of them.
s("hh*16").degradeBy(0.4).sometimesBy(0.3, x => x.speed(2))
  .stack(s("bd ~ sd ~"))
`),
  s("ply", "Stutter with ply", "intermediate", "Rhythm", ["ply", "drums"], `
// ply repeats each step: 1, 2, then 3 times, cycle by cycle.
s("bd sd [~ bd] sd").ply("<1 2 3>")
`),
  s("voicings", "Chord names and voicings", "intermediate", "Harmony", ["chords", "voicing", "jazz"], `
// chord() takes chord names; voicing() spreads them into playable notes.
chord("<Cm7 Fm7 Bb7 Ebmaj7>").voicing().s("gm_epiano1").room(0.4)
`),
  s("arpeggio", "Arpeggiate a chord", "intermediate", "Melody", ["arpeggio", "chords"], `
// arp plays the notes of a chord one at a time, in the order you give.
note("<[c3,e3,g3,b3] [a2,c3,e3,g3]>").arp("0 1 2 3 2 1 0 2").s("gm_orchestral_harp")
`),
  s("off", "A copy, a step later", "intermediate", "Melody", ["off", "canon"], `
// off layers a delayed copy; here it is an octave higher.
note("c3 eb3 g3 [bb3 g3]").off(1/8, x => x.add(note(12)).gain(0.6)).s("triangle")
`),
  s("jux-rev", "Backwards in one ear", "intermediate", "Melody", ["jux", "stereo"], `
// jux applies a change to the right channel only; rev reverses the pattern.
n("0 2 4 <7 5> 4 2").scale("D:dorian").s("gm_kalimba").jux(rev)
`),
  s("mini-ops", "Elongate, repeat, maybe", "intermediate", "Melody", ["mini-notation"], `
// @3 holds a note three steps long, !2 repeats it, ? plays it half the time.
note("c4@3 e4 g4!2 b4? c5").s("gm_vibraphone")
`),
  s("filter-lfo", "A filter that moves", "intermediate", "Sound design", ["filter", "lfo", "signal"], `
// sine is a smooth wave from 0 to 1; range maps it to cutoff frequencies.
note("c2*16").s("sawtooth").lpf(sine.range(200, 3000).slow(4)).lpq(8)
`),
  s("envelope", "Shape each note", "intermediate", "Sound design", ["envelope", "adsr", "synth"], `
// attack, decay, sustain, release: how a note starts, settles and fades.
note("c3 eb3 g3 bb3").s("sawtooth").lpf(1200)
  .attack(0.05).decay(0.2).sustain(0.3).release(0.4)
`),
  s("fm-bells", "FM bells", "intermediate", "Sound design", ["fm", "synth", "bells"], `
// fm adds frequency modulation; fmh sets the ratio. Odd ratios ring like bells.
note("c5 g5 e5 [a5 g5]").s("sine").fm(4).fmh(3.5).decay(0.6).sustain(0).room(0.5)
`),
  s("vowel", "Make it talk", "intermediate", "Effects", ["vowel", "filter", "synth"], `
// vowel filters the sound so it sounds like a, e, i, o or u.
note("c2*8").s("sawtooth").vowel("<a e i o>")
`),
  s("crush", "Lo-fi crunch", "intermediate", "Effects", ["bitcrush", "lofi", "drums"], `
// crush lowers the bit depth: 16 is clean, 4 is crunchy.
s("bd*4, ~ sd, hh*8").crush("<16 8 6 4>")
`),
  s("duck", "Duck under the kick", "intermediate", "Effects", ["sidechain", "gain", "pad"], `
// A gain pattern that dips on each beat, so the pad breathes with the kick.
$: s("bd*4")
$: note("<[c3,eb3,g3] [ab2,c3,eb3]>").s("sawtooth").lpf(1500)
  .gain("[0.2 0.6 0.8 0.9]*4").slow(2)
`),
  s("slider", "A knob in your code", "intermediate", "Live controls", ["slider", "filter"], `
// slider() puts a knob right in the code. Drag it while the pattern plays.
note("c2*8").s("sawtooth").lpf(slider(800, 100, 4000)).lpq(6)
`),
  s("named-tracks", "Name your tracks", "intermediate", "Structure", ["tracks", "mixer"], `
// A name before the colon makes a track you can find in the Mixer and Timeline.
drums: s("bd*2, ~ sd, hh*8").bank("RolandTR909")
bass: note("<c2 ab1 f1 g1>*4").s("sawtooth").lpf(500)
keys: chord("<Cm Ab F G>").voicing().s("piano").gain(0.6)
`),
  s("scope", "Watch the waveform", "intermediate", "Visuals", ["viz", "scope", "uses .viz"], `
// .viz("scope") draws the sound wave under the line as it plays.
note("<c2 eb2 g1 bb1>*4").s("sawtooth").lpf(sine.range(300, 2000).slow(4)).viz("scope")
`),

  // ── Advanced ────────────────────────────────────────────────────────────
  s("arrange", "Arrange sections", "advanced", "Structure", ["arrange", "song", "sections"], `
// arrange plays each section for a number of cycles, then the next.
const verse = stack(s("bd ~ sd ~, hh*8"), note("c2 ~ eb2 ~").s("sawtooth").lpf(500))
const chorus = stack(s("bd*4, ~ cp, hh*16"), note("<[c3,eb3,g3] [ab2,c3,eb3]>").s("supersaw").lpf(2000))
arrange([4, verse], [4, chorus])
`),
  s("chunk", "Change one part at a time", "advanced", "Melody", ["chunk", "variation"], `
// chunk splits the pattern into 4 parts and transforms a different one each cycle.
n("0 1 2 3 4 5 6 7").scale("C:minor").chunk(4, x => x.add(7)).s("gm_marimba")
`),
  s("three-against-four", "Three against four", "advanced", "Rhythm", ["polyrhythm", "drums"], `
// A 3-step and a 4-step pattern in the same cycle: a polyrhythm.
stack(
  s("bd bd bd").bank("RolandTR909"),
  s("rim rim rim rim").bank("RolandTR909").gain(0.7),
  s("hh*12").gain("[.6 .3 .3]*4"),
)
`),
  s("generative-melody", "A melody that writes itself", "advanced", "Melody", ["random", "generative"], `
// irand picks random scale steps; segment holds each for an eighth note.
// degradeBy leaves gaps, so the phrases breathe.
n(irand(8).segment(8)).scale("A:minor:pentatonic")
  .s("gm_vibraphone").room(0.6).degradeBy(0.2)
`),
  s("break-chop", "Chop a breakbeat", "advanced", "Rhythm", ["breakbeat", "samples", "chop"], `
// splice cuts the break into 8 slices and plays them in a new order.
s("breaks165").splice(8, "0 1 <2 6> 3 [4 4] 5 <6 2> 7").gain(0.9)
`),
  s("acid", "Acid line", "advanced", "Bass", ["acid", "303", "filter"], `
// A squelchy line: resonant filter swept slowly, short notes, accents in the gain.
note("c2 c3 eb2 [c2 g2] f2 c2 [bb1 c3] g1").s("sawtooth")
  .lpf(sine.range(300, 2500).slow(8)).lpq(15)
  .decay(0.15).sustain(0).gain("1 .7 .9 .7")
`),
  s("dub-chords", "Dub chords", "advanced", "Harmony", ["dub", "delay", "chords"], `
// Short offbeat chords sent into a long delay and a big room.
chord("<Cm9 Fm9>").voicing().struct("~ x ~ x").s("sawtooth").lpf(900)
  .decay(0.12).sustain(0).delay(0.6).delaytime(3/16).delayfeedback(0.65).room(0.6)
`),
  s("struct", "Rhythm from a mask", "advanced", "Melody", ["struct", "rhythm"], `
// struct gives a melody its rhythm from a pattern of x and ~.
n("<0 3 5 4>").add("0,4").scale("E:minor")
  .struct("x ~ x x ~ x ~ x").s("gm_electric_guitar_muted").room(0.3)
`),
  s("many-lfos", "Many LFOs", "advanced", "Sound design", ["lfo", "signal", "stereo"], `
// Signals at different speeds drive cutoff, pan and volume, so the line keeps changing.
note("c3*16").add(note("<0 3 5 7>")).s("square")
  .lpf(sine.range(400, 3000).slow(3)).pan(cosine.slow(2)).gain(saw.range(0.4, 0.9).fast(2))
`),
  s("call-response", "Call and response", "advanced", "Structure", ["lastOf", "variation"], `
// Three cycles of the call, then lastOf turns the fourth into the answer.
note("c4 e4 g4 [a4 g4]").s("gm_trumpet")
  .lastOf(4, x => x.rev().add(note(-5)))
`),
  s("ambient", "Ambient drift", "advanced", "Sound design", ["ambient", "generative", "pad"], `
// Long, soft notes chosen at random, sparse, with a long release and a big room.
n(irand(10).segment(4)).scale("D:lydian").s("gm_pad_warm")
  .attack(0.5).release(2).degradeBy(0.3).room(0.9).size(8).slow(2)
`),
  s("palindrome-iter", "Turn the phrase around", "advanced", "Melody", ["iter", "palindrome"], `
// iter starts the phrase one step later each cycle; palindrome plays it back and forth.
n("0 2 4 5 7").scale("G:mixolydian").iter(5).palindrome().s("gm_acoustic_guitar_nylon")
`),
  s("hydra-backdrop", "Music you can see", "advanced", "Visuals", ["viz", "hydra", "uses .viz"], `
// .viz() can use a Hydra visual too: this kaleidoscope reacts to the sound.
s("bd*4, ~ cp, hh*8").bank("RolandTR909")
  .stack(note("<c2 eb2 ab1 bb1>*2").s("sawtooth").lpf(700))
  .viz("kaleidoscope:hydra")
`),
  s("full-groove", "A full groove", "advanced", "Structure", ["tracks", "song", "uses .viz"], `
// Four named tracks: drums, bass, chords and a lead you can see.
drums: s("bd ~ ~ bd ~ ~ sd ~, hh*8, ~ ~ ~ ~ ~ ~ ~ oh").bank("RolandTR909").swingBy(1/6, 4)
bass: note("<c2 c2 ab1 bb1>").struct("x ~ x x ~ x ~ ~").s("sawtooth").lpf(600).decay(0.2).sustain(0.4)
chords: chord("<Cm7 Cm7 Abmaj7 Bb7>").voicing().s("gm_epiano1").gain(0.5).room(0.4)
lead: n("<[0 2 4 ~] [7 ~ 4 2]>").scale("C:minor").add(n(7)).s("triangle").delay(0.3).viz("pianoroll")
`),
];
