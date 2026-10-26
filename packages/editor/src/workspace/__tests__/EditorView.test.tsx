/**
 * EditorView — unit tests (Phase 10.2 Task 03).
 *
 * Covers the component's observable contract:
 *
 *   - Mounts inside its container and applies the theme via
 *     `applyTheme` on the container (PV6 / P6 guard — verified by reading
 *     the container's inline style property for a known CSS variable).
 *   - Shows a loading placeholder when the workspace file is not yet
 *     registered; does NOT mount Monaco in that state.
 *   - Sets Monaco `language` from `WorkspaceFile.language`.
 *   - Monaco `value` starts equal to `file.content`.
 *   - Monaco `onChange` calls `setContent` on the workspace store — i.e.,
 *     typing in the editor persists back to the store.
 *   - `chromeSlot` is rendered above the Monaco editor, inside the same
 *     DOM root.
 *   - `onMount` is called with the mocked editor/monaco instances.
 *
 * ## Why mock `@monaco-editor/react`
 *
 * Monaco ships a ~2MB bundle that does not run cleanly in jsdom (no
 * Worker support, canvas layout, etc.). Every test suite in this
 * repository that touches Monaco either stubs the editor out entirely
 * or avoids rendering it. We take the "stub" route here because the
 * behavior under test is the glue between the workspace file store and
 * the editor props — not Monaco itself.
 *
 * The mock records the most recent `{ language, value, onChange,
 * onMount, options }` props to a module-local `captured` object so
 * tests can assert against them and simulate `onChange` events. The
 * mock renders a div that looks enough like Monaco for theme assertions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock @monaco-editor/react BEFORE importing EditorView so the import
// resolves to the stub.
// ---------------------------------------------------------------------------

interface MonacoEditorProps {
  language?: string
  value?: string
  onChange?: (value: string | undefined) => void
  onMount?: (editor: unknown, monaco: unknown) => void
  options?: Record<string, unknown>
  height?: string | number
}

interface MonacoCapture {
  props: MonacoEditorProps | null
  mountCount: number
}

const capture: MonacoCapture = { props: null, mountCount: 0 }

// Stand-in for the real Monaco module. The `onMount` callback in
// `EditorView` will be called with `(stubEditor, stubMonaco)`; the stub
// `monaco` must expose enough of the `languages` surface that
// `ensureWorkspaceLanguages` can call it without throwing.
const stubEditor: Record<string, unknown> = { id: 'stub-editor' }

/** give the stub editor a model holding `text` at `version` (a new Monaco model is at 1) */
function stubModel(text: string, version: number): void {
  stubEditor.getValue = () => text
  stubEditor.getModel = () => ({ getVersionId: () => version })
}
const stubRegisteredLanguages: Array<{ id: string }> = []
const stubMonaco = {
  languages: {
    register: vi.fn((lang: { id: string }) => {
      stubRegisteredLanguages.push(lang)
    }),
    setMonarchTokensProvider: vi.fn(),
    setLanguageConfiguration: vi.fn(),
    getLanguages: vi.fn(() => stubRegisteredLanguages.slice()),
  },
}

vi.mock('@monaco-editor/react', () => ({
  default: (props: MonacoEditorProps) => {
    capture.props = props
    // Fire onMount synchronously once on every render (simulating the
    // real Monaco mount → we only count the first for the assertion).
    // React runs the jsx function during render, so we delay the mount
    // callback to the post-render phase via a dummy useEffect.
    React.useEffect(() => {
      capture.mountCount++
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

// Import AFTER the mock so `EditorView` picks it up.
import { EditorView } from '../EditorView'
import {
  createWorkspaceFile,
  getFile,
  subscribe,
  __resetWorkspaceFilesForTests,
} from '../WorkspaceFile'
import { __resetWorkspaceLanguagesForTests } from '../languages'

describe('EditorView', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    __resetWorkspaceLanguagesForTests()
    capture.props = null
    capture.mountCount = 0
    delete stubEditor.getValue
    delete stubEditor.getModel
    stubRegisteredLanguages.length = 0
    stubMonaco.languages.register.mockClear()
    stubMonaco.languages.setMonarchTokensProvider.mockClear()
    stubMonaco.languages.setLanguageConfiguration.mockClear()
  })

  it('shows a loading placeholder when the file is not registered', () => {
    const { getByText, queryByTestId } = render(
      <EditorView fileId="ghost" />,
    )
    expect(getByText('Loading…')).toBeTruthy()
    expect(queryByTestId('mock-monaco-editor')).toBeNull()
  })

  it('mounts Monaco with the file language and content once the file is registered', () => {
    createWorkspaceFile('a', 'a.strudel', 'hello world', 'strudel')
    const { getByTestId } = render(<EditorView fileId="a" />)
    const mock = getByTestId('mock-monaco-editor')
    expect(mock.getAttribute('data-language')).toBe('strudel')
    expect(mock.getAttribute('data-value')).toBe('hello world')
  })

  it('maps each workspace language to the matching Monaco language id', () => {
    const langs = ['strudel', 'sonicpi', 'hydra', 'p5js', 'markdown'] as const
    for (const lang of langs) {
      __resetWorkspaceFilesForTests()
      createWorkspaceFile(`f-${lang}`, `f.${lang}`, '// code', lang)
      const { getByTestId, unmount } = render(
        <EditorView fileId={`f-${lang}`} />,
      )
      expect(
        getByTestId('mock-monaco-editor').getAttribute('data-language'),
      ).toBe(lang)
      unmount()
    }
  })

  it('applies the dark theme to the container (PV6 / P6 guard)', () => {
    createWorkspaceFile('a', 'a.strudel', '// code', 'strudel')
    const { container } = render(<EditorView fileId="a" theme="dark" />)
    const viewRoot = container.querySelector(
      '[data-workspace-view="editor"]',
    ) as HTMLElement
    expect(viewRoot).not.toBeNull()
    // `applyTheme` writes CSS custom properties to the element's inline
    // style. jsdom does not compute CSS variable cascade, but inline
    // style.setProperty is observable via `style.getPropertyValue`.
    expect(viewRoot.style.getPropertyValue('--code-bg')).toBe('#090912')
  })

  it('applies the light theme when requested', () => {
    createWorkspaceFile('a', 'a.strudel', '// code', 'strudel')
    const { container } = render(<EditorView fileId="a" theme="light" />)
    const viewRoot = container.querySelector(
      '[data-workspace-view="editor"]',
    ) as HTMLElement
    expect(viewRoot.style.getPropertyValue('--code-bg')).toBe('#f0f0f6')
  })

  it('renders the chromeSlot above the Monaco editor inside the same root', () => {
    createWorkspaceFile('a', 'a.strudel', '// code', 'strudel')
    const { container } = render(
      <EditorView
        fileId="a"
        chromeSlot={<div data-testid="chrome-ping">chrome content</div>}
      />,
    )
    const viewRoot = container.querySelector(
      '[data-workspace-view="editor"]',
    ) as HTMLElement
    const chromeSlot = viewRoot.querySelector(
      '[data-workspace-view-slot="chrome"]',
    )
    expect(chromeSlot).not.toBeNull()
    expect(chromeSlot!.textContent).toBe('chrome content')

    // Chrome must come before the Monaco mount in DOM order. The slot
    // is the first child of the view root; the Monaco mount is inside
    // the second child (the flex-1 content area).
    const firstChild = viewRoot.firstElementChild
    expect(firstChild?.getAttribute('data-workspace-view-slot')).toBe(
      'chrome',
    )
  })

  it('calls setContent on the workspace store when Monaco fires onChange', () => {
    createWorkspaceFile('a', 'a.strudel', 'v1', 'strudel')
    render(<EditorView fileId="a" />)

    // Simulate a Monaco keystroke by invoking the captured onChange.
    act(() => {
      capture.props?.onChange?.('v2')
    })

    // The store should now hold v2 — we verify via a re-render of the
    // same component (the hook reads from the store on every render).
    // Because React has already committed the prior render, the next
    // render reflects the store's new state via getSnapshot.
    const { rerender } = render(<EditorView fileId="a" />)
    rerender(<EditorView fileId="a" />)
    expect(capture.props?.value).toBe('v2')
  })

  it('invokes the onMount callback with the editor and monaco instances', () => {
    createWorkspaceFile('a', 'a.strudel', '// code', 'strudel')
    const onMount = vi.fn()
    render(<EditorView fileId="a" onMount={onMount} />)
    expect(onMount).toHaveBeenCalledTimes(1)
    expect(onMount).toHaveBeenCalledWith(stubEditor, stubMonaco)
  })

  it('registers workspace languages via the Monaco mount handler', () => {
    createWorkspaceFile('a', 'a.strudel', '// code', 'strudel')
    render(<EditorView fileId="a" />)
    // strudel, sonicpi, hydra, p5js should all be registered on first mount.
    const registeredIds = stubMonaco.languages.register.mock.calls.map(
      (call) => (call[0] as { id: string }).id,
    )
    expect(registeredIds).toContain('strudel')
    expect(registeredIds).toContain('sonicpi')
    expect(registeredIds).toContain('hydra')
    expect(registeredIds).toContain('p5js')
  })
  // #2217 — the Monaco wrapper creates the editor in one commit and subscribes
  // onChange in the next; an edit in between reaches the editor only. The
  // mount handler writes it to the file.
  describe('an edit made before the change subscription (#2217)', () => {
    it('is written to the file when the editor mounts', () => {
      createWorkspaceFile('a', 'a.hydra', 'old', 'hydra')
      stubModel('osc(10).out()', 2)
      render(<EditorView fileId="a" />)
      expect(getFile('a')?.content).toBe('osc(10).out()')
    })

    it('an unedited model is never written back, even when its text differs (normalised line endings)', () => {
      createWorkspaceFile('a', 'a.hydra', 'a\r\nb\nc\n', 'hydra')
      stubModel('a\nb\nc\n', 1)
      render(<EditorView fileId="a" />)
      expect(getFile('a')?.content).toBe('a\r\nb\nc\n')
    })

    it('an edited model that matches the file writes nothing', () => {
      createWorkspaceFile('a', 'a.hydra', 'same', 'hydra')
      stubModel('same', 3)
      const seen: string[] = []
      const off = subscribe('a', () => seen.push(getFile('a')!.content))
      render(<EditorView fileId="a" />)
      off()
      expect(seen).toEqual([])
    })
  })
})
