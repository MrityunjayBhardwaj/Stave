/**
 * `useMixerModel.applyToMasterChunk` through the door (#1909).
 *
 * The master's expand drawer adds an effect to the master `all()` line. When the
 * document has no audio line yet, the hook first writes the base `all(x => x)` and
 * then the effect onto it — two edits, the second computed from the document after
 * the first — and the user must get ONE undo step back. These drive the real hook
 * against an in-memory editor and count the changes and undo boundaries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as React from 'react'
import { render, act } from '@testing-library/react'

import { fakeEditor } from '../../../codeView/__tests__/fakeEditor'

class Range {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

let f: ReturnType<typeof fakeEditor>
vi.mock('../../../workspace/editorRegistry', () => ({
  getActiveEditor: () => f.editor,
  onActiveEditorChange: () => () => {},
  getMonacoNamespace: () => ({ Range }),
  requestReeval: () => {},
  getFileIdForEditor: () => 'test-file',
}))

import { commit, type ChunkInfo, type Writeback } from '../../../codeView'
import { useMixerModel } from '../useMixerModel'

let applyToMasterChunk: (mutate: (fresh: ChunkInfo, wb: Writeback) => void) => void
function Harness(): React.ReactElement {
  applyToMasterChunk = useMixerModel().applyToMasterChunk
  return React.createElement('div')
}

/** what the drawer's ＋More does: append an effect at the end of the arrow body */
const addRoom = (fresh: ChunkInfo, wb: Writeback): void => {
  commit(wb, { range: [fresh.exprRange[1], fresh.exprRange[1]], text: '.room(0.4)' }, 'knob')
}

describe('applyToMasterChunk through the door (#1909)', () => {
  beforeEach(() => {
    f = undefined as never
  })

  it('no master line yet: the base line and the effect land as ONE undo step', () => {
    f = fakeEditor('$: s("bd")\n')
    render(React.createElement(Harness))
    act(() => applyToMasterChunk(addRoom))
    expect(f.text()).toBe('$: s("bd")\nall(x => x.room(0.4))')
    expect(f.changes).toHaveLength(2) // the base line, then the effect
    expect(f.undoStops()).toBe(2) // one gesture: a boundary each side of both
  })

  it('a master line already there: the effect is its own single undo step', () => {
    f = fakeEditor('$: s("bd")\nall(x => x.gain(0.8))\n')
    render(React.createElement(Harness))
    act(() => applyToMasterChunk(addRoom))
    expect(f.text()).toBe('$: s("bd")\nall(x => x.gain(0.8).room(0.4))\n')
    expect(f.changes).toHaveLength(1)
    expect(f.undoStops()).toBe(2)
  })
})
