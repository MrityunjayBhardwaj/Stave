/**
 * AddEffectMenu — the ＋More effect-catalog popover (#575).
 *
 * Focus: the scroll-dismiss scope. The menu is a fixed-position portal that
 * closes when an ANCESTOR (the drawer body / page) scrolls, because the fixed
 * anchor would drift. But the menu's own list is `overflowY:auto`, and the
 * dismiss listener is a capture-phase window `scroll` handler — so without an
 * origin guard, scrolling the list itself closes the menu and the user can't
 * browse the long tail. These tests pin both sides: self-scroll survives,
 * an ancestor scroll moves the menu with its trigger and dismisses it only
 * once the trigger is out of view (#2088).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AddEffectMenu } from '../AddEffectMenu'

afterEach(() => cleanup())

function openMenu() {
  const utils = render(<AddEffectMenu present={new Set()} onToggle={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /More/ }))
  return utils
}

describe('AddEffectMenu — scroll-dismiss scope', () => {
  it('opens the catalog popover on ＋More', () => {
    openMenu()
    expect(document.querySelector('[data-mixer-add-effect-menu]')).not.toBeNull()
  })

  it('scrolling the menu LIST does not dismiss it (own overflow scroll)', () => {
    openMenu()
    const menu = document.querySelector('[data-mixer-add-effect-menu]') as HTMLElement
    expect(menu).not.toBeNull()
    // A scroll whose target is inside the menu = the user browsing the list.
    fireEvent.scroll(menu)
    expect(document.querySelector('[data-mixer-add-effect-menu]')).not.toBeNull()
  })

  // #2088 — an outside scroll closes the menu only when it took the trigger
  // out of view; one that moved it keeps the menu on it; one that did not move
  // it at all (the late event of a scroll from BEFORE the open) is ignored.
  function placeTrigger(top: number): void {
    const btn = screen.getByRole('button', { name: /More/ })
    btn.getBoundingClientRect = () =>
      ({ top, left: 100, bottom: top + 24, right: 220, width: 120, height: 24, x: 100, y: top, toJSON: () => ({}) }) as DOMRect
  }
  const menuTop = (): string =>
    (document.querySelector('[data-mixer-add-effect-menu]') as HTMLElement).style.top

  it('a page scroll that did not move the trigger leaves it open (#2088)', () => {
    render(<AddEffectMenu present={new Set()} onToggle={vi.fn()} />)
    placeTrigger(300)
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    fireEvent.scroll(window)
    expect(document.querySelector('[data-mixer-add-effect-menu]')).not.toBeNull()
  })

  it('a page scroll that moved the trigger keeps the menu on it (#2088)', () => {
    render(<AddEffectMenu present={new Set()} onToggle={vi.fn()} />)
    placeTrigger(300)
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    expect(menuTop()).toBe('328px')
    placeTrigger(250)
    fireEvent.scroll(window)
    expect(menuTop()).toBe('278px')
  })

  it('a page scroll that took the trigger out of view DOES dismiss it (fixed anchor would drift)', () => {
    render(<AddEffectMenu present={new Set()} onToggle={vi.fn()} />)
    placeTrigger(300)
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    placeTrigger(-40)
    fireEvent.scroll(window)
    expect(document.querySelector('[data-mixer-add-effect-menu]')).toBeNull()
  })

  it('a window resize dismisses it', () => {
    openMenu()
    fireEvent(window, new Event('resize'))
    expect(document.querySelector('[data-mixer-add-effect-menu]')).toBeNull()
  })

  it('Escape dismisses it', () => {
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('[data-mixer-add-effect-menu]')).toBeNull()
  })
})

describe('the catalog reaches the take controls (#1530)', () => {
  it('offers Pitch shift, so a take can be shifted without typing it', () => {
    openMenu()
    expect(screen.getByText('Pitch shift')).toBeTruthy()
  })

  it('adds it a FIFTH up — audible, and not on the knob rail an octave would be', () => {
    const onToggle = vi.fn()
    render(<AddEffectMenu present={new Set()} onToggle={onToggle} />)
    fireEvent.click(screen.getAllByRole('button', { name: /More/ })[0])
    fireEvent.click(screen.getAllByText('Pitch shift')[0])
    expect(onToggle).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'stretch', def: 0.5 }),
    )
  })

  it('never labels it as a corrective control — the shift misses by up to 246 cents', () => {
    openMenu()
    const menu = document.querySelector('[data-mixer-add-effect-menu]') as HTMLElement
    expect(/tune|correct|align/i.test(menu.textContent ?? '')).toBe(false)
  })
})
