/**
 * Phase 20-07 wave β — useBreakpoints hook tests.
 *
 * Mirrors useHighlighting.test.ts: stub a Monaco editor surface, drive
 * the hook via renderHook + act, assert against the stub's mocks. The
 * IR snapshot store is real (the hook subscribes to the module-level
 * `subscribeIRSnapshot` / `getIRSnapshot`), so each test publishes a
 * snapshot via `publishIRSnapshot` to control what the hook sees.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBreakpoints } from '../useBreakpoints'
import { BreakpointStore } from '../../engine/BreakpointStore'
import {
  publishIRSnapshot,
  clearIRSnapshot,
  type IRSnapshot,
} from '../../engine/irInspector'
import type { IREvent } from '../../codeView/ir/IREvent'

// ---- Mock factory helpers ----

interface MockCollection {
  set: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  append: ReturnType<typeof vi.fn>
}

function makeCollection(): MockCollection {
  return {
    set: vi.fn(),
    clear: vi.fn(),
    append: vi.fn(),
  }
}

function makeModel() {
  return {
    getPositionAt: vi.fn((offset: number) => ({ lineNumber: 1, column: offset + 1 })),
  }
}

function makeEditor() {
  const collections: MockCollection[] = []
  let mouseDownHandler: ((e: { target: { type: number; position?: { lineNumber: number } } }) => void) | null = null
  const registeredActions: Array<{
    id: string
    label: string
    run: (...args: unknown[]) => void
    dispose: ReturnType<typeof vi.fn>
  }> = []
  const editor = {
    createDecorationsCollection: vi.fn(() => {
      const c = makeCollection()
      collections.push(c)
      return c
    }),
    getModel: vi.fn(() => makeModel()),
    onMouseDown: vi.fn((handler: (e: { target: { type: number; position?: { lineNumber: number } } }) => void) => {
      mouseDownHandler = handler
      return { dispose: vi.fn() }
    }),
    addAction: vi.fn(
      (descriptor: { id: string; label: string; run: (...args: unknown[]) => void }) => {
        const dispose = vi.fn()
        const entry = { id: descriptor.id, label: descriptor.label, run: descriptor.run, dispose }
        registeredActions.push(entry)
        return { dispose }
      },
    ),
    collections,
    actions: registeredActions,
    fireMouseDown: (target: { type: number; position?: { lineNumber: number } }) => {
      if (mouseDownHandler) mouseDownHandler({ target })
    },
  }
  return editor
}

/** Build a minimal IR event for snapshot fixtures. */
function makeEvent(irNodeId: string, locStart: number, locEnd: number): IREvent {
  return {
    irNodeId,
    loc: [{ start: locStart, end: locEnd }],
    time: 0,
    duration: 1,
    value: {},
  } as unknown as IREvent
}

/** Publish a snapshot built from { line → ids } where each id maps to a
 *  single event whose loc starts on that line. The exact start offset
 *  doesn't matter for the hook — it reads `irNodeIdsByLine` directly,
 *  which is built by `enrichWithLookups` from the supplied `code`. */
function publishLineSnapshot(map: Record<number, string[]>): void {
  // Build code with N lines so countLines resolves to the requested line.
  const maxLine = Math.max(...Object.keys(map).map((s) => Number(s)), 1)
  const codeLines: string[] = []
  for (let i = 1; i <= maxLine; i++) codeLines.push(`// line ${i}`)
  const code = codeLines.join('\n')

  // Compute byte offsets for each requested line's start.
  const lineOffsets: Record<number, number> = {}
  let acc = 0
  for (let i = 1; i <= maxLine; i++) {
    lineOffsets[i] = acc
    acc += codeLines[i - 1]!.length + 1 // +1 for '\n'
  }

  const events: IREvent[] = []
  for (const lineStr of Object.keys(map)) {
    const line = Number(lineStr)
    for (const id of map[line]!) {
      events.push(makeEvent(id, lineOffsets[line]!, lineOffsets[line]! + 5))
    }
  }

  publishIRSnapshot({
    ts: Date.now(),
    runtime: 'strudel',
    code,
    passes: [],
    // The hook only reads `events` indirectly (via the lookups computed
    // from this) plus `ir` is required by the type — provide a stub.
    ir: { nodes: [], edges: [], roots: [] } as never,
    events,
  })
}

describe('20-07 — useBreakpoints (Monaco gutter)', () => {
  beforeEach(() => {
    clearIRSnapshot()
  })

  afterEach(() => {
    clearIRSnapshot()
  })

  it('(BP-01) renders stave-bp-active when id resolves in current snapshot', () => {
    const editor = makeEditor()
    const store = new BreakpointStore()

    publishLineSnapshot({ 3: ['idA'] })
    store.add('idA')

    renderHook(() => useBreakpoints(editor as never, store))

    // First render: store has idA, snapshot has idA on line 3 →
    // createDecorationsCollection called with one item, class 'stave-bp-active'.
    expect(editor.createDecorationsCollection).toHaveBeenCalled()
    const calls = editor.createDecorationsCollection.mock.calls as unknown as unknown[][]
    const decorations = calls[0]![0] as Array<{
      range: { startLineNumber: number }
      options: { glyphMarginClassName: string }
    }>
    expect(decorations).toHaveLength(1)
    expect(decorations[0]!.range.startLineNumber).toBe(3)
    expect(decorations[0]!.options.glyphMarginClassName).toBe('stave-bp-active')
  })

  it('(BP-02 / R-3) renders stave-bp-orphaned at lineHint when id is not in snapshot', () => {
    const editor = makeEditor()
    const store = new BreakpointStore()

    // Snapshot has idOther but NOT idOrphan.
    publishLineSnapshot({ 2: ['idOther'] })
    store.add('idOrphan', { lineHint: 5 })

    renderHook(() => useBreakpoints(editor as never, store))

    expect(editor.createDecorationsCollection).toHaveBeenCalled()
    const calls = editor.createDecorationsCollection.mock.calls as unknown as unknown[][]
    const decorations = calls[0]![0] as Array<{
      range: { startLineNumber: number }
      options: { glyphMarginClassName: string }
    }>
    expect(decorations).toHaveLength(1)
    expect(decorations[0]!.range.startLineNumber).toBe(5)
    expect(decorations[0]!.options.glyphMarginClassName).toBe('stave-bp-orphaned')
  })

  it('(BP-03 / R-3) orphan id without lineHint is silently skipped (no decoration)', () => {
    const editor = makeEditor()
    const store = new BreakpointStore()

    publishLineSnapshot({ 2: ['idOther'] })
    // Inspector-side orphan: no lineHint at registration time.
    store.add('inspector-orphan')

    renderHook(() => useBreakpoints(editor as never, store))

    // Either no collection was created (entries.size > 0 path bailed mid-loop)
    // or the collection was created with an empty list. Both are valid
    // expressions of "silently skipped" — assert no decoration with a class.
    const allCalls = editor.createDecorationsCollection.mock.calls as unknown as unknown[][]
    for (const call of allCalls) {
      const decs = call[0] as Array<{ options: { glyphMarginClassName?: string } }>
      for (const d of decs) {
        expect(d.options.glyphMarginClassName).toBeUndefined()
      }
    }
  })

  it('(BP-04) gutter click resolves line → irNodeIdsByLine and calls store.toggleSet', () => {
    const editor = makeEditor()
    const store = new BreakpointStore()
    const toggleSetSpy = vi.spyOn(store, 'toggleSet')

    publishLineSnapshot({ 4: ['idX', 'idY'] })

    renderHook(() => useBreakpoints(editor as never, store))

    // Simulate a gutter click on line 4.
    act(() => {
      editor.fireMouseDown({ type: 2, position: { lineNumber: 4 } })
    })

    expect(toggleSetSpy).toHaveBeenCalledTimes(1)
    expect(toggleSetSpy).toHaveBeenCalledWith(['idX', 'idY'], { lineHint: 4 })
    // Verify the store now contains both ids.
    expect(store.has('idX')).toBe(true)
    expect(store.has('idY')).toBe(true)
  })

  it('(BP-05) cleans up subscriptions and clears decorations on unmount', () => {
    const editor = makeEditor()
    const store = new BreakpointStore()

    publishLineSnapshot({ 1: ['idA'] })
    store.add('idA')

    const { unmount } = renderHook(() => useBreakpoints(editor as never, store))
    expect(editor.createDecorationsCollection).toHaveBeenCalledTimes(1)
    const collection = editor.collections[0]!

    unmount()
    expect(collection.clear).toHaveBeenCalled()

    // After unmount, the store's listener set should be empty — toggling
    // doesn't trigger any re-render path on the (now unmounted) hook.
    const beforeCallCount = editor.createDecorationsCollection.mock.calls.length
    act(() => {
      store.toggle('idB', { lineHint: 2 })
    })
    expect(editor.createDecorationsCollection.mock.calls.length).toBe(beforeCallCount)
  })

  it('(BP-06) ignores non-glyph-margin clicks (target.type !== 2)', () => {
    const editor = makeEditor()
    const store = new BreakpointStore()
    const toggleSetSpy = vi.spyOn(store, 'toggleSet')

    publishLineSnapshot({ 4: ['idX'] })
    renderHook(() => useBreakpoints(editor as never, store))

    // target.type === 6 (CONTENT_TEXT) — not the gutter glyph margin.
    act(() => {
      editor.fireMouseDown({ type: 6, position: { lineNumber: 4 } })
    })
    expect(toggleSetSpy).not.toHaveBeenCalled()
  })

  it('(BP-07 / R-1) registers stave.debugger.resume action when onResume provided; run() invokes onResume', () => {
    const editor = makeEditor()
    const store = new BreakpointStore()
    const onResume = vi.fn()

    renderHook(() => useBreakpoints(editor as never, store, onResume))

    expect(editor.addAction).toHaveBeenCalledTimes(1)
    const entry = editor.actions.find((a) => a.id === 'stave.debugger.resume')
    expect(entry).toBeDefined()
    expect(entry!.label).toBe('Debugger: Resume')

    // Invoking the action's run() must call the supplied onResume closure.
    entry!.run()
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('(BP-07b) does NOT register the resume action when onResume is omitted', () => {
    const editor = makeEditor()
    const store = new BreakpointStore()

    renderHook(() => useBreakpoints(editor as never, store))

    // No action registered — keeps the hook a no-op for non-debugger editors.
    expect(editor.addAction).not.toHaveBeenCalled()
  })
})
