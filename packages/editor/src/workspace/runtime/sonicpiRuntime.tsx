/**
 * SONICPI_RUNTIME — Phase 10.2 Task 05.
 *
 * The `LiveCodingRuntimeProvider` for `.sonicpi` files. Wraps `SonicPiEngine`
 * (the adapter at `engine/sonicpi/adapter.ts`, which itself wraps the
 * standalone `sonicPiWeb` engine via a CDN-loaded SuperSonic backend).
 *
 * @remarks
 * ## Pattern.prototype hands-off (PV1, PV2, P1, P2)
 *
 * Sonic Pi has its own viz capture path inside `engine/sonicpi/adapter.ts`
 * (`parseVizRequests` / `stripVizCalls`). Like the Strudel runtime, this
 * file does NOT touch any prototype, does NOT install viz interceptors,
 * does NOT mutate `file.content` before evaluation. The runtime is a
 * passthrough.
 *
 * ## BufferedScheduler elevation (S8)
 *
 * Sonic Pi's adapter exposes streaming + audio in `engine.components` but
 * does NOT populate `queryable`. The `LiveCodingRuntime.play()` lifecycle
 * detects this and lazily constructs a `BufferedScheduler` wrapping the
 * adapter's `HapStream` and the underlying `AudioContext`. Inline view
 * zones for `.sonicpi` files use that elevated scheduler. The wiring is
 * automatic — this runtime provider does not need to opt in.
 *
 * ## Chrome rendering
 *
 * Same `▶ ⏹ BPM error chromeExtras` shape as `STRUDEL_RUNTIME`. BPM
 * extraction is `LiveCodingRuntime`'s Strudel tempo reader (`codeView/tempo.ts`),
 * which reads JavaScript setter calls a Sonic Pi file does not contain — the
 * runtime returns `undefined` for `getBpm()` on Sonic Pi code, and the
 * chrome silently omits the BPM display. A future Sonic Pi BPM source
 * (e.g., `use_bpm 120` extraction) is a follow-up task; the chrome's
 * conditional rendering already handles `bpm === undefined` correctly.
 */

import React from 'react'
import { SonicPiEngine } from '../../engine/sonicpi'
import type {
  ChromeContext,
  LiveCodingRuntimeProvider,
} from '../types'
import { useTouchBar } from './touchBar'

/**
 * Transport chrome for `.sonicpi` files. Identical visual shape to the
 * Strudel chrome. Kept as a separate component (rather than parameterized)
 * because future per-language affordances (Sonic Pi sample browser, beat
 * indicator) will diverge — we want a clear seam to add them without
 * threading flags through a shared component.
 */
function SonicPiChrome(ctx: ChromeContext): React.ReactElement {
  const { isPlaying, isPlayPending = false, error, errorMessage, bpm, onPlay, onStop, chromeExtras } = ctx
  const bar = useTouchBar()
  // #2259 — as the Strudel chrome: while Play is still loading it says so, and a
  // second press cancels that Play
  const busy = isPlaying || isPlayPending
  return (
    <div
      data-sonicpi-runtime-chrome="root"
      {...bar.attrs}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: bar.height,
        padding: '0 12px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
      }}
    >
      <button
        data-testid="sonicpi-chrome-transport"
        data-play-pending={!isPlaying && isPlayPending ? 'true' : undefined}
        onClick={busy ? onStop : onPlay}
        title={
          isPlaying
            ? 'Stop (Ctrl+.)'
            : isPlayPending ? 'Loading… click to cancel (Ctrl+.)' : 'Play (Ctrl+Enter)'
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          borderRadius: 4,
          border: 'none',
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          background: busy ? 'rgba(139,92,246,0.15)' : 'var(--accent)',
          color: busy ? 'var(--accent)' : '#fff',
          outline: busy ? '1px solid var(--accent)' : 'none',
        }}
      >
        {isPlaying ? '\u25A0 Stop' : isPlayPending ? '\u25CC Loading' : '\u25B6 Play'}
      </button>

      {bpm != null && (
        <span
          data-testid="sonicpi-chrome-bpm"
          style={{ color: 'var(--foreground-muted)', fontSize: 11 }}
        >
          {bpm} BPM
        </span>
      )}

      <div style={{ flex: 1 }} />

      {error && (
        <span
          data-testid="sonicpi-chrome-error"
          title={errorMessage ?? error.message}
          style={{
            maxWidth: 240,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#f87171',
            fontSize: 11,
            padding: '2px 8px',
            background: 'rgba(248,113,113,0.1)',
            borderRadius: 4,
            border: '1px solid rgba(248,113,113,0.3)',
          }}
        >
          {errorMessage ?? error.message}
        </span>
      )}

      {chromeExtras && (
        <div
          data-testid="sonicpi-chrome-extras"
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {chromeExtras}
        </div>
      )}
    </div>
  )
}

export const SONICPI_RUNTIME: LiveCodingRuntimeProvider = {
  extensions: ['.sonicpi'],
  language: 'sonicpi',
  createEngine: () => new SonicPiEngine(),
  renderChrome: (ctx) => <SonicPiChrome {...ctx} />,
}
