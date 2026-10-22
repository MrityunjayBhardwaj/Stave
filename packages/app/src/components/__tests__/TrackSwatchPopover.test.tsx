/**
 * TrackSwatchPopover — Phase 20-12 β-6 unit tests.
 *
 * Coverage matches plan §4 β-6 PART C:
 *   - 32 swatches in 8×4 grid
 *   - swatch click → onPick(color) THEN onClose()
 *   - outside-click → onClose
 *   - Escape → onClose
 *   - aria-current set on the matching currentColor swatch
 *
 * The deferred-attach pattern (mirroring BackdropPopover.tsx:48-68) is
 * verified by checking the listener doesn't fire on the same tick as the
 * mount.
 */

import { describe, it, expect, vi } from 'vitest'
import { act, render, cleanup, fireEvent } from '@testing-library/react'
import { afterEach } from 'vitest'
import { TrackSwatchPopover } from '../TrackSwatchPopover'
import { TRACK_PALETTE_32 } from '@stave/editor'

afterEach(() => {
  cleanup()
})

function fakeRect(): DOMRect {
  return {
    top: 100,
    bottom: 112,
    left: 50,
    right: 62,
    width: 12,
    height: 12,
    x: 50,
    y: 100,
    toJSON: () => ({}),
  } as DOMRect
}

describe('20-12 β-6 — TrackSwatchPopover', () => {
  it('renders 32 swatches in an 8×4 grid', () => {
    const { container } = render(
      <TrackSwatchPopover
        anchorRect={fakeRect()}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const swatches = container.querySelectorAll(
      '[data-musical-timeline="swatch-cell"]',
    )
    expect(swatches).toHaveLength(32)
    expect(TRACK_PALETTE_32).toHaveLength(32)
    // Confirm each color from the palette appears in order.
    swatches.forEach((sw, i) => {
      expect(sw.getAttribute('data-color')).toBe(TRACK_PALETTE_32[i])
    })
  })

  it('clicking a swatch calls onPick(color) then onClose() (commit-on-click, not mousemove)', () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <TrackSwatchPopover
        anchorRect={fakeRect()}
        onPick={onPick}
        onClose={onClose}
      />,
    )
    const target = container.querySelector<HTMLButtonElement>(
      `[data-color="${TRACK_PALETTE_32[5]}"]`,
    )
    fireEvent.click(target!)
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(TRACK_PALETTE_32[5])
    expect(onClose).toHaveBeenCalledTimes(1)
    // onPick fired before onClose (write storm guard — we don't fire on
    // mousemove, only on commit).
    expect(onPick.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0],
    )
  })

  it('outside-click closes (after deferred-attach tick)', async () => {
    vi.useFakeTimers()
    try {
      const onClose = vi.fn()
      render(
        <TrackSwatchPopover
          anchorRect={fakeRect()}
          onPick={vi.fn()}
          onClose={onClose}
        />,
      )
      // Same-tick mousedown should NOT close (deferred-attach pattern).
      act(() => {
        document.body.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true }),
        )
      })
      expect(onClose).not.toHaveBeenCalled()
      // Advance the setTimeout(0) — the listener attaches.
      act(() => {
        vi.advanceTimersByTime(1)
      })
      // Now an outside mousedown closes.
      act(() => {
        document.body.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true }),
        )
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('Escape closes', () => {
    const onClose = vi.fn()
    render(
      <TrackSwatchPopover
        anchorRect={fakeRect()}
        onPick={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // #587 — the popover is positioned from the anchor rect captured on open and
  // doesn't track the dot afterwards, so it must close on scroll/resize rather
  // than float away.
  it('a scroll (on any ancestor — capture) closes the popover (#587)', () => {
    const onClose = vi.fn()
    render(
      <TrackSwatchPopover anchorRect={fakeRect()} onPick={vi.fn()} onClose={onClose} />,
    )
    fireEvent.scroll(window, {})
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a window resize (covers browser zoom) closes the popover (#587)', () => {
    const onClose = vi.fn()
    render(
      <TrackSwatchPopover anchorRect={fakeRect()} onPick={vi.fn()} onClose={onClose} />,
    )
    fireEvent(window, new Event('resize'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('aria-current="true" is set on the matching currentColor swatch', () => {
    const target = TRACK_PALETTE_32[10]
    const { container } = render(
      <TrackSwatchPopover
        anchorRect={fakeRect()}
        currentColor={target}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const matching = container.querySelector(
      `[data-color="${target}"][aria-current="true"]`,
    )
    expect(matching).not.toBeNull()
    // No other swatch has aria-current=true.
    const allCurrent = container.querySelectorAll('[aria-current="true"]')
    expect(allCurrent).toHaveLength(1)
  })

  // Phase 20-12 wave-δ — custom color picker.
  it('renders a custom color row with <input type="color">', () => {
    const { container } = render(
      <TrackSwatchPopover
        anchorRect={fakeRect()}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const row = container.querySelector('[data-musical-timeline="swatch-custom-row"]')
    expect(row).not.toBeNull()
    const input = container.querySelector<HTMLInputElement>(
      '[data-musical-timeline="swatch-custom-input"]',
    )
    expect(input).not.toBeNull()
    expect(input!.type).toBe('color')
  })

  // Phase 20-12 wave-ε — custom picker does NOT close on change. React's
  // onChange for `<input type="color">` maps to native `input` which fires
  // on every drag frame; closing on first fire unmounts the popover before
  // the user can commit. Behavior: write-through on every change for
  // live preview; explicit dismiss (outside-click / Esc) closes.
  it('custom color change fires onPick(value) WITHOUT closing the popover (live preview)', () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <TrackSwatchPopover
        anchorRect={fakeRect()}
        onPick={onPick}
        onClose={onClose}
      />,
    )
    const input = container.querySelector<HTMLInputElement>(
      '[data-musical-timeline="swatch-custom-input"]',
    )
    fireEvent.change(input!, { target: { value: '#abcdef' } })
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('#abcdef')
    // No close on change — popover stays open for further adjustment.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('multiple change events all write through (drag frames live-preview)', () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <TrackSwatchPopover
        anchorRect={fakeRect()}
        onPick={onPick}
        onClose={onClose}
      />,
    )
    const input = container.querySelector<HTMLInputElement>(
      '[data-musical-timeline="swatch-custom-input"]',
    )
    fireEvent.change(input!, { target: { value: '#111111' } })
    fireEvent.change(input!, { target: { value: '#222222' } })
    fireEvent.change(input!, { target: { value: '#333333' } })
    expect(onPick).toHaveBeenCalledTimes(3)
    expect(onPick.mock.calls.map((c) => c[0])).toEqual(['#111111', '#222222', '#333333'])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('custom picker initial value reflects currentColor when off-palette', () => {
    // Off-palette currentColor → seed the picker with it for editing.
    const offPalette = '#abcdef'
    expect(TRACK_PALETTE_32).not.toContain(offPalette)
    const { container } = render(
      <TrackSwatchPopover
        anchorRect={fakeRect()}
        currentColor={offPalette}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const input = container.querySelector<HTMLInputElement>(
      '[data-musical-timeline="swatch-custom-input"]',
    )
    expect(input!.defaultValue).toBe(offPalette)
  })

  it('custom picker uses a neutral default when currentColor is on-palette', () => {
    // On-palette currentColor → don't overwrite the picker with a palette
    // match (that's the swatch grid's job; the picker stages a NEW choice).
    const { container } = render(
      <TrackSwatchPopover
        anchorRect={fakeRect()}
        currentColor={TRACK_PALETTE_32[3]}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const input = container.querySelector<HTMLInputElement>(
      '[data-musical-timeline="swatch-custom-input"]',
    )
    expect(input!.defaultValue).not.toBe(TRACK_PALETTE_32[3])
    expect(/^#[0-9a-f]{6}$/i.test(input!.defaultValue)).toBe(true)
  })
})
