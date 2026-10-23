/**
 * #2184 / #2185 — a squiggle's error follows the code around it, and comes off
 * when the text it underlined is edited. The model here keeps decorations the
 * way Monaco does for a range that never grows at its edges: an edit before a
 * range moves it, an edit inside changes its text, typing at its edges leaves
 * it alone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  installEngineLogMarkers,
  errorPositionNow,
  subscribeErrorPositions,
  __resetEngineLogMarkersForTests,
} from '../engineLogMarkers'
import { emitLog, emitFixed, getLogHistory, __resetEngineLogForTests } from '../../engine/engineLog'
import { registerEditor, registerMonacoNamespace, unregisterEditor } from '../editorRegistry'
import { createWorkspaceFile, deleteWorkspaceFile, listWorkspaceFiles } from '../WorkspaceFile'

interface Range { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

/** A text model with just enough of Monaco's: offsets ↔ positions, and tracked ranges. */
function makeModel(initial: string) {
  let text = initial
  const decorations = new Map<string, { start: number; end: number }>()
  const listeners = new Set<() => void>()
  const disposeListeners = new Set<() => void>()
  let disposed = false
  let next = 0
  const offsetOf = (line: number, column: number): number => {
    const lines = text.split('\n')
    let o = 0
    for (let i = 0; i < line - 1; i++) o += lines[i].length + 1
    return o + column - 1
  }
  const posOf = (o: number): { line: number; column: number } => {
    const before = text.slice(0, o).split('\n')
    return { line: before.length, column: before[before.length - 1].length + 1 }
  }
  const model = {
    getLineCount: () => text.split('\n').length,
    getLineMaxColumn: (line: number) => text.split('\n')[line - 1].length + 1,
    getLineFirstNonWhitespaceColumn: (line: number) => (text.split('\n')[line - 1].search(/\S/) + 1) || 1,
    getWordAtPosition: ({ lineNumber, column }: { lineNumber: number; column: number }) => {
      const l = text.split('\n')[lineNumber - 1]
      const re = /\w+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(l))) {
        if (m.index + 1 <= column && column <= m.index + 1 + m[0].length) {
          return { word: m[0], startColumn: m.index + 1, endColumn: m.index + 1 + m[0].length }
        }
      }
      return null
    },
    getValueInRange: (r: Range) => text.slice(offsetOf(r.startLineNumber, r.startColumn), offsetOf(r.endLineNumber, r.endColumn)),
    deltaDecorations: (old: string[], add: { range: Range }[]) => {
      for (const id of old) decorations.delete(id)
      return add.map(({ range }) => {
        const id = `d${next++}`
        decorations.set(id, { start: offsetOf(range.startLineNumber, range.startColumn), end: offsetOf(range.endLineNumber, range.endColumn) })
        return id
      })
    },
    getDecorationRange: (id: string): Range | null => {
      if (disposed) throw new Error('Model is disposed!')
      const d = decorations.get(id)
      if (!d) return null
      const a = posOf(d.start)
      const b = posOf(d.end)
      return { startLineNumber: a.line, startColumn: a.column, endLineNumber: b.line, endColumn: b.column }
    },
    onDidChangeContent: (fn: () => void) => {
      listeners.add(fn)
      return { dispose: () => listeners.delete(fn) }
    },
    onWillDispose: (fn: () => void) => {
      disposeListeners.add(fn)
      return { dispose: () => disposeListeners.delete(fn) }
    },
    /** as closing the file does; `quietly` skips telling anyone first */
    dispose(quietly = false) {
      if (!quietly) for (const fn of disposeListeners) fn()
      disposed = true
    },
    /** replace `[at, at + remove)` with `insert`, moving ranges as Monaco does */
    edit(at: number, remove: number, insert: string) {
      text = text.slice(0, at) + insert + text.slice(at + remove)
      const delta = insert.length - remove
      for (const d of decorations.values()) {
        if (at + remove <= d.start) { d.start += delta; d.end += delta } // before: moves
        else if (at < d.end) d.end = Math.max(d.start, d.end + delta) // inside: text changes
      }
      for (const fn of listeners) fn()
    },
    text: () => text,
  }
  return model
}

const setModelMarkers = vi.fn()
registerMonacoNamespace({
  editor: { setModelMarkers, TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 } },
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
})

const SRC = 'patterns/follow.strudel'
let model: ReturnType<typeof makeModel>
let editor: { getModel: () => unknown }
let fileId: string
const flush = (): Promise<void> => new Promise<void>((r) => queueMicrotask(() => r()))
const lastMarkers = () => setModelMarkers.mock.calls[setModelMarkers.mock.calls.length - 1][2]

async function ginError(): Promise<string> {
  emitLog({ level: 'error', runtime: 'strudel', source: SRC, line: 1, column: 26, message: 'note(...).s(...).gin is not a function' })
  await flush()
  return getLogHistory()[getLogHistory().length - 1].id
}

beforeEach(() => {
  setModelMarkers.mockReset()
  __resetEngineLogForTests()
  __resetEngineLogMarkersForTests()
  for (const f of listWorkspaceFiles()) deleteWorkspaceFile(f.id)
  model = makeModel('$: note("c e").s("sine").gin(0.2)\n')
  editor = { getModel: () => model }
  fileId = createWorkspaceFile('f-follow', SRC, model.text(), 'strudel').id
  registerEditor(fileId, editor)
  installEngineLogMarkers()
  return () => unregisterEditor(fileId, editor)
})

describe('#2184 — the error follows the code', () => {
  it('moves down when lines are typed above it', async () => {
    const id = await ginError()
    expect(errorPositionNow(id)).toEqual({ line: 1, column: 26 })
    model.edit(0, 0, '// a\n// b\n')
    expect(errorPositionNow(id)).toEqual({ line: 3, column: 26 })
  })

  it('tells listeners when an edit moves it, and only then', async () => {
    await ginError()
    const heard = vi.fn()
    const stop = subscribeErrorPositions(heard)
    model.edit(model.text().indexOf('0.2'), 3, '0.5') // same line: nothing moved
    expect(heard).not.toHaveBeenCalled()
    model.edit(0, 0, '\n')
    expect(heard).toHaveBeenCalledTimes(1)
    stop()
  })

  it('a closed file has nothing to follow, and asking does not throw', async () => {
    const id = await ginError()
    const heard = vi.fn()
    const stop = subscribeErrorPositions(heard)
    model.dispose()
    expect(heard).toHaveBeenCalled() // the Console row drops the line it was following
    expect(errorPositionNow(id)).toBeNull()
    stop()
  })

  it('asking about a model disposed without notice does not throw', async () => {
    const id = await ginError()
    model.dispose(true)
    expect(() => errorPositionNow(id)).not.toThrow()
    expect(errorPositionNow(id)).toBeNull()
  })

  it('a repeat of the same error keeps the place it has followed', async () => {
    const id = await ginError()
    model.edit(0, 0, '// a\n')
    const calls = setModelMarkers.mock.calls.length
    expect(await ginError()).toBe(id) // the log merges the repeat into the same entry
    expect(errorPositionNow(id)).toEqual({ line: 2, column: 26 })
    expect(setModelMarkers.mock.calls.length).toBe(calls) // not put back on line 1
  })

  it('a repeat keeps its place even when the old line reads the same again', async () => {
    // a copy of the line typed above it: line 1 still says `gin` at column 26
    const id = await ginError()
    model.edit(0, 0, '$: note("c e").s("sine").gin(0.2)\n')
    const calls = setModelMarkers.mock.calls.length
    await ginError()
    expect(errorPositionNow(id)).toEqual({ line: 2, column: 26 })
    expect(setModelMarkers.mock.calls.length).toBe(calls)
  })

  it('has nothing to follow after a clean run', async () => {
    const id = await ginError()
    emitFixed({ runtime: 'strudel', source: SRC })
    await flush()
    expect(errorPositionNow(id)).toBeNull()
  })
})

describe('#2185 — the squiggle comes off when its word is edited', () => {
  it('fixing the word takes the squiggle off', async () => {
    await ginError()
    model.edit(model.text().indexOf('gin') + 1, 0, 'a') // gin → gain
    expect(lastMarkers()).toEqual([])
  })

  it('an edit elsewhere leaves it on, at its new place', async () => {
    await ginError()
    const calls = setModelMarkers.mock.calls.length
    model.edit(0, 0, '// a\n')
    model.edit(model.text().indexOf('0.2'), 3, '0.5')
    expect(setModelMarkers.mock.calls.length).toBe(calls)
  })

  it('the same error after an undo puts it back; after the fix it stays off', async () => {
    const id = await ginError()
    const at = model.text().indexOf('gin')
    model.edit(at + 1, 0, 'a') // gain
    expect(await ginError()).toBe(id) // e.g. raised again while the old code plays
    expect(lastMarkers()).toEqual([])
    model.edit(at + 1, 1, '') // undo: gin again
    await ginError()
    expect(lastMarkers()).toMatchObject([{ startLineNumber: 1, startColumn: 26, endColumn: 29 }])
  })
})

describe('#2186 — mistakes found beside the run\'s error each keep a squiggle', () => {
  const TWO = '$: s("bd").gin(1)\n$: s("hh").fooo(2)\n'
  /** the run's error at `gin`, then `fooo` found beside it; their entry ids */
  async function failedRun(): Promise<{ gin: string; fooo: string }> {
    const gin = emitLog({ level: 'error', runtime: 'strudel', source: SRC, line: 1, column: 12, message: 's(...).gin is not a function' }).id
    const fooo = emitLog({ level: 'error', runtime: 'strudel', source: SRC, line: 2, column: 12, message: 's(...).fooo is not a function', alongside: gin }).id
    await flush()
    return { gin, fooo }
  }
  const words = () => (lastMarkers() as Range[]).map((r) => `${r.startLineNumber}:${r.startColumn} ${model.getValueInRange(r)}`)
  beforeEach(() => model.edit(0, model.text().length, TWO))

  it('both are underlined, and both follow the code', async () => {
    const { gin, fooo } = await failedRun()
    expect(words()).toEqual(['1:12 gin', '2:12 fooo'])
    model.edit(0, 0, '// drums\n')
    expect(errorPositionNow(gin)).toEqual({ line: 2, column: 12 })
    expect(errorPositionNow(fooo)).toEqual({ line: 3, column: 12 })
  })

  it('a third found beside the run keeps the second as well', async () => {
    model.edit(model.text().length, 0, '$: s("sd").roomm(1)\n')
    const { gin } = await failedRun()
    emitLog({ level: 'error', runtime: 'strudel', source: SRC, line: 3, column: 12, message: 's(...).roomm is not a function', alongside: gin })
    await flush()
    expect(words()).toEqual(['1:12 gin', '2:12 fooo', '3:12 roomm'])
  })

  it('fixing one takes off only its squiggle', async () => {
    await failedRun()
    model.edit(model.text().indexOf('fooo'), 4, 'fast')
    expect(words()).toEqual(['1:12 gin'])
  })

  it('the same failing run again changes nothing', async () => {
    const ids = await failedRun()
    const calls = setModelMarkers.mock.calls.length
    expect(await failedRun()).toEqual(ids)
    expect(setModelMarkers.mock.calls.length).toBe(calls)
  })

  it('a later run\'s error replaces them all, as one error always has', async () => {
    await failedRun()
    emitLog({ level: 'error', runtime: 'strudel', source: SRC, line: 2, column: 4, message: 'nope is not defined' })
    await flush()
    expect(words()).toEqual(['2:4 s'])
  })

  it('one found beside a run that placed nothing replaces the last run\'s', async () => {
    await failedRun()
    emitLog({ level: 'error', runtime: 'strudel', source: SRC, message: 'no line' })
    await flush()
    const unplaced = getLogHistory()[getLogHistory().length - 1].id
    emitLog({ level: 'error', runtime: 'strudel', source: SRC, line: 2, column: 12, message: 's(...).fasst is not a function', alongside: unplaced })
    await flush()
    expect(words()).toEqual(['2:12 fooo']) // the new one alone: `gin`'s is gone
  })

  it('once the first is fixed, the run stops at the one found beside it, which now stands alone', async () => {
    const { fooo } = await failedRun()
    model.edit(model.text().indexOf('gin'), 3, 'gain')
    // the next run reports `fooo` itself: the log merges it into the same row
    emitLog({ level: 'error', runtime: 'strudel', source: SRC, line: 2, column: 12, message: 's(...).fooo is not a function' })
    await flush()
    const row = getLogHistory().find((e) => e.id === fooo)!
    expect(row.alongside).toBeUndefined()
    expect(errorPositionNow(fooo)).toEqual({ line: 2, column: 12 })
  })
})
