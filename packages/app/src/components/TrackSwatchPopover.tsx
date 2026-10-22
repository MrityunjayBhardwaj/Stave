'use client'

/**
 * TrackSwatchPopover — Phase 20-12 β-6.
 *
 * 32-swatch (4-row × 8-col) grid over `TRACK_PALETTE_32`, anchored to a row
 * header swatch dot. onPick fires only on a discrete click (NOT mousemove —
 * CONTEXT pre-mortem #5: write storm). The popover closes itself after
 * pick by invoking `onClose` after `onPick`.
 *
 * Mirrors `BackdropPopover.tsx`'s deferred-attach idiom (BackdropPopover.tsx:
 * 48-68): the `mousedown` listener for outside-click is attached on a
 * `setTimeout(0)` so the OPENING click that fired this popover doesn't
 * immediately reach the listener and close it. Escape closes too.
 *
 * Pointer events: native browser tooltips (β-5) and this popover both
 * play nicely with click-through because the popover is `position: fixed`
 * + `z-index: 1000` and clicks INSIDE the popover go to swatches; clicks
 * OUTSIDE close it.
 */

import type * as React from 'react'
import { useEffect, useRef } from 'react'
import { TRACK_PALETTE_32 } from '@stave/editor'

export interface TrackSwatchPopoverProps {
  /** Anchor rect from the row-header swatch button's
   *  `getBoundingClientRect()`. The popover renders below-and-right of
   *  this rect. */
  readonly anchorRect: DOMRect
  /** Currently active color (auto + override resolved by caller). The
   *  matching swatch gets `aria-current="true"` + a thicker white
   *  border. */
  readonly currentColor?: string
  /** Fires on swatch click. Caller writes through to setTrackMeta and
   *  closes the popover separately via onClose. */
  readonly onPick: (color: string) => void
  /** Clear the override → fall back to the deterministic palette colour
   *  (Phase D, #581). Optional; when absent the "Default" affordance is hidden. */
  readonly onReset?: () => void
  /** Fires on outside-click, Escape key, or after a pick. */
  readonly onClose: () => void
}

export function TrackSwatchPopover({
  anchorRect,
  currentColor,
  onPick,
  onReset,
  onClose,
}: TrackSwatchPopoverProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Mirror BackdropPopover.tsx:48-68 — defer attach one tick so the
    // opening click doesn't immediately close the popover.
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // The popover is positioned from the anchor rect captured on open (#581); it
    // does not track the anchor afterwards, so any scroll/resize/zoom would leave
    // it floating away from its dot. Close it instead (#587). `scroll` uses
    // capture so a scroll on ANY ancestor (the timeline body, the strip row) is
    // caught, not just window; `resize` also covers browser zoom.
    const onReflow = () => onClose()
    const t = setTimeout(
      () => document.addEventListener('mousedown', onDown),
      0,
    )
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

  // Position: below-and-right of the anchor; clamp to viewport so the
  // popover doesn't render off-screen for tracks near the right edge.
  const POPOVER_WIDTH = 8 * 16 + 7 * 4 + 12 // 8 cols × 16 + 7 gaps × 4 + 12 padding
  const left =
    typeof window !== 'undefined'
      ? Math.max(8, Math.min(window.innerWidth - 8 - POPOVER_WIDTH, anchorRect.left))
      : anchorRect.left
  const top = anchorRect.bottom + 4

  // Track the in-progress custom-picker value so the native <input type="color">
  // can stage its choice without committing on every drag-frame. Only commit
  // (onPick + onClose) when the user releases the picker via `onBlur` /
  // `onChange` (Chrome fires `change` once on dismiss, after multiple `input`
  // events while dragging). Pre-mortem #5 family — write storm guard.
  const customColor = currentColor && !TRACK_PALETTE_32.includes(currentColor)
    ? currentColor
    : '#888888'

  return (
    <div
      ref={ref}
      data-musical-timeline="swatch-popover"
      data-testid="track-swatch-popover"
      role="dialog"
      aria-label="Pick track color"
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 1000,
        background: 'var(--bg-elevated, #1a1a1a)',
        border: '1px solid var(--border-strong, #333)',
        padding: 6,
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 16px)',
          gridGap: 4,
        }}
      >
        {TRACK_PALETTE_32.map((color) => {
          const isCurrent = color === currentColor
          return (
            <button
              key={color}
              type="button"
              data-musical-timeline="swatch-cell"
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
                border: isCurrent
                  ? '2px solid white'
                  : '1px solid rgba(255,255,255,0.18)',
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
        data-musical-timeline="swatch-custom-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingTop: 4,
          borderTop: '1px solid var(--border-strong, rgba(255,255,255,0.12))',
          fontSize: 11,
          color: 'var(--fg-muted, rgba(255,255,255,0.55))',
        }}
      >
        <label
          htmlFor="track-swatch-custom"
          style={{ flex: 1, cursor: 'pointer' }}
        >
          Custom
        </label>
        {onReset && (
          <button
            type="button"
            data-musical-timeline="swatch-reset"
            aria-label="Reset to default colour"
            title="Reset to the default palette colour"
            onClick={() => {
              onReset()
              onClose()
            }}
            style={{
              padding: '1px 6px',
              fontSize: 10,
              border: '1px solid var(--border-strong, rgba(255,255,255,0.18))',
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
          id="track-swatch-custom"
          type="color"
          data-musical-timeline="swatch-custom-input"
          aria-label="Custom track color"
          defaultValue={customColor}
          // Phase 20-12 wave-ε — DON'T close on change. React's `onChange`
          // for `<input type="color">` maps to the native `input` event,
          // which fires on EVERY drag frame inside the OS color picker.
          // The wave-δ implementation called onClose() on the first input
          // event, unmounting the popover before the user could commit.
          // Wave-ε behavior: write through on every change so the chrome
          // live-previews the color (track bars + dot update as the user
          // drags); the popover stays open until outside-click or Esc.
          // The user explicitly dismisses to commit; the LAST onPick value
          // is the persisted choice. Y.Map de-duplicates equal writes so
          // the per-frame write rate is fine.
          onChange={(e) => {
            onPick(e.currentTarget.value)
          }}
          style={{
            width: 28,
            height: 18,
            padding: 0,
            border: '1px solid var(--border-strong, rgba(255,255,255,0.18))',
            borderRadius: 3,
            background: 'transparent',
            cursor: 'pointer',
          }}
        />
      </div>
    </div>
  )
}
