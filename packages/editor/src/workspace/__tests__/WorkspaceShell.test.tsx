/**
 * WorkspaceShell — unit tests (Phase 10.2 Task 04).
 *
 * Covers the shell's observable contract:
 *
 *   - Renders with `initialTabs` — one group, first tab becomes active.
 *   - `onActiveTabChange` fires on mount with the initial active tab.
 *   - Clicking a tab switches `activeTabId` and fires `onActiveTabChange`.
 *   - Closing a tab removes it; if the closed tab was active, switches
 *     to the next adjacent tab. `onTabClose` fires with the closed tab.
 *   - Closing the only remaining tab in a group leaves the group empty
 *     (not collapsed). The empty state renders a "Drop a tab here" hint.
 *   - `editor`-kind tabs dispatch to `EditorView`; `preview`-kind tabs
 *     dispatch to `PreviewView` with a stub provider.
 *   - Split group creates a new empty sibling group. SplitPane now wraps
 *     the 2+ groups; the single-group path renders the group directly.
 *   - Close group merges tabs into the neighbor group.
 *   - Drag tab from group A to group B ends up in B, active in B,
 *     removed from A.
 *   - Theme applied via `style.getPropertyValue('--code-bg')` on the
 *     shell root container (PV6 guard).
 *   - PV7 acceptance test — the shell's own source file contains ZERO
 *     occurrences of `previewMode`.
 *
 * ## Why mock `@monaco-editor/react`
 *
 * The shell renders `EditorView` for editor-kind tabs, which mounts
 * Monaco. jsdom cannot run Monaco cleanly; we stub it out the same way
 * `EditorView.test.tsx` does. The stub just writes a div so theme /
 * dispatch assertions still work.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, fireEvent, createEvent, act } from '@testing-library/react'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Mock @monaco-editor/react BEFORE importing anything that reaches for it.
// ---------------------------------------------------------------------------

interface MonacoEditorProps {
  language?: string
  value?: string
  onChange?: (value: string | undefined) => void
  onMount?: (editor: unknown, monaco: unknown) => void
  height?: string | number
  options?: Record<string, unknown>
}

const stubEditor = { id: 'stub-editor' }
const stubMonaco = {
  languages: {
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    setLanguageConfiguration: vi.fn(),
    getLanguages: vi.fn(() => [] as Array<{ id: string }>),
  },
}

vi.mock('@monaco-editor/react', () => ({
  default: (props: MonacoEditorProps) => {
    React.useEffect(() => {
      props.onMount?.(stubEditor, stubMonaco)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return (
      <div
        data-testid="mock-monaco-editor"
        data-language={props.language ?? ''}
        data-value={props.value ?? ''}
      />
    )
  },
  // Named export used by HistoryDiffOverlay (#198) — render-only stub.
  DiffEditor: (props: MonacoEditorProps) => (
    <div data-testid="mock-diff-editor" data-language={props.language ?? ""} />
  ),
}))

// Mock modules imported transitively by EditorView (Task 07 wiring)
// to avoid loading P5VizRenderer → gifenc (CJS/ESM incompatibility in test).
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

// Shared mount-renderer spy used by the "stop-button end-to-end"
// test below. Declared at module level so both the vi.mock factory
// and the test body can reach it. The pause/resume/destroy fields
// are fresh `vi.fn()` instances per mount call so a single test
// can inspect call counts without stale state from earlier tests.
const mountVizRendererSpy = vi.fn(() => ({
  renderer: {
    mount: vi.fn(),
    update: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    destroy: vi.fn(),
  },
  disconnect: vi.fn(),
}))

vi.mock('../../visualizers/mountVizRenderer', () => ({
  mountVizRenderer: (...args: unknown[]) =>
    (mountVizRendererSpy as unknown as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('../../visualizers/vizCompiler', () => ({
  compilePreset: vi.fn((preset: { id: string; renderer: string }) => ({
    id: `mock-${preset.id}`,
    label: 'mock',
    renderer: preset.renderer,
    factory: () => ({
      mount: vi.fn(),
      update: vi.fn(),
      resize: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      destroy: vi.fn(),
    }),
  })),
}))

// Mock the built-in audio source registry (issue #3) so the shell's
// onTogglePausePreview / handleTabClose audio dispatch can be observed
// without touching real Web Audio. The spies are created via vi.hoisted
// so the vi.mock factory below sees them at module-init time.
const {
  builtinSampleStartSpy,
  builtinSampleStopSpy,
  builtinDrumStartSpy,
  builtinDrumStopSpy,
  builtinChordStartSpy,
  builtinChordStopSpy,
} = vi.hoisted(() => ({
  builtinSampleStartSpy: vi.fn(),
  builtinSampleStopSpy: vi.fn(),
  builtinDrumStartSpy: vi.fn(),
  builtinDrumStopSpy: vi.fn(),
  builtinChordStartSpy: vi.fn(),
  builtinChordStopSpy: vi.fn(),
}))

vi.mock('../builtinExampleSources', () => {
  const sources = [
    {
      sourceId: '__example_sample__',
      label: 'sample',
      startIfIdle: builtinSampleStartSpy,
      stopIfRunning: builtinSampleStopSpy,
    },
    {
      sourceId: '__example_drums__',
      label: 'drums',
      startIfIdle: builtinDrumStartSpy,
      stopIfRunning: builtinDrumStopSpy,
    },
    {
      sourceId: '__example_chords__',
      label: 'chord',
      startIfIdle: builtinChordStartSpy,
      stopIfRunning: builtinChordStopSpy,
    },
  ]
  return {
    BUILTIN_EXAMPLE_SOURCES: sources,
    BUILTIN_SOURCE_IDS: new Set(sources.map((s) => s.sourceId)),
    findBuiltinExampleSource: (id: string) =>
      sources.find((s) => s.sourceId === id),
  }
})

import { WorkspaceShell } from '../WorkspaceShell'
import {
  createWorkspaceFile,
  __resetWorkspaceFilesForTests,
} from '../WorkspaceFile'
import { __resetWorkspaceLanguagesForTests } from '../languages'
import { __resetWorkspaceAudioBusForTests } from '../WorkspaceAudioBus'
import type {
  PreviewProvider,
  PreviewContext,
  PreviewEditorChromeContext,
} from '../PreviewProvider'
import type { WorkspaceTab } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePreviewProvider(): PreviewProvider {
  return {
    extensions: ['hydra'],
    label: 'Test Preview',
    keepRunningWhenHidden: false,
    reload: 'instant',
    render(ctx: PreviewContext) {
      return (
        <div
          data-testid="stub-preview-output"
          data-file-content={ctx.file.content}
        />
      )
    },
  }
}

function seedFiles() {
  createWorkspaceFile('f-strudel', 'main.strudel', '// strudel code', 'strudel')
  createWorkspaceFile('f-hydra', 'viz.hydra', '// hydra code', 'hydra')
  createWorkspaceFile('f-p5', 'sketch.p5', '// p5 code', 'p5js')
}

function editorTab(id: string, fileId: string): WorkspaceTab {
  return { kind: 'editor', id, fileId }
}

function previewTab(id: string, fileId: string): WorkspaceTab {
  return {
    kind: 'preview',
    id,
    fileId,
    sourceRef: { kind: 'default' },
  }
}

describe('WorkspaceShell', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    __resetWorkspaceLanguagesForTests()
    __resetWorkspaceAudioBusForTests()
    seedFiles()
  })

  describe('initial render', () => {
    it('seeds a single group with the provided tabs and activates the first', () => {
      const tabs = [
        editorTab('t-strudel', 'f-strudel'),
        editorTab('t-hydra', 'f-hydra'),
      ]
      const { getByTestId, container } = render(
        <WorkspaceShell initialTabs={tabs} />,
      )
      // Shell root exists.
      expect(
        container.querySelector('[data-workspace-shell="root"]'),
      ).not.toBeNull()
      // One group rendered.
      const groups = container.querySelectorAll('[data-workspace-group]')
      expect(groups.length).toBe(1)
      // Both tabs present in the tab bar.
      expect(
        container.querySelectorAll('[data-workspace-tab]').length,
      ).toBe(2)
      // First tab is active.
      const firstTab = container.querySelector(
        '[data-workspace-tab="t-strudel"]',
      )
      expect(firstTab?.getAttribute('data-tab-active')).toBe('true')
      // And its content area shows Monaco for the strudel file.
      const mock = getByTestId('mock-monaco-editor')
      expect(mock.getAttribute('data-value')).toBe('// strudel code')
      expect(mock.getAttribute('data-language')).toBe('strudel')
    })

    it('fires onActiveTabChange on mount with the initial active tab', () => {
      const tabs = [editorTab('t-strudel', 'f-strudel')]
      const onActiveTabChange = vi.fn()
      render(
        <WorkspaceShell
          initialTabs={tabs}
          onActiveTabChange={onActiveTabChange}
        />,
      )
      expect(onActiveTabChange).toHaveBeenCalledTimes(1)
      expect(onActiveTabChange).toHaveBeenCalledWith(tabs[0])
    })

    it('renders the empty state when no tabs are seeded', () => {
      const { container } = render(<WorkspaceShell initialTabs={[]} />)
      const empty = container.querySelector('[data-testid^="group-empty-"]')
      expect(empty).not.toBeNull()
      expect(empty?.textContent).toContain('Drop a tab here')
    })
  })

  describe('tab click', () => {
    it('changes the active tab and fires onActiveTabChange', () => {
      const tabs = [
        editorTab('t-a', 'f-strudel'),
        editorTab('t-b', 'f-hydra'),
      ]
      const onActiveTabChange = vi.fn()
      const { container } = render(
        <WorkspaceShell
          initialTabs={tabs}
          onActiveTabChange={onActiveTabChange}
        />,
      )
      onActiveTabChange.mockClear()
      const tabB = container.querySelector(
        '[data-workspace-tab="t-b"]',
      ) as HTMLElement
      fireEvent.click(tabB)
      // Active flag flipped.
      expect(
        container
          .querySelector('[data-workspace-tab="t-b"]')
          ?.getAttribute('data-tab-active'),
      ).toBe('true')
      // Callback fired.
      expect(onActiveTabChange).toHaveBeenCalledWith(tabs[1])
    })
  })

  describe('tab close', () => {
    it('removes a tab and switches to the next adjacent tab', () => {
      const tabs = [
        editorTab('t-a', 'f-strudel'),
        editorTab('t-b', 'f-hydra'),
      ]
      const onTabClose = vi.fn()
      const { container, getByTestId } = render(
        <WorkspaceShell initialTabs={tabs} onTabClose={onTabClose} />,
      )
      // Close the first (active) tab.
      const closeBtn = getByTestId('tab-close-t-a')
      fireEvent.click(closeBtn)
      // Only one tab left.
      expect(
        container.querySelectorAll('[data-workspace-tab]').length,
      ).toBe(1)
      // t-b is now active.
      expect(
        container
          .querySelector('[data-workspace-tab="t-b"]')
          ?.getAttribute('data-tab-active'),
      ).toBe('true')
      // onTabClose fired with the closed tab.
      expect(onTabClose).toHaveBeenCalledTimes(1)
      expect(onTabClose).toHaveBeenCalledWith(tabs[0])
    })

    it('leaves the group empty when the last tab is closed', () => {
      const tabs = [editorTab('t-a', 'f-strudel')]
      const { container, getByTestId } = render(
        <WorkspaceShell initialTabs={tabs} />,
      )
      fireEvent.click(getByTestId('tab-close-t-a'))
      // Group still exists but has no tabs and shows the drop hint.
      expect(
        container.querySelectorAll('[data-workspace-tab]').length,
      ).toBe(0)
      expect(
        container.querySelector('[data-testid^="group-empty-"]'),
      ).not.toBeNull()
    })
  })

  describe('tab dispatch by kind', () => {
    it('editor-kind dispatches to EditorView (renders Monaco stub)', () => {
      const tabs = [editorTab('t-e', 'f-strudel')]
      const { getByTestId, container } = render(
        <WorkspaceShell initialTabs={tabs} />,
      )
      expect(getByTestId('mock-monaco-editor')).toBeTruthy()
      expect(
        container.querySelector('[data-workspace-view="editor"]'),
      ).not.toBeNull()
    })

    it('preview-kind dispatches to PreviewView with the provided provider', () => {
      const tabs = [previewTab('t-p', 'f-hydra')]
      const provider = makePreviewProvider()
      const { getByTestId, container } = render(
        <WorkspaceShell
          initialTabs={tabs}
          previewProviderFor={() => provider}
        />,
      )
      expect(getByTestId('stub-preview-output')).toBeTruthy()
      expect(
        container.querySelector('[data-workspace-view="preview"]'),
      ).not.toBeNull()
    })

    it('Stop click on the REAL viz chrome actually calls renderer.pause() end-to-end', async () => {
      // Full-chain integration test for the Stop button. Unlike the
      // stub-chrome regression below, this one uses the REAL
      // HYDRA_VIZ provider (with mocked mountVizRenderer + compilePreset)
      // so we can verify the shell → PreviewView → provider →
      // CompiledVizMount → renderer.pause chain works end-to-end.
      //
      // The historical failure mode (commit 6cac6cc fixed it): the
      // provider's render function built a fresh VizDescriptor on
      // every invocation, causing CompiledVizMount's mount effect
      // (dep [descriptor]) to tear down and re-mount the p5 instance
      // on every paused-prop flip. pause() DID fire, but on a brand-
      // new p5 instance that hadn't even finished its first draw.
      // Without this test, the isolated chrome/provider tests can
      // pass while the browser UX is broken — which is exactly what
      // happened.
      mountVizRendererSpy.mockClear()
      // Dynamic import so the mocks above take effect.
      const { HYDRA_VIZ } = await import('../preview/hydraViz')
      const tabs = [editorTab('t-hydra', 'f-hydra')]
      const { container, getByTestId, findByTestId } = render(
        <WorkspaceShell
          initialTabs={tabs}
          previewProviderFor={() => HYDRA_VIZ}
        />,
      )

      // Sanity: the chrome renders with the ⚙ gear in 'off' mode, and no
      // standalone transport button until a preview exists (#773).
      const gear = getByTestId('viz-chrome-settings')
      expect(gear.getAttribute('data-preview-mode')).toBe('off')

      // Open the ⚙ popover and pick preview=side → shell splits off a preview
      // group and mounts a CompiledVizMount. Wait for the mount effect to
      // complete (the data-compiled-viz-mount attribute appears once
      // mountVizRenderer has been called).
      await act(async () => {
        fireEvent.click(gear)
      })
      await act(async () => {
        fireEvent.click(getByTestId('viz-preview-mode-side'))
      })
      await findByTestId('compiled-viz-mount-f-hydra')
      expect(mountVizRendererSpy).toHaveBeenCalled()

      // Grab the renderer reference the compiled mount is using.
      // The mock returns { renderer, disconnect } and the mount
      // hands `renderer` directly to the renderer ref.
      const firstMount = mountVizRendererSpy.mock.results[0].value
      const pauseSpy = firstMount.renderer.pause as ReturnType<typeof vi.fn>
      const resumeSpy = firstMount.renderer.resume as ReturnType<typeof vi.fn>
      pauseSpy.mockClear()
      resumeSpy.mockClear()

      // Chrome button should now show 'running'.
      const runningButton = getByTestId('viz-chrome-open-preview')
      expect(runningButton.getAttribute('data-button-state')).toBe('running')

      // Click Stop → shell flips pausedPreviews → PreviewView
      // re-renders with paused=true → provider.render threads
      // paused through ctx → CompiledVizMount's pause effect
      // fires → renderer.pause() called.
      await act(async () => {
        fireEvent.click(runningButton)
      })
      const pausedButton = getByTestId('viz-chrome-open-preview')
      expect(pausedButton.getAttribute('data-button-state')).toBe('paused')

      // THE critical assertion: pause was actually called on the
      // renderer that was mounted on Preview click. Mount count
      // should still be 1 — no teardown/remount cascade.
      expect(pauseSpy).toHaveBeenCalled()
      expect(mountVizRendererSpy).toHaveBeenCalledTimes(1)

      // Click Play → resume on the same renderer instance.
      pauseSpy.mockClear()
      await act(async () => {
        fireEvent.click(pausedButton)
      })
      expect(resumeSpy).toHaveBeenCalled()
      expect(mountVizRendererSpy).toHaveBeenCalledTimes(1)
    })

    it('closing a viz file tab stops its backdrop audio + clears the backdrop (#785)', async () => {
      const { HYDRA_VIZ } = await import('../preview/hydraViz')
      const tabs = [editorTab('t-hydra', 'f-hydra')]
      const { getByTestId, queryByTestId } = render(
        <WorkspaceShell initialTabs={tabs} previewProviderFor={() => HYDRA_VIZ} />,
      )
      builtinSampleStartSpy.mockClear()
      builtinSampleStopSpy.mockClear()

      // Pick the sample source in the ⚙ popover, then set preview=backdrop —
      // this starts the sample audio and records it as the backdrop's source.
      await act(async () => {
        fireEvent.click(getByTestId('viz-chrome-settings'))
      })
      await act(async () => {
        fireEvent.change(getByTestId('viz-chrome-source'), {
          target: { value: 'file:__example_sample__' },
        })
      })
      await act(async () => {
        fireEvent.click(getByTestId('viz-preview-mode-backdrop'))
      })
      expect(builtinSampleStartSpy).toHaveBeenCalled()

      // Close the viz FILE tab → teardown must stop the sample audio (#785).
      await act(async () => {
        fireEvent.click(getByTestId('tab-close-t-hydra'))
      })
      expect(builtinSampleStopSpy).toHaveBeenCalledTimes(1)
      // Tab (and its chrome) gone — the viz surface is fully torn down.
      expect(queryByTestId('viz-chrome-settings')).toBeNull()
    })

    // #2427 — a tab switch clears the pane's background (stopping its sound) and
    // switching back restores it: the viz's own example sound comes back too.
    it('restoring a viz file\'s own background restarts its chosen example sound (#2427)', async () => {
      const { HYDRA_VIZ } = await import('../preview/hydraViz')
      const { __resetVizSourceChoiceForTests } = await import('../preview/vizSourceChoice')
      __resetVizSourceChoiceForTests()
      const tabs = [editorTab('t-hydra', 'f-hydra')]
      const shell = React.createRef<import('../WorkspaceShell').WorkspaceShellHandle>()
      const { getByTestId } = render(
        <WorkspaceShell ref={shell} initialTabs={tabs} previewProviderFor={() => HYDRA_VIZ} />,
      )
      await act(async () => {
        fireEvent.click(getByTestId('viz-chrome-settings'))
      })
      await act(async () => {
        fireEvent.change(getByTestId('viz-chrome-source'), {
          target: { value: 'file:__example_sample__' },
        })
      })
      await act(async () => {
        fireEvent.click(getByTestId('viz-preview-mode-backdrop'))
      })
      builtinSampleStartSpy.mockClear()
      builtinSampleStopSpy.mockClear()

      await act(async () => {
        shell.current!.setBackgroundFile(null) // the tab switch away
      })
      expect(builtinSampleStopSpy).toHaveBeenCalledTimes(1)
      await act(async () => {
        shell.current!.setBackgroundFile('f-hydra') // …and back
      })
      expect(builtinSampleStartSpy).toHaveBeenCalledTimes(1)
      // recorded again, so closing the tab still stops it
      await act(async () => {
        fireEvent.click(getByTestId('tab-close-t-hydra'))
      })
      expect(builtinSampleStopSpy).toHaveBeenCalledTimes(2)
    })

    it('#787 — backdrop follows its tab across a cross-group move; close after the move still stops the audio', async () => {
      const { HYDRA_VIZ } = await import('../preview/hydraViz')
      const tabs = [
        editorTab('t-a', 'f-strudel'),
        editorTab('t-hydra', 'f-hydra'),
      ]
      const { container, getByTestId } = render(
        <WorkspaceShell
          initialTabs={tabs}
          previewProviderFor={(t) =>
            t.fileId === 'f-hydra' ? HYDRA_VIZ : undefined
          }
        />,
      )
      builtinSampleStartSpy.mockClear()
      builtinSampleStopSpy.mockClear()

      // Activate the hydra tab and play it as the backdrop with the sample
      // source (same gesture chain as the #785 test above).
      await act(async () => {
        fireEvent.click(
          container.querySelector('[data-workspace-tab="t-hydra"]')!,
        )
      })
      await act(async () => {
        fireEvent.click(getByTestId('viz-chrome-settings'))
      })
      await act(async () => {
        fireEvent.change(getByTestId('viz-chrome-source'), {
          target: { value: 'file:__example_sample__' },
        })
      })
      await act(async () => {
        fireEvent.click(getByTestId('viz-preview-mode-backdrop'))
      })
      expect(builtinSampleStartSpy).toHaveBeenCalled()

      const groupEl = container.querySelector(
        '[data-workspace-group]',
      ) as HTMLElement
      const originalGroupId = groupEl.getAttribute('data-workspace-group')!
      expect(
        container
          .querySelector('[data-workspace-background]')
          ?.getAttribute('data-workspace-background'),
      ).toBe(originalGroupId)

      // Drag the hydra tab to the EAST quadrant of its group → a new side
      // group. Rect mocked so computeQuadrant sees a real 200×200 box.
      groupEl.getBoundingClientRect = () =>
        ({
          x: 0, y: 0, left: 0, top: 0,
          width: 200, height: 200,
          right: 200, bottom: 200,
          toJSON: () => ({}),
        }) as DOMRect
      const dataStore: Record<string, string> = {}
      const dataTransfer = {
        setData: (type: string, value: string) => {
          dataStore[type] = value
        },
        getData: (type: string) => dataStore[type] ?? '',
        types: [] as string[],
        effectAllowed: '',
        dropEffect: '',
      }
      fireEvent.dragStart(
        container.querySelector('[data-workspace-tab="t-hydra"]')!,
        { dataTransfer },
      )
      dataTransfer.types.push('application/workspace-tab')
      const patchCoords = <E extends Event>(ev: E, x: number, y: number): E => {
        Object.defineProperty(ev, 'clientX', { value: x, configurable: true })
        Object.defineProperty(ev, 'clientY', { value: y, configurable: true })
        return ev
      }
      await act(async () => {
        fireEvent(
          groupEl,
          patchCoords(createEvent.drop(groupEl, { dataTransfer }), 180, 100),
        )
      })

      // The tab moved into a NEW group…
      expect(
        container.querySelectorAll('[data-workspace-group]').length,
      ).toBe(2)
      const hydraGroupId = container
        .querySelector('[data-workspace-tab="t-hydra"]')!
        .closest('[data-workspace-group]')!
        .getAttribute('data-workspace-group')!
      expect(hydraGroupId).not.toBe(originalGroupId)

      // …and the backdrop moved WITH it (Bug1): exactly one backdrop layer,
      // pinned to the tab's new group, none left on the original group.
      const backdrops = container.querySelectorAll(
        '[data-workspace-background]',
      )
      expect(backdrops.length).toBe(1)
      expect(backdrops[0].getAttribute('data-workspace-background')).toBe(
        hydraGroupId,
      )
      // The move itself never interrupts the audio.
      expect(builtinSampleStopSpy).not.toHaveBeenCalled()

      // Bug2 regression guard: the remounted chrome in the new group SEES the
      // live backdrop (Pause transport) — not a fresh idle "▶ Play" whose
      // re-activation used to clobber the audio-teardown record with a
      // 'default' ref that close could not stop.
      expect(
        getByTestId('viz-chrome-open-preview').getAttribute(
          'data-button-state',
        ),
      ).toBe('running')

      // Close the moved tab → the teardown still stops the sample audio and
      // clears the backdrop (Bug2).
      await act(async () => {
        fireEvent.click(getByTestId('tab-close-t-hydra'))
      })
      expect(builtinSampleStopSpy).toHaveBeenCalledTimes(1)
      expect(
        container.querySelectorAll('[data-workspace-background]').length,
      ).toBe(0)
    })

    it('#788 — changing a LIVE backdrop\'s source re-keys the teardown record; close stops the CURRENT source', async () => {
      const { HYDRA_VIZ } = await import('../preview/hydraViz')
      const tabs = [editorTab('t-hydra', 'f-hydra')]
      const { getByTestId } = render(
        <WorkspaceShell initialTabs={tabs} previewProviderFor={() => HYDRA_VIZ} />,
      )
      builtinSampleStartSpy.mockClear()
      builtinSampleStopSpy.mockClear()
      builtinDrumStartSpy.mockClear()
      builtinDrumStopSpy.mockClear()

      // Sample source → backdrop (records sample as the teardown source).
      await act(async () => {
        fireEvent.click(getByTestId('viz-chrome-settings'))
      })
      await act(async () => {
        fireEvent.change(getByTestId('viz-chrome-source'), {
          target: { value: 'file:__example_sample__' },
        })
      })
      await act(async () => {
        fireEvent.click(getByTestId('viz-preview-mode-backdrop'))
      })
      expect(builtinSampleStartSpy).toHaveBeenCalled()

      // Swap the source to drums WHILE the backdrop is live: the chrome swaps
      // the audio (drums start, sample stops) and must re-key the shell's
      // teardown record to drums.
      await act(async () => {
        fireEvent.change(getByTestId('viz-chrome-source'), {
          target: { value: 'file:__example_drums__' },
        })
      })
      expect(builtinDrumStartSpy).toHaveBeenCalled()
      expect(builtinSampleStopSpy).toHaveBeenCalledTimes(1)
      expect(builtinDrumStopSpy).not.toHaveBeenCalled()

      // Close the viz file tab → teardown stops DRUMS (the current source),
      // not the stale sample recorded at activation.
      await act(async () => {
        fireEvent.click(getByTestId('tab-close-t-hydra'))
      })
      expect(builtinDrumStopSpy).toHaveBeenCalledTimes(1)
      // The sample was only stopped once — by the swap, not by teardown.
      expect(builtinSampleStopSpy).toHaveBeenCalledTimes(1)
    })

    it('editor tab chrome flips Preview → Stop → Play through real shell state (regression)', async () => {
      // Integration regression for the three-state chrome button.
      // The chrome should show:
      //   - "▶ Preview" when no preview tab exists for the file
      //   - "■ Stop"    after clicking Preview (preview now open)
      //   - "▶ Play"    after clicking Stop  (preview now paused)
      //
      // This exercises the full shell → chrome → click → shell-state
      // → chrome re-render loop that the isolated hydraViz chrome
      // tests can't cover (they call renderEditorChrome directly
      // with hand-crafted context objects). If the shell fails to
      // thread previewOpen / previewPaused into the chrome after
      // state updates, this test catches it.
      const provider: PreviewProvider = {
        extensions: ['hydra'],
        label: 'Chrome Test',
        keepRunningWhenHidden: false,
        reload: 'instant',
        render: () => <div data-testid="stub-preview-output" />,
        renderEditorChrome: (ctx: PreviewEditorChromeContext) => (
          <div
            data-testid="chrome-stub"
            data-button-state={
              !ctx.previewOpen
                ? 'closed'
                : ctx.previewPaused
                  ? 'paused'
                  : 'running'
            }
            onClick={() => {
              if (ctx.previewOpen && ctx.onTogglePausePreview) {
                ctx.onTogglePausePreview()
              } else {
                ctx.onOpenPreview()
              }
            }}
          />
        ),
      }
      const tabs = [editorTab('t-hydra', 'f-hydra')]
      const { getByTestId } = render(
        <WorkspaceShell
          initialTabs={tabs}
          previewProviderFor={() => provider}
        />,
      )

      // Initial: chrome should be in 'closed' state (no preview tab).
      const chromeClosed = getByTestId('chrome-stub')
      expect(chromeClosed.getAttribute('data-button-state')).toBe('closed')

      // Click Preview → shell splits off a preview group. After the
      // state update propagates, the chrome should re-render in
      // 'running' state.
      await act(async () => {
        fireEvent.click(chromeClosed)
      })
      const chromeRunning = getByTestId('chrome-stub')
      expect(chromeRunning.getAttribute('data-button-state')).toBe('running')

      // Click Stop → pausedPreviews gains an entry for f-hydra. Chrome
      // re-renders in 'paused' state.
      await act(async () => {
        fireEvent.click(chromeRunning)
      })
      const chromePaused = getByTestId('chrome-stub')
      expect(chromePaused.getAttribute('data-button-state')).toBe('paused')

      // Click Play → pausedPreviews entry removed. Back to 'running'.
      await act(async () => {
        fireEvent.click(chromePaused)
      })
      expect(
        getByTestId('chrome-stub').getAttribute('data-button-state'),
      ).toBe('running')
    })

    it('Stop click dispatches stopIfRunning on the open preview tab\'s built-in source (issue #3)', async () => {
      // The chrome's local `selectedSource` state can be wiped by
      // layout-shape-driven remounts (one group → two groups when
      // Preview opens, the IIFE-vs-SplitPane render path swap).
      // Therefore the audio start/stop dispatch on Stop click MUST
      // come from the shell side, reading the OPEN PREVIEW TAB's
      // sourceRef as the source of truth — not the chrome's local
      // selectedSource.
      //
      // This test simulates that exact path: open a preview tab pinned
      // to the drum source via `onOpenPreview(sourceRef)`, then click
      // Stop, and assert the shell dispatched `stopIfRunning` on the
      // mocked drum source.
      builtinDrumStopSpy.mockClear()
      builtinDrumStartSpy.mockClear()
      const provider: PreviewProvider = {
        extensions: ['hydra'],
        label: 'Audio Dispatch Test',
        keepRunningWhenHidden: false,
        reload: 'instant',
        render: () => <div data-testid="stub-preview-output" />,
        renderEditorChrome: (ctx: PreviewEditorChromeContext) => (
          <div
            data-testid="chrome-stub"
            data-button-state={
              !ctx.previewOpen
                ? 'closed'
                : ctx.previewPaused
                  ? 'paused'
                  : 'running'
            }
            onClick={() => {
              if (ctx.previewOpen && ctx.onTogglePausePreview) {
                ctx.onTogglePausePreview()
              } else {
                ctx.onOpenPreview({
                  kind: 'file',
                  fileId: '__example_drums__',
                })
              }
            }}
          />
        ),
      }
      const tabs = [editorTab('t-hydra', 'f-hydra')]
      const { getByTestId } = render(
        <WorkspaceShell
          initialTabs={tabs}
          previewProviderFor={() => provider}
        />,
      )

      // Click Preview → opens a preview tab pinned to drums.
      // No audio dispatch yet (Preview click goes through the chrome's
      // existing startIfIdle path, which our stub doesn't exercise — we
      // only care about Stop click for this test).
      await act(async () => {
        fireEvent.click(getByTestId('chrome-stub'))
      })
      expect(getByTestId('chrome-stub').getAttribute('data-button-state')).toBe(
        'running',
      )
      // Reset spies — we only want to assert on the Stop click.
      builtinDrumStopSpy.mockClear()
      builtinDrumStartSpy.mockClear()

      // Click Stop → shell flips pausedPreviews AND dispatches
      // builtin.stopIfRunning() because the preview tab's sourceRef
      // is the drum example.
      await act(async () => {
        fireEvent.click(getByTestId('chrome-stub'))
      })
      expect(getByTestId('chrome-stub').getAttribute('data-button-state')).toBe(
        'paused',
      )
      expect(builtinDrumStopSpy).toHaveBeenCalledTimes(1)
      expect(builtinDrumStartSpy).not.toHaveBeenCalled()

      // Click Play → resumes the audio loop.
      builtinDrumStopSpy.mockClear()
      builtinDrumStartSpy.mockClear()
      await act(async () => {
        fireEvent.click(getByTestId('chrome-stub'))
      })
      expect(getByTestId('chrome-stub').getAttribute('data-button-state')).toBe(
        'running',
      )
      expect(builtinDrumStartSpy).toHaveBeenCalledTimes(1)
      expect(builtinDrumStopSpy).not.toHaveBeenCalled()
    })

    it('Closing a preview tab pinned to a built-in source stops the audio (issue #3)', async () => {
      // Tab × close path. The shell's handleTabClose is responsible for
      // dispatching stopIfRunning when the closed preview tab was pinned
      // to a built-in example. Without it, "× the tab → silence" doesn't
      // work and the drum loop keeps playing in the background.
      builtinChordStopSpy.mockClear()
      const provider: PreviewProvider = {
        extensions: ['hydra'],
        label: 'Tab Close Test',
        keepRunningWhenHidden: false,
        reload: 'instant',
        render: () => <div data-testid="stub-preview-output" />,
      }
      const tabs = [
        editorTab('t-hydra', 'f-hydra'),
        previewTab('t-preview', 'f-hydra'),
      ]
      // Override the preview tab's sourceRef to a built-in chord.
      const tabsWithSource = tabs.map((t) =>
        t.id === 't-preview' && t.kind === 'preview'
          ? {
              ...t,
              sourceRef: {
                kind: 'file' as const,
                fileId: '__example_chords__',
              },
            }
          : t,
      )
      const { container } = render(
        <WorkspaceShell
          initialTabs={tabsWithSource}
          previewProviderFor={() => provider}
        />,
      )

      // Close the preview tab via its × button. The selector is the
      // tab close button — find by data-workspace-tab + a child close
      // control. Looking at the shell render: tabs are
      // `[data-workspace-tab="${tab.id}"]` with a button inside.
      const previewTabEl = container.querySelector(
        '[data-workspace-tab="t-preview"]',
      ) as HTMLElement
      expect(previewTabEl).not.toBeNull()
      const closeBtn = previewTabEl.querySelector('button')
      expect(closeBtn).not.toBeNull()
      await act(async () => {
        fireEvent.click(closeBtn!)
      })

      expect(builtinChordStopSpy).toHaveBeenCalledTimes(1)
    })

    it('preview-kind with no provider renders the no-provider message', () => {
      const tabs = [previewTab('t-p', 'f-hydra')]
      const { getByTestId } = render(
        <WorkspaceShell initialTabs={tabs} previewProviderFor={() => undefined} />,
      )
      expect(getByTestId('preview-no-provider-t-p')).toBeTruthy()
    })

    it('passes chromeForTab output into the EditorView chrome slot', () => {
      const tabs = [editorTab('t-e', 'f-strudel')]
      const { container } = render(
        <WorkspaceShell
          initialTabs={tabs}
          chromeForTab={(tab) =>
            tab.kind === 'editor' ? (
              <div data-testid={`chrome-for-${tab.id}`}>chrome!</div>
            ) : undefined
          }
        />,
      )
      const slot = container.querySelector(
        '[data-workspace-view-slot="chrome"]',
      )
      expect(slot).not.toBeNull()
      expect(slot?.textContent).toBe('chrome!')
    })
  })

  describe('group split', () => {
    it('creates a new sibling group and renders two groups inside a SplitPane', () => {
      const tabs = [editorTab('t-a', 'f-strudel')]
      const { container, getByTestId } = render(
        <WorkspaceShell initialTabs={tabs} />,
      )
      // Only one group to start with.
      expect(
        container.querySelectorAll('[data-workspace-group]').length,
      ).toBe(1)
      // Find the split button on the initial group (id is generated).
      const splitBtn = container.querySelector(
        '[data-testid^="group-split-"]',
      ) as HTMLElement
      expect(splitBtn).not.toBeNull()
      fireEvent.click(splitBtn)
      // Two groups now.
      expect(
        container.querySelectorAll('[data-workspace-group]').length,
      ).toBe(2)
      // The second group is empty — renders the empty-state hint.
      const emptyStates = container.querySelectorAll(
        '[data-testid^="group-empty-"]',
      )
      expect(emptyStates.length).toBe(1)
      // And the close-group button is now visible on both groups.
      const closeBtns = container.querySelectorAll(
        '[data-testid^="group-close-"]',
      )
      expect(closeBtns.length).toBe(2)
      // silence unused warning
      void getByTestId
    })
  })

  describe('group close', () => {
    it('merges tabs from the closed group into the neighbor', () => {
      const tabs = [editorTab('t-a', 'f-strudel')]
      const { container } = render(<WorkspaceShell initialTabs={tabs} />)
      // Split to create a second empty group.
      const splitBtn = container.querySelector(
        '[data-testid^="group-split-"]',
      ) as HTMLElement
      fireEvent.click(splitBtn)
      // Now close the ORIGINAL group (the one with t-a). Find its
      // close-group button via the group id that contains the tab.
      const originalGroup = container
        .querySelector('[data-workspace-tab="t-a"]')
        ?.closest('[data-workspace-group]') as HTMLElement
      const originalGroupId = originalGroup?.getAttribute(
        'data-workspace-group',
      )
      const closeBtn = container.querySelector(
        `[data-testid="group-close-${originalGroupId}"]`,
      ) as HTMLElement
      fireEvent.click(closeBtn)
      // Only one group left.
      expect(
        container.querySelectorAll('[data-workspace-group]').length,
      ).toBe(1)
      // t-a survived the merge and is visible.
      expect(
        container.querySelector('[data-workspace-tab="t-a"]'),
      ).not.toBeNull()
    })

    it('auto-collapses a group when closing its last tab (non-only group)', () => {
      // VS Code parity: closing the × on the last tab of a non-only
      // group should remove the group entirely — no "Drop a tab here"
      // placeholder left behind. Previously the user had to hunt
      // down the tiny group-close × on the chrome bar to dismiss the
      // area, which was effectively hidden.
      const tabs = [
        editorTab('t-a', 'f-strudel'),
        editorTab('t-b', 'f-hydra'),
      ]
      const { container } = render(<WorkspaceShell initialTabs={tabs} />)
      // Split to create a second empty group so we have 2 groups total.
      const splitBtn = container.querySelector(
        '[data-testid^="group-split-"]',
      ) as HTMLElement
      fireEvent.click(splitBtn)
      // Now drag t-b into the second group so it's the only tab there.
      // Simpler path for the test: just verify the close-last-tab-of-
      // a-non-only-group behavior by closing t-b first, which leaves
      // only t-a in the original group PLUS the empty second group.
      // Close the empty group via its × so we're at a clean 2-group
      // state with one tab in each? No — simpler: programmatically
      // arrange via public API.
      //
      // The direct test: close t-a while 2 groups exist. t-a is the
      // last tab of its group → group should collapse.
      const tabACloseBtn = container.querySelector(
        '[data-testid="tab-close-t-a"]',
      ) as HTMLElement
      // Close t-b first (so the first group has only t-a).
      const tabBCloseBtn = container.querySelector(
        '[data-testid="tab-close-t-b"]',
      ) as HTMLElement
      fireEvent.click(tabBCloseBtn)
      // Now the first group has only t-a; the second group (from
      // split) is still empty. Close t-a → group should collapse AND
      // leave us with just the empty split group.
      fireEvent.click(tabACloseBtn)
      const groupsAfter = container.querySelectorAll(
        '[data-workspace-group]',
      )
      // Exactly one group remains (the empty split one). The
      // collapse-on-last-tab eliminated the original group.
      expect(groupsAfter.length).toBe(1)
    })

    it('leaves the only group intact when closing its last tab', () => {
      // Edge case: if closing the last tab of the ONLY group, we
      // cannot remove that group (the shell would have nothing to
      // render). The group stays, empty. This preserves the
      // "Drop a tab here" placeholder as the zero-tab fallback.
      const tabs = [editorTab('t-a', 'f-strudel')]
      const { container } = render(<WorkspaceShell initialTabs={tabs} />)
      const tabACloseBtn = container.querySelector(
        '[data-testid="tab-close-t-a"]',
      ) as HTMLElement
      fireEvent.click(tabACloseBtn)
      const groupsAfter = container.querySelectorAll(
        '[data-workspace-group]',
      )
      // Still one group, but now empty.
      expect(groupsAfter.length).toBe(1)
    })

    it('ignores close-group when only one group exists', () => {
      const tabs = [editorTab('t-a', 'f-strudel')]
      const { container } = render(<WorkspaceShell initialTabs={tabs} />)
      // With only one group, the close-group button is not rendered
      // (canClose === false). That's the "ignore" behavior.
      expect(
        container.querySelector('[data-testid^="group-close-"]'),
      ).toBeNull()
    })
  })

  describe('drag-drop between groups', () => {
    it('moves a tab from group A to group B and activates it there', () => {
      const tabs = [
        editorTab('t-a', 'f-strudel'),
        editorTab('t-b', 'f-hydra'),
      ]
      const { container } = render(<WorkspaceShell initialTabs={tabs} />)
      // Split to create a second group.
      const splitBtn = container.querySelector(
        '[data-testid^="group-split-"]',
      ) as HTMLElement
      fireEvent.click(splitBtn)

      const groupEls = container.querySelectorAll(
        '[data-workspace-group]',
      ) as NodeListOf<HTMLElement>
      expect(groupEls.length).toBe(2)
      const sourceGroupId = groupEls[0].getAttribute('data-workspace-group')!
      const targetGroupId = groupEls[1].getAttribute('data-workspace-group')!

      // Simulate dragstart on t-b — we need a DataTransfer shim because
      // jsdom's fireEvent.dragStart sets one up but doesn't persist
      // setData across the subsequent drop.
      const dataStore: Record<string, string> = {}
      const dataTransfer = {
        setData: (type: string, value: string) => {
          dataStore[type] = value
        },
        getData: (type: string) => dataStore[type] ?? '',
        types: [] as string[],
        effectAllowed: '',
        dropEffect: '',
      }

      const tabB = container.querySelector(
        '[data-workspace-tab="t-b"]',
      ) as HTMLElement
      fireEvent.dragStart(tabB, { dataTransfer })
      dataTransfer.types.push('application/workspace-tab')

      // DragOver + drop on the target group (the empty one).
      const targetGroupEl = groupEls[1]
      fireEvent.dragOver(targetGroupEl, { dataTransfer })
      fireEvent.drop(targetGroupEl, { dataTransfer })

      // t-b should now be inside the target group.
      const tbAfter = container.querySelector(
        '[data-workspace-tab="t-b"]',
      ) as HTMLElement
      const containingGroup = tbAfter.closest('[data-workspace-group]')
      expect(containingGroup?.getAttribute('data-workspace-group')).toBe(
        targetGroupId,
      )
      expect(tbAfter.getAttribute('data-tab-active')).toBe('true')

      // And t-a should still be in the source group.
      const taAfter = container.querySelector(
        '[data-workspace-tab="t-a"]',
      ) as HTMLElement
      expect(
        taAfter
          .closest('[data-workspace-group]')
          ?.getAttribute('data-workspace-group'),
      ).toBe(sourceGroupId)
    })

    it('splits within the same group when dragging a tab to its own directional quadrant', () => {
      // The common case: all seed tabs start in ONE group. The user
      // drags a tab to the east quadrant of that same group expecting
      // a new split to appear. This regression test makes sure the
      // drop handler does not early-return just because source and
      // target are the same group.
      //
      // Implementation note: React Testing Library's `fireEvent.drop`
      // with `{ clientX, clientY }` in the init dict does NOT propagate
      // those values into the React SyntheticEvent reliably. We work
      // around that by dispatching a native DragEvent directly with
      // `bubbles: true` so React's delegated root listener picks it
      // up with the coordinates attached.
      const tabs = [
        editorTab('t-a', 'f-strudel'),
        editorTab('t-b', 'f-hydra'),
      ]
      const { container } = render(<WorkspaceShell initialTabs={tabs} />)
      const groupsBefore = container.querySelectorAll(
        '[data-workspace-group]',
      )
      expect(groupsBefore.length).toBe(1)

      // Mock getBoundingClientRect on the group so computeQuadrant
      // sees a real 200×200 rect — jsdom otherwise returns zero-size
      // which makes the defensive path collapse to 'center'.
      const groupEl = groupsBefore[0] as HTMLElement
      groupEl.getBoundingClientRect = () =>
        ({
          x: 0, y: 0, left: 0, top: 0,
          width: 200, height: 200,
          right: 200, bottom: 200,
          toJSON: () => ({}),
        }) as DOMRect

      const dataStore: Record<string, string> = {}
      const dataTransfer = {
        setData: (type: string, value: string) => {
          dataStore[type] = value
        },
        getData: (type: string) => dataStore[type] ?? '',
        types: [] as string[],
        effectAllowed: '',
        dropEffect: '',
      }

      const tabB = container.querySelector(
        '[data-workspace-tab="t-b"]',
      ) as HTMLElement
      fireEvent.dragStart(tabB, { dataTransfer })
      dataTransfer.types.push('application/workspace-tab')

      // React Testing Library's `createEvent.drop` builds a proper
      // DragEvent that React's delegated listener recognizes. We patch
      // `clientX`/`clientY` via `defineProperty` because RTL's init
      // dict path doesn't reliably set them, and fireEvent otherwise
      // strips them. Same treatment for dragover.
      const patchCoords = <E extends Event>(ev: E, x: number, y: number): E => {
        Object.defineProperty(ev, 'clientX', { value: x, configurable: true })
        Object.defineProperty(ev, 'clientY', { value: y, configurable: true })
        return ev
      }
      const dragOverEvent = patchCoords(
        createEvent.dragOver(groupEl, { dataTransfer }),
        180,
        100,
      )
      fireEvent(groupEl, dragOverEvent)
      const dropEvent = patchCoords(
        createEvent.drop(groupEl, { dataTransfer }),
        180,
        100,
      )
      fireEvent(groupEl, dropEvent)

      // After the drop we should have TWO groups — the original (with
      // t-a still in it) and a new one (with t-b moved into it).
      const groupsAfter = container.querySelectorAll(
        '[data-workspace-group]',
      )
      expect(groupsAfter.length).toBe(2)

      // t-b should be in a different group than t-a.
      const tbAfter = container.querySelector(
        '[data-workspace-tab="t-b"]',
      ) as HTMLElement
      const taAfter = container.querySelector(
        '[data-workspace-tab="t-a"]',
      ) as HTMLElement
      const tbGroup = tbAfter.closest('[data-workspace-group]')
      const taGroup = taAfter.closest('[data-workspace-group]')
      expect(tbGroup).not.toBe(taGroup)
    })

    it('is a no-op when dragging the ONLY tab in a single-tab group to its own quadrant', () => {
      // Degenerate case — splitting a single tab off of its own group
      // would collapse the source and re-home the tab as the only
      // tab of a new group, producing a visually identical state. The
      // drop should be a no-op so the user doesn't see a phantom
      // reorganization.
      const tabs = [editorTab('t-a', 'f-strudel')]
      const { container } = render(<WorkspaceShell initialTabs={tabs} />)

      const groupEl = container.querySelector(
        '[data-workspace-group]',
      ) as HTMLElement
      groupEl.getBoundingClientRect = () =>
        ({
          x: 0, y: 0, left: 0, top: 0,
          width: 200, height: 200,
          right: 200, bottom: 200,
          toJSON: () => ({}),
        }) as DOMRect

      const dataStore: Record<string, string> = {}
      const dataTransfer = {
        setData: (type: string, value: string) => {
          dataStore[type] = value
        },
        getData: (type: string) => dataStore[type] ?? '',
        types: [] as string[],
        effectAllowed: '',
        dropEffect: '',
      }

      const tabA = container.querySelector(
        '[data-workspace-tab="t-a"]',
      ) as HTMLElement
      fireEvent.dragStart(tabA, { dataTransfer })
      dataTransfer.types.push('application/workspace-tab')

      const patchCoords2 = <E extends Event>(ev: E, x: number, y: number): E => {
        Object.defineProperty(ev, 'clientX', { value: x, configurable: true })
        Object.defineProperty(ev, 'clientY', { value: y, configurable: true })
        return ev
      }
      fireEvent(
        groupEl,
        patchCoords2(
          createEvent.dragOver(groupEl, { dataTransfer }),
          180,
          100,
        ),
      )
      fireEvent(
        groupEl,
        patchCoords2(createEvent.drop(groupEl, { dataTransfer }), 180, 100),
      )

      // Still exactly one group, t-a still in it.
      const groupsAfter = container.querySelectorAll(
        '[data-workspace-group]',
      )
      expect(groupsAfter.length).toBe(1)
    })
  })

  describe('theme (PV6 / P6 guard)', () => {
    it('applies the dark theme to the shell root', () => {
      const tabs = [editorTab('t-a', 'f-strudel')]
      const { container } = render(
        <WorkspaceShell initialTabs={tabs} theme="dark" />,
      )
      const root = container.querySelector(
        '[data-workspace-shell="root"]',
      ) as HTMLElement
      expect(root).not.toBeNull()
      expect(root.style.getPropertyValue('--code-bg')).toBe('#090912')
    })

    it('applies the light theme when requested', () => {
      const tabs = [editorTab('t-a', 'f-strudel')]
      const { container } = render(
        <WorkspaceShell initialTabs={tabs} theme="light" />,
      )
      const root = container.querySelector(
        '[data-workspace-shell="root"]',
      ) as HTMLElement
      expect(root.style.getPropertyValue('--code-bg')).toBe('#f0f0f6')
    })
  })

  describe('onActiveTabChange on group switch', () => {
    it('fires when the user mousedown-clicks into a different group', () => {
      const tabs = [editorTab('t-a', 'f-strudel')]
      const onActiveTabChange = vi.fn()
      const { container } = render(
        <WorkspaceShell
          initialTabs={tabs}
          onActiveTabChange={onActiveTabChange}
        />,
      )
      // Split to get a second group (empty).
      const splitBtn = container.querySelector(
        '[data-testid^="group-split-"]',
      ) as HTMLElement
      fireEvent.click(splitBtn)
      onActiveTabChange.mockClear()

      // Click into the empty group's content area.
      const emptyContent = container.querySelector(
        '[data-testid^="group-empty-"]',
      ) as HTMLElement
      // The mousedown listener lives on the group wrapper; bubble up.
      const groupRoot = emptyContent.closest(
        '[data-workspace-group]',
      ) as HTMLElement
      fireEvent.mouseDown(groupRoot)
      // Switching into an empty group means the active tab is null.
      expect(onActiveTabChange).toHaveBeenLastCalledWith(null)
    })
  })

  describe('PV7 acceptance — previewMode is NOT in the shell source', () => {
    it('has zero occurrences of "previewMode" in WorkspaceShell.tsx or types.ts additions', () => {
      // Read the shell source from disk. This is the acceptance test
      // from the task spec: PLAN.md §10.2-04 says `grep -n "previewMode"`
      // on the new file must return zero.
      const shellPath = path.resolve(
        __dirname,
        '..',
        'WorkspaceShell.tsx',
      )
      const shellSrc = fs.readFileSync(shellPath, 'utf8')
      expect(shellSrc).not.toMatch(/previewMode/)
      // Also check the Task 04 type additions. We only scan the
      // "Task 04 — WorkspaceShell" section marker down, so Task 03's
      // types that have nothing to do with previewMode stay out of
      // scope. A simple occurrence check suffices since types.ts has
      // never mentioned previewMode in any section.
      const typesPath = path.resolve(__dirname, '..', 'types.ts')
      const typesSrc = fs.readFileSync(typesPath, 'utf8')
      expect(typesSrc).not.toMatch(/previewMode/)
    })
  })

  describe('switching active groups updates the resolved active tab', () => {
    it('reports the right tab when user drags across groups', () => {
      const tabs = [
        editorTab('t-a', 'f-strudel'),
        editorTab('t-b', 'f-hydra'),
      ]
      const onActiveTabChange = vi.fn()
      const { container } = render(
        <WorkspaceShell
          initialTabs={tabs}
          onActiveTabChange={onActiveTabChange}
        />,
      )
      onActiveTabChange.mockClear()

      // Split and move t-b across.
      const splitBtn = container.querySelector(
        '[data-testid^="group-split-"]',
      ) as HTMLElement
      fireEvent.click(splitBtn)
      const groupEls = container.querySelectorAll(
        '[data-workspace-group]',
      ) as NodeListOf<HTMLElement>

      const dataStore: Record<string, string> = {}
      const dataTransfer = {
        setData: (type: string, value: string) => {
          dataStore[type] = value
        },
        getData: (type: string) => dataStore[type] ?? '',
        types: [] as string[],
        effectAllowed: '',
        dropEffect: '',
      }

      const tabB = container.querySelector(
        '[data-workspace-tab="t-b"]',
      ) as HTMLElement
      fireEvent.dragStart(tabB, { dataTransfer })
      dataTransfer.types.push('application/workspace-tab')
      fireEvent.dragOver(groupEls[1], { dataTransfer })
      fireEvent.drop(groupEls[1], { dataTransfer })

      // After the drop, the active tab is t-b (in the target group).
      expect(onActiveTabChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 't-b' }),
      )
    })
  })

  describe('tab bar overflow (#177)', () => {
    it('places pinned group actions OUTSIDE the scrollable tab strip', () => {
      // Regression for #177 — before this fix, the split / close buttons
      // lived inside the same overflowX:auto container as the tabs and
      // scrolled off the right edge once enough tabs were open.
      const tabs = [editorTab('t-a', 'f-strudel'), editorTab('t-b', 'f-hydra')]
      const { container } = render(
        <WorkspaceShell initialTabs={tabs} />,
      )
      const groupEl = container.querySelector('[data-workspace-group]')
      const strip = groupEl?.querySelector('[data-workspace-tab-strip]')
      const splitBtn = container.querySelector(
        '[data-testid^="group-split-"]',
      )
      expect(strip).not.toBeNull()
      expect(splitBtn).not.toBeNull()
      expect(strip?.contains(splitBtn ?? null)).toBe(false)
    })

    it('hides the overflow menu when no overflow', () => {
      const tabs = [editorTab('t-a', 'f-strudel')]
      const { container } = render(
        <WorkspaceShell initialTabs={tabs} />,
      )
      expect(
        container.querySelector('[data-testid^="tab-overflow-menu-"]'),
      ).toBeNull()
    })

    it('renders the overflow ▾ menu when scrollWidth exceeds clientWidth, lists all tabs, and click jumps activation', () => {
      const tabs = [
        editorTab('t-a', 'f-strudel'),
        editorTab('t-b', 'f-hydra'),
        editorTab('t-c', 'f-p5'),
      ]
      const onActiveTabChange = vi.fn()
      const { container, getByTestId } = render(
        <WorkspaceShell
          initialTabs={tabs}
          onActiveTabChange={onActiveTabChange}
        />,
      )
      const strip = container.querySelector(
        '[data-workspace-tab-strip]',
      ) as HTMLElement | null
      expect(strip).not.toBeNull()
      // Simulate overflow: tabs would need 1000px but the strip is 200px.
      // The scroll listener inside GroupTabBar reads scrollWidth/clientWidth
      // and updates state — triggering it via fireEvent.scroll exercises
      // the same code path the user does by scrolling the strip.
      Object.defineProperty(strip!, 'scrollWidth', {
        value: 1000,
        configurable: true,
      })
      Object.defineProperty(strip!, 'clientWidth', {
        value: 200,
        configurable: true,
      })
      Object.defineProperty(strip!, 'scrollLeft', {
        value: 0,
        configurable: true,
        writable: true,
      })
      act(() => {
        fireEvent.scroll(strip!)
      })
      // Overflow menu button appears.
      const menuBtn = container.querySelector(
        '[data-testid^="tab-overflow-menu-"]',
      ) as HTMLButtonElement | null
      expect(menuBtn).not.toBeNull()
      // Open the menu — all three tabs listed.
      act(() => {
        fireEvent.click(menuBtn!)
      })
      const itemA = container.querySelector(
        '[data-testid="tab-overflow-item-t-a"]',
      )
      const itemB = container.querySelector(
        '[data-testid="tab-overflow-item-t-b"]',
      )
      const itemC = container.querySelector(
        '[data-testid="tab-overflow-item-t-c"]',
      )
      expect(itemA).not.toBeNull()
      expect(itemB).not.toBeNull()
      expect(itemC).not.toBeNull()
      // Reset the activation spy before the jump click so we can assert on it.
      onActiveTabChange.mockClear()
      act(() => {
        fireEvent.click(itemC!)
      })
      expect(onActiveTabChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't-c' }),
      )
      // Active tab attribute flips to t-c.
      const tabC = container.querySelector('[data-workspace-tab="t-c"]')
      expect(tabC?.getAttribute('data-tab-active')).toBe('true')
      // Menu closes after pick — getByTestId throws if absent, so use query.
      expect(
        container.querySelector('[data-testid^="tab-overflow-list-"]'),
      ).toBeNull()
      // Silence unused-variable warning for getByTestId.
      void getByTestId
    })

    it('scrolls the active tab into view when activation changes', () => {
      const tabs = [editorTab('t-a', 'f-strudel'), editorTab('t-b', 'f-hydra')]
      const calls: string[] = []
      const originalProto = HTMLElement.prototype as unknown as {
        scrollIntoView?: () => void
      }
      const hadOriginal = 'scrollIntoView' in HTMLElement.prototype
      const original = originalProto.scrollIntoView
      originalProto.scrollIntoView = function (this: HTMLElement) {
        calls.push(this.getAttribute('data-workspace-tab') ?? '?')
      }
      try {
        const { getByTestId } = render(
          <WorkspaceShell initialTabs={tabs} />,
        )
        // Initial mount call fires for t-a (the active tab on mount).
        const initialCount = calls.length
        // Click t-b → activation changes → effect re-runs.
        fireEvent.click(getByTestId('mock-monaco-editor'))
        // Click the t-b tab in the strip to switch activation.
        fireEvent.click(
          document.querySelector('[data-workspace-tab="t-b"]') as HTMLElement,
        )
        expect(calls.length).toBeGreaterThan(initialCount)
        expect(calls).toContain('t-b')
      } finally {
        if (hadOriginal && original) {
          originalProto.scrollIntoView = original
        } else {
          delete (originalProto as { scrollIntoView?: () => void }).scrollIntoView
        }
      }
    })
  })

  // Silence the unused imports that some branches above don't reach
  // in every test. `act` is imported for future timing tests; kept
  // here to keep the import list stable across plan tasks.
  it('act import stays stable', () => {
    expect(typeof act).toBe('function')
  })
})
