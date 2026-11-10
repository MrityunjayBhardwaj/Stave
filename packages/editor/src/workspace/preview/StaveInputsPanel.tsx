/**
 * StaveInputsPanel — a ShaderToy-style reference of the Stave-injected globals
 * available in a viz sketch (#309), with optional LIVE master values (#346).
 *
 * Two modes, gated by the "Live values in viz inputs" setting (default ON):
 *   - LIVE (open + playing): each injected signal that carries a `live` spec
 *     paints its current MASTER value — scalars as a bar + number, fft/wave as a
 *     sparkline, glsl iTime as seconds. Painted IMPERATIVELY (ref.style.width /
 *     textContent) off the already-running {@link vizSignalProbe} tick, throttled
 *     ~12fps — NO React setState per frame, NO new data loop (the probe is a sunk
 *     cost, acquired for the hover provider). Idle / collapsed / off-tab = zero
 *     work. Main-thread DOM only — orthogonal to the #299/#122 GPU jank.
 *   - STATIC (setting OFF): the original copyable `formatStaveInputs(kind)` block.
 *
 * Row content (live + static) comes from the single {@link injectedGlobals}
 * catalogue, so neither view can drift from what the compilers inject. Per #309
 * the probe is MASTER-only: per-sound `sig('bd')` / `sig.track` rows stay static.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { buildVizInputRows, formatStaveInputs } from '../../visualizers/injectedGlobals'
import type { VizInputRow } from '../../visualizers/injectedGlobals'
import type { VizRendererKind } from '../vizLanguages'
import { vizSignalProbe } from '../vizSignalProbe'
import {
  getVizInputsLiveValuesEnabled,
  onVizInputsLiveValuesChange,
} from '../editorRegistry'

const KIND_LABEL: Record<VizRendererKind, string> = {
  p5: 'p5',
  hydra: 'hydra',
  glsl: 'glsl',
  three: 'three.js',
}

/** Paint throttle — ~12fps is plenty for reading a value, and keeps the
 *  main-thread DOM cost negligible next to the 60fps viz GPU work. */
const PAINT_INTERVAL_MS = 1000 / 12

const SPARK = '▁▂▃▄▅▆▇█'
/** An array as a fixed-width sparkline over `n` auto-scaled samples (so the row
 *  doesn't reflow frame-to-frame). */
function sparkString(arr: number[], n = 32): string {
  if (arr.length === 0) return '·'.repeat(n)
  const step = Math.max(1, Math.floor(arr.length / n))
  const samples: number[] = []
  let max = 1e-6
  for (let i = 0; i < arr.length && samples.length < n; i += step) {
    const v = Math.abs(arr[i])
    samples.push(v)
    if (v > max) max = v
  }
  let out = ''
  for (const v of samples) out += SPARK[Math.min(7, Math.floor((v / max) * 7.999))]
  return out
}

// Eighth-block fractions for a fine-grained unicode bar (1/8…7/8 of a cell).
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
/** A 0..1 scalar as a monospace unicode bar (no DOM box) — full `█` cells plus a
 *  fractional eighth-block, so the bar resolves finer than one character. */
function barString(v: number, cells = 8): string {
  const total = Math.round(Math.max(0, Math.min(1, v)) * cells * 8)
  return '█'.repeat(Math.floor(total / 8)) + EIGHTHS[total % 8]
}

/** Imperative value node for one live row — every kind (scalar bar / array
 *  sparkline / time seconds) writes its text into a single span. */
interface ValueRefs {
  text?: HTMLSpanElement | null
}

export function StaveInputsPanel({ kind }: { kind: VizRendererKind }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [liveEnabled, setLiveEnabled] = useState(true)

  // Keep the global master signal probe alive while any viz editor is mounted,
  // so the hover provider AND this panel have live master values to read (#309).
  // Ref-counted — the rAF/subscription stops when the last viz tab closes. This
  // is the ONLY data loop; the live readout below merely samples it (#346).
  useEffect(() => vizSignalProbe.acquire(), [])

  // The live-values setting (default ON). Read on mount + react to toggles so the
  // panel switches modes without a reload.
  useEffect(() => {
    setLiveEnabled(getVizInputsLiveValuesEnabled())
    return onVizInputsLiveValuesChange(setLiveEnabled)
  }, [])

  const rows = useMemo(() => buildVizInputRows(kind), [kind])
  const liveRows = useMemo(() => rows.filter((r): r is Extract<VizInputRow, { type: 'live' }> => r.type === 'live'), [rows])
  const valueRefs = useRef<ValueRefs[]>([])

  // Imperative paint loop — runs ONLY while the drawer is open + live mode is on.
  // rAF self-throttles in a background tab (≈0Hz), and we additionally cap to
  // ~12fps and skip all work while no pattern is playing, so idle cost is ~zero.
  useEffect(() => {
    if (!open || !liveEnabled) return
    if (typeof requestAnimationFrame !== 'function') return
    let raf = 0
    let last = 0
    let prevPlaying = false
    let playStartT = 0
    let idlePainted = false

    const paintIdle = (): void => {
      for (const refs of valueRefs.current) {
        if (refs?.text) refs.text.textContent = '—'
      }
    }

    const loop = (t: number): void => {
      raf = requestAnimationFrame(loop)
      if (t - last < PAINT_INTERVAL_MS) return
      last = t
      const playing = vizSignalProbe.playing
      if (playing && !prevPlaying) playStartT = t
      prevPlaying = playing
      if (!playing) {
        if (!idlePainted) {
          paintIdle()
          idlePainted = true
        }
        return
      }
      idlePainted = false
      liveRows.forEach((row, i) => {
        const node = valueRefs.current[i]?.text
        if (!node) return
        if (row.spec.kind === 'time') {
          // The master probe has no per-shader clock; approximate glsl iTime with
          // wall-clock seconds since playback was observed (an authoring hint).
          node.textContent = `${((t - playStartT) / 1000).toFixed(1)}s`
          return
        }
        const v = vizSignalProbe.read(row.spec)
        if (row.spec.kind === 'array') {
          node.textContent = Array.isArray(v) ? sparkString(v) : '—'
          return
        }
        // scalar — a unicode bar; `null` while playing = unsupported spec (keyVelocity).
        node.textContent = typeof v === 'number' ? barString(v) : '—'
      })
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [open, liveEnabled, liveRows])

  return (
    <div
      data-workspace-chrome="viz-inputs"
      style={{
        flexShrink: 0,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        fontSize: 11,
      }}
    >
      <button
        data-testid="viz-inputs-toggle"
        data-open={open ? 'on' : 'off'}
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Hide injected globals' : 'Show the Stave globals injected into this viz'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          height: 26,
          padding: '0 12px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--foreground-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          textAlign: 'left',
        }}
      >
        <span style={{ width: 9, display: 'inline-block' }}>{open ? '▾' : '▸'}</span>
        <span style={{ color: 'var(--accent-strong, var(--accent))' }}>{'⚡'}</span>
        <span>Stave Inputs</span>
        <span style={{ opacity: 0.6 }}>· {KIND_LABEL[kind]} injected globals</span>
        {!open && (
          <span style={{ marginLeft: 'auto', opacity: 0.5 }}>
            {liveEnabled ? 'open for live master values' : 'hover a token in your code for live values'}
          </span>
        )}
      </button>

      {open &&
        (liveEnabled ? (
          <div
            data-testid="viz-inputs-live"
            style={{
              padding: '4px 14px 10px 30px',
              maxHeight: 320,
              overflow: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            {(() => {
              let li = -1
              return rows.map((row, idx) => {
                if (row.type === 'header') {
                  return (
                    <div
                      key={idx}
                      style={{ color: 'var(--foreground-subtle, var(--foreground-muted))', opacity: 0.7, marginTop: idx === 0 ? 0 : 6 }}
                    >
                      {`// — ${row.group} —`}
                    </div>
                  )
                }
                if (row.type === 'static') {
                  return (
                    <div key={idx} style={{ color: 'var(--foreground-muted)', whiteSpace: 'pre', opacity: 0.85 }}>
                      <span>{row.decl}</span>
                      <span style={{ opacity: 0.6 }}>{`  // ${row.comment}`}</span>
                    </div>
                  )
                }
                // live row
                const myIndex = (li += 1)
                const isScalar = row.spec.kind === 'scalar'
                return (
                  <div
                    key={idx}
                    data-token={row.token}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--foreground)' }}
                  >
                    <span style={{ minWidth: 132, color: 'var(--accent-strong, var(--accent))' }}>{row.label}</span>
                    <span
                      data-live-bar={isScalar ? row.token : undefined}
                      data-live-text={isScalar ? undefined : row.token}
                      ref={(el) => {
                        ;(valueRefs.current[myIndex] ??= {}).text = el
                      }}
                      style={{
                        whiteSpace: 'pre',
                        color: isScalar
                          ? 'var(--accent-strong, var(--accent))'
                          : 'var(--foreground-muted)',
                      }}
                    >
                      —
                    </span>
                    {row.comment && (
                      <span style={{ marginLeft: 'auto', opacity: 0.5, color: 'var(--foreground-muted)' }}>{`// ${row.comment}`}</span>
                    )}
                  </div>
                )
              })
            })()}
          </div>
        ) : (
          <pre
            data-testid="viz-inputs-block"
            style={{
              margin: 0,
              padding: '4px 14px 10px 30px',
              maxHeight: 320,
              overflow: 'auto',
              color: 'var(--foreground-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre',
              userSelect: 'text',
            }}
          >
            {formatStaveInputs(kind)}
          </pre>
        ))}
    </div>
  )
}
