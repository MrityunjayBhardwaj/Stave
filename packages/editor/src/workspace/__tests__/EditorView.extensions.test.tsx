/**
 * #2513 — which editors extensions get: the code editor (`EditorView`) and the read-only
 * history view, each with the bar under it; the side-by-side diff never.
 *
 * `@monaco-editor/react` is stubbed as in EditorView.test.tsx, with one addition the real
 * wrapper has: unmounting disposes the editor, which fires its own `onDidDispose`. The
 * page's editor list (`pageCodeEditors`) is watched the way an extension's host does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, act } from '@testing-library/react'

interface StubEditor {
  onDidDispose(fn: () => void): { dispose(): void }
  dispose(): void
  listeners: Set<() => void>
  [k: string]: unknown
}
const made: StubEditor[] = []
function stubEditor(): StubEditor {
  const listeners = new Set<() => void>()
  const ed: StubEditor = {
    listeners,
    onDidDispose(fn) {
      listeners.add(fn)
      return { dispose: () => listeners.delete(fn) }
    },
    dispose() {
      for (const fn of [...listeners]) fn()
      listeners.clear()
    },
  }
  made.push(ed)
  return ed
}
const stubMonaco = {
  languages: {
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    setLanguageConfiguration: vi.fn(),
    getLanguages: vi.fn(() => []),
    registerFoldingRangeProvider: vi.fn(),
    registerCompletionItemProvider: vi.fn(),
    registerHoverProvider: vi.fn(),
  },
  editor: { setTheme: vi.fn(), defineTheme: vi.fn() },
}

interface Props {
  onMount?: (editor: unknown, monaco: unknown) => void
}
/** mounts an editor after render and disposes it on unmount, as the real wrapper does */
function StubMonaco(props: Props) {
  React.useEffect(() => {
    const ed = stubEditor()
    props.onMount?.(ed, stubMonaco)
    return () => ed.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div data-testid="mock-monaco-editor" />
}
vi.mock('@monaco-editor/react', () => ({
  default: (p: Props) => <StubMonaco {...p} />,
  DiffEditor: (p: Props) => <StubMonaco {...p} />,
}))
vi.mock('../../visualizers/defaultDescriptors', () => ({ DEFAULT_VIZ_DESCRIPTORS: [] }))
vi.mock('../../visualizers/viewZones', () => ({
  addInlineViewZones: vi.fn(() => ({ cleanup: vi.fn(), pause: vi.fn(), resume: vi.fn() })),
}))
vi.mock('../../monaco/useHighlighting', () => ({ useHighlighting: vi.fn(() => ({ clearAll: vi.fn() })) }))
vi.mock('../../monaco/diagnostics', () => ({
  setEvalError: vi.fn(),
  clearEvalErrors: vi.fn(),
  refreshStrudelLintMarkers: vi.fn(),
  clearStrudelLintMarkers: vi.fn(),
}))

import { EditorView } from '../EditorView'
import { HistoryViewOverlay } from '../history/HistoryViewOverlay'
import { HistoryDiffOverlay } from '../history/HistoryDiffOverlay'
import { seedHistory } from '../history/historyGraph'
import { createWorkspaceFile, __resetWorkspaceFilesForTests } from '../WorkspaceFile'
import { __resetWorkspaceLanguagesForTests } from '../languages'
import { pageCodeEditors, type CodeEditorSite } from '../../extensions'

/** Watch the page's editors as a host does; returns the log and the stop. */
function watch() {
  const log = { attach: [] as CodeEditorSite[], detach: [] as CodeEditorSite[] }
  const stop = pageCodeEditors().watch((site) => {
    log.attach.push(site)
    return () => log.detach.push(site)
  })
  return { log, stop }
}

const history = seedHistory('p', { f1: 's("bd")', f2: 'osc().out()' }, undefined, 'c0abcdef', 1, {
  f1: { path: 'a.strudel', language: 'strudel' },
  f2: { path: 'b.hydra', language: 'hydra' },
} as never)
const commit = history.commits.c0abcdef

describe('editors offered to extensions (#2513)', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    __resetWorkspaceLanguagesForTests()
    made.length = 0
  })

  it('the code editor is offered with its bar, its language, not read-only; a remount pairs up', () => {
    createWorkspaceFile('f1', 'a.strudel', 's("bd")', 'strudel')
    const { log, stop } = watch()
    const before = pageCodeEditors().size()
    const first = render(<EditorView fileId="f1" />)
    expect(log.attach).toHaveLength(1)
    const site = log.attach[0]
    expect(site.readOnly).toBe(false)
    expect(site.language()).toBe('strudel')
    expect(site.bar).toBe(first.container.querySelector('[data-editor-bar]'))
    expect(site.bar.childNodes).toHaveLength(0)
    expect(site.editor).toBe(made[0])
    expect(first.container.querySelector('[data-code-editor]')).not.toBeNull()
    // a tab switch: the view unmounts (the editor is disposed) and a new one mounts
    first.unmount()
    expect(log.detach).toEqual([site])
    const second = render(<EditorView fileId="f1" />)
    expect(log.attach).toHaveLength(2)
    second.unmount()
    expect(log.detach).toHaveLength(2)
    expect(pageCodeEditors().size()).toBe(before)
    stop()
  })

  it('the history view is offered read-only, with the language of the file it shows', () => {
    const { log, stop } = watch()
    const view = render(<HistoryViewOverlay history={history} commit={commit} initialFileId="f2" onClose={() => undefined} />)
    expect(log.attach).toHaveLength(1)
    expect(log.attach[0].readOnly).toBe(true)
    expect(log.attach[0].language()).toBe('hydra')
    expect(log.attach[0].bar).toBe(view.container.querySelector('[data-editor-bar]'))
    expect(view.container.querySelector('[data-code-editor]')).not.toBeNull()
    view.rerender(<HistoryViewOverlay history={history} commit={commit} initialFileId="f1" onClose={() => undefined} />)
    expect(log.attach).toHaveLength(1)
    expect(log.attach[0].language()).toBe('strudel')
    view.unmount()
    expect(log.detach).toHaveLength(1)
    stop()
  })

  it('the side-by-side diff is never offered, and has no bar', () => {
    const { log, stop } = watch()
    let view!: ReturnType<typeof render>
    act(() => {
      view = render(
        <HistoryDiffOverlay history={history} commit={commit} initialFileId="f1" defaultMode="previous" onClose={() => undefined} />,
      )
    })
    expect(made.length).toBeGreaterThan(0)
    expect(log.attach).toHaveLength(0)
    expect(view.container.querySelector('[data-editor-bar]')).toBeNull()
    expect(view.container.querySelector('[data-code-editor]')).toBeNull()
    view.unmount()
    stop()
  })
})
