import React from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { TrackLaneMenu } from '../TrackLaneMenu'

/**
 * #2082 — a lane's menu opens at the pointer and grows downward. On a lane near
 * the bottom of the window it ran past the bottom edge, and its Type item could
 * not be reached. It now moves up to end 8 px above the edge, as its left edge
 * is already kept 8 px inside.
 *
 * jsdom does no layout, so the menu's height is given here: 60 px.
 */

const MENU_HEIGHT = 60
const WINDOW_HEIGHT = 600
let restore: (() => void) | null = null

beforeAll(() => {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-full-song-lane-menu') ? MENU_HEIGHT : 0
    },
  })
  const height = window.innerHeight
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: WINDOW_HEIGHT })
  restore = () => {
    if (own) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', own)
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  }
})
afterAll(() => restore?.())
afterEach(cleanup)

function topAt(y: number): number {
  cleanup()
  const anchor = document.createElement('div')
  document.body.appendChild(anchor)
  render(
    <TrackLaneMenu x={100} y={y} anchor={anchor} trackName="lead" display="bars" onSetDisplay={() => {}} onRename={() => {}} onClose={() => {}} />,
  )
  const menu = document.querySelector('[data-full-song-lane-menu="lead"]') as HTMLElement
  return parseFloat(menu.style.top)
}

describe('the lane menu stays inside the window (#2082)', () => {
  it('opened near the bottom, it moves up to end 8 px above the edge', () => {
    expect(topAt(590)).toBe(WINDOW_HEIGHT - 8 - MENU_HEIGHT)
  })

  it('opened where it fits, it stays at the pointer', () => {
    expect(topAt(100)).toBe(100)
    // The last place it still fits.
    expect(topAt(WINDOW_HEIGHT - 8 - MENU_HEIGHT)).toBe(WINDOW_HEIGHT - 8 - MENU_HEIGHT)
  })

  it('a window shorter than the menu keeps its top on screen', () => {
    window.innerHeight = 50
    try {
      expect(topAt(40)).toBe(8)
    } finally {
      window.innerHeight = WINDOW_HEIGHT
    }
  })
})
