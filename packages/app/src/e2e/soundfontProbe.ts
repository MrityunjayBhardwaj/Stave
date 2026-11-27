/**
 * soundfontProbe — E2E-only handle for the custom-soundfont spike (#2658).
 *
 * Same dead-code-eliminated gate as the other `__stave*` hooks: it attaches only
 * when `window.__STAVE_E2E__` is set, so it never exists in normal use. A spec
 * flips the flag with `page.addInitScript`, hands this probe the bytes of a real
 * `.sf2`, and reads back whether the font registered, played through the real
 * offline render graph, and produced audio it can then listen to.
 *
 * The probe runs its OWN engine (like the bounce probe) rather than the app's, so
 * it is decoupled from which file is open or whether the app is playing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SkippedSounds = any

export interface SoundfontProbeResult {
  ok: boolean
  error?: string
  /** The registered sound key, e.g. `sf_vintage`. */
  key?: string
  presetCount?: number
  /** Hap accounting from `renderOfflineReport`. */
  haps?: number
  played?: number
  skipped?: SkippedSounds[]
  /** The rendered bounce as a base64 WAV, so the spec can save + listen to it. */
  wav?: string
}

/** Stored-font metadata as the IndexedDB store reports it (bytes omitted). */
export interface SoundfontStoreMeta {
  name: string
  size: number
  storedAt: number
}

export interface SoundfontProbe {
  /**
   * Register `sf2` (base64 of a `.sf2`) under `sf_<name>` and offline-render
   * `code` (default: a three-note arpeggio on that font). Returns the render's
   * hap accounting plus the WAV, or an error.
   */
  run(sf2Base64: string, name?: string, code?: string): Promise<SoundfontProbeResult>

  // --- #2660: the IndexedDB blob store, for the reload-survival observation ---
  /** Wipe the soundfont database (by the store's own DB-name constant). */
  storeReset(): Promise<void>
  /** Store base64 `.sf2` bytes under `name`; returns the stored metadata. */
  storePut(sf2Base64: string, name: string): Promise<SoundfontStoreMeta>
  /** Read bytes back by name, base64-encoded. `null` when the store has none. */
  storeGet(name: string): Promise<string | null>
  /** Every stored font's metadata, bytes omitted. */
  storeList(): Promise<SoundfontStoreMeta[]>
  /** Drop a font from the store by name. */
  storeRemove(name: string): Promise<void>

  /**
   * #2661 — boot a FRESH engine and let its `init()` re-register fonts from the
   * store, WITHOUT this probe registering anything itself. Reports whether
   * `sf_<name>` ended up in the live registry (and the picker-visible global),
   * its type, and whether it plays — the whole boot-path claim in one call.
   */
  bootRegistersFromStore(name: string): Promise<{
    present: boolean
    type: string | null
    inGlobal: boolean
    played: number
    skipped: SkippedSounds[]
    error?: string
  }>
}

declare global {
  interface Window {
    __staveSoundfontProbe?: SoundfontProbe
    __STAVE_E2E__?: boolean
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/**
 * Installs `window.__staveSoundfontProbe`. Returns a teardown so the caller's
 * effect can remove it.
 */
export function installSoundfontProbe(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (process.env.NODE_ENV === 'production') return () => {}
  if (!window.__STAVE_E2E__) return () => {}

  const probe: SoundfontProbe = {
    async run(sf2Base64, name = 'vintage', code) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import('@stave/editor')
        const engine = new mod.StrudelEngine()
        await engine.init()

        const bytes = base64ToBytes(sf2Base64)
        const { key, presetCount } = await mod.registerUserSoundfontFromBytes(name, bytes)

        const song = code ?? `note("60 64 67").s("${key}")`
        const report = await engine.renderOfflineReport(song, 2)

        return {
          ok: true,
          key,
          presetCount,
          haps: report.haps,
          played: report.played,
          skipped: report.skipped,
          wav: await blobToBase64(report.blob),
        }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    },

    async storeReset() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('@stave/editor')
      // Wipe by the store's own constant, never a literal copy — a rename would
      // otherwise silently stop wiping and leak state into the next test.
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(mod.SOUNDFONT_DB_NAME)
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      })
    },

    async storePut(sf2Base64, name) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('@stave/editor')
      return mod.putSoundfont(name, base64ToBytes(sf2Base64))
    },

    async storeGet(name) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('@stave/editor')
      const bytes: Uint8Array | null = await mod.getSoundfont(name)
      return bytes ? bytesToBase64(bytes) : null
    },

    async storeList() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('@stave/editor')
      return mod.listSoundfonts()
    },

    async storeRemove(name) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('@stave/editor')
      await mod.deleteSoundfont(name)
    },

    async bootRegistersFromStore(name) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import('@stave/editor')
        const engine = new mod.StrudelEngine()
        // init() runs the engine's own registerUserSoundfonts() boot step, which
        // reads the store — the probe deliberately registers NOTHING itself here.
        await engine.init()

        // The engine publishes the LIVE superdough soundMap to globalThis during
        // init (it is the same ref the picker reads), so read it there rather than
        // importing `@strudel/webaudio`, which is not a resolvable bare specifier
        // in the app's browser bundle.
        const key = `sf_${name}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dict: Record<string, any> =
          (globalThis as unknown as { soundMap?: { get?: () => Record<string, unknown> } })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .soundMap?.get?.() as any ?? {}
        const entry = dict[key]
        const present = Boolean(entry)
        const inGlobal = present // globalThis.soundMap is exactly what the picker reads

        let played = 0
        let skipped: SkippedSounds[] = []
        if (present) {
          const report = await engine.renderOfflineReport(`note("69").s("${key}")`, 2)
          played = report.played
          skipped = report.skipped
        }
        return { present, type: entry?.data?.type ?? null, inGlobal, played, skipped }
      } catch (e) {
        return { present: false, type: null, inGlobal: false, played: 0, skipped: [], error: String(e) }
      }
    },
  }

  window.__staveSoundfontProbe = probe
  return () => {
    if (window.__staveSoundfontProbe === probe) delete window.__staveSoundfontProbe
  }
}
