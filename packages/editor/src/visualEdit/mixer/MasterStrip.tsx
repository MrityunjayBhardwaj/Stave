/**
 * MasterStrip — the master channel (S5, design §6.8; code counterpart #792).
 *
 * The master is Strudel's master bus: `all(x => …)`, stacking every track. Like a
 * channel strip it shows a mute button, a fader, and a live meter:
 *  - a live METER off the engine's post-mix `AnalyserNode` (read-only side-tap),
 *  - a FADER that round-trips to code: it PROJECTS the document's
 *    `all(x => x.mul(postgain()))` factor (unity when the line is absent; a
 *    legacy `all(x => x.gain())` / `.postgain()` line is still read) and, on
 *    drag, WRITES that line through the Mixer's `Writeback`, as a channel fader
 *    writes `.gain()` on its `$:` line (#792). It MULTIPLIES each track's
 *    postgain rather than setting a control, so it scales the mix instead of
 *    overwriting every track's own value (#1711). No synthetic per-file output
 *    gain: the master trim lives in the document.
 *  - a MUTE button that adds/removes an `all(x => silence)` line — the master
 *    analog of a channel's `_`-prefix, ORTHOGONAL to the fader so the gain
 *    survives a mute/unmute. A signal/pattern gain disables the fader.
 *
 * There is NO master pan (#1719): `all(x => x.pan(v))` SETS pan on every hap, so
 * the control threw away each track's own, and no document-level control reaches
 * the finished mix (superdough pans per voice). A channel strip still pans; a
 * document's own master pan line still plays.
 *
 * A pure projection — `gain`/`onGainChange` are supplied by `MixerStrips` from
 * `useMixerModel` (which reads/writes the doc), so this component never touches
 * the store or the engine. The meter reads the post-mix analyser, which already
 * reflects the code gain (each hap is scaled in eval), so it stays post-fader.
 * `foreign` (a signal/patterned master gain the fader can't rewrite) disables the
 * drag. Meter and fader share the channel dB taper (`faderTaper`), one scale.
 */
import * as React from 'react'

import { useMasterMeter } from './useMasterMeter'
import { gainToFaderPos, faderPosToGain, formatDb } from './faderTaper'

const FADER_HEIGHT = 80
/** pixels of drag for the fader's full 0..1 travel (matches the channel fader). */
const DRAG_SPAN_PX = 160

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)


export function MasterStrip({
  zoom = 1,
  gain,
  foreign = false,
  muted = false,
  expanded = false,
  onToggleExpand,
  onGainChange,
  onMuteToggle,
  onGestureStart,
  onGestureEnd,
}: {
  zoom?: number
  /** the master gain the fader shows — the doc's `all()` gain, or unity (#792). */
  gain: number
  /** true when the master gain is a signal/pattern the fader can't rewrite → disabled. */
  foreign?: boolean
  /** whether the master is muted (an `all(x => silence)` line is present). */
  muted?: boolean
  /** whether the master's expand drawer (its effects chain) is open. */
  expanded?: boolean
  /** toggle the master expand drawer — a ▸/◂ disclosure in the header. */
  onToggleExpand?: () => void
  /** drag/reset writes the new master gain to code (via `MixerStrips`→Writeback). */
  onGainChange: (value: number) => void
  /** toggle the master mute — add/remove the `all(x => silence)` line. */
  onMuteToggle?: () => void
  /** open/close the one-undo-step gesture around a continuous drag (as ChannelStrip). */
  onGestureStart?: () => void
  onGestureEnd?: () => void
}): React.ReactElement {
  const meter = useMasterMeter()
  const fillRef = React.useRef<HTMLDivElement>(null)
  const peakRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const fill = fillRef.current
    const peak = peakRef.current
    if (!fill || !peak) return
    meter.register({ fill, peak })
    return () => meter.register(null)
  }, [meter])

  const pos = gainToFaderPos(gain)
  // Pointer-capture drag with a start anchor, so a re-render mid-drag (the gain
  // projection updates as you drag) can't drop the gesture — the Knob/ChannelStrip
  // pattern. The drag is wrapped in a Writeback gesture (begin on down, end on up)
  // so a continuous move is ONE undo step + ONE re-eval on release (#792), exactly
  // like a channel fader. A `foreign` (signal) master gain disables the drag.
  const drag = React.useRef<{ startY: number; startPos: number } | null>(null)
  const onDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (foreign) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    onGestureStart?.()
    drag.current = { startY: e.clientY, startPos: pos }
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const next = faderPosToGain(clamp01(d.startPos + (d.startY - e.clientY) / DRAG_SPAN_PX))
    onGainChange(Math.round(next * 1000) / 1000)
  }
  const onUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    drag.current = null
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    onGestureEnd?.()
  }
  const reset = (): void => {
    if (foreign) return
    onGainChange(1) // double-click → unity
  }


  const muteEnabled = onMuteToggle !== undefined

  return (
    <div
      data-mixer-master-strip
      data-mixer-master-muted={muted ? '' : undefined}
      style={{
        // A plain, non-stretching card (`alignSelf: flex-start` keeps its natural
        // zoomed height while its right-side expand drawer stretches to match —
        // V-mixer-10), exactly like a channel face. Match the console channel
        // groups' scale (set by MixerStrips); `zoom` (not transform) keeps it
        // aspect-exact.
        zoom,
        width: 84,
        flexShrink: 0,
        alignSelf: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        // When expanded, the drawer abuts the RIGHT edge (the master opens
        // rightward like a channel), so flatten the right corners and drop the
        // right border — the drawer's left border is the single seam — so face +
        // drawer read as one unit.
        borderRadius: expanded ? '6px 0 0 6px' : 6,
        border: '1px solid var(--border, #3a3a42)',
        borderRight: expanded ? 'none' : undefined,
        // A slightly stronger surface than the channel strips so it reads as the
        // master bus.
        background: 'var(--background-elevated, #2c2c34)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        color: 'var(--foreground, #e6e6ea)',
      }}
    >
      {/* header: name row over a mute-button row — structurally mirrors the
          channel header (name row + button row), so the master meter/fader align
          with the channel meters/faders below it without a hand-tuned spacer. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span
            data-mixer-master-name
            style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: 0.3, opacity: muted ? 0.45 : 1 }}
          >
            Master
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            data-mixer-master-mute
            aria-label={muted ? 'Unmute master' : 'Mute master'}
            aria-pressed={muted}
            disabled={!muteEnabled}
            onClick={() => onMuteToggle?.()}
            title={muted ? 'Unmute master' : 'Mute master (silence the whole mix)'}
            style={{
              flexShrink: 0,
              width: 16,
              height: 16,
              padding: 0,
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 700,
              lineHeight: '14px',
              cursor: muteEnabled ? 'pointer' : 'default',
              border: '1px solid var(--border, #3a3a42)',
              background: muted ? 'var(--meter-red, #e0564a)' : 'var(--background, #1c1c20)',
              color: muted ? '#fff' : 'var(--foreground-muted, #a0a0aa)',
              opacity: muteEnabled ? 1 : 0.3,
            }}
          >
            M
          </button>
          {onToggleExpand && (
            <button
              type="button"
              data-mixer-master-expand
              aria-label={expanded ? 'Collapse master' : 'Expand master'}
              aria-expanded={expanded}
              onClick={() => onToggleExpand()}
              title={expanded ? 'Collapse master effects' : 'Expand master effects'}
              style={{
                flexShrink: 0,
                width: 16,
                height: 16,
                padding: 0,
                borderRadius: 3,
                fontSize: 10,
                fontWeight: 700,
                lineHeight: '14px',
                cursor: 'pointer',
                border: '1px solid var(--border, #3a3a42)',
                background: expanded ? 'var(--background-elevated, #26262c)' : 'var(--background, #1c1c20)',
                color: 'var(--foreground-muted, #a0a0aa)',
              }}
            >
              {/* the master opens rightward like a channel: ▸ = will-open, ◂ = collapse */}
              {expanded ? '◂' : '▸'}
            </button>
          )}
        </div>
      </div>

      {/* the pan row's place. The master has no pan (#1719), but a channel card
          has the row, so without it this card is one row shorter and its meter
          sits that much higher than the channels' (#2027). The row is laid out
          like the channel's and holds nothing to read or press. */}
      <div
        data-mixer-master-pan-place
        aria-hidden
        style={{ display: 'flex', fontSize: 10, visibility: 'hidden', userSelect: 'none' }}
      >
        <span>pan</span>
      </div>

      {/* fused meter + fader — Logic-style, sharing one dB scale (faderTaper) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'stretch',
          gap: 5,
          height: FADER_HEIGHT,
        }}
      >
        <div
          data-mixer-master-meter
          style={{
            position: 'relative',
            width: 10,
            height: '100%',
            borderRadius: 2,
            background: 'var(--background, #1c1c20)',
            border: '1px solid var(--border, #3a3a42)',
            overflow: 'hidden',
          }}
        >
          <div
            ref={fillRef}
            data-mixer-master-meter-fill
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '0%',
              background: 'var(--meter-green, #44d07b)',
            }}
          />
          <div
            ref={peakRef}
            data-mixer-master-meter-peak
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: '0%',
              height: 2,
              background: 'var(--foreground, #e6e6ea)',
              opacity: 0,
            }}
          />
        </div>

        {/* fader — vertical drag sets the per-file master output gain */}
        <div
          data-mixer-master-fader
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={reset}
          title={foreign ? 'master gain is a signal — edit it in code' : undefined}
          style={{
            position: 'relative',
            height: '100%',
            width: 26,
            display: 'flex',
            justifyContent: 'center',
            cursor: foreign ? 'default' : 'ns-resize',
            opacity: foreign ? 0.5 : 1,
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 4,
              borderRadius: 2,
              background: 'var(--background, #1c1c20)',
              border: '1px solid var(--border, #3a3a42)',
              pointerEvents: 'none',
            }}
          />
          <div
            data-mixer-master-thumb
            style={{
              position: 'absolute',
              top: (1 - pos) * (FADER_HEIGHT - 6),
              width: 22,
              height: 6,
              borderRadius: 2,
              background: 'var(--foreground, #e6e6ea)',
              boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      {/* master gain readout: linear + dB (or "sig" for a foreign gain — mirrors ChannelStrip) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
        {foreign ? (
          <span data-mixer-master-gain title="master gain is a signal — edit it in code">sig</span>
        ) : (
          <>
            <span data-mixer-master-gain>{Math.round(gain * 100) / 100}</span>
            <span data-mixer-master-db style={{ color: 'var(--foreground-muted, #a0a0aa)' }}>
              {formatDb(gain)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
