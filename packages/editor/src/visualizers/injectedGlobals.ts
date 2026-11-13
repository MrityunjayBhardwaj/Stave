/**
 * injectedGlobals — the single, authoritative catalogue of the Stave-injected
 * globals a viz sketch may read, per renderer kind (#309).
 *
 * This is the SOURCE OF TRUTH for two surfaces:
 *   - the read-only "Stave Inputs" reference block shown above the viz editor
 *     (ShaderToy-style — see {@link formatStaveInputs}); and
 *   - the Monaco hover provider that shows a token's doc + live master value
 *     (see {@link injectedGlobalByToken} + the `live` field).
 *
 * Keeping ONE list means the docs surfaced to authors cannot drift from what is
 * actually injected by the compilers/builders (`buildStaveUniforms` for p5,
 * `buildHydraStaveBag` for hydra, the `UNIFORMS` + `STAVE_TRACK_API` strings for
 * glsl). When a new bus signal is added to those builders, add it here too — the
 * same PV54 additive-floor obligation, applied to the doc surface (PV94).
 *
 * SCOPE (deliberate, issue #309): Stave-exclusive globals ONLY. The full p5 /
 * hydra built-in API is NOT listed — authors know p5/hydra; what they can't
 * discover is what STAVE injects on top.
 *
 * WORKER-SAFE: pure data + string formatting, no DOM / no renderer imports.
 */

import type { VizRendererKind } from '../workspace/vizLanguages'

/**
 * How the hover provider reads a token's LIVE value from the GLOBAL MASTER bus
 * (issue #309 — master-only, no per-instance focus). `null`/absent ⇒ no live
 * value (structural handle like `stave.scheduler`, or a per-instance/non-numeric
 * token) → hover shows the doc only.
 */
export type LiveSpec =
  | { kind: 'scalar'; read: MasterScalar } // a 0..1 number from the master bus
  | { kind: 'array'; read: MasterArray } // a number[] (fft / wave) → sparkline
  | { kind: 'time' } // glsl iTime — seconds since the probe started

/** Master-mix scalar signals readable live (all 0..1). */
export type MasterScalar =
  | 'rms'
  | 'bass'
  | 'mid'
  | 'treble'
  | 'keyVelocity'
  | 'env:uKick'
  | 'env:uSnare'
  | 'env:uHat'
  | 'env:uOpenHat'
  | 'env:uClap'
  | 'env:uRim'
  | 'env:uTom'

/** Master-mix array signals readable live. */
export type MasterArray = 'fft' | 'wave'

/**
 * One catalogued entry. `decl` is the human declaration line shown in the block
 * (kind-specific syntax); `comment` is the trailing `// ...`; `tokens` are the
 * individual identifiers the hover provider matches a hovered word against.
 */
export interface InjectedGlobal {
  /** Declaration as it reads in the block, e.g. `uniform float iTime;`. */
  readonly decl: string
  /** Trailing comment (no leading `//`). */
  readonly comment: string
  /** Identifiers under this entry, for hover word-match. */
  readonly tokens: readonly string[]
  /**
   * Section the entry belongs to in the reference block. Entries are listed in
   * group order; {@link formatStaveInputs} emits a `// — <group> —` header when
   * the group changes. Makes the one-namespace rule visible at a glance
   * (every signal lives on `sig` — `sig.kick` a number, `sig.fft` an array).
   */
  readonly group: string
  /** Live-value source on the master bus, when the token carries one. */
  readonly live?: Partial<Record<string, LiveSpec>>
}

// Section labels — shared so the formatter and the trailing rule line stay
// consistent with the grouping.
const G_CONTEXT = 'context'
const G_SCALARS = 'signals · scalars on sig (0..1)'
const G_SCALARS_THUNK = 'signals · scalar thunks on stave.sig (0..1)'
const G_STRUCTURED = 'signals · structured (on sig)'
const G_CORE = 'core'
const G_GLSL_SCALARS = 'signals · scalars (0..1)'
const G_GLSL_TRACK = 'signals · per-track'
const G_GLSL_NOTES = 'upcoming notes'

/** The trailing one-line rule per kind (the scalar-vs-accessor payoff). */
const RULE: Record<VizRendererKind, string | null> = {
  p5: 'rule: every signal lives on sig — sig.kick is a number, sig.fft an array, sig(\'bd\') one sound',
  hydra: 'rule: every signal lives on stave.sig — sig.kick() a number, sig.fft an array, sig(\'bd\') one sound',
  glsl: 'rule: scalars are floats · spectrum/waveform = iChannel0 texture · per-track via staveTrack(i) · notes via staveNote(i)',
  three: 'rule: plain three.js; every signal lives on sig — sig.bass is a number, sig.fft an array, sig(\'bd\') one sound',
}

// ── per-kind catalogues ─────────────────────────────────────────────────────
// Each `decl // comment` line mirrors the grounded injected surface. The `live`
// map keys are the individual tokens (so `uKick` and `uSnare` on one decl line
// can each carry their own master reading).

const ENV_LIVE = (env: MasterScalar): LiveSpec => ({ kind: 'scalar', read: env })

const GLSL_GLOBALS: readonly InjectedGlobal[] = [
  { group: G_CORE, decl: 'uniform vec3      iResolution;', comment: 'viewport resolution (in pixels)', tokens: ['iResolution'] },
  { group: G_CORE, decl: 'uniform float     iTime;', comment: 'playback time (in seconds)', tokens: ['iTime'], live: { iTime: { kind: 'time' } } },
  { group: G_CORE, decl: 'uniform vec4      iMouse;', comment: 'mouse pixel coords (zero in worker)', tokens: ['iMouse'] },
  { group: G_CORE, decl: 'uniform sampler2D iChannel0;', comment: 'analyser — row 0 = FFT, row 1 = waveform', tokens: ['iChannel0'] },
  {
    group: G_GLSL_SCALARS,
    decl: 'uniform float     uKick, uSnare, uHat, uOpenHat, uClap, uRim, uTom;',
    comment: 'per-drum envelope 0..1',
    tokens: ['uKick', 'uSnare', 'uHat', 'uOpenHat', 'uClap', 'uRim', 'uTom'],
    live: {
      uKick: ENV_LIVE('env:uKick'), uSnare: ENV_LIVE('env:uSnare'), uHat: ENV_LIVE('env:uHat'),
      uOpenHat: ENV_LIVE('env:uOpenHat'), uClap: ENV_LIVE('env:uClap'), uRim: ENV_LIVE('env:uRim'), uTom: ENV_LIVE('env:uTom'),
    },
  },
  { group: G_GLSL_SCALARS, decl: 'uniform float     uVelocity;', comment: 'loudest active hit 0..1', tokens: ['uVelocity'], live: { uVelocity: { kind: 'scalar', read: 'keyVelocity' } } },
  {
    group: G_GLSL_SCALARS,
    decl: 'uniform float     uRms, uBass, uMid, uTreble;',
    comment: 'master-mix DSP 0..1',
    tokens: ['uRms', 'uBass', 'uMid', 'uTreble'],
    live: { uRms: { kind: 'scalar', read: 'rms' }, uBass: { kind: 'scalar', read: 'bass' }, uMid: { kind: 'scalar', read: 'mid' }, uTreble: { kind: 'scalar', read: 'treble' } },
  },
  { group: G_GLSL_TRACK, decl: 'uniform int       uTrackCount;', comment: 'live track count', tokens: ['uTrackCount'] },
  { group: G_GLSL_TRACK, decl: 'StaveTrack        staveTrack(int i);', comment: '{ env, velocity, rms, bass, mid, treble } — per track i', tokens: ['staveTrack', 'StaveTrack'] },
  { group: G_GLSL_NOTES, decl: 'uniform int       uNoteCount;', comment: 'notes in uNotes (≤ STAVE_MAX_NOTES), now−4 … now+2 cycles', tokens: ['uNoteCount', 'STAVE_MAX_NOTES'] },
  { group: G_GLSL_NOTES, decl: 'StaveNote         staveNote(int i);', comment: '{ begin, end, midi (−1 = drum), gain, velocity, track } — sorted by begin', tokens: ['staveNote', 'StaveNote'] },
  { group: G_GLSL_NOTES, decl: 'uniform float     uNow, uCps;', comment: 'scheduler now (cycles) · cycles per second', tokens: ['uNow', 'uCps'] },
  { group: G_GLSL_NOTES, decl: 'uniform sampler2D uNotes;', comment: 'the raw texture staveNote(i) reads (texelFetch)', tokens: ['uNotes'] },
]

const P5_GLOBALS: readonly InjectedGlobal[] = [
  { group: G_CONTEXT, decl: 'PatternScheduler  stave.scheduler;', comment: '.now(), .query(begin, end)', tokens: ['scheduler'] },
  { group: G_CONTEXT, decl: 'AnalyserNode      stave.analyser;', comment: 'raw getFloat{Time,Frequency}Data', tokens: ['analyser'] },
  { group: G_CONTEXT, decl: 'HapStream         stave.hapStream;', comment: 'active note events', tokens: ['hapStream'] },
  { group: G_CONTEXT, decl: 'object            stave.options;', comment: 'the .viz({ ... }) argument', tokens: ['options'] },
  {
    group: G_SCALARS,
    decl: 'number   sig.kick, sig.snare, sig.hat, sig.openHat, sig.clap, sig.rim, sig.tom;',
    comment: 'per-drum envelope 0..1',
    tokens: ['kick', 'snare', 'hat', 'openHat', 'clap', 'rim', 'tom'],
    live: {
      kick: ENV_LIVE('env:uKick'), snare: ENV_LIVE('env:uSnare'), hat: ENV_LIVE('env:uHat'),
      openHat: ENV_LIVE('env:uOpenHat'), clap: ENV_LIVE('env:uClap'), rim: ENV_LIVE('env:uRim'), tom: ENV_LIVE('env:uTom'),
    },
  },
  { group: G_SCALARS, decl: 'number   sig.keyVelocity;', comment: 'loudest active hit 0..1', tokens: ['keyVelocity'], live: { keyVelocity: { kind: 'scalar', read: 'keyVelocity' } } },
  {
    group: G_SCALARS,
    decl: 'number   sig.rms, sig.bass, sig.mid, sig.treble;',
    comment: 'master-mix DSP 0..1',
    tokens: ['rms', 'bass', 'mid', 'treble'],
    live: { rms: { kind: 'scalar', read: 'rms' }, bass: { kind: 'scalar', read: 'bass' }, mid: { kind: 'scalar', read: 'mid' }, treble: { kind: 'scalar', read: 'treble' } },
  },
  { group: G_STRUCTURED, decl: 'number[] sig.fft, sig.wave;', comment: 'master spectrum / waveform (arrays)', tokens: ['fft', 'wave'], live: { fft: { kind: 'array', read: 'fft' }, wave: { kind: 'array', read: 'wave' } } },
  { group: G_STRUCTURED, decl: "Reading  sig('bd'), sig.track('$0');", comment: 'one sound / track → { env, rms, fft[], … }', tokens: ['sig', 'track'] },
  { group: G_STRUCTURED, decl: 'string[] sig.tracks, sig.sounds;', comment: 'live published track / sound keys', tokens: ['tracks', 'sounds'] },
  { group: G_STRUCTURED, decl: 'number   sig.density;', comment: 'quality LOD multiplier (1 = full)', tokens: ['density'] },
]

/** #2516 — a three.js sketch gets the p5 signal surface (the same `sig`, built by
 *  `buildStaveUniforms`) and, of the `stave` context, the options, the size and
 *  (#2570) the scheduler:
 *  everything else it needs is plain three.js. */
const THREE_GLOBALS: readonly InjectedGlobal[] = [
  { group: G_CONTEXT, decl: 'object            stave.options;', comment: 'the .viz({ ... }) argument', tokens: ['options'] },
  { group: G_CONTEXT, decl: 'number            stave.width, stave.height;', comment: 'the viz size (also innerWidth / innerHeight)', tokens: ['width', 'height'] },
  { group: G_CONTEXT, decl: 'PatternScheduler  stave.scheduler;', comment: '.now(), .query(begin, end) — the notes around now (#2570)', tokens: ['scheduler'] },
  ...P5_GLOBALS.filter((g) => g.group !== G_CONTEXT),
]

const HYDRA_GLOBALS: readonly InjectedGlobal[] = [
  {
    group: G_SCALARS_THUNK,
    decl: '() => number      stave.sig.kick, stave.sig.snare, stave.sig.hat, stave.sig.openHat,\n                  stave.sig.clap, stave.sig.rim, stave.sig.tom, stave.sig.keyVelocity;',
    comment: 'per-drum envelope thunks → call them',
    tokens: ['kick', 'snare', 'hat', 'openHat', 'clap', 'rim', 'tom', 'keyVelocity'],
    live: {
      kick: ENV_LIVE('env:uKick'), snare: ENV_LIVE('env:uSnare'), hat: ENV_LIVE('env:uHat'),
      openHat: ENV_LIVE('env:uOpenHat'), clap: ENV_LIVE('env:uClap'), rim: ENV_LIVE('env:uRim'), tom: ENV_LIVE('env:uTom'),
      keyVelocity: { kind: 'scalar', read: 'keyVelocity' },
    },
  },
  {
    group: G_SCALARS_THUNK,
    decl: '() => number      stave.sig.rms, stave.sig.bass, stave.sig.mid, stave.sig.treble;',
    comment: 'master-mix DSP thunks',
    tokens: ['rms', 'bass', 'mid', 'treble'],
    live: { rms: { kind: 'scalar', read: 'rms' }, bass: { kind: 'scalar', read: 'bass' }, mid: { kind: 'scalar', read: 'mid' }, treble: { kind: 'scalar', read: 'treble' } },
  },
  { group: G_STRUCTURED, decl: "Thunks            stave.sig('bd'), stave.sig.track('$0');", comment: '.env() .rms() .fft[i] … per sound / track', tokens: ['sig', 'track'] },
  { group: G_STRUCTURED, decl: 'string[]          stave.sig.tracks, stave.sig.sounds;', comment: 'live published track / sound keys', tokens: ['tracks', 'sounds'] },
  { group: G_STRUCTURED, decl: "() => number      stave.H(trackId, field = 'gain');", comment: 'raw event field reader', tokens: ['H'] },
  { group: G_CONTEXT, decl: 'PatternScheduler  stave.scheduler;', comment: '.now(), .query(begin, end)', tokens: ['scheduler'] },
]

const CATALOGUE: Record<VizRendererKind, readonly InjectedGlobal[]> = {
  p5: P5_GLOBALS,
  three: THREE_GLOBALS,
  hydra: HYDRA_GLOBALS,
  glsl: GLSL_GLOBALS,
}

/** The catalogue of Stave-injected globals for a renderer kind (issue #309). */
export function injectedGlobals(kind: VizRendererKind): readonly InjectedGlobal[] {
  return CATALOGUE[kind]
}

/**
 * Render the read-only "Stave Inputs" reference block — a ShaderToy-style aligned
 * `decl // comment` list. Comments are padded to a common column so the block
 * reads like ShaderToy's "Shader Inputs". Multi-line decls (hydra) align each
 * continuation line's comment too.
 */
export function formatStaveInputs(kind: VizRendererKind): string {
  const rows = injectedGlobals(kind)
  // Longest single decl line (for comment alignment); multi-line decls only
  // attach the comment to their LAST physical line.
  const lastLineLen = (decl: string): number => {
    const lines = decl.split('\n')
    return lines[lines.length - 1].length
  }
  const width = Math.min(64, Math.max(...rows.map((r) => lastLineLen(r.decl)))) + 2
  const out: string[] = ['// Stave Inputs']
  let group: string | null = null
  for (const r of rows) {
    if (r.group !== group) {
      out.push('', `// — ${r.group} —`) // blank line + section header on change
      group = r.group
    }
    const declLines = r.decl.split('\n')
    const last = declLines[declLines.length - 1]
    const pad = ' '.repeat(Math.max(1, width - last.length))
    declLines[declLines.length - 1] = `${last}${pad}// ${r.comment}`
    out.push(declLines.join('\n'))
  }
  const rule = RULE[kind]
  if (rule) out.push('', `// ${rule}`)
  return out.join('\n')
}

/**
 * A row in the LIVE "Stave Inputs" drawer (#346). The drawer, when live values
 * are enabled, renders this flat list instead of the static {@link formatStaveInputs}
 * block:
 *   - `header` — a `// — group —` divider (group changed).
 *   - `live`   — one injected token that carries a {@link LiveSpec}; the panel
 *                paints its master value (bar+number / sparkline / iTime seconds)
 *                imperatively off the vizSignalProbe tick.
 *   - `static` — a reference entry with NO live token (`sig`, `sig.track`,
 *                `sig.tracks`, `sig.sounds`, `sig.density`, `stave.scheduler`…):
 *                shown as its `decl // comment` text, no live value.
 *
 * Pure + worker-safe (data only) so it is unit-testable without DOM/IDB/Yjs.
 */
export type VizInputRow =
  | { type: 'header'; group: string }
  | { type: 'static'; decl: string; comment: string }
  | { type: 'live'; label: string; comment: string | null; token: string; spec: LiveSpec }

/** The token as it reads in the kind's namespace, for the live row label. p5 and
 *  hydra live tokens hang off `sig`; hydra scalars are thunks (call them); glsl
 *  injects bare uniforms (`uKick`, `iTime`). */
function liveLabel(kind: VizRendererKind, token: string, spec: LiveSpec): string {
  if (kind === 'glsl') return token
  if (kind === 'hydra') return spec.kind === 'scalar' ? `sig.${token}()` : `sig.${token}`
  return `sig.${token}`
}

/**
 * Build the live-drawer row model for a renderer kind (#346). Mirrors the group
 * ordering of {@link formatStaveInputs}; every entry that has at least one `live`
 * token expands into one `live` row per token (comment attached to the first),
 * and every entry without a live token stays a `static` reference row.
 */
export function buildVizInputRows(kind: VizRendererKind): VizInputRow[] {
  const out: VizInputRow[] = []
  let group: string | null = null
  for (const entry of injectedGlobals(kind)) {
    if (entry.group !== group) {
      out.push({ type: 'header', group: entry.group })
      group = entry.group
    }
    const liveTokens = entry.tokens.filter((t) => entry.live?.[t])
    if (liveTokens.length === 0) {
      out.push({ type: 'static', decl: entry.decl, comment: entry.comment })
      continue
    }
    liveTokens.forEach((token, i) => {
      const spec = entry.live![token]!
      out.push({
        type: 'live',
        label: liveLabel(kind, token, spec),
        comment: i === 0 ? entry.comment : null,
        token,
        spec,
      })
    })
  }
  return out
}

/**
 * Look up the catalogue entry + the specific token a hovered WORD matches, for a
 * renderer kind. Returns `null` when the word is not a Stave-injected token.
 * (A bare word like `uKick` / `iTime` / `rms` is matched against every entry's
 * `tokens`; the first match wins — token sets are disjoint within a kind.)
 */
export function injectedGlobalByToken(
  kind: VizRendererKind,
  word: string,
): { entry: InjectedGlobal; token: string; live: LiveSpec | null } | null {
  for (const entry of injectedGlobals(kind)) {
    if (entry.tokens.includes(word)) {
      const live = entry.live?.[word] ?? null
      return { entry, token: word, live }
    }
  }
  return null
}
