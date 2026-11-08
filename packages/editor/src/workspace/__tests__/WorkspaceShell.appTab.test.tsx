/**
 * WorkspaceShell — app tabs (#2471).
 *
 * A `kind: 'app'` tab is one the HOST draws (the Community Gallery is
 * `appKey: 'gallery'`): the shell owns its lifecycle — open / focus-if-open /
 * drag / split / close / switch away and back / state — and the host draws
 * its body through `renderAppTab` and names it through `appTabLabel`. It has
 * no file, so the pane's background never applies to it and its content area
 * is opaque.
 *
 * Renders the real shell (Monaco stubbed as in WorkspaceShell.test.tsx).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, fireEvent, createEvent, act } from '@testing-library/react'

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
import {
  createWorkspaceFile,
  __resetWorkspaceFilesForTests,
} from '../WorkspaceFile'
import { __resetWorkspaceLanguagesForTests } from '../languages'
import { __resetWorkspaceAudioBusForTests } from '../WorkspaceAudioBus'
import type { PreviewProvider } from '../PreviewProvider'
import type { WorkspaceGroupState, WorkspaceTab, WorkspaceShellProps } from '../types'
import {
  serializeShellState,
  validatePersistedState,
  hydrateSnapshot,
  type ShellSnapshot,
} from '../tabPersistence'

type AppTab = WorkspaceTab & { kind: 'app' }

// A host body that reports its mounts/unmounts and shows the state it got.
const lifecycle: string[] = []
function GalleryBody({ tab }: { tab: AppTab }): React.ReactElement {
  React.useEffect(() => {
    lifecycle.push(`mount:${tab.id}`)
    return () => {
      lifecycle.push(`unmount:${tab.id}`)
    }
  }, [tab.id])
  return (
    <div data-testid="gallery-body" data-state={JSON.stringify(tab.state ?? null)}>
      gallery
    </div>
  )
}

const renderAppTab: NonNullable<WorkspaceShellProps['renderAppTab']> = (tab) =>
  tab.appKey === 'gallery' ? <GalleryBody tab={tab} /> : null
const appTabLabel: NonNullable<WorkspaceShellProps['appTabLabel']> = (tab) =>
  tab.appKey === 'gallery'
    ? { title: 'Community Gallery', icon: <span data-testid="gallery-icon">G</span> }
    : undefined

function stubProvider(): PreviewProvider {
  return {
    extensions: ['hydra'],
    label: 'Stub',
    keepRunningWhenHidden: false,
    reload: 'instant',
    render: () => <div data-testid="stub-preview-output" />,
  }
}

function editorTab(id: string, fileId: string): WorkspaceTab {
  return { kind: 'editor', id, fileId }
}

function snapshot(groups: WorkspaceGroupState[], layout: string[][], activeGroupId: string): ShellSnapshot {
  return { groups: new Map(groups.map((g) => [g.id, g])), layout, activeGroupId }
}

function tabsIn(container: HTMLElement, groupId: string): string[] {
  const g = container.querySelector(`[data-workspace-group="${groupId}"]`)!
  return Array.from(g.querySelectorAll('[data-workspace-tab]')).map(
    (el) => el.getAttribute('data-workspace-tab')!,
  )
}

function appTabEls(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[data-workspace-tab][data-tab-kind="app"]'))
}

function dragTransfer() {
  const store: Record<string, string> = {}
  return {
    setData: (type: string, value: string) => {
      store[type] = value
    },
    getData: (type: string) => store[type] ?? '',
    types: [] as string[],
    effectAllowed: '',
    dropEffect: '',
  }
}

describe('WorkspaceShell — app tabs (#2471)', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    __resetWorkspaceLanguagesForTests()
    __resetWorkspaceAudioBusForTests()
    createWorkspaceFile('f-strudel', 'main.strudel', '// strudel code', 'strudel')
    createWorkspaceFile('f-hydra', 'viz.hydra', '// hydra code', 'hydra')
    lifecycle.length = 0
  })

  it('openAppTab adds the tab to the active group, activates it and draws the host body with its label', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const onActiveTabChange = vi.fn()
    const { container, getByTestId, queryByTestId } = render(
      <WorkspaceShell
        ref={shell}
        initialTabs={[editorTab('t-a', 'f-strudel')]}
        renderAppTab={renderAppTab}
        appTabLabel={appTabLabel}
        onActiveTabChange={onActiveTabChange}
      />,
    )
    expect(queryByTestId('gallery-body')).toBeNull()
    act(() => shell.current!.openAppTab('gallery'))

    const chips = appTabEls(container)
    expect(chips).toHaveLength(1)
    expect(chips[0].getAttribute('data-tab-active')).toBe('true')
    expect(chips[0].textContent).toContain('Community Gallery')
    expect(chips[0].querySelector('[data-testid="gallery-icon"]')).not.toBeNull()
    expect(getByTestId('gallery-body')).toBeTruthy()
    // The editor is no longer drawn (only the active tab is).
    expect(queryByTestId('mock-monaco-editor')).toBeNull()
    expect(onActiveTabChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'app', appKey: 'gallery' }),
    )
    // No fileId on the tab the shell made.
    const reported = onActiveTabChange.mock.calls.at(-1)![0] as Record<string, unknown>
    expect('fileId' in reported).toBe(false)
  })

  it('falls back to the app key as label, and a placeholder body, when the host gives none', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const { container, getByTestId } = render(
      <WorkspaceShell ref={shell} initialTabs={[]} />,
    )
    act(() => shell.current!.openAppTab('mystery'))
    expect(appTabEls(container)[0].textContent).toContain('mystery')
    expect(getByTestId('app-tab-unavailable-app-mystery')).toBeTruthy()
  })

  it('openAppTab focuses the open tab — even in another, inactive group — instead of adding a second', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const gallery: WorkspaceTab = { kind: 'app', id: 'app-gallery', appKey: 'gallery' }
    const s = snapshot(
      [
        { id: 'g1', tabs: [editorTab('t-a', 'f-strudel')], activeTabId: 't-a' },
        { id: 'g2', tabs: [gallery, editorTab('t-b', 'f-hydra')], activeTabId: 't-b' },
      ],
      [['g1', 'g2']],
      'g1',
    )
    const { container } = render(
      <WorkspaceShell
        ref={shell}
        initialGroups={s.groups}
        initialLayout={s.layout}
        initialActiveGroupId={s.activeGroupId}
        renderAppTab={renderAppTab}
        appTabLabel={appTabLabel}
      />,
    )
    act(() => shell.current!.openAppTab('gallery'))
    expect(appTabEls(container)).toHaveLength(1)
    expect(tabsIn(container, 'g1')).toEqual(['t-a'])
    expect(tabsIn(container, 'g2')).toEqual(['app-gallery', 't-b'])
    const g2 = container.querySelector('[data-workspace-group="g2"]')!
    expect(g2.getAttribute('data-active-group')).toBe('true')
    expect(
      g2.querySelector('[data-workspace-tab="app-gallery"]')!.getAttribute('data-tab-active'),
    ).toBe('true')
    expect(g2.querySelector('[data-testid="gallery-body"]')).not.toBeNull()
  })

  it('two opens in the same tick still make one tab', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const { container } = render(
      <WorkspaceShell ref={shell} initialTabs={[editorTab('t-a', 'f-strudel')]} renderAppTab={renderAppTab} />,
    )
    act(() => {
      shell.current!.openAppTab('gallery')
      shell.current!.openAppTab('gallery')
    })
    expect(appTabEls(container)).toHaveLength(1)
  })

  it('opts.state moves an open tab there; omitted, the tab keeps its state', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const { getByTestId } = render(
      <WorkspaceShell ref={shell} initialTabs={[editorTab('t-a', 'f-strudel')]} renderAppTab={renderAppTab} />,
    )
    act(() => shell.current!.openAppTab('gallery', { state: { view: 'browse' } }))
    expect(getByTestId('gallery-body').getAttribute('data-state')).toBe('{"view":"browse"}')
    act(() => shell.current!.openAppTab('gallery', { state: { view: 'entry', id: 'e1' } }))
    expect(getByTestId('gallery-body').getAttribute('data-state')).toBe('{"view":"entry","id":"e1"}')
    act(() => shell.current!.openAppTab('gallery'))
    expect(getByTestId('gallery-body').getAttribute('data-state')).toBe('{"view":"entry","id":"e1"}')
  })

  it('setAppTabState updates the tab and reaches the persistence sink; an unchanged state writes nothing', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const onGroupsChange = vi.fn()
    const { getByTestId } = render(
      <WorkspaceShell
        ref={shell}
        initialTabs={[editorTab('t-a', 'f-strudel')]}
        renderAppTab={renderAppTab}
        onGroupsChange={onGroupsChange}
      />,
    )
    act(() => shell.current!.openAppTab('gallery'))
    onGroupsChange.mockClear()
    act(() => shell.current!.setAppTabState('gallery', { view: 'profile', handle: 'ana' }))
    expect(getByTestId('gallery-body').getAttribute('data-state')).toBe('{"view":"profile","handle":"ana"}')
    expect(onGroupsChange).toHaveBeenCalledTimes(1)
    const snap = onGroupsChange.mock.calls[0][0] as ShellSnapshot
    const persisted = serializeShellState(snap)
    const saved = Object.values(persisted.groups).flatMap((g) => g.tabs)
    expect(saved).toContainEqual({
      kind: 'app',
      id: 'app-gallery',
      appKey: 'gallery',
      state: { view: 'profile', handle: 'ana' },
    })
    // Same value again → no state change, no write.
    act(() => shell.current!.setAppTabState('gallery', { view: 'profile', handle: 'ana' }))
    expect(onGroupsChange).toHaveBeenCalledTimes(1)
    // Clearing removes the key.
    act(() => shell.current!.setAppTabState('gallery', undefined))
    expect(getByTestId('gallery-body').getAttribute('data-state')).toBe('null')
    // No tab with that key → no-op.
    onGroupsChange.mockClear()
    act(() => shell.current!.setAppTabState('nope', 1))
    expect(onGroupsChange).not.toHaveBeenCalled()
  })

  it('switching away unmounts the body; switching back remounts it with the state the tab kept', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const { container, queryByTestId } = render(
      <WorkspaceShell ref={shell} initialTabs={[editorTab('t-a', 'f-strudel')]} renderAppTab={renderAppTab} />,
    )
    act(() => shell.current!.openAppTab('gallery', { state: { view: 'entry', id: 'e9' } }))
    expect(lifecycle).toEqual(['mount:app-gallery'])

    fireEvent.click(container.querySelector('[data-workspace-tab="t-a"]')!)
    expect(queryByTestId('gallery-body')).toBeNull()
    expect(queryByTestId('mock-monaco-editor')).not.toBeNull()
    expect(lifecycle).toEqual(['mount:app-gallery', 'unmount:app-gallery'])

    fireEvent.click(container.querySelector('[data-workspace-tab="app-gallery"]')!)
    expect(queryByTestId('gallery-body')!.getAttribute('data-state')).toBe('{"view":"entry","id":"e9"}')
    expect(lifecycle).toEqual(['mount:app-gallery', 'unmount:app-gallery', 'mount:app-gallery'])
  })

  it('closing removes the tab, reports it to onTabClose, and it can be opened again', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const onTabClose = vi.fn()
    const { container, getByTestId, queryByTestId } = render(
      <WorkspaceShell
        ref={shell}
        initialTabs={[editorTab('t-a', 'f-strudel')]}
        renderAppTab={renderAppTab}
        onTabClose={onTabClose}
      />,
    )
    act(() => shell.current!.openAppTab('gallery'))
    fireEvent.click(getByTestId('tab-close-app-gallery'))
    expect(appTabEls(container)).toHaveLength(0)
    expect(queryByTestId('gallery-body')).toBeNull()
    expect(onTabClose).toHaveBeenCalledWith(expect.objectContaining({ kind: 'app', appKey: 'gallery' }))
    // The neighbouring editor tab takes over.
    expect(queryByTestId('mock-monaco-editor')).not.toBeNull()
    act(() => shell.current!.openAppTab('gallery'))
    expect(appTabEls(container)).toHaveLength(1)
  })

  it('file-scoped operations leave it alone: closeTabsForFile, Cmd+S', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const onSaveFile = vi.fn()
    const { container } = render(
      <WorkspaceShell
        ref={shell}
        initialTabs={[editorTab('t-a', 'f-strudel')]}
        renderAppTab={renderAppTab}
        onSaveFile={onSaveFile}
      />,
    )
    act(() => shell.current!.openAppTab('gallery'))
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    expect(onSaveFile).not.toHaveBeenCalled()
    act(() => shell.current!.closeTabsForFile('f-strudel'))
    expect(tabsIn(container, container.querySelector('[data-workspace-group]')!.getAttribute('data-workspace-group')!)).toEqual(['app-gallery'])
  })

  it('drags to another group like any tab, and its body is drawn there', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const { container } = render(
      <WorkspaceShell ref={shell} initialTabs={[editorTab('t-a', 'f-strudel')]} renderAppTab={renderAppTab} />,
    )
    act(() => shell.current!.openAppTab('gallery'))
    fireEvent.click(container.querySelector('[data-testid^="group-split-"]')!)
    const groupEls = container.querySelectorAll('[data-workspace-group]') as NodeListOf<HTMLElement>
    expect(groupEls).toHaveLength(2)
    const target = groupEls[1].getAttribute('data-workspace-group')!

    const dt = dragTransfer()
    fireEvent.dragStart(container.querySelector('[data-workspace-tab="app-gallery"]')!, { dataTransfer: dt })
    dt.types.push('application/workspace-tab')
    fireEvent.dragOver(groupEls[1], { dataTransfer: dt })
    fireEvent.drop(groupEls[1], { dataTransfer: dt })

    expect(tabsIn(container, target)).toEqual(['app-gallery'])
    const targetEl = container.querySelector(`[data-workspace-group="${target}"]`)!
    expect(targetEl.querySelector('[data-testid="gallery-body"]')).not.toBeNull()
    expect(appTabEls(container)).toHaveLength(1)
  })

  it('splits off into a new group through a quadrant drop', () => {
    const shell = React.createRef<WorkspaceShellHandle>()
    const { container } = render(
      <WorkspaceShell ref={shell} initialTabs={[editorTab('t-a', 'f-strudel')]} renderAppTab={renderAppTab} />,
    )
    act(() => shell.current!.openAppTab('gallery'))
    const groupEl = container.querySelector('[data-workspace-group]') as HTMLElement
    groupEl.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, toJSON: () => ({}) }) as DOMRect
    const dt = dragTransfer()
    fireEvent.dragStart(container.querySelector('[data-workspace-tab="app-gallery"]')!, { dataTransfer: dt })
    dt.types.push('application/workspace-tab')
    const at = <E extends Event>(ev: E): E => {
      Object.defineProperty(ev, 'clientX', { value: 190, configurable: true })
      Object.defineProperty(ev, 'clientY', { value: 100, configurable: true })
      return ev
    }
    fireEvent(groupEl, at(createEvent.dragOver(groupEl, { dataTransfer: dt })))
    fireEvent(groupEl, at(createEvent.drop(groupEl, { dataTransfer: dt })))

    const groups = container.querySelectorAll('[data-workspace-group]')
    expect(groups).toHaveLength(2)
    const holder = container.querySelector('[data-workspace-tab="app-gallery"]')!.closest('[data-workspace-group]')!
    const editorHolder = container.querySelector('[data-workspace-tab="t-a"]')!.closest('[data-workspace-group]')!
    expect(holder).not.toBe(editorHolder)
    expect(holder.querySelector('[data-testid="gallery-body"]')).not.toBeNull()
  })

  describe('the pane background does not apply', () => {
    function renderWithBackground(spanning?: WorkspaceShellProps['spanningBackdrop']) {
      const shell = React.createRef<WorkspaceShellHandle>()
      const s = snapshot(
        [
          {
            id: 'g1',
            tabs: [editorTab('t-a', 'f-strudel'), { kind: 'app', id: 'app-gallery', appKey: 'gallery' }],
            activeTabId: 'app-gallery',
            backgroundFileId: 'f-hydra',
          },
        ],
        [['g1']],
        'g1',
      )
      const utils = render(
        <WorkspaceShell
          ref={shell}
          initialGroups={s.groups}
          initialLayout={s.layout}
          initialActiveGroupId={s.activeGroupId}
          renderAppTab={renderAppTab}
          previewProviderFor={(t) => (t.fileId === 'f-hydra' ? stubProvider() : undefined)}
          {...(spanning !== undefined ? { spanningBackdrop: spanning } : {})}
        />,
      )
      return { shell, ...utils }
    }

    it('no pane background is drawn behind an active app tab, and its page is opaque', () => {
      const { container } = renderWithBackground()
      const content = container.querySelector('[data-workspace-group-content="g1"]')!
      expect(content.querySelector('[data-workspace-background]')).toBeNull()
      expect(content.querySelector('[data-stave-code-panel]')!.getAttribute('data-stave-backdrop')).toBe('off')
      const page = content.querySelector('[data-workspace-view="app"]') as HTMLElement
      expect(page.style.background).toBe('var(--background)')
    })

    it('the setting stays on the pane and comes back with the next file tab', () => {
      const { container, shell } = renderWithBackground()
      expect(shell.current!.getBackgroundFileId('g1')).toBe('f-hydra')
      fireEvent.click(container.querySelector('[data-workspace-tab="t-a"]')!)
      const content = container.querySelector('[data-workspace-group-content="g1"]')!
      expect(content.querySelector('[data-workspace-background="g1"]')).not.toBeNull()
      expect(content.querySelector('[data-stave-code-panel]')!.getAttribute('data-stave-backdrop')).toBe('on')
    })

    it('a background spanning the workspace does not show through it either', () => {
      const { container } = renderWithBackground({ fileId: 'f-hydra', ownerFileId: 'f-strudel' })
      // The spanning layer exists (behind every pane)…
      expect(container.querySelector('[data-workspace-background="workspace"]')).not.toBeNull()
      // …but the app tab's panel is not see-through and its page paints solid.
      const content = container.querySelector('[data-workspace-group-content="g1"]')!
      expect(content.querySelector('[data-stave-code-panel]')!.getAttribute('data-stave-backdrop')).toBe('off')
      const page = content.querySelector('[data-workspace-view="app"]') as HTMLElement
      expect(page.style.background).toBe('var(--background)')
    })
  })

  it('a reload restores it: persisted layout → validate with the known key → shell draws it where it was', () => {
    const before = snapshot(
      [
        { id: 'g1', tabs: [editorTab('t-a', 'f-strudel')], activeTabId: 't-a' },
        {
          id: 'g2',
          tabs: [{ kind: 'app', id: 'app-gallery', appKey: 'gallery', state: { view: 'entry', id: 'e7' } }],
          activeTabId: 'app-gallery',
        },
      ],
      [['g1', 'g2']],
      'g2',
    )
    const wire = JSON.parse(JSON.stringify(serializeShellState(before)))
    const restored = hydrateSnapshot(validatePersistedState(wire, new Set(['f-strudel']), new Set(['gallery']))!)
    const shell = React.createRef<WorkspaceShellHandle>()
    const { container } = render(
      <WorkspaceShell
        ref={shell}
        initialGroups={restored.groups}
        initialLayout={restored.layout}
        initialActiveGroupId={restored.activeGroupId}
        renderAppTab={renderAppTab}
      />,
    )
    const g2 = container.querySelector('[data-workspace-group="g2"]')!
    expect(g2.querySelector('[data-testid="gallery-body"]')!.getAttribute('data-state')).toBe('{"view":"entry","id":"e7"}')
    // Opening it again focuses the restored tab, never a copy.
    act(() => shell.current!.openAppTab('gallery'))
    expect(appTabEls(container)).toHaveLength(1)
  })
})
