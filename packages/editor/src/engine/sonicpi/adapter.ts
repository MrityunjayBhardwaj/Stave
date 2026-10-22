/**
 * SonicPiEngine adapter — wraps the standalone sonicPiWeb engine
 * to conform to Stave's LiveCodingEngine interface.
 *
 * Responsibilities of the ADAPTER (not the engine):
 *  - SuperSonic CDN loading (bundler-proof dynamic import)
 *  - SoundEvent → HapEvent bridging (sonicPiWeb events → Stave events)
 *  - loc computation (engine provides srcLine, adapter computes char offsets)
 *  - Viz request capture (viz() injected here, not in the engine)
 *  - inlineViz component assembly (afterLine computed from code)
 *
 * The engine (sonicPiWeb) knows about music: play, sleep, sample.
 * The adapter knows about the editor: viz, components, highlighting.
 */

// Sonic Pi's engine lives in the sibling `sonicPiWeb` repo, NOT vendored into
// this repo yet (#171). A static import broke the production build on a clean
// clone (the sibling isn't there). Until sonicPiWeb is published as a package,
// the engine is loaded via an OPAQUE dynamic import — esbuild can't resolve the
// path at build time, so the bundle builds anywhere — and the Sonic Pi
// templates are hidden (packages/app/src/templates.ts) so this path is never
// exercised in shipped builds. To restore Sonic Pi: vendor/package sonicPiWeb
// and swap loadRawSonicPiEngine() back to a static import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawSonicPiEngine = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SoundEvent = any

const SONICPI_ENGINE_MODULE = '../../../../../../sonicPiWeb/src/engine/SonicPiEngine'

/** Load the sibling Sonic Pi engine class via an opaque dynamic import so the
 *  bundler does not statically resolve the (unvendored) sibling path. Mirrors
 *  the `importFromCDN` bundler-proof pattern below. */
async function loadRawSonicPiEngine(): Promise<{ new (o: unknown): RawSonicPiEngine }> {
  const load = new Function('m', 'return import(m)') as (
    m: string,
  ) => Promise<{ SonicPiEngine: { new (o: unknown): RawSonicPiEngine } }>
  return (await load(SONICPI_ENGINE_MODULE)).SonicPiEngine
}

import type { LiveCodingEngine, EngineComponents } from '../LiveCodingEngine'
import { HapStream } from '../HapStream'
import type { HapEvent } from '../HapStream'

const SUPERSONIC_CDN = 'https://unpkg.com/supersonic-scsynth@latest'

/** Load an ES module from a URL without bundler interception. */
async function importFromCDN(url: string): Promise<Record<string, unknown>> {
  const load = new Function('url', 'return import(url)')
  return load(url)
}

/**
 * Parse code for viz requests. Supports two syntaxes:
 *  - Runtime: viz :scope (inside live_loop — Ruby) or viz("scope") (JS)
 *  - Comment: # @viz scope or // @viz scope (after a loop block)
 *
 * Returns Map<trackName, { vizId, afterLine }>
 */
function parseVizRequests(code: string): Map<string, { vizId: string; afterLine: number }> {
  const requests = new Map<string, { vizId: string; afterLine: number }>()
  const lines = code.split('\n')

  const loopPattern = /live_loop\s*(?:\(\s*["'](\w+)["']|:(\w+)\s)/
  const loopBlocks = new Map<string, { start: number; end: number }>()

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    // Skip commented-out lines
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue
    const loopMatch = trimmed.match(loopPattern)
    if (loopMatch) {
      const name = loopMatch[1] ?? loopMatch[2]
      const start = i
      let depth = 0
      let end = lines.length - 1
      for (let j = i; j < lines.length; j++) {
        if (/\bdo\b/.test(lines[j])) depth++
        if (/\bend\b/.test(lines[j])) depth--
        depth += (lines[j].match(/[{(]/g) ?? []).length
        depth -= (lines[j].match(/[})]/g) ?? []).length
        if (depth <= 0 && j > i) { end = j; break }
      }
      loopBlocks.set(name, { start, end })
    }
  }

  const vizCallPattern = /\bviz\s+:(\w+)|viz\s*\(\s*["':]+(\w+)["']?\s*\)/
  for (const [name, block] of loopBlocks) {
    for (let i = block.start; i <= block.end; i++) {
      const vizMatch = lines[i].match(vizCallPattern)
      if (vizMatch) {
        requests.set(name, {
          vizId: vizMatch[1] ?? vizMatch[2],
          afterLine: block.end + 1,
        })
        break
      }
    }
  }

  // Source 2: Comment-based @viz — only attach to an ACTIVE (uncommented) preceding loop
  const commentVizPattern = /(?:\/\/|#)\s*@viz\s+(\w+)/
  for (let i = 0; i < lines.length; i++) {
    const vizMatch = lines[i].match(commentVizPattern)
    if (vizMatch) {
      // Scan backwards for a preceding live_loop that is NOT commented out
      let trackName: string | null = null
      for (let j = i - 1; j >= 0; j--) {
        const trimmed = lines[j].trim()
        // Skip commented-out lines
        if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue
        const loopMatch = trimmed.match(loopPattern)
        if (loopMatch) {
          const name = loopMatch[1] ?? loopMatch[2]
          // Only attach if this loop is in our active loopBlocks
          if (loopBlocks.has(name)) {
            trackName = name
          }
          break
        }
      }
      if (trackName && !requests.has(trackName)) {
        requests.set(trackName, { vizId: vizMatch[1], afterLine: i + 1 })
      }
    }
  }

  return requests
}

/**
 * Strip viz() calls from code before passing to the engine.
 * The engine doesn't know about viz — it's an adapter concern.
 */
function stripVizCalls(code: string): string {
  // Use [ \t] instead of \s to avoid matching \n — preserves line count
  return code
    .replace(/^[ \t]*viz[ \t]+:\w+[ \t]*$/gm, '')
    .replace(/^[ \t]*viz[ \t]*\([ \t]*["']\w+["'][ \t]*\)[ \t]*$/gm, '')
    .replace(/^[ \t]*(?:\/\/|#)[ \t]*@viz[ \t]+\w+[ \t]*$/gm, '')
}

export class SonicPiEngine implements LiveCodingEngine {
  private raw: RawSonicPiEngine | null = null
  private hapStream = new HapStream()
  private runtimeErrorHandler: ((err: Error) => void) | null = null
  private options: { schedAheadTime?: number }
  private vizRequests = new Map<string, { vizId: string; afterLine: number }>()
  /** Original code lines + char offsets — for computing loc from srcLine */
  private originalLines: string[] = []
  private lineOffsets: number[] = []
  /** Per-track HapStreams for scoped inline viz (keyed by live_loop name) */
  private trackStreams = new Map<string, HapStream>()

  constructor(options?: { schedAheadTime?: number }) {
    this.options = options ?? {}
  }

  async init(): Promise<void> {
    if (this.raw) return

    let SuperSonicClass: unknown
    try {
      const mod = await importFromCDN(SUPERSONIC_CDN)
      SuperSonicClass = mod.SuperSonic ?? mod.default
    } catch {
      // Silent mode — engine works without audio
    }

    const RawEngineClass = await loadRawSonicPiEngine()
    this.raw = new RawEngineClass({
      ...this.options,
      bridge: SuperSonicClass ? { SuperSonicClass: SuperSonicClass as never } : {},
    })

    await this.raw.init()

    // Forward sonicPiWeb's SoundEvents into Stave's HapStream
    // Engine provides srcLine (raw integer), adapter computes loc (char offsets)
    // Events are routed to both the global stream AND per-track streams
    this.raw.components.streaming?.eventStream.on(
      (e: SoundEvent) => {
        // Compute loc from srcLine + original code
        let loc: Array<{ start: number; end: number }> | null = null
        if (e.srcLine && e.srcLine > 0 && e.srcLine <= this.originalLines.length) {
          const idx = e.srcLine - 1 // srcLine is 1-based
          const start = this.lineOffsets[idx]
          const end = start + this.originalLines[idx].length
          loc = [{ start, end }]
        }

        const event: HapEvent = {
          audioTime: e.audioTime,
          audioDuration: e.audioDuration,
          scheduledAheadMs: e.scheduledAheadMs,
          midiNote: e.midiNote,
          s: e.s,
          color: null,
          loc,
        }

        // Global stream (for highlighting and panel viz)
        this.hapStream.emitEvent(event)

        // Per-track stream (for scoped inline viz)
        if (e.trackId) {
          this.trackStreams.get(e.trackId)?.emitEvent(event)
        }
      },
    )

    if (this.runtimeErrorHandler) {
      this.raw.setRuntimeErrorHandler(this.runtimeErrorHandler)
    }
  }

  async evaluate(code: string): Promise<{ error?: Error }> {
    if (!this.raw) return { error: new Error('Call init() before evaluate()') }

    // Build line offset table from original code (for loc computation)
    this.originalLines = code.split('\n')
    this.lineOffsets = []
    let offset = 0
    for (const line of this.originalLines) {
      this.lineOffsets.push(offset)
      offset += line.length + 1
    }

    // Capture viz requests BEFORE stripping (adapter concern)
    this.vizRequests = parseVizRequests(code)

    // Pre-create per-track HapStreams for all tracks with viz requests.
    // Reuse existing streams (keeps subscriptions alive across re-evaluate),
    // create new ones for new tracks, dispose removed ones.
    const activeTrackIds = new Set(this.vizRequests.keys())
    for (const id of activeTrackIds) {
      if (!this.trackStreams.has(id)) {
        this.trackStreams.set(id, new HapStream())
      }
    }
    for (const [id, stream] of this.trackStreams) {
      if (!activeTrackIds.has(id)) {
        stream.dispose()
        this.trackStreams.delete(id)
      }
    }

    // Strip viz calls — engine doesn't know about visualization
    const cleanCode = stripVizCalls(code)

    // Mute audio during re-evaluate to silence stale loop iterations.
    // The old loop body may still be mid-sleep — when it resolves, it could
    // fire one more round of play/sample before the hot-swap takes effect.
    // Suspending the AudioContext silences that transitional burst.
    const audioCtx = this.raw.components.audio?.audioCtx
    const wasRunning = audioCtx?.state === 'running'
    if (wasRunning) {
      await audioCtx!.suspend()
    }

    const result = await this.raw.evaluate(cleanCode)

    // Resume immediately after evaluate completes — no magic delay.
    // The old loop iteration's stale events fired during suspend (inaudible).
    if (wasRunning && audioCtx) {
      audioCtx.resume()
    }

    return result
  }

  play(): void { this.raw?.play() }
  stop(): void { this.raw?.stop() }

  dispose(): void {
    this.hapStream.dispose()
    for (const stream of this.trackStreams.values()) stream.dispose()
    this.trackStreams.clear()
    this.raw?.dispose()
    this.raw = null
    this.vizRequests.clear()
    this.originalLines = []
    this.lineOffsets = []
  }

  setRuntimeErrorHandler(handler: (err: Error) => void): void {
    this.runtimeErrorHandler = handler
    this.raw?.setRuntimeErrorHandler(handler)
  }

  get components(): Partial<EngineComponents> {
    const bag: Partial<EngineComponents> = {
      streaming: { hapStream: this.hapStream },
    }
    if (!this.raw) return bag

    const rawComponents = this.raw.components

    if (rawComponents.audio) bag.audio = rawComponents.audio

    if (this.vizRequests.size > 0) {
      bag.inlineViz = {
        vizRequests: this.vizRequests,
        trackStreams: this.trackStreams.size > 0 ? this.trackStreams : undefined,
      }
    }

    return bag
  }
}
