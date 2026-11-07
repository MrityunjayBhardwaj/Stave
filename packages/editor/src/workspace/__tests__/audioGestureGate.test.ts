/**
 * audioGestureGate — a sound the page can't play yet waits for the first gesture (#2451).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  startWhenAudioAllowed,
  cancelAudioStart,
  isWaitingForGesture,
  onGestureWaitChange,
  __resetAudioGestureGateForTests,
} from '../audioGestureGate'

const activation = { hasBeenActive: false, isActive: false }
function setActive(v: boolean) {
  activation.hasBeenActive = v
  activation.isActive = v
}

describe('audioGestureGate', () => {
  beforeEach(() => {
    __resetAudioGestureGateForTests()
    setActive(false)
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: activation })
  })
  afterEach(() => {
    __resetAudioGestureGateForTests()
    setActive(true)
  })

  it('starts at once when the page may already play audio', () => {
    setActive(true)
    const start = vi.fn()
    startWhenAudioAllowed('v1', start)
    expect(start).toHaveBeenCalledTimes(1)
    expect(isWaitingForGesture('v1')).toBe(false)
  })

  it('waits for the first click, then starts once', () => {
    const start = vi.fn()
    const changed = vi.fn()
    onGestureWaitChange(changed)
    startWhenAudioAllowed('v1', start)
    expect(start).not.toHaveBeenCalled()
    expect(isWaitingForGesture('v1')).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)

    setActive(true) // the browser grants activation as the gesture is dispatched
    window.dispatchEvent(new Event('pointerdown'))
    expect(start).toHaveBeenCalledTimes(1)
    expect(isWaitingForGesture('v1')).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)

    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('keydown'))
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('a key that grants nothing (Escape) keeps it waiting', () => {
    const start = vi.fn()
    startWhenAudioAllowed('v1', start)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(start).not.toHaveBeenCalled()
    expect(isWaitingForGesture('v1')).toBe(true)
    setActive(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('a finger going down grants nothing; its lift does (a phone tap)', () => {
    const start = vi.fn()
    startWhenAudioAllowed('v1', start)
    window.dispatchEvent(new Event('pointerdown')) // not active yet: a touch may still scroll
    expect(start).not.toHaveBeenCalled()
    setActive(true)
    window.dispatchEvent(new Event('pointerup'))
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('one start per key: a second request replaces the first', () => {
    const first = vi.fn()
    const second = vi.fn()
    startWhenAudioAllowed('v1', first)
    startWhenAudioAllowed('v1', second)
    setActive(true)
    window.dispatchEvent(new Event('pointerdown'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('a cancelled start never runs, and the window listeners go with the last one', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const start = vi.fn()
    startWhenAudioAllowed('v1', start)
    cancelAudioStart('v1')
    expect(isWaitingForGesture('v1')).toBe(false)
    const removed = remove.mock.calls.map((c) => c[0])
    expect(removed).toEqual(expect.arrayContaining(['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']))
    setActive(true)
    window.dispatchEvent(new Event('pointerdown'))
    expect(start).not.toHaveBeenCalled()
    remove.mockRestore()
  })
})
