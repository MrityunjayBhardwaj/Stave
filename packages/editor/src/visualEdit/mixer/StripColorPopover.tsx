'use client'

/**
 * StripColorPopover — the Mixer's per-track colour picker (Phase D, #581).
 *
 * A 32-swatch grid over the SHARED `TRACK_PALETTE_32` (from `trackColor.ts`) plus
 * a native custom-colour input and a "Default" reset, anchored to a strip's colour
 * dot. The editor-package sibling of the app's `TrackSwatchPopover`: the two are
 * separate WIDGETS only because the editor cannot import an app component and the
 * app can't barrel-import this one without dragging the editor bundle into its unit
 * tests (P172). What MATTERS stays single-source — the palette, the `TrackMeta`
 * store the pick writes to, and the `trackIdentity` colour resolution are all
 * shared, so a colour picked here and one picked on the Timeline are identical.
 *
 * onPick fires on a discrete swatch click (and on each custom-input change so the
 * dot live-previews); the caller writes through to `setTrackMeta` and closes via
 * `onClose`. Outside-click (deferred one tick so the opening click doesn't close
 * it) and Escape close.
 *
 * PORTALED to `document.body` (like `AddEffectMenu`, P-MIX-18): the console strip
 * FACE renders at `zoom: 1.5` (CONSOLE_ZOOM), and a `position: fixed` element
 * inside a CSS-`zoom` subtree has its coordinates SCALED by that zoom — so a
 * popover anchored by `getBoundingClientRect()` (real viewport px) would land
 * ~1.5× off the dot. The portal mounts it OUTSIDE the zoomed strip, where fixed
 * coordinates map 1:1 to the viewport (the Timeline's identical popover aligns
 * because the Timeline isn't zoomed).
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { TRACK_PALETTE_32 } from '../../codeView'

export interface StripColorPopoverProps {
  /** Anchor rect from the strip dot's `getBoundingClientRect()`. */
  readonly anchorRect: DOMRect
  /** The currently-applied colour (override or resolved default) — the matching
   *  swatch is highlighted. */
  readonly currentColor?: string
  /** Fires on a swatch click / custom-input change with the chosen hex. */
  readonly onPick: (color: string) => void
  /** Clear the override → fall back to the deterministic palette colour. */
  readonly onReset?: () => void
  /** Fires on outside-click, Escape, or after a discrete pick. */
  readonly onClose: () => void
}

export function StripColorPopover({
  anchorRect,
  currentColor,
  onPick,
  onReset,
  onClose,
}: StripColorPopoverProps): React.ReactPortal | null {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    // Defer the outside-click listener one tick so the click that opened the
    // popover doesn't immediately close it (mirrors the app TrackSwatchPopover).
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Positioned from the anchor rect captured on open (#581) — it doesn't track
    // the dot afterwards, so a scroll/resize/zoom would leave it floating away
    // (#587). Close on reflow. `scroll` uses capture so a scroll on ANY ancestor
    // (the console strip row) is caught, not just window; `resize` covers zoom.
    const onReflow = (): void => onClose()
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [onClose])

  const POPOVER_WIDTH = 8 * 16 + 7 * 4 + 12
  const left =
    typeof window !== 'undefined'
      ? Math.max(8, Math.min(window.innerWidth - 8 - POPOVER_WIDTH, anchorRect.left))
      : anchorRect.left
  const top = anchorRect.bottom + 4

  const customColor =
    currentColor && !TRACK_PALETTE_32.includes(currentColor) ? currentColor : '#888888'

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={ref}
      data-mixer-strip-color-popover
      role="dialog"
      aria-label="Pick track color"
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 1000,
        background: 'var(--background-elevated, #1a1a1a)',
        border: '1px solid var(--border, #333)',
        padding: 6,
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 16px)', gridGap: 4 }}>
        {TRACK_PALETTE_32.map((color) => {
          const isCurrent = color === currentColor
          return (
            <button
              key={color}
              type="button"
              data-mixer-strip-swatch
              data-color={color}
              aria-label={`Color ${color}`}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => {
                onPick(color)
                onClose()
              }}
              style={{
                width: 16,
                height: 16,
                padding: 0,
                border: isCurrent ? '2px solid white' : '1px solid rgba(255,255,255,0.18)',
                background: color,
                cursor: 'pointer',
                borderRadius: 3,
                boxSizing: 'border-box',
              }}
            />
          )
        })}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingTop: 4,
          borderTop: '1px solid var(--border, rgba(255,255,255,0.12))',
          fontSize: 11,
          color: 'var(--foreground-muted, rgba(255,255,255,0.55))',
        }}
      >
        <label htmlFor="mixer-strip-custom-color" style={{ flex: 1, cursor: 'pointer' }}>
          Custom
        </label>
        {onReset && (
          <button
            type="button"
            data-mixer-strip-color-reset
            aria-label="Reset to default colour"
            title="Reset to the default palette colour"
            onClick={() => {
              onReset()
              onClose()
            }}
            style={{
              padding: '1px 6px',
              fontSize: 10,
              border: '1px solid var(--border, rgba(255,255,255,0.18))',
              borderRadius: 3,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Default
          </button>
        )}
        <input
          id="mixer-strip-custom-color"
          type="color"
          data-mixer-strip-custom-color
          aria-label="Custom track color"
          defaultValue={customColor}
          // Write through on every change so the dot live-previews; the popover
          // stays open until outside-click/Esc (the LAST value is the persisted
          // choice). Y.Map de-dups equal writes, so the per-frame rate is fine.
          onChange={(e) => onPick(e.currentTarget.value)}
          style={{
            width: 28,
            height: 18,
            padding: 0,
            border: '1px solid var(--border, rgba(255,255,255,0.18))',
            borderRadius: 3,
            background: 'transparent',
            cursor: 'pointer',
          }}
        />
      </div>
    </div>,
    document.body,
  )
}
