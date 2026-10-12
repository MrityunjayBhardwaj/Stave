/**
 * jumpCursorToTrack (#595) — the cursor-follows-strip guard.
 *
 * Verifies the once-per-target behaviour that keeps a continuous fader/knob drag
 * from thrashing the scroll/focus: reveal+focus only when the target statement
 * changed OR the editor isn't focused; otherwise leave the pinned caret alone.
 * Monaco-free — a tiny mock editor records which methods were called.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'

import { jumpCursorToTrack } from '../useMixerModel'

interface Calls {
  setPosition: number
  reveal: number
  focus: number
  lastLine: number | null
}

/** mock editor/model; `focused` drives hasTextFocus, offsets map to line = offset+1 */
function makeEditor(focused: boolean) {
  const calls: Calls = { setPosition: 0, reveal: 0, focus: 0, lastLine: null }
  const editor = {
    hasTextFocus: () => focused,
    setPosition: (p: { lineNumber: number }) => {
      calls.setPosition++
      calls.lastLine = p.lineNumber
    },
    revealLineInCenter: () => {
      calls.reveal++
    },
    focus: () => {
      calls.focus++
      focused = true // focusing makes it focused (mirrors Monaco)
    },
  }
  const model = { getPositionAt: (off: number) => ({ lineNumber: off + 1, column: 1 }) }
  return { editor, model, calls }
}

describe('jumpCursorToTrack', () => {
  it('reveals + focuses on the first jump to a track', () => {
    const { editor, model, calls } = makeEditor(false)
    const ref = { current: null as number | null }
    jumpCursorToTrack(editor, model, 10, ref)
    expect(calls).toMatchObject({ setPosition: 1, reveal: 1, focus: 1, lastLine: 11 })
    expect(ref.current).toBe(10)
  })

  it('does NOT re-reveal/focus on repeated ticks at the same focused track (drag)', () => {
    const { editor, model, calls } = makeEditor(false)
    const ref = { current: null as number | null }
    jumpCursorToTrack(editor, model, 10, ref) // first → jumps + focuses
    jumpCursorToTrack(editor, model, 10, ref) // same target, now focused → no-op
    jumpCursorToTrack(editor, model, 10, ref)
    expect(calls).toMatchObject({ setPosition: 1, reveal: 1, focus: 1 })
  })

  it('re-reveals + focuses when the target track changes', () => {
    const { editor, model, calls } = makeEditor(false)
    const ref = { current: null as number | null }
    jumpCursorToTrack(editor, model, 10, ref)
    jumpCursorToTrack(editor, model, 40, ref) // different statement
    expect(calls).toMatchObject({ setPosition: 2, reveal: 2, focus: 2, lastLine: 41 })
    expect(ref.current).toBe(40)
  })

  it('re-reveals + focuses for the same target if the editor lost focus', () => {
    const { editor, model, calls } = makeEditor(true)
    const ref = { current: 10 } // already jumped here once
    // editor reports focused → first call is a no-op pin
    jumpCursorToTrack(editor, model, 10, ref)
    expect(calls.reveal).toBe(0)
    // user clicked away; editor no longer focused → re-jump
    editor.hasTextFocus = () => false
    jumpCursorToTrack(editor, model, 10, ref)
    expect(calls).toMatchObject({ reveal: 1, focus: 1 })
  })

  it('never throws when editor APIs are missing (cursor is a courtesy)', () => {
    const ref = { current: null as number | null }
    expect(() =>
      jumpCursorToTrack({}, { getPositionAt: () => undefined }, 10, ref),
    ).not.toThrow()
    expect(ref.current).toBeNull() // no position → no jump recorded
  })
})

/**
 * #2017 — on a touch device the jump moves the cursor and scrolls but never focuses
 * the editor (that would summon the keyboard over the strip under the finger). And
 * because the editor is then never focused, "not focused" must not count as a reason
 * to jump again, or every tick of a fader drag would re-centre the code.
 */
describe('jumpCursorToTrack on a touch device (#2017)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const touch = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }))

  it('moves the cursor and reveals, without focusing', () => {
    touch()
    const { editor, model, calls } = makeEditor(false)
    jumpCursorToTrack(editor, model, 7, { current: null })
    expect(calls).toEqual({ setPosition: 1, reveal: 1, focus: 0, lastLine: 8 })
  })

  it('a drag on ONE strip jumps once, though the editor never gains focus', () => {
    touch()
    const { editor, model, calls } = makeEditor(false)
    const last = { current: null as number | null }
    for (let tick = 0; tick < 5; tick++) jumpCursorToTrack(editor, model, 7, last)
    expect(calls.setPosition).toBe(1)
    expect(calls.reveal).toBe(1)
    expect(calls.focus).toBe(0)
  })

  it('a different strip jumps again', () => {
    touch()
    const { editor, model, calls } = makeEditor(false)
    const last = { current: null as number | null }
    jumpCursorToTrack(editor, model, 7, last)
    jumpCursorToTrack(editor, model, 12, last)
    expect(calls.setPosition).toBe(2)
    expect(calls.lastLine).toBe(13)
    expect(calls.focus).toBe(0)
  })
})
