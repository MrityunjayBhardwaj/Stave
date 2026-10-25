/**
 * Project templates — PM Phase 2.5
 *
 * Each template defines the starting set of files for a new project.
 * When a user creates a new project with a template, the template's
 * files are seeded into the Y.Doc via seedWorkspaceFile.
 */

import {
  seedWorkspaceFile,
  setContent,
  setChildOrder,
  getTrackMeta,
  setTrackMeta,
  getZoneHeightOverride,
  setZoneHeightOverride,
  buildDefaultSnapshot,
  listWorkspaceFiles,
  loadShellState,
  saveShellState,
  type TrackDisplay,
  bundledPresetId,
  workspaceFileIdForPreset,
  isVizLanguage,
  type WorkspaceLanguage,
  // Bundled p5 viz source — moved into @stave/editor in #184 so the
  // viz picker (compiled from DEFAULT_VIZ_DESCRIPTORS) and these
  // preset files (seeded below) share one code path.
  PIANOROLL_P5_CODE,
  WORDFALL_P5_CODE,
  SCOPE_P5_CODE,
  FSCOPE_P5_CODE,
  SPECTRUM_P5_CODE,
  SPIRAL_P5_CODE,
  PITCHWHEEL_P5_CODE,
  // Signal-bus example sketches (Phase 21) — living docs for the named bus.
  SIGNALS_SPECTRUM_P5_CODE,
  SIGNALS_BACKDROP_P5_CODE,
} from "@stave/editor";
import {
  PITCHWHEEL_P5_UNTIL_2021,
  PITCHWHEEL_P5_UNTIL_1929,
  PITCHWHEEL_P5_FIRST,
  SPIRAL_P5_UNTIL_2021,
  SPIRAL_P5_FIRST,
} from "./retiredPresetSources";
import { VIZ_LIBRARY, planVizLibFiles } from "./assetLibrary/vizLibrary";
import { pinTabBackdropIfUnset } from "./state/tabBackdrops";

// ── Default code snippets ────────────────────────────────────────────

export const STRUDEL_CODE = `// Welcome to Stave! Ctrl+Enter plays, Ctrl+. stops.
// Each named line is a track: you'll find it in the Mixer and on the Timeline.

setcps(110/60/4) // 110 bpm

kick: s("bd*4").bank("LinnDrum").gain(0.5)

snare: s("~ sd ~ sd").bank("LinnDrum").gain(0.4).room(0.6).size(6)

hats: s("[~ hh]*4").bank("LinnDrum").gain(0.3)

bass: note("<[a1 a2]*4 [f1 f2]*4 [c2 c3]*4 [g1 g2]*4>").s("sawtooth")
  .lpf(slider(900, 200, 3000)) // drag the knob
  .decay(0.15).sustain(0.3)._pianoroll()

pads: chord("<Am F C G>").voicing().s("supersaw")
  .lpf(1800).attack(0.3).release(1).gain(0.35).room(0.5)
  .viz("Sunset Drive", { backdrop: true })

lead: n("<[4 ~ 3 ~ 2 ~ ~ ~] [~ 0 ~ 2 3 ~ 2 ~]>").scale("A4:minor")
  .s("square").lpf(2500).gain(0.4).delay(0.4).delaytime(3/8)
  .viz("scope")
`;

/** Strudel Sketch (#2076): a short, plain pattern to start writing on. The
 *  Starter is the tour (STRUDEL_CODE, wired to the visualisers); this is the
 *  quiet page. */
export const STRUDEL_SKETCH_CODE = `// A Strudel sketch — Ctrl+Enter to play · Ctrl+. to stop

setcps(0.5)

drums: s("bd ~ sd ~, hh*8").gain(0.6)

bass: note("<c3 eb3 g3 f3>")
  .s("sawtooth").lpf(900).release(0.2)`;

export const SONIC_PI_CODE = `# Sonic Pi — Imperative play/sleep/live_loop
# Ctrl+Enter to play · Ctrl+. to stop

use_bpm 120

live_loop :drums do
  viz :pianoroll
  sample :bd_haus
  sleep 0.5
  sample :sn_dub
  sleep 0.5
end

live_loop :bass do
  viz :scope
  use_synth :tb303
  play choose([36, 39, 43]), release: 0.3
  sleep 0.5
end

live_loop :melody do
  viz :pitchwheel
  use_synth :prophet
  play choose([60, 64, 67, 72]), release: 0.2
  sleep 0.25
end`;

export const PIANOROLL_HYDRA_CODE = `// Hydra Piano Roll — shader-based frequency bands
s.osc(() => 10 + s.a.fft[0] * 50, -0.3, 0)
  .thresh(() => 0.3 + s.a.fft[0] * 0.5, 0.1)
  .color(0.46, 0.71, 1.0)
  .add(
    s.osc(() => 20 + s.a.fft[1] * 40, 0.2, 0)
      .rotate(Math.PI / 2)
      .thresh(() => 0.4 + s.a.fft[1] * 0.4, 0.08)
      .color(1.0, 0.79, 0.16),
    () => s.a.fft[1] * 0.8
  )
  .modulate(s.noise(2, () => s.a.fft[3] * 0.4), () => s.a.fft[0] * 0.015)
  .scrollX(() => s.a.fft[0] * 0.02)
  .out()`;

export const HYDRA_SCOPE_CODE = `// Hydra Scope — audio-reactive oscilloscope
s.osc(() => 20 + s.a.fft[0] * 80, 0.1, 0)
  .color(0.2, 0.8, 1.0)
  .rotate(() => s.a.fft[1] * 0.5)
  .modulate(s.osc(3, 0, 0), () => s.a.fft[2] * 0.1)
  .diff(s.osc(2, 0.1, 0).rotate(0.5))
  .out()`;

export const HYDRA_KALEIDOSCOPE_CODE = `// Hydra Kaleidoscope — mirrored fractal audio patterns
s.osc(6, 0.1, () => s.a.fft[0] * 3)
  .kaleid(() => 3 + Math.floor(s.a.fft[1] * 8))
  .color(
    () => 0.5 + s.a.fft[0] * 0.5,
    () => 0.3 + s.a.fft[1] * 0.7,
    () => 0.8 + s.a.fft[2] * 0.2
  )
  .rotate(() => s.a.fft[3] * 3.14)
  .modulate(s.noise(3), () => s.a.fft[0] * 0.05)
  .out()`;

export const SIGNALS_BANDS_HYDRA_CODE = `// Hydra Signals (Bands) — the named musical-signal bus in hydra.
// Try it over a drum pattern, e.g.   $: s("bd*4 hh*8")
//
// IMPORTANT: hydra sketches receive two namespaces — \`s\` (the hydra synth) and
// \`stave\` (the live bus). Unlike p5, nothing is exposed bare here, so write
// \`s.osc(...)\` and \`stave.sig.bass(...)\`. And in hydra the bus SCALARS are
// () => number THUNKS (call them every frame), while \`fft\` / \`wave\` are arrays:
//
//   stave.sig.bass()       — master low-band magnitude, 0..1 (a THUNK — call it).
//                            stave.sig.rms() / sig.mid() / sig.treble() are siblings.
//   stave.sig('bd').rms()  — the 'bd' (kick) sound's loudness 0..1 (also a thunk).
//   stave.sig('bd').env()  — that sound's envelope, 0..1 (bumps on each hit).
//   stave.sig('bd').fft[i] — that sound's spectrum: an ARRAY, indexed natively.
//                            Wrap the WHOLE expression in () => … so hydra reads
//                            it fresh each frame:  () => stave.sig('bd').fft[2]
//
// (In p5 these same names are bare LIVE NUMBERS — see "Signals (Spectrum)".)

s.osc(() => 8 + stave.sig.bass() * 30, 0.1, 0)      // density rides the low band
  .color(
    () => 0.4 + stave.sig('bd').rms() * 0.6,        // red pulses with the kick
    0.5,
    () => 0.6 + stave.sig.treble() * 0.4            // blue follows the highs
  )
  .rotate(() => stave.sig('bd').fft[2] || 0)        // spin from a kick spectrum bin
  .modulate(s.noise(2), () => stave.sig.mid() * 0.15) // wobble with the mids
  .out(s.o0)`;

/**
 * A finished song, one file. The voice line is a sung melody transcribed to
 * notes, so the template is code only — it needs no audio file.
 */
export const FULL_SONG_CODE = `// A full song — 48 bars, 96 seconds. C minor, 120 BPM, one cycle = one bar.
// Piano chords in a pushed rhythm, an offbeat bass that follows them, a flute
// playing a short stabbed hook, and a sung line over the last eight bars.
// Ctrl+Enter to play · Ctrl+. to stop
//
// The voice line began as a sung recording. It was read a sixteenth at a time
// and written as notes: 8 bars, 16 sixteenths a bar. \`c4@11\` is a C held for
// eleven sixteenths, \`~@3\` is three of silence. The recording is not used.
//
// Each track at the bottom is laid out with arrange([bars, part], ...).
setcps(120/240)

// drums
const loop  = s("bd*2, hh*4").gain(0.4)
const four  = s("bd*4, hh*8").gain(0.4)
const fast  = s("bd*4, hh*16").gain(0.4)
const beat  = s("bd*4, hh*16, ~ clap ~ clap, [~ oh]*4").gain(0.4)
const thin  = s("sd*4 sd*8 sd*16 sd*16").gain("0.07 0.09 0.13 0.18")

// bass
const hollow = note("c2").s("sine").gain(0.35)
const sub    = note("<ab1 bb1 c2 g1>").struct("~ x ~ x ~ x ~ x").s("sawtooth").lpf(800)
const subUp  = note("<ab1 bb1 c2 a#1>").struct("~ x ~ x ~ x ~ x").s("sawtooth").lpf("<800 800 2500 2500>")
const subOn  = note("<ab1 bb1 c2 a#1>").struct("~ x ~ x ~ x ~ x").s("sawtooth").lpf(2500).room(0.4)

// chords, lead
const chords = note("<[ab3,c4,eb4,g4] [bb3,d4,f4] [c4,eb4,g4,bb4] [g3,bb3,eb4]>").struct("x ~ ~ x ~ ~ x ~").s("piano").room(0.6).gain(0.6)
const lead   = note("<[c5 c5 ~ eb5 ~ c5 g5 ~] [f5 f5 ~ eb5 ~ d5 bb4 ~]>").s("gm_flute").clip(0.5).delay(0.3).room(0.3).gain(1.2)

// voice
const melody = note("c4@11 ~@3 d4@2  eb4@2 d4@4 c4@2 bb3@5 ~@3  c4@9 ~@4 eb4@3  eb4@2 f4@4 eb4@2 d4@4 c4 bb3@3  c4@7 ~@4 d4@2 eb4@3  d4@3 c4@8 d4@3 eb4@12 f4@3 g4@7 ~@12").slow(8).s("gm_voice_oohs").room(0.4)

drums: arrange([10, loop], [2, silence], [5, loop], [3, four], [3, fast], [12, beat], [1, thin], [8, beat], [4, loop])
bass:  arrange([10, silence], [2, hollow], [12, sub], [4, subUp], [16, subOn], [4, silence])
keys:  arrange([28, silence], [8, chords], [12, chords])
lead:  arrange([30, silence], [5, lead], [1, silence], [8, lead], [4, silence])
voice: arrange([40, silence], [8, melody])

all(x => x.postgain(0.8))`;

// ── Types ────────────────────────────────────────────────────────────

export interface TemplateFile {
  id: string;
  path: string;
  content: string;
  language: WorkspaceLanguage;
  meta?: Record<string, unknown>;
  /** How each of the song's NAMED tracks draws on the Song timeline: every
   *  track Bars, a vocal Waveform. Saved when the project is made, so a track
   *  whose default would change once its sound loads (a piano's sample
   *  outlasts a bar, #2079) does not. Never a `$:` track's d1, d2…: that name
   *  is only "the first `$:`", so a type saved for it would stick to whatever
   *  track the user writes first. Songs of `$:` tracks rely on the default. */
  trackDisplays?: Record<string, TrackDisplay>;
  /** #2240 — the viz file pinned behind this file's tab when a project is
   *  made from the template, so it shows before anything is played. */
  backdrop?: string;
  /** #2240 — the height (px) of a named track's inline visual, saved the way a
   *  drag saves it, with the visual's id: a ceiling on the fit-to-width height,
   *  so two visuals of different shapes can sit at one size, dropped when the
   *  track's visual changes (`pruneZoneOverrides`). */
  zoneHeights?: Record<string, { px: number; vizId: string }>;
  /** #2240 — open as a tab when the project is made, in the order listed; the
   *  first one opened is the active tab. Without any, the editor opens the
   *  project's Strudel file on its own. */
  openTab?: boolean;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  files: TemplateFile[];
}

// Helper — the bundled viz preset IDs
const p5PresetId = () => bundledPresetId("Piano Roll", "p5");
const hydraPresetId = () => bundledPresetId("Piano Roll Hydra", "hydra");

// ── Templates ─────────────────────────────────────────────────────────

/**
 * Starter — a Strudel pattern playing through the built-in p5.js and Hydra
 * visualisers. Its viz files are also the bundled visualisers every project
 * carries in preset/viz (seedMissingPresetFiles). Best for exploring.
 *
 * #2240 — it also brings the Viz Library's Sunset Drive, the backdrop the
 * pattern asks for, at the id and path the Library's `+` writes, so adding it
 * from the Library later finds it already there.
 */
function makeStarterFiles(): TemplateFile[] {
  const p5Id = p5PresetId();
  const hydraId = hydraPresetId();

  // Helper — create a viz preset workspace file with the right id/meta
  // so the preset bridge picks it up on mount.
  const vizFile = (
    name: string,
    ext: "p5" | "hydra" | "glsl",
    code: string,
  ): TemplateFile => {
    const lang: WorkspaceLanguage =
      ext === "hydra" ? "hydra" : ext === "glsl" ? "glsl" : "p5js";
    const renderer = ext === "hydra" ? "hydra" : ext === "glsl" ? "glsl" : "p5";
    const presetId = bundledPresetId(name, renderer);
    return {
      id: workspaceFileIdForPreset(presetId),
      path: `preset/viz/${name}.${ext}`,
      content: code,
      language: lang,
      meta: { presetId },
    };
  };

  return [
    // The song: the project's own file, at the root (#2076).
    {
      id: "pattern.strudel",
      path: "pattern.strudel",
      content: STRUDEL_CODE,
      language: "strudel",
      // #2240 — Sunset Drive behind the song from the first second
      backdrop: sunsetDriveFiles()[0]?.id,
      // the piano roll and the scope at one size, short enough that the whole
      // song fits on the first screen (the scope alone fits to 462px at 1280)
      zoneHeights: { bass: { px: 160, vizId: "pianoroll" }, lead: { px: 160, vizId: "scope" } },
      openTab: true,
    },
    // NOTE: the Sonic Pi preset file is intentionally omitted from this build —
    // its engine (sibling sonicPiWeb repo) is not vendored yet (#171). Re-add
    // when sonicPiWeb ships as a package.
    // Viz presets — p5
    {
      id: workspaceFileIdForPreset(p5Id),
      path: "preset/viz/Piano Roll.p5",
      content: PIANOROLL_P5_CODE,
      language: "p5js",
      meta: { presetId: p5Id },
    },
    vizFile("scope", "p5", SCOPE_P5_CODE),
    vizFile("fscope", "p5", FSCOPE_P5_CODE),
    vizFile("spectrum", "p5", SPECTRUM_P5_CODE),
    vizFile("spiral", "p5", SPIRAL_P5_CODE),
    vizFile("pitchwheel", "p5", PITCHWHEEL_P5_CODE),
    vizFile("wordfall", "p5", WORDFALL_P5_CODE),
    // Signal-bus example sketches (Phase 21) — bundled docs for the named bus.
    vizFile("Signals (Spectrum)", "p5", SIGNALS_SPECTRUM_P5_CODE),
    vizFile("Signals (Backdrop)", "p5", SIGNALS_BACKDROP_P5_CODE),
    // Viz presets — Hydra
    {
      id: workspaceFileIdForPreset(hydraId),
      path: "preset/viz/Piano Roll (Hydra).hydra",
      content: PIANOROLL_HYDRA_CODE,
      language: "hydra",
      meta: { presetId: hydraId },
    },
    vizFile("scope", "hydra", HYDRA_SCOPE_CODE),
    vizFile("kaleidoscope", "hydra", HYDRA_KALEIDOSCOPE_CODE),
    vizFile("Signals (Bands)", "hydra", SIGNALS_BANDS_HYDRA_CODE),
    // GLSL example shaders (Prism, Pulse Grid) are no longer seeded here — they
    // moved to the curated Viz library (`assetLibrary/vizLibrary.ts`, #834), so
    // the user opts into them via the Library's "Add to workspace" instead.
    // #2240 — the one Library package the Starter's pattern uses, open in a
    // tab beside the song so its code is one click away.
    ...sunsetDriveFiles().map((f) => ({ ...f, openTab: true })),
  ];
}

/** Sunset Drive, as the Library's `+` would add it (#2240). */
function sunsetDriveFiles(): TemplateFile[] {
  const item = VIZ_LIBRARY.find((i) => i.id === "sunset-drive");
  if (!item) return [];
  return planVizLibFiles(item).map((f) => ({
    id: f.workspaceId,
    path: f.path,
    content: f.content,
    language: f.language,
  }));
}

function makeStrudelOnlyFiles(): TemplateFile[] {
  return [
    {
      id: "pattern.strudel",
      path: "pattern.strudel",
      content: STRUDEL_SKETCH_CODE,
      language: "strudel",
    },
  ];
}

function makeFullSongFiles(): TemplateFile[] {
  return [
    {
      id: "song.strudel",
      path: "song.strudel",
      content: FULL_SONG_CODE,
      trackDisplays: { drums: "bars", bass: "bars", keys: "bars", lead: "bars", voice: "waveform" },
      language: "strudel",
    },
  ];
}

// The sketch is a file of its own (#2076). It used to take the Piano Roll
// (Hydra) preset's id, which hid that preset from preset/viz and made editing
// the sketch rewrite the visualiser `.viz("Piano Roll (Hydra)")` plays.
function makeHydraOnlyFiles(): TemplateFile[] {
  return [
    {
      id: "sketch.hydra",
      path: "sketch.hydra",
      content: PIANOROLL_HYDRA_CODE,
      language: "hydra",
    },
  ];
}

function makeSonicPiOnlyFiles(): TemplateFile[] {
  return [
    {
      id: "pattern.sonicpi",
      path: "pattern.sonicpi",
      content: SONIC_PI_CODE,
      language: "sonicpi",
    },
  ];
}

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: "starter",
    name: "Starter",
    description:
      "An outrun groove: drums, bass, pads and lead, a knob, a piano roll, a scope, and Sunset Drive behind it. Best for exploring.",
    files: [], // filled lazily via getTemplateFiles
  },
  {
    id: "strudel",
    name: "Strudel Sketch",
    description: "A short Strudel pattern to start writing on.",
    files: [],
  },
  {
    id: "song",
    name: "Full Song",
    description:
      "A finished 48-bar song: drums, bass, keys, a flute hook and a sung line written as notes.",
    files: [],
  },
  // Sonic Pi template hidden in this build — engine not vendored yet (#171).
  {
    id: "hydra",
    name: "Hydra Visual",
    description: "A Hydra sketch of its own. Audio-reactive visuals.",
    files: [],
  },
  {
    id: "blank",
    name: "Blank",
    description: "No files of your own yet. Add them from the sidebar.",
    files: [],
  },
];

export function getTemplateFiles(templateId: string): TemplateFile[] {
  switch (templateId) {
    case "starter":
      return makeStarterFiles();
    case "strudel":
      return makeStrudelOnlyFiles();
    case "song":
      return makeFullSongFiles();
    case "sonicpi":
      return makeSonicPiOnlyFiles();
    case "hydra":
      return makeHydraOnlyFiles();
    case "blank":
      return [];
    default:
      return makeStarterFiles();
  }
}

/**
 * Seed all files from a template into the current Y.Doc via seedWorkspaceFile.
 * If files already exist (persisted project), they are returned unchanged —
 * this is idempotent for a given project.
 */
export function seedProjectFromTemplate(templateId: string, projectId: string): void {
  const files = getTemplateFiles(templateId);
  for (const f of files) {
    seedWorkspaceFile(f.id, f.path, f.content, f.language, f.meta);
    // #2240 — a backdrop the template pins; one already chosen stays
    if (f.backdrop) pinTabBackdropIfUnset(projectId, f.id, f.backdrop);
    for (const [track, { px, vizId }] of Object.entries(f.zoneHeights ?? {})) {
      if (getZoneHeightOverride(f.id, track) === undefined) setZoneHeightOverride(f.id, track, px, undefined, vizId);
    }
    // A type already saved is the user's choice: seeding again never changes it.
    for (const [track, display] of Object.entries(f.trackDisplays ?? {})) {
      if (getTrackMeta(f.id, track).display === undefined) setTrackMeta(f.id, track, { display });
    }
  }
  openTemplateTabs(projectId, files);
  // The project's own files come first, above the bundled visualisers every
  // project carries in preset/ (#2076); folders would otherwise sort first.
  const own = files.filter((f) => !f.path.includes("/")).map((f) => `f:${f.id}`);
  if (own.length > 0) setChildOrder("", [...own, "d:preset"]);
}

/**
 * #2240 — the tabs a new project opens with: the template's `openTab` files, in
 * order, the first one active. Saved as the project's tab layout, which the
 * editor reads when it mounts; a layout already saved for the project stays.
 */
function openTemplateTabs(projectId: string, files: readonly TemplateFile[]): void {
  const open = files.filter((f) => f.openTab).map((f) => f.id);
  if (open.length === 0) return;
  const valid = new Set(listWorkspaceFiles().map((f) => f.id));
  if (loadShellState(projectId, valid)) return;
  const base = buildDefaultSnapshot("g-main", open[0]);
  const group = base.groups.get("g-main")!;
  const groups = new Map(base.groups);
  groups.set("g-main", {
    ...group,
    tabs: [...group.tabs, ...open.slice(1).map((fileId) => ({ kind: "editor" as const, id: `tab-${fileId}`, fileId }))],
  });
  saveShellState(projectId, { ...base, groups });
}

/**
 * The kinds of file a template creates, in the order it lists them: what its
 * card shows (#2076). Blank creates none.
 */
export function templateLanguages(templateId: string): WorkspaceLanguage[] {
  return [...new Set(getTemplateFiles(templateId).map((f) => f.language))];
}

/** The fixed sketch each retired source became (#2021) — see retiredPresetSources.ts. */
const RETIRED_PRESET_SOURCES: ReadonlyMap<string, readonly string[]> = new Map([
  [PITCHWHEEL_P5_CODE, [PITCHWHEEL_P5_UNTIL_2021, PITCHWHEEL_P5_UNTIL_1929, PITCHWHEEL_P5_FIRST]],
  [SPIRAL_P5_CODE, [SPIRAL_P5_UNTIL_2021, SPIRAL_P5_FIRST]],
]);

/**
 * Seed any missing viz preset workspace files into the current project, and bring
 * an UNEDITED copy of a since-fixed sketch up to date (see RETIRED_PRESET_SOURCES).
 * Idempotent — seedWorkspaceFile skips files that already exist, and a copy that
 * has been brought up to date no longer matches a retired source.
 * Call on mount so older projects get the new preset files without
 * requiring a project re-creation.
 */
export function seedMissingPresetFiles(): void {
  const starterFiles = makeStarterFiles();
  for (const f of starterFiles) {
    // Only the bundled visualisers: the Starter's Library package (#2240) is
    // the Starter's own, not something every project should gain.
    if (isVizLanguage(f.language) && f.path.startsWith("preset/")) {
      const file = seedWorkspaceFile(f.id, f.path, f.content, f.language, f.meta);
      if (RETIRED_PRESET_SOURCES.get(f.content)?.includes(file.content)) {
        setContent(f.id, f.content);
      }
    }
  }
}
