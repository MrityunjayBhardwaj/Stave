/**
 * WorkspaceShell — a pane emptied by a close goes away (#2586).
 *
 * Closing a pane's last tab removes the pane unless it is the only one. That
 * has to hold however many tabs one action closes: Close All, Close Others,
 * closing a file's tabs, and a viz editor taking its side preview with it all
 * close several tabs in one tick. An empty pane made on purpose by Split stays.
 *
 * Renders the real shell (Monaco stubbed as in WorkspaceShell.test.tsx).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, act, fireEvent } from '@testing-library/react'

vi.mock('@monaco-editor/react', () => ({
  default: (props: { language?: string; value?: string }) => (
    <div
      data-testid="mock-monaco-editor"
      data-language={props.language ?? ''}
      data-value={props.value ?? ''}
    />
  ),
  DiffEditor: () => <div data-testid="mock-diff-editor" />,
}))
vi.mock('../../visualizers/defaultDescriptors', () => ({
  DEFAULT_VIZ_DESCRIPTORS: [],
}))
vi.mock('../../visualizers/viewZones', () => ({
  addInlineViewZones: vi.fn(() => ({ cleanup: vi.fn(), pause: vi.fn(), resume: vi.fn() })),
}))
vi.mock('../../monaco/useHighlighting', () => ({
  useHighlighting: vi.fn(() => ({ clearAll: vi.fn() })),
}))
vi.mock('../../monaco/diagnostics', () => ({
  setEvalError: vi.fn(),
  clearEvalErrors: vi.fn(),
}))

import { WorkspaceShell, type WorkspaceShellHandle } from '../WorkspaceShell'
import { createWorkspaceFile, __resetWorkspaceFilesForTests } from '../WorkspaceFile'
import { __resetWorkspaceLanguagesForTests } from '../languages'
import { __resetWorkspaceAudioBusForTests } from '../WorkspaceAudioBus'
import type { PreviewProvider } from '../PreviewProvider'
import type { WorkspaceGroupState, WorkspaceTab } from '../types'

const editorTab = (id: string, fileId: string): WorkspaceTab => ({ kind: 'editor', id, fileId })
const previewTab = (id: string, fileId: string): WorkspaceTab => ({ kind: 'preview', id, fileId, sourceRef: { kind: 'default' } })
const STUB: PreviewProvider = { extensions: ['hydra'], label: 'Stub', keepRunningWhenHidden: false, reload: 'instant', render: () => <div /> }

/** the panes on screen, left to right, each as its tab ids */
function panes(container: HTMLElement): string[][] {
  return Array.from(container.querySelectorAll('[data-workspace-group]')).map((g) =>
    Array.from(g.querySelectorAll('[data-workspace-tab]')).map((t) => t.getAttribute('data-workspace-tab')!),
  )
}

function twoPanes(right: WorkspaceTab[], left: WorkspaceTab[] = [editorTab('t-a', 'f-a')]) {
  const shell = React.createRef<WorkspaceShellHandle>()
  const groups: WorkspaceGroupState[] = [
    { id: 'g1', tabs: left, activeTabId: left[0]?.id ?? null },
    { id: 'g2', tabs: right, activeTabId: right[0]?.id ?? null },
  ]
  const r = render(
    <WorkspaceShell
      ref={shell}
      initialGroups={new Map(groups.map((g) => [g.id, g]))}
      initialLayout={[['g1', 'g2']]}
      initialActiveGroupId="g2"
      previewProviderFor={() => STUB}
    />,
  )
  return { shell, container: r.container, getByTestId: r.getByTestId }
}

describe('WorkspaceShell — a pane emptied by a close goes away (#2586)', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    __resetWorkspaceLanguagesForTests()
    __resetWorkspaceAudioBusForTests()
    createWorkspaceFile('f-a', 'a.strudel', '// a', 'strudel')
    createWorkspaceFile('f-b', 'b.strudel', '// b', 'strudel')
    createWorkspaceFile('f-c', 'c.strudel', '// c', 'strudel')
    createWorkspaceFile('f-v', 'v.hydra', '// v', 'hydra')
  })

  it('Close All on a pane\'s tabs removes the pane', () => {
    const { shell, container } = twoPanes([editorTab('t-b', 'f-b'), editorTab('t-c', 'f-c')])
    act(() => shell.current!.closeAllTabsInGroup('t-b'))
    expect(panes(container)).toEqual([['t-a']])
  })

  it('closing a file whose two tabs fill a pane removes the pane', () => {
    const { shell, container } = twoPanes([editorTab('t-v', 'f-v'), previewTab('p-v', 'f-v')])
    act(() => shell.current!.closeTabsForFile('f-v'))
    expect(panes(container)).toEqual([['t-a']])
  })

  it('a viz editor closed with x takes its side preview, and their pane, with it', () => {
    const { container, getByTestId } = twoPanes([editorTab('t-v', 'f-v'), previewTab('p-v', 'f-v')])
    act(() => { fireEvent.click(getByTestId('tab-close-t-v')) })
    expect(panes(container)).toEqual([['t-a']])
  })

  it('Close Others keeps the pane, holding the one tab', () => {
    const { shell, container } = twoPanes([editorTab('t-b', 'f-b'), editorTab('t-c', 'f-c')])
    act(() => shell.current!.closeOtherTabs('t-b'))
    expect(panes(container)).toEqual([['t-a'], ['t-b']])
  })

  it('x on the last tab still removes the pane, and on the last pane keeps it', () => {
    const { container, getByTestId } = twoPanes([editorTab('t-b', 'f-b')])
    act(() => { fireEvent.click(getByTestId('tab-close-t-b')) })
    expect(panes(container)).toEqual([['t-a']])
    act(() => { fireEvent.click(getByTestId('tab-close-t-a')) })
    expect(panes(container)).toEqual([[]])
  })

  it('one action emptying every pane leaves one empty pane, not none', () => {
    const { shell, container } = twoPanes([editorTab('t-b', 'f-a')], [editorTab('t-a', 'f-a')])
    act(() => shell.current!.closeTabsForFile('f-a'))
    expect(panes(container)).toEqual([[]])
  })

  it('an empty pane made by Split stays until something closes in it', () => {
    const { shell, container } = twoPanes([editorTab('t-b', 'f-b')])
    act(() => shell.current!.splitActiveGroup('east'))
    expect(panes(container)).toEqual([['t-a'], ['t-b'], []])
    act(() => shell.current!.closeOtherTabs('t-a'))
    expect(panes(container)).toEqual([['t-a'], ['t-b'], []])
  })
})
