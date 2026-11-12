/**
 * vizInputsHover — Monaco hover provider for the Stave-injected globals (#309).
 *
 * Hovering an injected token (`uKick`, `uRms`, `iChannel0`, `staveTrack`, …) in a
 * viz file shows its doc (from {@link injectedGlobalByToken}) plus, when a pattern
 * is playing, the token's LIVE value read from the GLOBAL MASTER bus
 * ({@link vizSignalProbe}). Master-only by design — no per-instance focus (#309).
 *
 * Complements the existing signal-bus dot-completion provider (which handles
 * `u('bd').` field suggestions); this one is word-hover for the bare tokens.
 */

import type * as Monaco from 'monaco-editor'
import { injectedGlobalByToken } from '../visualizers/injectedGlobals'
import type { VizRendererKind } from './vizLanguages'
import { vizSignalProbe } from './vizSignalProbe'

/** Monaco language id → fenced-code language for the hover signature block. */
const FENCE_LANG: Record<VizRendererKind, string> = {
  p5: 'javascript',
  hydra: 'javascript',
  glsl: 'glsl',
  three: 'javascript',
}

/** A 0..1 scalar as an 8-cell block bar. */
function bar(v: number): string {
  const cells = 8
  const lit = Math.max(0, Math.min(cells, Math.round(v * cells)))
  return '`▕' + '█'.repeat(lit) + '░'.repeat(cells - lit) + '▏`'
}

const SPARK = '▁▂▃▄▅▆▇█'
/** An array as a compact sparkline over the first `n` samples (auto-scaled). */
function spark(arr: number[], n = 28): string {
  if (arr.length === 0) return '`(empty)`'
  const step = Math.max(1, Math.floor(arr.length / n))
  let max = 1e-6
  const samples: number[] = []
  for (let i = 0; i < arr.length && samples.length < n; i += step) {
    const v = Math.abs(arr[i])
    samples.push(v)
    if (v > max) max = v
  }
  return '`' + samples.map((v) => SPARK[Math.min(7, Math.floor((v / max) * 7.999))]).join('') + '`'
}

/**
 * Register the injected-globals hover provider for one viz language. Returns the
 * Monaco disposable. Idempotency is handled by the caller's `ensureProviders`.
 */
export function registerVizInputsHover(
  monaco: typeof Monaco,
  language: string,
  kind: VizRendererKind,
): Monaco.IDisposable {
  return monaco.languages.registerHoverProvider(language, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position)
      if (!word) return null
      const hit = injectedGlobalByToken(kind, word.word)
      if (!hit) return null

      const md: Monaco.IMarkdownString[] = [
        { value: '```' + FENCE_LANG[kind] + '\n' + hit.entry.decl + '\n```' },
        { value: hit.entry.comment },
      ]

      if (hit.live) {
        const v = vizSignalProbe.read(hit.live)
        if (typeof v === 'number') {
          md.push({ value: `**live · master:** \`${v.toFixed(3)}\`  ${bar(v)}` })
        } else if (Array.isArray(v)) {
          md.push({ value: `**live · master:** ${spark(v)}` })
        } else if (!vizSignalProbe.playing) {
          md.push({ value: '_play a pattern to see the live master value_' })
        }
        // playing but unsupported live spec (iTime / keyVelocity) → doc only
      }

      return {
        range: new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        ),
        contents: md,
      }
    },
  })
}
