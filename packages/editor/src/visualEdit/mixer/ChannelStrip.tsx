/**
 * ChannelStrip — one vertical strip.
 *
 * A projection of a `StripModel`: colour dot + name (the source line is gone —
 * a mix console names channels, it doesn't echo their code), a pan readout, and
 * a fader (thumb at the gain's taper position with a dB readout). `showHeader`
 * off drops the dot/name/mute row entirely — the Pattern tab's *local* mixer is
 * a single headerless strip for the cursor's track (you already know which one
 * it is), where only pan/fader/meter/gain matter.
 *
 * S1 makes the fader and pan WRITE: a vertical drag on the fader sets `.gain`
 * (the taper maps screen travel → linear gain), a horizontal drag on the pan row
 * sets `.pan` (0..1, grounded GR2). Both use pointer capture + a start anchor so
 * a parent re-render mid-drag can't drop the gesture (the Knob pattern), and
 * both wrap the drag in one undo via onGesture{Start,End}. A foreign `.gain`
 * (a signal) and a patterned `.pan` disable their control rather than guess
 * (conservatism, P194).
 */
import * as React from 'react'

import type { StripModel } from '../../codeView'
import { gainToFaderPos, faderPosToGain, formatDb } from './faderTaper'
import type { MeterController } from './useTrackMeters'
import { StripColorPopover } from './StripColorPopover'

/** pixels of drag for the fader's full 0..1 travel (matches the Knob). */
const DRAG_SPAN_PX = 160
const FADER_HEIGHT = 80

interface ChannelStripProps {
  strip: StripModel
  /** set this strip's gain (linear) — absent in a read-only context */
  onGainChange?: (value: number) => void
  /** set this strip's pan (0..1) */
  onPanChange?: (value: number) => void
  /** toggle this strip's mute (flip the `_`-prefix marker) — absent = read-only */
  onMuteToggle?: () => void
  /** rename this track — write a `name:` label into the code (#580, Phase C).
   *  Double-clicking the strip name opens an inline editor; absent = read-only. */
  onRename?: (newLabel: string) => void
  /** whether this strip is soloed (console variant) */
  soloed?: boolean
  /** toggle this strip's solo — provided only by the Mixer console */
  onSoloToggle?: () => void
  /** dim this strip: a solo is active elsewhere and this strip isn't soloed */
  dimmed?: boolean
  /** this strip is the currently-selected one — draw a thin accent border (#639). */
  selected?: boolean
  /** select this strip (a press anywhere on its face) — provided by the console. */
  onSelect?: () => void
  /** wrap a drag as one undo step */
  onGestureStart?: () => void
  onGestureEnd?: () => void
  /** live-meter controller — absent in a read-only/test context (no meter then) */
  meters?: MeterController
  /** show the dot/name/mute header row. Off = the headerless local strip. */
  showHeader?: boolean
  /** strip orientation. `'vertical'` (default) = the console strip: a tall
   *  fader, meter beside it, controls stacked. `'horizontal'` = the Pattern-tab
   *  inspector strip: a wide fader, meter under it, pan/vol on short rows, so it
   *  sits as a compact bar atop the inspector and frees the grid's width (#600).
   *  Horizontal is always headerless (identity lives in the Pattern top bar). */
  orientation?: 'vertical' | 'horizontal'
  /** the resolved dot colour `customColor ?? strip.color` (Phase D, #581). When
   *  absent, the dot uses `strip.color` (the deterministic palette). */
  dotColor?: string
  /** set this strip's custom colour (console only) — makes the dot a swatch
   *  trigger that opens a colour popover. Absent = the dot is a plain indicator. */
  onPickColor?: (color: string) => void
  /** clear this strip's custom colour → fall back to the deterministic palette. */
  onResetColor?: () => void
  /** whether this strip's expand drawer is open (console variant). When
   *  `onToggleExpand` is set, the header shows a ▸/◂ disclosure toggle. */
  expanded?: boolean
  /** toggle this strip's expand drawer — provided only by the Mixer console */
  onToggleExpand?: () => void
  /** CSS `zoom` for the strip FACE only (console renders at 1.5×). Aspect-exact
   *  and leaves the delta-based fader/pan drags untouched (they read pointer
   *  deltas, not bounding boxes). The expand drawer is a non-zoomed sibling that
   *  stretches to this scaled face height — so the drawer is taller (its knob
   *  chain stops scrolling) while its content stays 1×. */
  zoom?: number
}

/**
 * StripMeter — the live level bar fused beside the fader (design §6.2). It owns
 * no animation: it registers its fill + peak elements with the shared
 * `useTrackMeters` RAF loop (via `controller`), which paints them imperatively
 * each frame. Keyed by `captureId`; a captureId with no analyser stays dark.
 */
function StripMeter({
  captureId,
  controller,
  horizontal = false,
}: {
  captureId: string
  controller: MeterController
  /** lay the bar out horizontally (fill grows left→right) — Pattern-tab strip. */
  horizontal?: boolean
}): React.ReactElement {
  const fillRef = React.useRef<HTMLDivElement>(null)
  const peakRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const fill = fillRef.current
    const peak = peakRef.current
    if (!fill || !peak) return
    controller.register(captureId, { fill, peak, horizontal })
    return () => controller.register(captureId, null)
  }, [captureId, controller, horizontal])
  return (
    <div
      data-mixer-strip-meter
      data-mixer-meter-capture={captureId}
      style={{
        position: 'relative',
        width: horizontal ? '100%' : 6,
        height: horizontal ? 6 : '100%',
        borderRadius: 2,
        background: 'var(--background, #1c1c20)',
        border: '1px solid var(--border, #3a3a42)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        ref={fillRef}
        data-mixer-meter-fill
        style={
          horizontal
            ? { position: 'absolute', top: 0, bottom: 0, left: 0, width: '0%', background: 'var(--meter-green, #44d07b)' }
            : { position: 'absolute', left: 0, right: 0, bottom: 0, height: '0%', background: 'var(--meter-green, #44d07b)' }
        }
      />
      <div
        ref={peakRef}
        data-mixer-meter-peak
        style={
          horizontal
            ? { position: 'absolute', top: 0, bottom: 0, left: '0%', width: 2, background: 'var(--foreground, #e6e6ea)', opacity: 0 }
            : { position: 'absolute', left: 0, right: 0, bottom: '0%', height: 2, background: 'var(--foreground, #e6e6ea)', opacity: 0 }
        }
      />
    </div>
  )
}

/** the linear gain the fader sits at, or null when the gain is foreign. */
function faderGain(strip: StripModel): number | null {
  switch (strip.gain.kind) {
    case 'scalar':
      return strip.gain.value
    case 'managed':
      return strip.gain.ceiling
    case 'absent':
      return 1
    case 'foreign':
      return null
  }
}

/** pan readout: `C`, `L<n>`, or `R<n>` (0=hard L, 0.5=C, 1=hard R). */
function panLabel(pan: number | null): string {
  if (pan === null || pan === 0.5) return 'C'
  if (pan < 0.5) return `L${Math.round((0.5 - pan) * 200)}`
  return `R${Math.round((pan - 0.5) * 200)}`
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** the 16×16 mute/solo button style for the horizontal strip (#600). `bg`/`color`
 *  default to the neutral idle look; pass the active colour when pressed. */
function compactBtn(bg: string | undefined, color: string | undefined, enabled: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    width: 16,
    height: 16,
    padding: 0,
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 700,
    lineHeight: '14px',
    cursor: enabled ? 'pointer' : 'default',
    border: '1px solid var(--border, #3a3a42)',
    background: bg ?? 'var(--background, #1c1c20)',
    color: color ?? 'var(--foreground-muted, #a0a0aa)',
    opacity: enabled ? 1 : 0.3,
  }
}

export function ChannelStrip({
  strip,
  onGainChange,
  onPanChange,
  onMuteToggle,
  onRename,
  soloed = false,
  onSoloToggle,
  dimmed = false,
  selected = false,
  onSelect,
  onGestureStart,
  onGestureEnd,
  meters,
  showHeader = true,
  dotColor,
  onPickColor,
  onResetColor,
  expanded = false,
  onToggleExpand,
  zoom = 1,
  orientation = 'vertical',
}: ChannelStripProps): React.ReactElement {
  const horizontal = orientation === 'horizontal'
  // Colour swatch popover (Phase D, #581) — console only (when onPickColor is set).
  const [colorAnchor, setColorAnchor] = React.useState<DOMRect | null>(null)
  const colorPickEnabled = onPickColor !== undefined
  const muteEnabled = strip.muteable && onMuteToggle !== undefined
  // Inline rename (#580, Phase C). The seed is the track's BARE label (mute
  // marker stripped); an anonymous `$:` track seeds EMPTY (its `d{N}` display
  // isn't real code) so the field invites a fresh name rather than echoing it.
  const [renaming, setRenaming] = React.useState(false)
  // `strip.label` is already the bare label — `stripModel` strips the marker,
  // on either side (#1679), so there is nothing to strip here.
  const bareLabel = strip.label ?? ''
  const renameSeed = bareLabel !== '' && bareLabel !== '$' ? bareLabel : ''
  const renameEnabled = onRename !== undefined
  // ONE write per rename gesture (#877). Committing on Enter unmounts the input,
  // and the write itself focuses the editor (the cursor follows the track) — so
  // the field ALSO blurs, and the blur handler fired a SECOND rename. Both wrote,
  // and the second landed on the wrong track. The gesture is settled exactly once:
  // whichever of Enter / blur / Escape happens first closes it, the rest no-op.
  const settledRef = React.useRef(false)
  const openRename = (): void => {
    settledRef.current = false
    setRenaming(true)
  }
  const commitRename = (raw: string): void => {
    if (settledRef.current) return
    settledRef.current = true
    setRenaming(false)
    const v = raw.trim()
    if (v) onRename?.(v) // renameEdit validates + no-ops; invalid → silent revert
  }
  const cancelRename = (): void => {
    settledRef.current = true
    setRenaming(false)
  }
  const gain = faderGain(strip)
  const pos = gain === null ? 0 : gainToFaderPos(gain)
  const faderEnabled = gain !== null && onGainChange !== undefined
  const panEnabled = !strip.panForeign && onPanChange !== undefined
  const panValue = strip.pan ?? 0.5

  // The fader stores the axis coordinate it samples: a vertical fader reads
  // UP-is-louder (start − clientY), a horizontal one RIGHT-is-louder
  // (clientX − start). Both still read pointer DELTAS ÷ DRAG_SPAN_PX (never a
  // bounding box), so the gesture is unaffected by zoom or layout (#596).
  const faderDrag = React.useRef<{ start: number; startPos: number } | null>(null)
  const panDrag = React.useRef<{ startX: number; startPan: number } | null>(null)

  const onFaderDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!faderEnabled) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    faderDrag.current = { start: horizontal ? e.clientX : e.clientY, startPos: pos }
    onGestureStart?.()
  }
  const onFaderMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = faderDrag.current
    if (!d) return
    const delta = horizontal ? e.clientX - d.start : d.start - e.clientY
    const next = faderPosToGain(clamp01(d.startPos + delta / DRAG_SPAN_PX))
    onGainChange?.(Math.round(next * 1000) / 1000)
  }
  const endFader = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!faderDrag.current) return
    faderDrag.current = null
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    onGestureEnd?.()
  }
  const resetFader = (): void => {
    // One non-gesture edit → its own undo step, and Writeback re-evals it live.
    if (faderEnabled) onGainChange?.(1)
  }

  const onPanDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!panEnabled) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    panDrag.current = { startX: e.clientX, startPan: panValue }
    onGestureStart?.()
  }
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = panDrag.current
    if (!d) return
    const next = clamp01(d.startPan + (e.clientX - d.startX) / DRAG_SPAN_PX)
    onPanChange?.(Math.round(next * 100) / 100)
  }
  const endPan = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!panDrag.current) return
    panDrag.current = null
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    onGestureEnd?.()
  }

  // ── Horizontal (Pattern-tab inspector) layout (#600) ──────────────────────
  // A compact, headerless bar: a pan row over a wide fader with its meter fused
  // underneath and the gain·dB readout beside it. Sits atop the inspector so the
  // grid reclaims the width the old vertical strip's side column took. Shares
  // every drag handler and value above — only the arrangement differs.
  if (horizontal) {
    return (
      <div
        data-mixer-strip
        data-mixer-strip-id={strip.id}
        data-mixer-strip-kind={strip.kind}
        data-mixer-strip-muted={strip.muted ? '' : undefined}
        data-mixer-strip-orientation="horizontal"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          width: '100%',
          minWidth: 0,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          color: 'var(--foreground, #e6e6ea)',
          // a solo elsewhere dims the non-soloed track (matches the console)
          opacity: dimmed ? 0.45 : 1,
          transition: 'opacity 120ms ease',
        }}
      >
        {/* mute + solo on the left, pan (horizontal drag sets .pan) on the right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(onMuteToggle || onSoloToggle) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <button
                type="button"
                data-mixer-strip-mute
                aria-label={`${strip.muted ? 'Unmute' : 'Mute'} track`}
                aria-pressed={strip.muted}
                disabled={!muteEnabled}
                onClick={() => onMuteToggle?.()}
                title={strip.muteable ? (strip.muted ? 'Unmute' : 'Mute') : 'Only named/$: tracks can be muted'}
                style={compactBtn(strip.muted ? 'var(--meter-red, #e0564a)' : undefined, strip.muted ? '#fff' : undefined, muteEnabled)}
              >
                M
              </button>
              {onSoloToggle && (
                <button
                  type="button"
                  data-mixer-strip-solo
                  aria-label={`${soloed ? 'Unsolo' : 'Solo'} track`}
                  aria-pressed={soloed}
                  onClick={() => onSoloToggle()}
                  title={soloed ? 'Unsolo' : 'Solo (hear this alone)'}
                  style={compactBtn(soloed ? 'var(--meter-yellow, #ffcc4d)' : undefined, soloed ? '#1c1c20' : undefined, true)}
                >
                  S
                </button>
              )}
            </div>
          )}
          <div
            data-mixer-strip-pan-control
            onPointerDown={onPanDown}
            onPointerMove={onPanMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              fontSize: 10,
              cursor: panEnabled ? 'ew-resize' : 'default',
              opacity: strip.panForeign ? 0.4 : 1,
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            <span style={{ color: 'var(--foreground-muted, #a0a0aa)' }}>pan</span>
            <span data-mixer-strip-pan>{strip.panForeign ? 'sig' : panLabel(strip.pan)}</span>
          </div>
        </div>

        {/* vol — a wide fader (horizontal drag sets .gain) with its meter fused
            directly beneath, sharing one dB taper, plus the gain·dB readout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--foreground-muted, #a0a0aa)' }}>vol</span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div
              data-mixer-strip-fader
              onPointerDown={onFaderDown}
              onPointerMove={onFaderMove}
              onPointerUp={endFader}
              onPointerCancel={endFader}
              onDoubleClick={resetFader}
              style={{
                position: 'relative',
                height: 14,
                display: 'flex',
                alignItems: 'center',
                opacity: gain === null ? 0.4 : 1,
                cursor: faderEnabled ? 'ew-resize' : 'default',
                touchAction: 'none',
                userSelect: 'none',
              }}
            >
              {/* groove */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--background, #1c1c20)',
                  border: '1px solid var(--border, #3a3a42)',
                  pointerEvents: 'none',
                }}
              />
              {/* thumb at the taper position (hidden for foreign gain) */}
              {gain !== null && (
                <div
                  data-mixer-strip-thumb
                  style={{
                    position: 'absolute',
                    left: `${pos * 100}%`,
                    transform: 'translateX(-50%)',
                    width: 6,
                    height: 14,
                    borderRadius: 2,
                    background: 'var(--foreground, #e6e6ea)',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
            {/* fused meter — runs under the fader, aligned to its travel */}
            {meters && <StripMeter captureId={strip.captureId} controller={meters} horizontal />}
          </div>
          {/* gain readout: linear + dB (or "sig" for a foreign gain) */}
          {gain === null ? (
            <span data-mixer-strip-gain title="gain is a signal — edit in code" style={{ fontSize: 10 }}>
              sig
            </span>
          ) : (
            <span style={{ display: 'flex', gap: 5, fontSize: 10, flexShrink: 0 }}>
              <span data-mixer-strip-gain>{formatNum(gain)}</span>
              <span data-mixer-strip-db style={{ color: 'var(--foreground-muted, #a0a0aa)' }}>
                {formatDb(gain)}
              </span>
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      data-mixer-strip
      data-mixer-strip-id={strip.id}
      data-mixer-strip-kind={strip.kind}
      data-mixer-strip-muted={strip.muted ? '' : undefined}
      data-mixer-strip-selected={selected ? '' : undefined}
      // #639 — a press anywhere on the strip face selects it (the accent border
      // below then marks it). Inner controls still fire their own handlers and
      // bubble up, so interacting with a strip also selects it.
      onClick={onSelect}
      style={{
        // The console header stacks name (row 1) over the mute/solo/expand
        // buttons (row 2), so a short name like `d1` never truncates and one
        // compact width serves both the console and the headerless local strip.
        width: 84,
        // Scale the strip face (console = 1.5×). The drawer matches this height
        // but keeps 1× content — see the `zoom` prop doc.
        zoom,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        // When the expand drawer is open (console), flatten the RIGHT corners so
        // the strip face and its drawer read as one connected unit — the drawer
        // rounds the right edge. Standalone / closed → fully rounded.
        borderRadius: expanded ? '6px 0 0 6px' : 6,
        // The strip face keeps its neutral border; the SELECTION highlight (#639)
        // lives on the wrapping group div (MixerStrips), which encapsulates the
        // face AND its drawer so the accent outline wraps the whole unit and
        // grows with the drawer — not on the face/drawer individually.
        border: '1px solid var(--border, #3a3a42)',
        // When expanded, the drawer abuts this right edge and owns the seam
        // hairline (its left border) — drop ours so the divider is a single
        // 1px line, not a doubled 2px one (#609).
        borderRight: expanded ? 'none' : undefined,
        background: 'var(--background-elevated, #26262c)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        color: 'var(--foreground, #e6e6ea)',
        // a solo elsewhere dims the non-soloed strips (design §6.5)
        opacity: dimmed ? 0.45 : 1,
        transition: 'opacity 120ms ease',
      }}
    >
      {/* header: name row over a button row (mute/solo/expand) — dropped on the
          headerless local strip. Stacking keeps short names from truncating. */}
      {showHeader && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          {colorPickEnabled ? (
            <button
              type="button"
              data-mixer-strip-dot
              aria-label={`Change colour of ${strip.shownName}`}
              title={`${strip.shownName} — click to change colour`}
              onClick={(e) => setColorAnchor(e.currentTarget.getBoundingClientRect())}
              style={{
                width: 8,
                height: 8,
                padding: 0,
                border: 'none',
                borderRadius: '50%',
                background: dotColor ?? strip.color,
                flexShrink: 0,
                cursor: 'pointer',
              }}
            />
          ) : (
            <span
              data-mixer-strip-dot
              style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor ?? strip.color, flexShrink: 0 }}
            />
          )}
          {colorAnchor && onPickColor && (
            <StripColorPopover
              anchorRect={colorAnchor}
              currentColor={dotColor ?? strip.color}
              onPick={(color) => onPickColor(color)}
              onReset={onResetColor ? () => onResetColor() : undefined}
              onClose={() => setColorAnchor(null)}
            />
          )}
          {renaming ? (
            <input
              data-mixer-strip-rename
              autoFocus
              defaultValue={renameSeed}
              placeholder="name this track"
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                // preventDefault BEFORE committing (#877): the commit unmounts this
                // input, so the browser finishes delivering the keystroke to
                // whatever holds focus next — the editor — and typed the Enter
                // (and the rest of the gesture) straight into the user's code.
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitRename(e.currentTarget.value)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelRename()
                }
                e.stopPropagation() // don't let the editor swallow the keystrokes
              }}
              onBlur={(e) => commitRename(e.currentTarget.value)}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'inherit',
                color: 'inherit',
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 3,
                padding: '0 2px',
                outline: 'none',
              }}
            />
          ) : (
            <span
              data-mixer-strip-name
              title={renameEnabled ? `${strip.shownName} — double-click to rename` : strip.shownName}
              onDoubleClick={renameEnabled ? openRename : undefined}
              style={{
                flex: 1,
                fontSize: 11,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                opacity: strip.muted ? 0.45 : 1,
                cursor: renameEnabled ? 'text' : 'default',
              }}
            >
              {strip.shownName}
            </span>
          )}
          {strip.sounds.length > 1 && (
            // a track whose sound is a pattern plays several (#2226); one sound shows nothing new
            <span
              data-mixer-strip-sounds
              title={strip.sounds.join(', ')}
              style={{ flexShrink: 0, fontSize: 9, opacity: 0.7, whiteSpace: 'nowrap' }}
            >
              {strip.sounds.length} sounds
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          data-mixer-strip-mute
          aria-label={`${strip.muted ? 'Unmute' : 'Mute'} ${strip.shownName}`}
          aria-pressed={strip.muted}
          disabled={!muteEnabled}
          onClick={() => onMuteToggle?.()}
          title={strip.muteable ? (strip.muted ? 'Unmute' : 'Mute') : 'Only named/$: tracks can be muted'}
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
            background: strip.muted ? 'var(--meter-red, #e0564a)' : 'var(--background, #1c1c20)',
            color: strip.muted ? '#fff' : 'var(--foreground-muted, #a0a0aa)',
            opacity: muteEnabled ? 1 : 0.3,
          }}
        >
          M
        </button>
        {onSoloToggle && (
          <button
            type="button"
            data-mixer-strip-solo
            aria-label={`${soloed ? 'Unsolo' : 'Solo'} ${strip.shownName}`}
            aria-pressed={soloed}
            onClick={() => onSoloToggle()}
            title={soloed ? 'Unsolo' : 'Solo (hear this alone)'}
            style={{
              flexShrink: 0,
              width: 16,
              height: 16,
              padding: 0,
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 700,
              lineHeight: '14px',
              cursor: 'pointer',
              border: '1px solid var(--border, #3a3a42)',
              background: soloed ? 'var(--meter-yellow, #ffcc4d)' : 'var(--background, #1c1c20)',
              color: soloed ? '#1c1c20' : 'var(--foreground-muted, #a0a0aa)',
            }}
          >
            S
          </button>
        )}
        {onToggleExpand && (
          <button
            type="button"
            data-mixer-strip-expand
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${strip.shownName}`}
            aria-expanded={expanded}
            onClick={() => onToggleExpand()}
            title={expanded ? 'Collapse channel' : 'Expand channel'}
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
            {expanded ? '◂' : '▸'}
          </button>
        )}
        </div>
      </div>
      )}

      {/* pan — horizontal drag sets .pan */}
      <div
        data-mixer-strip-pan-control
        onPointerDown={onPanDown}
        onPointerMove={onPanMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          cursor: panEnabled ? 'ew-resize' : 'default',
          opacity: strip.panForeign ? 0.4 : 1,
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <span style={{ color: 'var(--foreground-muted, #a0a0aa)' }}>pan</span>
        <span data-mixer-strip-pan>{strip.panForeign ? 'sig' : panLabel(strip.pan)}</span>
      </div>

      {/* fader + fused meter — Logic-style: the live meter sits beside the
          fader at the same height, sharing one dB scale (faderTaper). */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'stretch',
          gap: 5,
          height: FADER_HEIGHT,
        }}
      >
        {meters && <StripMeter captureId={strip.captureId} controller={meters} />}
        {/* fader — vertical drag sets .gain */}
        <div
          data-mixer-strip-fader
          onPointerDown={onFaderDown}
          onPointerMove={onFaderMove}
          onPointerUp={endFader}
          onPointerCancel={endFader}
          onDoubleClick={resetFader}
          style={{
            position: 'relative',
            height: '100%',
            width: 26,
            display: 'flex',
            justifyContent: 'center',
            opacity: gain === null ? 0.4 : 1,
            cursor: faderEnabled ? 'ns-resize' : 'default',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          {/* groove */}
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
          {/* thumb at the taper position (hidden for foreign gain) */}
          {gain !== null && (
            <div
              data-mixer-strip-thumb
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
          )}
        </div>
      </div>

      {/* gain readout: linear + dB (or "sig" for a foreign gain) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
        {gain === null ? (
          <span data-mixer-strip-gain title="gain is a signal — edit in code">sig</span>
        ) : (
          <>
            <span data-mixer-strip-gain>{formatNum(gain)}</span>
            <span data-mixer-strip-db style={{ color: 'var(--foreground-muted, #a0a0aa)' }}>
              {formatDb(gain)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function formatNum(v: number): string {
  return (Math.round(v * 100) / 100).toString()
}
