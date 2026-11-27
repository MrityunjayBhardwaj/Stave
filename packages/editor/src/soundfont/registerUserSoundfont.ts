/**
 * registerUserSoundfont — turn a user-supplied `.sf2` (raw bytes) into a playable
 * `s("sf_<name>")` sound, registered through superdough's registry the same way
 * the built-in General MIDI set is (`@strudel/soundfonts`'s `registerSoundfonts`).
 *
 * This is the production registration module (#2659). It supersedes the spike
 * (#2658), which proved feasibility but routed audio straight to `ctx.destination`
 * and so bypassed the per-orbit gain / FX / pan chain AND the recording tap.
 *
 * HOW IT ROUTES CORRECTLY (the spike's finding #1, resolved)
 * ----------------------------------------------------------
 * sfumato's `startPresetNote` builds, per active zone, the graph
 *
 *     bufferSource → envGain(dahdsr) → stereoPanner → ctx.destination
 *
 * (see sfumato `applyOptions`). Every part of that is correct and worth keeping —
 * the Int16→Float32 decode, the playback-rate tuning from the zone's
 * originalPitch / coarseTune / fineTune, the loop points, the volume envelope,
 * the font's intrinsic pan — EXCEPT the final `R.connect(ctx.destination)`, which
 * is the bypass. Rather than re-implement that fragile SF2 math (and risk tuning
 * or envelope bugs), we hand `startPresetNote` a `Proxy` of the AudioContext whose
 * `.destination` is a capture `GainNode` we own. All active zones then sum into
 * that node, and we return it as superdough's `{ node }`. superdough connects it
 * as the chain source (`chain.connect(sourceNode)`), so the font now flows through
 * orbit gain → `.room()` / `.delay()` → `.pan()` → the recording tap → output,
 * exactly like the GM soundfonts and every other registered sound.
 *
 * The capture node is a `GainNode` on purpose: superdough's polyphony stealer ramps
 * `soundHandle.node.gain` to 0 and then calls `soundHandle.stop(time)`. A gain node
 * satisfies the first; sfumato's returned `stop(time)` satisfies the second.
 *
 * VERSION SKEW (finding #2, still relevant)
 * -----------------------------------------
 * `@strudel/soundfonts` pulls `soundfont2@^0.5`; `sfumato` uses `soundfont2@^0.4`.
 * `startPresetNote` expects a font parsed by sfumato's own `soundfont2`, so we never
 * parse the bytes ourselves — we let sfumato's `loadSoundfont` do it (it `fetch`es a
 * `blob:` URL we build from the bytes). The two `soundfont2` copies never meet.
 *
 * LIFECYCLE
 * ---------
 * `startPresetNote` relies on superdough's `AudioParam.prototype.dahdsr` extension,
 * which the engine installs during `init()`. So this must be called AFTER an engine
 * `init()`. (#2661 will re-register persisted fonts at boot, right after init.)
 */

export interface RegisterUserSoundfontResult {
  /** The superdough sound key the font was registered under (`sf_<name>`). */
  key: string
  /** How many presets the parsed font exposes (selectable with `.n(i)`). */
  presetCount: number
  /** The sanitized name used to build the key (`sf_<name>`). */
  name: string
}

export interface RegisterUserSoundfontOptions {
  /**
   * Reject fonts larger than this many bytes before parsing. Guards against a
   * huge upload exhausting memory. Default 64 MiB.
   */
  maxBytes?: number
}

/** Default size cap: 64 MiB. Real orchestral `.sf2`s can exceed this; the MVP caps. */
export const DEFAULT_MAX_SF2_BYTES = 64 * 1024 * 1024

/**
 * Turn a free-form soundfont name into the slug used in its key.
 * Lowercased (superdough lowercases keys on lookup anyway), restricted to
 * `[a-z0-9_-]`, with runs of other characters collapsed to a single `_`.
 */
export function sanitizeSoundfontName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Parse `bytes` as a `.sf2` via sfumato and register it under `sf_<name>` as a
 * first-class, routable, recordable sound.
 *
 * Must be called AFTER an engine `init()` (needs superdough + its `dahdsr` param
 * extension). Throws a clear error on an empty/invalid name, an oversized file, or
 * a file that will not parse / exposes no presets.
 */
export async function registerUserSoundfont(
  name: string,
  bytes: Uint8Array,
  options: RegisterUserSoundfontOptions = {},
): Promise<RegisterUserSoundfontResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SF2_BYTES

  const clean = sanitizeSoundfontName(name)
  if (!clean) {
    throw new Error(
      `soundfont name "${name}" has no usable characters (need a-z, 0-9, _ or -)`,
    )
  }
  if (!bytes || bytes.length === 0) {
    throw new Error(`soundfont "${clean}" is empty`)
  }
  if (bytes.length > maxBytes) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1)
    throw new Error(
      `soundfont "${clean}" is ${mb(bytes.length)} MiB, over the ${mb(maxBytes)} MiB limit`,
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sf: any = await import('@strudel/soundfonts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wa: any = await import('@strudel/webaudio')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const core: any = await import('@strudel/core')
  const { loadSoundfont, startPresetNote } = sf
  const { registerSound, getAudioContext, onceEnded, releaseAudioNode } = wa
  const noteToMidi: (n: unknown, def?: number) => number = core.noteToMidi
  const freqToMidi: (f: number) => number = core.freqToMidi
  const getSoundIndex: (n: unknown, total: number) => number = core.getSoundIndex

  const key = `sf_${clean}`
  // The `sf_` prefix structurally keeps user fonts out of the `gm_*` / synth / drum
  // namespaces, so a user font can never shadow a built-in. (A re-upload of the same
  // name simply overwrites its own key, which is what #2661's boot re-register wants.)

  // sfumato's loadSoundfont `fetch`es its argument, so a `blob:` URL keeps the bytes
  // off the network and lets sfumato's own `soundfont2` parse them (see VERSION SKEW).
  // Copy into a fresh ArrayBuffer-backed view: `BlobPart` requires `Uint8Array<ArrayBuffer>`.
  const blobUrl = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
  )
  let font: { presets?: unknown[] }
  try {
    font = await loadSoundfont(blobUrl)
  } catch (e) {
    throw new Error(`soundfont "${clean}" could not be parsed as a .sf2: ${String(e)}`)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
  const presets = font?.presets ?? []
  if (!presets.length) {
    throw new Error(`soundfont "${clean}" parsed but exposes no presets`)
  }

  registerSound(
    key,
    // Handler shape mirrors the GM soundfont handler: (startTime, value, onended, cps).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (time: number, value: any, onended: () => void) => {
      const ctx = getAudioContext()

      // Resolve the target pitch the way the GM handler does: freq wins, then a
      // numeric note is already MIDI, else parse the note name. (`n` is the preset
      // index, NOT a note — the spike conflated them; it does not fall back to a note.)
      const rawNote = value?.note ?? 'c3'
      let midi: number
      if (value?.freq != null) midi = freqToMidi(value.freq)
      else if (typeof rawNote === 'number') midi = rawNote
      else midi = noteToMidi(rawNote)

      const preset = presets[getSoundIndex(value?.n, presets.length)]

      // Capture node: the single sink all active zones route into, and the node we
      // hand superdough to route onward. A GainNode so the polyphony stealer can ramp
      // its gain. Default gain is 1 (passthrough).
      const captureNode = ctx.createGain()

      // Proxy the context so sfumato's `applyOptions` connects its per-zone panners to
      // `captureNode` instead of `ctx.destination` — the one line that was the bypass.
      // Also intercept `createBufferSource` to collect the sources for end-of-note
      // cleanup. Every other member is the real context's, bound to it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sources: any[] = []
      const proxyCtx = new Proxy(ctx, {
        get(target, prop, receiver) {
          if (prop === 'destination') return captureNode
          if (prop === 'createBufferSource') {
            return (...args: unknown[]) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const src = (target as any).createBufferSource(...args)
              sources.push(src)
              return src
            }
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const v = (target as any)[prop]
          return typeof v === 'function' ? v.bind(target) : v
        },
      })

      // Builds + starts every active zone's graph into captureNode; returns stop(time).
      const stopPreset: (releaseTime?: number) => void = startPresetNote(
        proxyCtx,
        preset,
        midi,
        time,
      )

      // Give the note its duration: schedule the natural release (per-zone volume
      // envelope) at time + duration.
      const duration = typeof value?.duration === 'number' ? value.duration : 0.5
      try {
        stopPreset(time + duration)
      } catch {
        /* a zone with no loop simply rings for its sample length */
      }

      // Fire superdough's onended once, when the last source actually finishes, so it
      // can release the chain. Release our own (off-chain) sources then too.
      let ended = false
      const finish = () => {
        if (ended) return
        ended = true
        for (const s of sources) {
          try {
            releaseAudioNode(s)
          } catch {
            /* already released */
          }
        }
        onended()
      }
      if (sources.length) onceEnded(sources[sources.length - 1], finish)
      else finish() // no active zone for this pitch — nothing sounds; release at once

      return {
        node: captureNode,
        // superdough calls this to force-stop early (polyphony stealing).
        stop: (releaseTime?: number) => {
          try {
            stopPreset(releaseTime ?? ctx.currentTime)
          } catch {
            /* already stopped */
          }
        },
        nodes: { source: sources },
      }
    },
    { type: 'soundfont', prebake: false },
  )

  return { key, presetCount: presets.length, name: clean }
}

/**
 * @deprecated Use {@link registerUserSoundfont}. Kept so the #2658 spike probe/spec
 * (which call `registerUserSoundfontFromBytes`) keep working unchanged.
 */
export const registerUserSoundfontFromBytes = registerUserSoundfont
