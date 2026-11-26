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

export interface SoundfontProbe {
  /**
   * Register `sf2` (base64 of a `.sf2`) under `sf_<name>` and offline-render
   * `code` (default: a three-note arpeggio on that font). Returns the render's
   * hap accounting plus the WAV, or an error.
   */
  run(sf2Base64: string, name?: string, code?: string): Promise<SoundfontProbeResult>
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
  }

  window.__staveSoundfontProbe = probe
  return () => {
    if (window.__staveSoundfontProbe === probe) delete window.__staveSoundfontProbe
  }
}
