/**
 * glslCore — the SHARED, host-agnostic WebGL2 renderer for a single-pass
 * ShaderToy sketch. ONE implementation drives BOTH viz hosts (PV56 spirit — one
 * concept, one implementation):
 *   - the worker (`hostP5Worker.ts` mountGLSL) — context from the transferred
 *     `OffscreenCanvas` (Tier-1: render DIRECT, no blit);
 *   - the main thread (`GLSLVizRenderer.ts`) — context from a `<canvas>` (the
 *     fallback + non-OffscreenCanvas path).
 * Only the canvas type and the audio source differ; the GL pipeline is identical,
 * so it lives here once.
 *
 * Pipeline (v1, issue #281): a fullscreen triangle (no VBO — `gl_VertexID`) runs
 * the wrapped fragment shader; the master analyser is uploaded each frame to a
 * 2-row `R8` texture bound as `iChannel0` (row 0 = FFT, row 1 = waveform — the
 * ShaderToy convention). Uniforms: `iResolution`, `iTime`, `iMouse`, `iChannel0`.
 *
 * Throw discipline: compile/link errors throw from `create` (mount-time) — the
 * worker host catches them and the FallbackVizRenderer degrades to main (#247).
 * `draw()` runs a GPU shader with NO per-frame user JS, so it does not throw —
 * the #257 draw-swallow seam is satisfied trivially (a notable contract finding).
 *
 * REF: glslShaderSource.ts (the wrapped sources), architecture/renderer-contract.mdx
 *      (the contract), rawShims.ts (the worker AudioByteSource), HydraVizRenderer
 *      (the main-thread analyser source — same getByte* surface).
 */

import { GLSL_FULLSCREEN_VERT, buildGLSLFragmentSource, MAX_GLSL_TRACKS, STAVE_MAX_NOTES } from './glslShaderSource'

export { MAX_GLSL_TRACKS }

/** The per-frame audio surface — the SAME shape exposed by the worker's
 *  `RawAnalyserShim` AND a Web Audio `AnalyserNode`, so the core feeds from
 *  either host with no branch (the audio-feed seam the contract is tested on). */
export interface AudioByteSource {
  frequencyBinCount: number
  getByteFrequencyData(arr: Uint8Array): void
  getByteTimeDomainData(arr: Uint8Array): void
}

/** A WebGL2 context from either a `<canvas>` (main) or an `OffscreenCanvas`
 *  (worker) — structurally identical for our use. */
export type GL2 = WebGL2RenderingContext

export interface GLSLDrawState {
  /** Backing-store width in device px. */
  width: number
  /** Backing-store height in device px. */
  height: number
  /** Milliseconds since mount → `iTime = ms / 1000`. */
  timeMs: number
  /** `iMouse` (x, y, clickX, clickY); zeros in the worker (no pointer events). */
  mouse?: readonly [number, number, number, number]
}

/** The PATTERN-EVENT uniform names (#284) — per-drum envelope levels + master DSP,
 *  all `float` 0..1, fed from the named-signal bus. The single source of truth for
 *  BOTH the cached uniform locations here AND the shader preamble declarations
 *  (glslShaderSource.ts) AND the bus reader (glslEvents.ts). */
export const GLSL_EVENT_NAMES = [
  'uKick', 'uSnare', 'uHat', 'uOpenHat', 'uClap', 'uRim', 'uTom', 'uVelocity',
  'uRms', 'uBass', 'uMid', 'uTreble',
] as const

/** Per-frame event uniform values — one number per GLSL_EVENT_NAMES entry. */
export type GLSLEvents = Record<(typeof GLSL_EVENT_NAMES)[number], number>

/** All-zero events (no bus / silence) — the default when `draw` gets no events. */
export const ZERO_GLSL_EVENTS: GLSLEvents = Object.fromEntries(
  GLSL_EVENT_NAMES.map((n) => [n, 0]),
) as GLSLEvents

/** The per-track signal fields exposed to GLSL, in `StaveTrack` struct order
 *  (#297). Packed two-vec3-per-track: `uTrackA = (env, velocity, rms)`,
 *  `uTrackB = (bass, mid, treble)` — the scalar half of a bus `SignalReading`. */
export const GLSL_TRACK_FIELDS = ['env', 'velocity', 'rms', 'bass', 'mid', 'treble'] as const

/** Per-frame per-track signal block (#297). `a`/`b` are flat `vec3` uniform
 *  payloads of length `MAX_GLSL_TRACKS * 3` (track i at `[i*3 .. i*3+3)`): `a` =
 *  (env, velocity, rms), `b` = (bass, mid, treble). `count` is the number of real
 *  tracks (≤ MAX_GLSL_TRACKS); slots past `count` stay zero. */
export interface GLSLTracks {
  count: number
  a: Float32Array
  b: Float32Array
}

/** No tracks (no bus / demo) — the default when `draw` gets no track block. */
export const ZERO_GLSL_TRACKS: GLSLTracks = {
  count: 0,
  a: new Float32Array(MAX_GLSL_TRACKS * 3),
  b: new Float32Array(MAX_GLSL_TRACKS * 3),
}

/** The upcoming-notes block (#2571) — `GLSLNoteFeed` (glslNotes.ts) is one.
 *  `data` is the RGBA32F texels (STAVE_MAX_NOTES × 2); `version` moves only when
 *  they changed, so the texture is re-uploaded only then. */
export interface GLSLNotes {
  readonly data: Float32Array
  readonly count: number
  readonly version: number
  /** Scheduler now, in cycles (`uNow`). */
  readonly now: number
  /** Cycles per second (`uCps`). */
  readonly cps: number
}

/** Texture unit for `uNotes` (unit 0 is `iChannel0`). */
const NOTES_UNIT = 1

/** Width (texels) of each row of the `iChannel0` audio texture. */
const AUDIO_TEX_W = 512
const AUDIO_TEX_H = 2

function compileShader(gl: GL2, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error(`glsl: could not create ${label} shader`)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? ''
    gl.deleteShader(sh)
    // Strip the injected preamble's line offset from messages where we can — the
    // user body starts after the preamble, but raw GLSL line numbers are still
    // the most useful signal; surface the log verbatim.
    throw new Error(`glsl ${label} compile error:\n${log.trim()}`)
  }
  return sh
}

/** Resample `src[0..srcLen)` byte data into `dst[0..dstLen)` by box-averaging —
 *  maps an analyser buffer (1024 bins / 2048 samples) onto the texture row. */
function resampleByteRow(src: Uint8Array, srcLen: number, dst: Uint8Array, dstLen: number): void {
  if (srcLen <= 0) {
    dst.fill(0, 0, dstLen)
    return
  }
  const bucket = srcLen / dstLen
  for (let i = 0; i < dstLen; i++) {
    const start = Math.floor(i * bucket)
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket))
    let sum = 0
    let n = 0
    for (let j = start; j < end && j < srcLen; j++) {
      sum += src[j]
      n++
    }
    dst[i] = n > 0 ? Math.round(sum / n) : 0
  }
}

/**
 * A compiled, drawable single-pass GLSL program bound to one WebGL2 context.
 * Construct with `createGLSLProgram(gl, userSource)` (throws on compile/link
 * error); drive with `draw(audio, state)`; release with `dispose()`.
 */
export class GLSLProgram {
  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly audioTex: WebGLTexture
  private readonly uResolution: WebGLUniformLocation | null
  private readonly uTime: WebGLUniformLocation | null
  private readonly uMouse: WebGLUniformLocation | null
  private readonly uChannel0: WebGLUniformLocation | null
  /** Cached locations for the pattern-event uniforms (#284), by name. */
  private readonly uEvents: Array<readonly [keyof GLSLEvents, WebGLUniformLocation | null]>
  /** Cached locations for the per-track signal uniforms (#297) — null when the
   *  shader references none (GLSL strips them), making the set a cheap no-op. */
  private readonly uTrackCount: WebGLUniformLocation | null
  private readonly uTrackA: WebGLUniformLocation | null
  private readonly uTrackB: WebGLUniformLocation | null
  /** Upcoming-notes uniforms (#2571) — null when the shader reads no notes. */
  private readonly uNotes: WebGLUniformLocation | null
  private readonly uNoteCount: WebGLUniformLocation | null
  private readonly uNow: WebGLUniformLocation | null
  private readonly uCps: WebGLUniformLocation | null
  /** The RGBA32F notes texture; created only when the shader samples `uNotes`. */
  private notesTex: WebGLTexture | null = null
  /** `GLSLNotes.version` last uploaded (−1 = never). */
  private notesUploaded = -1
  /** Scratch buffers, allocated once (no per-frame alloc). */
  private readonly freqScratch = new Uint8Array(AUDIO_TEX_W * 4)
  private readonly waveScratch = new Uint8Array(AUDIO_TEX_W * 4)
  /** The 2-row texel buffer uploaded each frame (row 0 FFT, row 1 wave). */
  private readonly texRows = new Uint8Array(AUDIO_TEX_W * AUDIO_TEX_H)
  private disposed = false

  constructor(
    private readonly gl: GL2,
    userSource: string,
  ) {
    const vert = compileShader(gl, gl.VERTEX_SHADER, GLSL_FULLSCREEN_VERT, 'vertex')
    const frag = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      buildGLSLFragmentSource(userSource),
      'fragment',
    )
    const program = gl.createProgram()
    if (!program) throw new Error('glsl: could not create program')
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    // Shaders can be flagged for deletion once linked.
    gl.deleteShader(vert)
    gl.deleteShader(frag)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? ''
      gl.deleteProgram(program)
      throw new Error(`glsl link error:\n${log.trim()}`)
    }
    this.program = program
    this.uResolution = gl.getUniformLocation(program, 'iResolution')
    this.uTime = gl.getUniformLocation(program, 'iTime')
    this.uMouse = gl.getUniformLocation(program, 'iMouse')
    this.uChannel0 = gl.getUniformLocation(program, 'iChannel0')
    // Event uniforms (#284) — null when the shader doesn't reference one (GLSL
    // strips unused uniforms), in which case the set is a cheap no-op.
    this.uEvents = GLSL_EVENT_NAMES.map(
      (n) => [n, gl.getUniformLocation(program, n)] as const,
    )
    // Per-track signal uniforms (#297) — null when the shader uses none (stripped).
    this.uTrackCount = gl.getUniformLocation(program, 'uTrackCount')
    this.uTrackA = gl.getUniformLocation(program, 'uTrackA')
    this.uTrackB = gl.getUniformLocation(program, 'uTrackB')
    // Upcoming notes (#2571) — null when unused (GLSL strips them).
    this.uNotes = gl.getUniformLocation(program, 'uNotes')
    this.uNoteCount = gl.getUniformLocation(program, 'uNoteCount')
    this.uNow = gl.getUniformLocation(program, 'uNow')
    this.uCps = gl.getUniformLocation(program, 'uCps')

    // WebGL2 core requires a bound VAO for drawArrays, even with no attributes.
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('glsl: could not create VAO')
    this.vao = vao

    // The audio texture — single-channel R8, 512×2, linear-filtered, clamped.
    const tex = gl.createTexture()
    if (!tex) throw new Error('glsl: could not create audio texture')
    this.audioTex = tex
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1) // R8 rows aren't 4-byte aligned
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, AUDIO_TEX_W, AUDIO_TEX_H, 0, gl.RED, gl.UNSIGNED_BYTE, null,
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)

    // The notes texture (#2571) — RGBA32F, STAVE_MAX_NOTES×2, NEAREST (read with
    // texelFetch; float textures need no extension for that in WebGL2).
    if (this.uNotes) {
      const nt = gl.createTexture()
      if (!nt) throw new Error('glsl: could not create notes texture')
      this.notesTex = nt
      gl.bindTexture(gl.TEXTURE_2D, nt)
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F, STAVE_MAX_NOTES, 2, 0, gl.RGBA, gl.FLOAT, null,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
  }

  /** Whether the shader reads any upcoming-notes uniform (#2571) — a host can
   *  skip gathering notes for one that doesn't. */
  get readsNotes(): boolean {
    return !!(this.uNotes || this.uNoteCount || this.uNow || this.uCps)
  }

  /** How many times the notes texture has been uploaded (for tests/diagnostics). */
  notesUploads = 0

  /** Render one frame. `audio` may be null (no analyser yet) → the texture stays
   *  at its current contents (or zero) and the shader still animates off iTime.
   *  `events` carries the per-frame pattern-event uniforms (#284); omit → all 0.
   *  `tracks` carries the per-track signal uniforms (#297); omit → no tracks.
   *  `notes` carries the upcoming notes (#2571); omit → no notes. */
  draw(
    audio: AudioByteSource | null,
    state: GLSLDrawState,
    events?: GLSLEvents,
    tracks?: GLSLTracks,
    notes?: GLSLNotes,
  ): void {
    if (this.disposed) return
    const gl = this.gl
    const w = Math.max(1, Math.round(state.width))
    const h = Math.max(1, Math.round(state.height))

    // Upload the audio texture (row 0 = FFT, row 1 = waveform).
    if (audio) {
      const bins = Math.min(audio.frequencyBinCount, this.freqScratch.length)
      const freq = this.freqScratch.subarray(0, bins)
      const wave = this.waveScratch.subarray(0, bins)
      audio.getByteFrequencyData(freq)
      audio.getByteTimeDomainData(wave)
      resampleByteRow(freq, bins, this.texRows.subarray(0, AUDIO_TEX_W), AUDIO_TEX_W)
      resampleByteRow(wave, bins, this.texRows.subarray(AUDIO_TEX_W), AUDIO_TEX_W)
      gl.bindTexture(gl.TEXTURE_2D, this.audioTex)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, 0, AUDIO_TEX_W, AUDIO_TEX_H, gl.RED, gl.UNSIGNED_BYTE, this.texRows,
      )
    }

    gl.viewport(0, 0, w, h)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)

    if (this.uResolution) gl.uniform3f(this.uResolution, w, h, 1)
    if (this.uTime) gl.uniform1f(this.uTime, state.timeMs / 1000)
    if (this.uMouse) {
      const m = state.mouse ?? [0, 0, 0, 0]
      gl.uniform4f(this.uMouse, m[0], m[1], m[2], m[3])
    }
    if (this.uChannel0) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.audioTex)
      gl.uniform1i(this.uChannel0, 0)
    }
    // Pattern-event uniforms (#284) — set only the ones the shader actually uses
    // (others have a null location, GLSL stripped them). Default 0 in silence.
    const ev = events ?? ZERO_GLSL_EVENTS
    for (const [name, loc] of this.uEvents) {
      if (loc) gl.uniform1f(loc, ev[name])
    }
    // Per-track signal uniforms (#297) — set only when the shader references them
    // (locations null otherwise). `a`/`b` are full MAX_GLSL_TRACKS*3 vec3 payloads
    // (zero past `count`), so the array uniform is always fully written.
    const tr = tracks ?? ZERO_GLSL_TRACKS
    if (this.uTrackCount) gl.uniform1i(this.uTrackCount, tr.count)
    if (this.uTrackA) gl.uniform3fv(this.uTrackA, tr.a)
    if (this.uTrackB) gl.uniform3fv(this.uTrackB, tr.b)
    // Upcoming notes (#2571). The texture is re-uploaded only when the notes
    // changed (`version` moved), not every frame; now/cps are per-frame uniforms.
    if (this.uNotes && this.notesTex) {
      gl.activeTexture(gl.TEXTURE0 + NOTES_UNIT)
      gl.bindTexture(gl.TEXTURE_2D, this.notesTex)
      if (notes && notes.version !== this.notesUploaded) {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STAVE_MAX_NOTES, 2, gl.RGBA, gl.FLOAT, notes.data)
        this.notesUploaded = notes.version
        this.notesUploads++
      }
      gl.uniform1i(this.uNotes, NOTES_UNIT)
      gl.activeTexture(gl.TEXTURE0)
    }
    if (this.uNoteCount) gl.uniform1i(this.uNoteCount, notes?.count ?? 0)
    if (this.uNow) gl.uniform1f(this.uNow, notes?.now ?? 0)
    if (this.uCps) gl.uniform1f(this.uCps, notes?.cps ?? 0)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    try {
      gl.deleteProgram(this.program)
      gl.deleteVertexArray(this.vao)
      gl.deleteTexture(this.audioTex)
      if (this.notesTex) gl.deleteTexture(this.notesTex)
    } catch {
      /* context may already be lost — ignore */
    }
  }
}

/** Compile + link a ShaderToy `mainImage` body against `gl`. Throws on a compile
 *  or link error (the message carries the GLSL info log). */
export function createGLSLProgram(gl: GL2, userSource: string): GLSLProgram {
  return new GLSLProgram(gl, userSource)
}
