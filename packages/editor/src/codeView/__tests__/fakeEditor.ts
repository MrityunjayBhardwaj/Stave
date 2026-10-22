/**
 * A small in-memory Monaco editor with the surface `Writeback` drives (offset ↔
 * position, `pushEditOperations`, undo boundaries, content listeners). Records
 * every change with the source that was up while it landed, and counts undo
 * boundaries. Shared by the door's tests (#1900, #1906) and the panel bindings
 * built on it (#1909).
 */
import type * as Monaco from 'monaco-editor'
import { Writeback, type WriteSource } from '../writeback'

export function fakeEditor(initial: string, opts: { noModel?: boolean } = {}) {
  let text = initial
  const changes: { source: WriteSource | null; text: string }[] = []
  let undoStops = 0
  let wb: Writeback | null = null
  let listeners: (() => void)[] = []
  const offsetOf = (p: { lineNumber: number; column: number }): number => {
    const lines = text.split('\n')
    let off = 0
    for (let i = 0; i < p.lineNumber - 1; i++) off += lines[i].length + 1
    return off + p.column - 1
  }
  const model = {
    getValue: () => text,
    getPositionAt: (offset: number) => {
      const before = text.slice(0, offset).split('\n')
      return { lineNumber: before.length, column: before[before.length - 1].length + 1 }
    },
    pushStackElement: () => {
      undoStops++
    },
    pushEditOperations: (
      _sel: unknown,
      ops: { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; text: string }[],
    ) => {
      const spans = ops
        .map((o) => ({
          s: offsetOf({ lineNumber: o.range.startLineNumber, column: o.range.startColumn }),
          e: offsetOf({ lineNumber: o.range.endLineNumber, column: o.range.endColumn }),
          t: o.text,
        }))
        .sort((a, b) => b.s - a.s)
      for (const { s, e, t } of spans) text = text.slice(0, s) + t + text.slice(e)
      changes.push({ source: wb?.currentSource ?? null, text })
      for (const l of [...listeners]) l()
      return null
    },
    onDidChangeContent: (l: () => void) => {
      listeners.push(l)
      return { dispose: () => (listeners = listeners.filter((x) => x !== l)) }
    },
  }
  const editor = { getModel: () => (opts.noModel ? null : model) }
  const monaco = {
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
  }
  wb = new Writeback(
    editor as unknown as Monaco.editor.IStandaloneCodeEditor,
    monaco as unknown as typeof Monaco,
  )
  return { wb, editor, changes, text: () => text, undoStops: () => undoStops }
}
