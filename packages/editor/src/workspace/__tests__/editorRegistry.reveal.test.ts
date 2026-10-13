/**
 * editorRegistry — reveal helpers (#472).
 *
 * The distinction that matters: `revealLineInFile` parks the cursor at column 1
 * (fine for a top-level statement), while `revealOffsetInFile` maps a source
 * CHARACTER OFFSET to its exact line+column via the model's getPositionAt — so
 * the cursor can land INSIDE one arm of a combinator on a shared line, where the
 * grid binds (column 1 there resolves to the whole combinator → standby).
 *
 * Per feedback_editor_idb_test_split: plain spies over a fake Monaco editor, no
 * Monaco runtime — the real cursor behaviour is gated by the Playwright spec.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { registerEditor, unregisterEditor, revealLineInFile, revealOffsetInFile, revealTakesFocus } from '../editorRegistry'
import { TOUCH_POINTER_QUERY } from '../usePhone'

interface Pos {
  lineNumber: number
  column: number
}

function fakeEditor() {
  const calls = { setPosition: [] as Pos[], revealed: [] as number[], focused: 0 }
  const editor = {
    // model maps an offset → a position deterministically for assertions:
    // line = floor(offset / 10) + 1, column = (offset % 10) + 1.
    getModel: () => ({
      getPositionAt: (offset: number): Pos => ({
        lineNumber: Math.floor(offset / 10) + 1,
        column: (offset % 10) + 1,
      }),
    }),
    revealLineInCenter: (line: number) => calls.revealed.push(line),
    setPosition: (p: Pos) => calls.setPosition.push(p),
    focus: () => {
      calls.focused += 1
    },
  }
  return { editor, calls }
}

describe('editorRegistry — reveal helpers (#472)', () => {
  const FILE = 'file-1'
  let f: ReturnType<typeof fakeEditor>

  beforeEach(() => {
    f = fakeEditor()
    registerEditor(FILE, f.editor)
  })
  afterEach(() => {
    unregisterEditor(FILE, f.editor)
  })

  it('revealLineInFile parks the cursor at column 1', () => {
    expect(revealLineInFile(FILE, 4)).toBe(true)
    expect(f.calls.setPosition).toEqual([{ lineNumber: 4, column: 1 }])
    expect(f.calls.revealed).toEqual([4])
  })

  it('revealOffsetInFile sets the cursor at the offset’s line AND column (not column 1)', () => {
    // offset 23 → line 3, column 4 under the fake model mapping.
    expect(revealOffsetInFile(FILE, 23)).toBe(true)
    expect(f.calls.setPosition).toEqual([{ lineNumber: 3, column: 4 }])
    expect(f.calls.revealed).toEqual([3])
    expect(f.calls.focused).toBe(1)
  })

  it('both return false for an unknown file', () => {
    expect(revealLineInFile('nope', 1)).toBe(false)
    expect(revealOffsetInFile('nope', 1)).toBe(false)
  })
})

/**
 * #2017 — a reveal on a TOUCH device must not focus the editor: focusing its text
 * field is what summons the on-screen keyboard, over the panel that was just tapped.
 * The cursor still moves and the code still scrolls.
 */
describe('editorRegistry — a reveal and keyboard focus (#2017)', () => {
  const FILE = 'file-2017'
  let f: ReturnType<typeof fakeEditor>
  let asked: string[]

  /** a browser whose main pointer is, or is not, a finger */
  function device(touch: boolean) {
    asked = []
    vi.stubGlobal('matchMedia', (query: string) => {
      asked.push(query)
      return { matches: query === TOUCH_POINTER_QUERY ? touch : false }
    })
  }

  beforeEach(() => {
    f = fakeEditor()
    registerEditor(FILE, f.editor)
  })
  afterEach(() => {
    unregisterEditor(FILE, f.editor)
    vi.unstubAllGlobals()
  })

  it('with a mouse, both reveals focus the editor', () => {
    device(false)
    expect(revealTakesFocus()).toBe(true)
    revealLineInFile(FILE, 4)
    revealOffsetInFile(FILE, 23)
    expect(f.calls.focused).toBe(2)
    // the question put to the browser is the touch-pointer one, and only that
    expect(new Set(asked)).toEqual(new Set([TOUCH_POINTER_QUERY]))
  })

  it('on a touch device, neither reveal focuses the editor — and both still move the cursor and scroll', () => {
    device(true)
    expect(revealTakesFocus()).toBe(false)
    expect(revealLineInFile(FILE, 4)).toBe(true)
    expect(revealOffsetInFile(FILE, 23)).toBe(true)
    expect(f.calls.focused).toBe(0)
    expect(f.calls.setPosition).toEqual([
      { lineNumber: 4, column: 1 },
      { lineNumber: 3, column: 4 },
    ])
    expect(f.calls.revealed).toEqual([4, 3])
  })

  it('a browser that cannot be asked gets the mouse behaviour', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(revealTakesFocus()).toBe(true)
    revealOffsetInFile(FILE, 23)
    expect(f.calls.focused).toBe(1)
  })
})
