/**
 * registerUserSoundfont — turn a user-supplied `.sf2` (raw bytes) into a playable
 * `s("sf_<name>")` sound, registered through superdough's registry the same way
 * the built-in General MIDI set is (`@strudel/soundfonts`'s `registerSoundfonts`).
 *
 * SPIKE SCOPE (#2658). This file exists to answer one question by observation:
 * does a sfumato-parsed `.sf2` play, at the right pitch, through a `registerSound`
 * handler? It is deliberately minimal and carries two findings that #2659 (the
 * real registration module) must act on:
 *
 *   1. ROUTING. sfumato's `startPresetNote` builds its nodes and connects them to
 *      `ctx.destination` itself (`applyOptions`: `panner.connect(ctx.destination)`).
 *      So the audio reaches the output, but it BYPASSES superdough's per-orbit
 *      gain / FX (`.room`, `.delay`) / `.pan` chain and the engine's recording tap.
 *      There is no upstream `.sf2` path that routes through that chain — even
 *      Strudel's own `Pattern.prototype.soundfont` uses `startPresetNote`. The
 *      production handler (#2659) must instead build the buffer-source nodes from
 *      the font's zones and RETURN a `node` for superdough to route, mirroring the
 *      GM handler's `{ node, stop, nodes }` shape — not call `startPresetNote`.
 *      Until then we hand superdough a silent dummy `node` so its routing contract
 *      is satisfied while the real (destination-routed) audio still renders.
 *
 *   2. VERSION SKEW. `@strudel/soundfonts` pulls `soundfont2@^0.5`; `sfumato` uses
 *      `soundfont2@^0.4`. We never parse the bytes ourselves — we let sfumato's own
 *      `loadSoundfont` do it, so the two `soundfont2` copies never meet.
 *
 * `startPresetNote` also relies on superdough's `AudioParam.prototype.dahdsr`
 * extension, installed by the engine's `init()` — so this must run post-init.
 */

export interface RegisterUserSoundfontResult {
  /** The superdough sound key the font was registered under (`sf_<name>`). */
  key: string
  /** How many presets the parsed font exposes (preset 0 is what the spike plays). */
  presetCount: number
}

/**
 * Parse `bytes` as a `.sf2` via sfumato and register it under `sf_<name>`.
 * Must be called AFTER an engine `init()` (needs superdough + its param extensions).
 * Throws on a font that will not parse or has no presets.
 */
export async function registerUserSoundfontFromBytes(
  name: string,
  bytes: Uint8Array,
): Promise<RegisterUserSoundfontResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sf: any = await import('@strudel/soundfonts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wa: any = await import('@strudel/webaudio')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const core: any = await import('@strudel/core')
  const { loadSoundfont, startPresetNote } = sf
  const { registerSound, getAudioContext } = wa
  const noteToMidi: (n: unknown) => number = core.noteToMidi

  const key = `sf_${name}`

  // sfumato's loadSoundfont just `fetch`es the argument, so a `blob:` URL works
  // and keeps the bytes off the network. The font is parsed into memory before
  // the URL is revoked.
  // Copy into a fresh ArrayBuffer-backed view: `BlobPart` requires
  // `Uint8Array<ArrayBuffer>`, and the caller's bytes may be `ArrayBufferLike`.
  const blobUrl = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
  )
  let font: { presets?: unknown[] }
  try {
    font = await loadSoundfont(blobUrl)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
  const presets = font?.presets ?? []
  if (!presets.length) {
    throw new Error(`soundfont "${name}" parsed but exposes no presets`)
  }

  registerSound(
    key,
    // Handler shape mirrors the GM soundfont handler: (startTime, value, onended).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (time: number, value: any, onended: () => void) => {
      const ctx = getAudioContext()
      const raw = value?.note ?? value?.n ?? 'c4'
      const midi = typeof raw === 'number' ? raw : noteToMidi(raw)
      const preset = presets[0]
      // startPresetNote connects to ctx.destination itself and returns a stop(time).
      const stop = startPresetNote(ctx, preset, midi, time)
      const duration = typeof value?.duration === 'number' ? value.duration : 0.5
      const end = time + duration
      try {
        stop(end)
      } catch {
        /* a zone with no loop still rings for its sample length */
      }
      // Silent placeholder so superdough's `node.connect(...)` routing contract
      // holds without adding a second audible path (see finding #1 above).
      const placeholder = ctx.createGain()
      placeholder.gain.value = 0
      return {
        node: placeholder,
        stop: () => {
          try {
            stop(ctx.currentTime)
          } catch {
            /* already stopped */
          }
          onended()
        },
        nodes: {},
      }
    },
    { type: 'soundfont', prebake: false },
  )

  return { key, presetCount: presets.length }
}
