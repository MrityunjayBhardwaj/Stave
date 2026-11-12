/**
 * glslShaderSource — build the WebGL2 (GLSL ES 3.00) program sources for a viz
 * sketch. Supports BOTH conventions (#283), auto-detected from the source:
 *
 *   - SHADERTOY — the user writes only `void mainImage(out vec4 fragColor,
 *     in vec2 fragCoord)`. We add the `main()` entry that calls it + the output.
 *   - RAW GLSL  — the user writes their own `void main()` (and their own `out`).
 *     We only prepend the version, precision, and the Stave uniforms.
 *
 * Both get the SAME uniforms; both render through the same fullscreen-triangle
 * vertex shader (the user controls only the FRAGMENT shader). There is NO
 * transpile — string composition — so a `.glsl` sketch crosses to the worker as a
 * plain transferable string (the same property that lets p5/hydra source cross —
 * workerMessages.ts MountMessage.code).
 *
 * v1 uniform set (HARD scope — Vairagya, issue #281):
 *   - `iResolution` (vec3)  — viewport px in .xy, 1.0 in .z
 *   - `iTime`       (float) — seconds since mount
 *   - `iMouse`      (vec4)  — pointer; zero in the worker (no pointer events)
 *   - `iChannel0`   (sampler2D) — master analyser, 2-row texture (row 0 FFT,
 *                                 row 1 waveform — ShaderToy convention)
 *   (Per-event signal uniforms — uKick/uSnare/… — are appended by #284.)
 *
 * REF: glslCore.ts (consumes these), hostP5Worker.ts mountGLSL, GLSLVizRenderer,
 *      architecture/renderer-contract.mdx (the contract this renderer validates).
 */

/** Fullscreen-triangle vertex shader — covers the clip volume with 3 verts and
 *  NO attribute buffer (positions come from `gl_VertexID`), so the core needs no
 *  VBO/VAO setup. Draw with `gl.drawArrays(TRIANGLES, 0, 3)`. */
export const GLSL_FULLSCREEN_VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

const VERSION = '#version 300 es'
const PRECISION = 'precision highp float;\nprecision highp int;'

/** Max tracks a shader can address (#297) — the uniform-array bound shared by the
 *  preamble declarations below AND the cached uniform locations in glslCore
 *  (`uTrackA`/`uTrackB` are declared `[MAX_GLSL_TRACKS]`). `uTrackCount` is clamped
 *  to this; extra tracks are dropped (Vairagya — bounded; 16 is plenty for music).
 *  Lives here (not glslCore) so the string preamble can reference it WITHOUT a
 *  glslCore→glslShaderSource→glslCore import cycle. */
export const MAX_GLSL_TRACKS = 16

/** Width of the `uNotes` texture (#2571) — how many notes a shader can read.
 *  Re-exported by `glslNotes.ts` (the packer); lives here so the preamble's
 *  `#define STAVE_MAX_NOTES` can't drift from the texture the packer fills. */
export const STAVE_MAX_NOTES = 256

/** The v1 uniforms, declared for BOTH modes. A user shader must NOT redeclare
 *  these (same rule as ShaderToy, where the user never declares uniforms).
 *  The `u*` block (#284) carries PATTERN EVENTS — per-drum envelope levels +
 *  master DSP — from the named-signal bus, so a shader reacts to kicks/snares/
 *  velocity, not just the mixed FFT in iChannel0. All 0..1.
 *  The `uTrack*` block (#297) carries PER-TRACK signals: `uTrackCount` is how many
 *  tracks are live, and `staveTrack(i)` reads track `i`'s scalars (env/velocity/
 *  rms/bass/mid/treble) — the GLSL analog of p5/hydra's `u.track(id)`. Packed as
 *  two vec3 arrays (a = env/velocity/rms, b = bass/mid/treble) to halve uniform
 *  declarations; authors use `staveTrack(i)`, never the raw arrays. */
const UNIFORMS = `uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
uniform sampler2D iChannel0;
uniform float uKick, uSnare, uHat, uOpenHat, uClap, uRim, uTom, uVelocity;
uniform float uRms, uBass, uMid, uTreble;
uniform int uTrackCount;
uniform vec3 uTrackA[${MAX_GLSL_TRACKS}];
uniform vec3 uTrackB[${MAX_GLSL_TRACKS}];
uniform highp sampler2D uNotes;
uniform int uNoteCount;
uniform float uNow;
uniform float uCps;`

/** Per-track accessor (#297) injected for BOTH modes, after the uniforms. The
 *  struct + `staveTrack(i)` are the author-facing API (reserved names — a user
 *  shader must not redeclare them). Unused → GLSL strips them (zero cost). Field
 *  order MUST match `GLSL_TRACK_FIELDS` + the `a`/`b` packing in glslEvents. */
const STAVE_TRACK_API = `struct StaveTrack {
  float env;
  float velocity;
  float rms;
  float bass;
  float mid;
  float treble;
};
StaveTrack staveTrack(int i) {
  vec3 a = uTrackA[i];
  vec3 b = uTrackB[i];
  return StaveTrack(a.x, a.y, a.z, b.x, b.y, b.z);
}`

/** Upcoming-notes accessor (#2571) — the GLSL analog of `stave.scheduler.query()`.
 *  `uNotes` is an RGBA32F texture, STAVE_MAX_NOTES wide × 2 tall, packed by
 *  `glslNotes.ts`: row 0 = (begin, end, midi, gain), row 1 = (velocity, track).
 *  Field names match the JS haps. Read with `texelFetch` (no filtering). Notes
 *  `0 <= i < uNoteCount` are sorted by begin; times are absolute cycles (compare
 *  with `uNow`). Reserved names, like the rest of the preamble. */
const STAVE_NOTE_API = `#define STAVE_MAX_NOTES ${STAVE_MAX_NOTES}
struct StaveNote {
  float begin;
  float end;
  float midi;
  float gain;
  float velocity;
  int track;
};
StaveNote staveNote(int i) {
  vec4 a = texelFetch(uNotes, ivec2(i, 0), 0);
  vec4 b = texelFetch(uNotes, ivec2(i, 1), 0);
  return StaveNote(a.x, a.y, a.z, a.w, b.x, int(b.y));
}`

/** Everything Stave declares ahead of the user's source (both modes). */
const PREAMBLE = `${UNIFORMS}\n${STAVE_TRACK_API}\n${STAVE_NOTE_API}`

/** ShaderToy-mode output + entry: we own `main()`, it calls the user's mainImage. */
const SHADERTOY_OUT = 'out vec4 stave_FragColor;'
const SHADERTOY_ENTRY = `
void main() {
  vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(color, gl_FragCoord.xy);
  stave_FragColor = color;
}
`

/** Blank out comments so the entry-point detection can't be fooled by a
 *  `// uses mainImage` line or a `/* main() *​/` block. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

/** Remove a user-supplied `#version` directive — ours is canonical and must be
 *  the first line; two `#version`s is a compile error. */
function stripVersion(src: string): string {
  return src.replace(/^[ \t]*#version[^\n]*\r?\n?/m, '')
}

/**
 * Compose the full fragment shader source from a user sketch. Detects the
 * convention (ShaderToy `mainImage` vs raw `void main`) and wraps accordingly.
 * Throws a friendly error for the ambiguous (both) and empty (neither) cases —
 * NOT a cryptic GLSL duplicate-symbol / undefined-symbol error.
 */
export function buildGLSLFragmentSource(userSource: string): string {
  const probe = stripComments(userSource)
  const hasMainImage = /\bmainImage\s*\(/.test(probe)
  const hasMain = /\bvoid\s+main\s*\(/.test(probe)

  if (hasMainImage && hasMain) {
    throw new Error(
      'GLSL: found both mainImage() and main(). For a ShaderToy shader, remove your main() — Stave provides it. For a raw GLSL shader, remove mainImage().',
    )
  }
  if (hasMainImage) {
    // ShaderToy mode — Stave owns the entry point + the fragment output.
    return `${VERSION}\n${PRECISION}\n${PREAMBLE}\n${SHADERTOY_OUT}\n${userSource}\n${SHADERTOY_ENTRY}`
  }
  if (hasMain) {
    // Raw GLSL mode — the user owns `out` + `main()`; Stave provides only the
    // version, precision, and uniforms. Strip a user `#version` (ours is first).
    return `${VERSION}\n${PRECISION}\n${PREAMBLE}\n${stripVersion(userSource)}\n`
  }
  throw new Error(
    'GLSL: no entry point. Define `void mainImage(out vec4 fragColor, in vec2 fragCoord)` for a ShaderToy shader, or `void main()` for a raw GLSL shader.',
  )
}

/** How many preamble lines `buildGLSLFragmentSource` prepends BEFORE the user's
 *  source, for the mode auto-detected from `userSource`. A GLSL info-log line
 *  `0:N` counts from the top of the COMPOSED shader; the user's editor line is
 *  `N - glslPreambleLineCount(userSource)`. Built from the SAME prefix the
 *  composer uses (ShaderToy mode adds the `SHADERTOY_OUT` line raw mode doesn't),
 *  so the offset can't drift from the composition. (#331) */
export function glslPreambleLineCount(userSource: string): number {
  const probe = stripComments(userSource)
  const hasMainImage = /\bmainImage\s*\(/.test(probe)
  const prefix = hasMainImage
    ? `${VERSION}\n${PRECISION}\n${PREAMBLE}\n${SHADERTOY_OUT}\n`
    : `${VERSION}\n${PRECISION}\n${PREAMBLE}\n`
  return (prefix.match(/\n/g) ?? []).length
}

/** Map a GLSL FRAGMENT compile error message (from `glslCore`,
 *  `glsl fragment compile error:\n<infoLog>`) to the user's 1-based editor line,
 *  or `undefined` if it's not a fragment compile error or carries no `0:N` token.
 *  The info log counts from the composed shader's top → subtract the preamble.
 *  Vertex/link errors are Stave-owned (the fullscreen vert) — not the user's
 *  fragment — so they map to no editor line. (#331) */
export function glslFragmentErrorUserLine(message: string, userSource: string): number | undefined {
  if (!/fragment compile error/.test(message)) return undefined
  // ANGLE/driver format: `ERROR: 0:N: 'sym' : <reason>` — take the SECOND number.
  const m = /\b\d+:(\d+):/.exec(message)
  if (!m) return undefined
  return Math.max(1, Number(m[1]) - glslPreambleLineCount(userSource))
}
