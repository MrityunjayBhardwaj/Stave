import { describe, it, expect, vi } from 'vitest'
import { commit, isCommitting, openGesture, closeGesture, type OffsetEdit } from '../writeback'
import { assignmentEdit } from '../assign/soundAssign'
import { fakeEditor } from './fakeEditor'

/**
 * #1900 — `commit` is the one way an operation's result reaches the open
 * document. These run it against `fakeEditor`, a small in-memory model with the
 * same surface `Writeback` drives, recording which source was up while each
 * change landed.
 */
describe('commit — an operation result into the document', () => {
  const doc = '$: s("bd").gain(0.5)'
  const gainArg: [number, number] = [doc.indexOf('0.5'), doc.indexOf('0.5') + 3]

  it('writes one edit, tagged with the source it was given', () => {
    const f = fakeEditor(doc)
    expect(commit(f.wb, { range: gainArg, text: '0.8' }, 'mixer')).toBe('written')
    expect(f.text()).toBe('$: s("bd").gain(0.8)')
    expect(f.changes).toEqual([{ source: 'mixer', text: '$: s("bd").gain(0.8)' }])
  })

  it('writes several edits as ONE change (one undo step)', () => {
    const f = fakeEditor(doc)
    const edits: OffsetEdit[] = [
      { range: gainArg, text: '1' },
      { range: [doc.indexOf('bd'), doc.indexOf('bd') + 2], text: 'hh' },
    ]
    expect(commit(f.wb, edits, 'rename')).toBe('written')
    expect(f.text()).toBe('$: s("hh").gain(1)')
    expect(f.changes).toHaveLength(1)
    expect(f.changes[0].source).toBe('rename')
    expect(f.undoStops()).toBe(2) // one boundary each side of the single change
  })

  it('an operation that returned nothing writes nothing', () => {
    const f = fakeEditor(doc)
    expect(commit(f.wb, null, 'knob')).toBe('nothing-to-write')
    expect(commit(f.wb, [], 'knob')).toBe('nothing-to-write')
    expect(f.changes).toEqual([])
    expect(f.undoStops()).toBe(0)
  })

  it('says so when there is no document to write to', () => {
    const f = fakeEditor(doc, { noModel: true })
    expect(commit(f.wb, { range: gainArg, text: '0.8' }, 'mixer')).toBe('no-document')
  })

  it('the source is down again once the edit has landed', () => {
    const f = fakeEditor(doc)
    commit(f.wb, { range: gainArg, text: '0.8' }, 'knob')
    expect(f.wb.currentSource).toBeNull()
  })
})

/**
 * #1906 — the two other forms of the door. Both reach the registry, which holds
 * the monaco namespace and the editors once per module instance, so each arm
 * takes a fresh module pair (the same reason `commitToFile.test`
 * resets per arm).
 */
async function freshDoor() {
  vi.resetModules()
  const reg = await import('../../workspace/editorRegistry')
  const door = await import('../writeback')
  return { reg, door }
}
class Range {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

describe('commitToEditor — the editor route without a writer in hand', () => {
  const doc = '$: s("bd")'
  const bd: [number, number] = [doc.indexOf('bd'), doc.indexOf('bd') + 2]

  it('writes, tagged, when Monaco is loaded', async () => {
    const { reg, door } = await freshDoor()
    reg.registerMonacoNamespace({ Range } as never)
    const f = fakeEditor(doc)
    const spy = vi.spyOn(door.Writeback.prototype, 'replaceRanges')
    expect(door.commitToEditor(f.editor as never, { range: bd, text: 'hh' }, 'rename')).toBe('written')
    expect(spy.mock.calls.map((c) => c[1])).toEqual(['rename'])
    expect(f.text()).toBe('$: s("hh")')
    expect(f.changes.map((c) => c.text)).toEqual(['$: s("hh")'])
  })

  it('says no-document (and writes nothing) before Monaco is loaded', async () => {
    const { door } = await freshDoor()
    const f = fakeEditor(doc)
    expect(door.commitToEditor(f.editor as never, { range: bd, text: 'hh' }, 'mixer')).toBe('no-document')
    expect(f.text()).toBe(doc)
  })

  it('nothing to write is nothing-to-write', async () => {
    const { reg, door } = await freshDoor()
    reg.registerMonacoNamespace({ Range } as never)
    const f = fakeEditor(doc)
    expect(door.commitToEditor(f.editor as never, null, 'mixer')).toBe('nothing-to-write')
    expect(f.changes).toEqual([])
  })
})

describe('commitToFile — the file route keeps its stale-document check', () => {
  const FILE = 'song.js'
  const doc = '$: s("bd").gain(0.5)'
  const g: [number, number] = [doc.indexOf('0.5'), doc.indexOf('0.5') + 3]

  it('applies one edit against the document it was computed from', async () => {
    const { reg, door } = await freshDoor()
    reg.registerMonacoNamespace({ Range } as never)
    const f = fakeEditor(doc)
    reg.registerEditor(FILE, f.editor as never)
    expect(door.commitToFile(FILE, { range: g, text: '0.8' }, 'mixer', doc)).toBe('applied')
    expect(f.text()).toBe('$: s("bd").gain(0.8)')
  })

  it('refuses a moved document as stale-document and writes nothing', async () => {
    const { reg, door } = await freshDoor()
    reg.registerMonacoNamespace({ Range } as never)
    const f = fakeEditor(doc)
    reg.registerEditor(FILE, f.editor as never)
    expect(door.commitToFile(FILE, { range: g, text: '0.8' }, 'mixer', doc + ' ')).toBe('stale-document')
    expect(f.text()).toBe(doc)
  })

  it('names the other refusals: no editor, nothing to write', async () => {
    const { reg, door } = await freshDoor()
    reg.registerMonacoNamespace({ Range } as never)
    expect(door.commitToFile('nope.js', { range: g, text: '0.8' }, 'mixer', doc)).toBe('no-editor')
    const f = fakeEditor(doc)
    reg.registerEditor(FILE, f.editor as never)
    expect(door.commitToFile(FILE, null, 'mixer', doc)).toBe('no-edits')
    expect(door.commitToFile(FILE, [], 'mixer', doc)).toBe('no-edits')
    expect(f.text()).toBe(doc)
  })
})

describe('assignmentEdit — a plan as the plain edit it stands for', () => {
  it('replace keeps its range; insert is zero-width at its offset', () => {
    expect(assignmentEdit({ kind: 'replace', range: [3, 7], text: "'piano'" })).toEqual({ range: [3, 7], text: "'piano'" })
    expect(assignmentEdit({ kind: 'insert', offset: 12, text: '\ns("bd")' })).toEqual({ range: [12, 12], text: '\ns("bd")' })
  })
})

/**
 * #1909 — the door's remaining forms, for a surface that keeps a writer: build it,
 * group a gesture's commits, and tell its own write from an external one.
 */
describe('createWriter / openGesture / closeGesture / isCommitting', () => {
  const doc = '$: s("bd").gain(0.5)'
  const g: [number, number] = [doc.indexOf('0.5'), doc.indexOf('0.5') + 3]

  it('createWriter is null before Monaco is loaded, and a working writer after', async () => {
    const { reg, door } = await freshDoor()
    const f = fakeEditor(doc)
    expect(door.createWriter(f.editor as never)).toBeNull()
    reg.registerMonacoNamespace({ Range } as never)
    const w = door.createWriter(f.editor as never)
    expect(w).not.toBeNull()
    expect(door.commit(w!, { range: g, text: '0.8' }, 'knob')).toBe('written')
    expect(f.text()).toBe('$: s("bd").gain(0.8)')
  })

  it('a gesture is ONE undo step and ONE re-eval, on close, however many commits it holds', async () => {
    vi.useFakeTimers()
    try {
      const { reg, door } = await freshDoor()
      reg.registerMonacoNamespace({ Range } as never)
      const f = fakeEditor(doc)
      reg.registerEditor('song.js', f.editor as never)
      const reevals: string[] = []
      reg.registerReevalHandler((id) => reevals.push(id))
      const w = door.createWriter(f.editor as never)!
      door.openGesture(w)
      door.openGesture(w) // opening an open gesture does nothing
      for (const v of ['0.6', '0.7', '0.8']) {
        const at = f.text().indexOf('gain(') + 5
        door.commit(w, { range: [at, f.text().indexOf(')', at)], text: v }, 'knob')
      }
      vi.advanceTimersByTime(500)
      expect(reevals).toEqual([]) // nothing re-evaluates mid-gesture
      const stopsBeforeClose = f.undoStops()
      door.closeGesture(w)
      door.closeGesture(w) // closing a closed gesture does nothing
      expect(f.changes).toHaveLength(3)
      expect(stopsBeforeClose).toBe(1) // only the boundary the open pushed
      expect(f.undoStops()).toBe(2) // ...and the one the close pushed: one undo step
      vi.advanceTimersByTime(500)
      expect(reevals).toEqual(['song.js'])
      expect(f.text()).toBe('$: s("bd").gain(0.8)')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a gesture that wrote nothing does not re-evaluate', async () => {
    vi.useFakeTimers()
    try {
      const { reg, door } = await freshDoor()
      reg.registerMonacoNamespace({ Range } as never)
      const f = fakeEditor(doc)
      reg.registerEditor('song.js', f.editor as never)
      const reevals: string[] = []
      reg.registerReevalHandler((id) => reevals.push(id))
      const w = door.createWriter(f.editor as never)!
      door.openGesture(w)
      door.closeGesture(w)
      vi.advanceTimersByTime(500)
      expect(reevals).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('isCommitting is true only inside this writer\'s own edit', () => {
    const f = fakeEditor(doc)
    const seen: boolean[] = []
    const other = fakeEditor(doc) // a second writer on its own document
    const model = f.editor.getModel()!
    const push = model.pushEditOperations
    model.pushEditOperations = (...a: Parameters<typeof push>) => {
      seen.push(isCommitting(f.wb), isCommitting(other.wb))
      return push(...a)
    }
    expect(isCommitting(f.wb)).toBe(false)
    commit(f.wb, { range: g, text: '0.8' }, 'seq')
    expect(seen).toEqual([true, false]) // up for its own writer, not for another
    expect(isCommitting(f.wb)).toBe(false)
    expect(isCommitting(null)).toBe(false)
  })

  it('the gesture forms tolerate a missing writer (no editor yet)', () => {
    expect(() => {
      openGesture(null)
      closeGesture(null)
    }).not.toThrow()
  })
})
