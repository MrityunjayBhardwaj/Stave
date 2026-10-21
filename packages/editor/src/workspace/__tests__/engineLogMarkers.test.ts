import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  installEngineLogMarkers,
  __resetEngineLogMarkersForTests,
} from '../engineLogMarkers'
import {
  emitLog,
  emitFixed,
  __resetEngineLogForTests,
} from '../../engine/engineLog'
import {
  registerEditor,
  registerMonacoNamespace,
  unregisterEditor,
} from '../editorRegistry'
import {
  createWorkspaceFile,
  deleteWorkspaceFile,
  listWorkspaceFiles,
} from '../WorkspaceFile'

// Shared fake-Monaco — `registerMonacoNamespace` captures on first call
// and stays captured for the life of the process, so every test must
// share the same namespace object and just reset the spy.
const setModelMarkers = vi.fn()
const fakeMonaco = {
  editor: { setModelMarkers },
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
}
registerMonacoNamespace(fakeMonaco)

function makeFakeEditor() {
  const model = { getLineCount: () => 20, getLineMaxColumn: () => 80 }
  return { getModel: () => model }
}

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => queueMicrotask(() => resolve()))

// Clean every workspace file between tests so stale paths from a prior
// test don't satisfy `findFileIdForSource` with the wrong id.
function wipeWorkspace(): void {
  for (const f of listWorkspaceFiles()) {
    deleteWorkspaceFile(f.id)
  }
}

beforeEach(() => {
  setModelMarkers.mockReset()
  __resetEngineLogForTests()
  __resetEngineLogMarkersForTests()
  wipeWorkspace()
})

describe('installEngineLogMarkers', () => {
  it('is idempotent — re-install does not double-subscribe', async () => {
    const editor = makeFakeEditor()
    const file = createWorkspaceFile(
      'f-beat',
      'patterns/beat.strudel',
      '',
      'strudel',
    )
    registerEditor(file.id, editor)

    installEngineLogMarkers()
    installEngineLogMarkers()

    emitLog({
      level: 'error',
      runtime: 'strudel',
      source: 'patterns/beat.strudel',
      line: 3,
      message: 'x is not defined',
    })
    await flush()

    expect(setModelMarkers).toHaveBeenCalledTimes(1)

    unregisterEditor(file.id, editor)
  })

  it('places an inline marker when a log entry carries source + line', async () => {
    const editor = makeFakeEditor()
    const file = createWorkspaceFile(
      'f-wave',
      'viz/wave.hydra',
      '',
      'hydra',
    )
    registerEditor(file.id, editor)
    installEngineLogMarkers()

    emitLog({
      level: 'error',
      runtime: 'hydra',
      source: 'viz/wave.hydra',
      line: 5,
      column: 2,
      message: 'fft is not a function',
    })
    await flush()

    expect(setModelMarkers).toHaveBeenCalledOnce()
    const [, owner, markers] = setModelMarkers.mock.calls[0]
    expect(owner).toBe('stave-log')
    expect(markers[0]).toMatchObject({
      startLineNumber: 5,
      startColumn: 2,
      severity: 8,
    })

    unregisterEditor(file.id, editor)
  })

  it('ignores entries without source or line', async () => {
    installEngineLogMarkers()

    emitLog({
      level: 'error',
      runtime: 'strudel',
      source: 'a.strudel',
      message: 'no line',
    })
    emitLog({
      level: 'error',
      runtime: 'strudel',
      line: 3,
      message: 'no source',
    })
    await flush()

    expect(setModelMarkers).not.toHaveBeenCalled()
  })

  it('clears the file’s log-owner markers on a matching emitFixed', async () => {
    const editor = makeFakeEditor()
    const file = createWorkspaceFile(
      'f-loop',
      'patterns/loop.strudel',
      '',
      'strudel',
    )
    registerEditor(file.id, editor)
    installEngineLogMarkers()

    emitLog({
      level: 'error',
      runtime: 'strudel',
      source: 'patterns/loop.strudel',
      line: 2,
      message: 'broken',
    })
    await flush()

    emitFixed({
      runtime: 'strudel',
      source: 'patterns/loop.strudel',
    })
    await flush()

    const lastCall = setModelMarkers.mock.calls.at(-1)
    expect(lastCall?.[1]).toBe('stave-log')
    expect(lastCall?.[2]).toEqual([])

    unregisterEditor(file.id, editor)
  })

  it('silently drops entries whose source is an unknown workspace path', async () => {
    installEngineLogMarkers()

    emitLog({
      level: 'error',
      runtime: 'strudel',
      source: 'does/not/exist.strudel',
      line: 2,
      message: 'ghost',
    })
    await flush()

    expect(setModelMarkers).not.toHaveBeenCalled()
  })

  it('skips marker when parsed line is past the model (avoids painting whole file)', async () => {
    const editor = makeFakeEditor()
    const file = createWorkspaceFile(
      'f-tiny',
      'tiny.p5',
      '',
      'p5',
    )
    registerEditor(file.id, editor)
    installEngineLogMarkers()

    // Fake model has 20 lines (see makeFakeEditor). Line 999 would have
    // clamped to full-doc under the old setLineMarker fallback.
    emitLog({
      level: 'error',
      runtime: 'p5',
      source: 'tiny.p5',
      line: 999,
      message: 'SyntaxError',
    })
    await flush()

    expect(setModelMarkers).not.toHaveBeenCalled()

    unregisterEditor(file.id, editor)
  })

  it('attaches the suggestion name to the marker hover text', async () => {
    const editor = makeFakeEditor()
    const file = createWorkspaceFile(
      'f-sug',
      'a.strudel',
      '',
      'strudel',
    )
    registerEditor(file.id, editor)
    installEngineLogMarkers()

    emitLog({
      level: 'error',
      runtime: 'strudel',
      source: 'a.strudel',
      line: 1,
      message: '`nots` is not defined.',
      suggestion: { name: 'note', docsUrl: '/docs/strudel/#note' },
    })
    await flush()

    const [, , markers] = setModelMarkers.mock.calls[0]
    expect(markers[0].message).toContain('note')

    unregisterEditor(file.id, editor)
  })

  // #2170 — a hint that is not about one symbol carries a suggestion with no name
  // (for its example, or its link); the marker must not offer to "try" nothing.
  it('says no "try" when the suggestion names no symbol', async () => {
    const editor = makeFakeEditor()
    const file = createWorkspaceFile('f-nosym', 'b.strudel', '', 'strudel')
    registerEditor(file.id, editor)
    installEngineLogMarkers()

    emitLog({
      level: 'error',
      runtime: 'strudel',
      source: 'b.strudel',
      line: 1,
      message: '`gamepad` is part of Strudel, but it isn\'t in Stave yet.',
      suggestion: { name: '', linkLabel: '#128', docsUrl: 'https://github.com/MrityunjayBhardwaj/stave/issues/128' },
    })
    await flush()

    const [, , markers] = setModelMarkers.mock.calls[0]
    expect(markers[0].message).toBe('`gamepad` is part of Strudel, but it isn\'t in Stave yet.')

    unregisterEditor(file.id, editor)
  })
})
