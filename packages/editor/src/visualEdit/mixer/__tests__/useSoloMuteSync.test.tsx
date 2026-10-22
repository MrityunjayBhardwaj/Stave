/**
 * `useSoloMuteSync` through the door (#1909): a solo click commits the mute
 * markers `soloMuteEdits` decides as ONE undo step, and the pre-solo snapshot moves
 * on only when there was a document to write to.
 */
import { describe, it, expect, vi } from 'vitest'
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
let monacoLoaded = true
let fileId = 'a.js'
vi.mock('../../../workspace/editorRegistry', () => ({
  getActiveEditor: () => f.editor,
  getActiveFileId: () => fileId,
  onActiveEditorChange: () => () => {},
  getMonacoNamespace: () => (monacoLoaded ? { Range } : null),
  requestReeval: () => {},
  getFileIdForEditor: () => fileId,
}))

import { useSoloMuteSync } from '../soloMuteSync'
import { getPreSoloMutes } from '../soloStore'

let toggle: (id: string) => void
function Harness(): React.ReactElement {
  toggle = useSoloMuteSync().toggle
  return React.createElement('div')
}

const DOC = 'd1: s("bd*4")\nd2: s("hh*8")\n_d3: s("~ sd")\n'

describe('useSoloMuteSync through the door (#1909)', () => {
  it('a solo writes the other tracks\' markers as one undo step and stores the snapshot', () => {
    monacoLoaded = true
    fileId = 'a.js'
    f = fakeEditor(DOC)
    render(React.createElement(Harness))
    act(() => toggle('d1'))
    expect(f.text()).toBe('d1: s("bd*4")\n_d2: s("hh*8")\n_d3: s("~ sd")\n')
    expect(f.changes).toHaveLength(1)
    expect(f.undoStops()).toBe(2)
    expect([...(getPreSoloMutes('a.js') ?? [])]).toEqual(['d3'])
  })

  it('with no document to write to, nothing is written and the snapshot does not move', () => {
    monacoLoaded = false
    fileId = 'b.js'
    f = fakeEditor(DOC)
    render(React.createElement(Harness))
    act(() => toggle('d1'))
    expect(f.text()).toBe(DOC)
    expect(getPreSoloMutes('b.js')).toBeNull()
  })
})
