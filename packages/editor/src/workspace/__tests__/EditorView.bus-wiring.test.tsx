/**
 * EditorView bus wiring tests — Phase 10.2 Task 07.
 *
 * Covers the three bus-driven features added in Task 07:
 *
 *   1. Inline view zones (D-08): bus subscription → addInlineViewZones
 *   2. Active highlighting (S5): hapStream from bus → useHighlighting
 *   3. Error diagnostics (S7): error prop → setEvalError / clearEvalErrors
 *
 * Also tests the PopoutPreview theme fix (S3) in a separate describe block.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock addInlineViewZones
// ---------------------------------------------------------------------------

const mockZoneHandle = {
  cleanup: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
}

vi.mock('../../visualizers/viewZones', () => ({
  addInlineViewZones: vi.fn(() => mockZoneHandle),
}))

// ---------------------------------------------------------------------------
// Mock useHighlighting
// ---------------------------------------------------------------------------

const mockClearAll = vi.fn()

vi.mock('../../monaco/useHighlighting', () => ({
  useHighlighting: vi.fn(() => ({ clearAll: mockClearAll })),
}))

// ---------------------------------------------------------------------------
// Mock diagnostics
// ---------------------------------------------------------------------------

vi.mock('../../monaco/diagnostics', () => ({
  setEvalError: vi.fn(),
  clearEvalErrors: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock defaultDescriptors
// ---------------------------------------------------------------------------

vi.mock('../../visualizers/defaultDescriptors', () => ({
  DEFAULT_VIZ_DESCRIPTORS: [{ id: 'pianoroll', label: 'Piano Roll' }],
}))

// ---------------------------------------------------------------------------
// Mock @monaco-editor/react
// ---------------------------------------------------------------------------

interface MonacoEditorProps {
  language?: string
  value?: string
  onChange?: (value: string | undefined) => void
  onMount?: (editor: unknown, monaco: unknown) => void
  options?: Record<string, unknown>
  height?: string | number
}

const stubModel = { getModel: () => stubModel, getLineCount: () => 1, getLineMaxColumn: () => 1 }
const stubEditor = { id: 'stub-editor', getModel: () => stubModel }
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
  editor: {
    setModelMarkers: vi.fn(),
  },
  MarkerSeverity: { Error: 8 },
}

let capturedOnMount: ((editor: unknown, monaco: unknown) => void) | null = null
// When false, the mock captures onMount but does NOT auto-invoke it. Tests
// that simulate Monaco's async mount race (e.g. split-editor while playing)
// flip this off, publish to the bus, then manually invoke capturedOnMount.
let autoFireOnMount = true

vi.mock('@monaco-editor/react', () => ({
  default: (props: MonacoEditorProps) => {
    React.useEffect(() => {
      capturedOnMount = props.onMount ?? null
      if (autoFireOnMount) {
        props.onMount?.(stubEditor, stubMonaco)
      }
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

// ---------------------------------------------------------------------------
// Imports AFTER mocks
// ---------------------------------------------------------------------------

import { EditorView } from '../EditorView'
import {
  createWorkspaceFile,
  setZoneCropOverride,
  __resetWorkspaceFilesForTests,
} from '../WorkspaceFile'
import { __resetWorkspaceLanguagesForTests } from '../languages'
import {
  workspaceAudioBus,
  __resetWorkspaceAudioBusForTests,
} from '../WorkspaceAudioBus'
import { addInlineViewZones } from '../../visualizers/viewZones'
import { useHighlighting } from '../../monaco/useHighlighting'
import { setEvalError, clearEvalErrors } from '../../monaco/diagnostics'
import type { AudioPayload } from '../types'

describe('EditorView bus wiring (Task 07)', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    __resetWorkspaceAudioBusForTests()
    __resetWorkspaceLanguagesForTests()
    capturedOnMount = null
    autoFireOnMount = true
    stubRegisteredLanguages.length = 0
    mockZoneHandle.cleanup.mockClear()
    mockZoneHandle.pause.mockClear()
    mockZoneHandle.resume.mockClear()
    mockClearAll.mockClear()
    vi.mocked(addInlineViewZones).mockClear()
    vi.mocked(addInlineViewZones).mockReturnValue(mockZoneHandle)
    vi.mocked(useHighlighting).mockClear()
    vi.mocked(setEvalError).mockClear()
    vi.mocked(clearEvalErrors).mockClear()
  })

  // ---- Inline view zones (D-08, PK3) ----

  it('subscribes to the bus with { kind: "file", fileId } — own file, not default (D-08)', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    render(<EditorView fileId="f1" />)

    // Publish under a DIFFERENT file id — should NOT trigger addInlineViewZones.
    const otherPayload: AudioPayload = {
      inlineViz: { vizRequests: new Map([['$', { vizId: 'pianoroll', afterLine: 1 }]]) } as any,
    }
    act(() => {
      workspaceAudioBus.publish('other-file', otherPayload)
    })
    expect(addInlineViewZones).not.toHaveBeenCalled()
  })

  it('calls addInlineViewZones when bus publishes a payload with viz requests', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    render(<EditorView fileId="f1" />)

    const payload: AudioPayload = {
      inlineViz: { vizRequests: new Map([['$', { vizId: 'pianoroll', afterLine: 1 }]]) } as any,
    }
    act(() => {
      workspaceAudioBus.publish('f1', payload)
    })

    expect(addInlineViewZones).toHaveBeenCalledTimes(1)
    expect(addInlineViewZones).toHaveBeenCalledWith(
      stubEditor,
      payload,
      expect.any(Array),
      expect.any(Object),
      'f1',
    )
    expect(mockZoneHandle.resume).toHaveBeenCalled()
  })

  it('pauses (not cleanup) zones when bus fires null — runtime stopped (PK3)', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    render(<EditorView fileId="f1" />)

    // First publish to create zones.
    const payload: AudioPayload = {
      inlineViz: { vizRequests: new Map([['$', { vizId: 'pianoroll', afterLine: 1 }]]) } as any,
    }
    act(() => {
      workspaceAudioBus.publish('f1', payload)
    })

    mockZoneHandle.pause.mockClear()
    mockZoneHandle.cleanup.mockClear()

    // Then unpublish — simulates runtime.stop().
    act(() => {
      workspaceAudioBus.unpublish('f1')
    })

    expect(mockZoneHandle.pause).toHaveBeenCalledTimes(1)
    // cleanup must NOT be called on stop — zones freeze, not disappear.
    expect(mockZoneHandle.cleanup).not.toHaveBeenCalled()
  })

  it('cleans up old zones before adding new ones on re-publish (PK3)', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    render(<EditorView fileId="f1" />)

    const payload1: AudioPayload = {
      inlineViz: { vizRequests: new Map([['$', { vizId: 'pianoroll', afterLine: 1 }]]) } as any,
      hapStream: { on: vi.fn(), off: vi.fn() } as any,
    }
    act(() => {
      workspaceAudioBus.publish('f1', payload1)
    })

    mockZoneHandle.cleanup.mockClear()

    // Re-publish with a different payload (different hapStream ref triggers bus update).
    const payload2: AudioPayload = {
      inlineViz: { vizRequests: new Map([['$', { vizId: 'pianoroll', afterLine: 2 }]]) } as any,
      hapStream: { on: vi.fn(), off: vi.fn() } as any,
    }
    act(() => {
      workspaceAudioBus.publish('f1', payload2)
    })

    // cleanup was called before the second addInlineViewZones call.
    expect(mockZoneHandle.cleanup).toHaveBeenCalled()
    expect(addInlineViewZones).toHaveBeenCalledTimes(2)
  })

  // #2383 — the last `.viz()` deleted and the code re-evaluated: the runtime
  // publishes a payload with NO viz requests. That is the document's current
  // answer, so the old zones go. (They used to stay: neither branch matched.)
  it('removes the zones when a new evaluation asks for no inline viz', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    render(<EditorView fileId="f1" />)

    act(() => {
      workspaceAudioBus.publish('f1', {
        inlineViz: { vizRequests: new Map([['$', { vizId: 'pianoroll', afterLine: 1 }]]) } as any,
      })
    })
    expect(addInlineViewZones).toHaveBeenCalledTimes(1)
    mockZoneHandle.cleanup.mockClear()
    mockZoneHandle.pause.mockClear()

    act(() => {
      workspaceAudioBus.publish('f1', { inlineViz: { vizRequests: new Map() } as any })
    })

    expect(mockZoneHandle.cleanup).toHaveBeenCalledTimes(1)
    expect(addInlineViewZones).toHaveBeenCalledTimes(1) // nothing re-added
    expect(mockZoneHandle.pause).not.toHaveBeenCalled()
  })

  it('cleans up zones on unmount', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    const { unmount } = render(<EditorView fileId="f1" />)

    const payload: AudioPayload = {
      inlineViz: { vizRequests: new Map([['$', { vizId: 'pianoroll', afterLine: 1 }]]) } as any,
    }
    act(() => {
      workspaceAudioBus.publish('f1', payload)
    })

    mockZoneHandle.cleanup.mockClear()
    unmount()
    expect(mockZoneHandle.cleanup).toHaveBeenCalled()
  })

  // Regression: splitting an editor group while the runtime is already
  // publishing used to leave the new editor silent — the bus delivered the
  // payload synchronously at subscribe time, BEFORE Monaco's async onMount
  // populated `editorRef.current`. The callback's `editorRef.current` guard
  // failed and no redelivery happened. The fix adds an `editorReady` state
  // set inside `handleMonacoMount`, included in the bus-subscribe effect's
  // deps — the effect re-subscribes after mount, and the re-subscribe's
  // synchronous initial fire delivers the in-flight payload into a callback
  // whose guard now passes. See issue #22.
  it('wires viz on a new editor mounted while the bus is already publishing (split-group race)', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')

    // Publish BEFORE the editor mounts — models the "runtime already playing
    // when user splits a new editor group" scenario.
    const payload: AudioPayload = {
      inlineViz: { vizRequests: new Map([['$', { vizId: 'pianoroll', afterLine: 1 }]]) } as any,
      hapStream: { on: vi.fn(), off: vi.fn() } as any,
    }
    act(() => {
      workspaceAudioBus.publish('f1', payload)
    })

    // Disable the mock's auto-onMount so mounting simulates real async Monaco
    // init — editor mounts, but Monaco's onMount hasn't fired yet.
    autoFireOnMount = false
    render(<EditorView fileId="f1" />)

    // At this point the bus-subscribe effect has already run with
    // editorRef.current=null. Without the fix, the inline-viz branch was
    // silently skipped and no redelivery mechanism existed.
    expect(addInlineViewZones).not.toHaveBeenCalled()

    // Now simulate Monaco finishing its async mount.
    act(() => {
      capturedOnMount?.(stubEditor, stubMonaco)
    })

    // editorReady flipped true → bus-subscribe effect re-ran → synchronous
    // initial fire redelivered the in-flight payload with editorRef.current
    // populated → zones added.
    expect(addInlineViewZones).toHaveBeenCalledTimes(1)
    expect(addInlineViewZones).toHaveBeenCalledWith(
      stubEditor,
      payload,
      expect.any(Array),
      expect.any(Object),
      'f1',
    )
    expect(mockZoneHandle.resume).toHaveBeenCalled()

    // Highlighting also wires up — useHighlighting's last call sees the
    // hapStream from the redelivered payload.
    const calls = vi.mocked(useHighlighting).mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall[1]).toBe(payload.hapStream)
  })

  // ---- Active highlighting (S5) ----

  it('passes hapStream from bus payload to useHighlighting', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    render(<EditorView fileId="f1" />)

    const fakeHapStream = { on: vi.fn(), off: vi.fn() } as any
    const payload: AudioPayload = {
      hapStream: fakeHapStream,
      inlineViz: { vizRequests: new Map() } as any,
    }
    act(() => {
      workspaceAudioBus.publish('f1', payload)
    })

    // useHighlighting should have been called with the hapStream.
    const calls = vi.mocked(useHighlighting).mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall[1]).toBe(fakeHapStream)
  })

  it('passes null hapStream to useHighlighting when bus payload is null', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    render(<EditorView fileId="f1" />)

    // Initial subscription fires with null — useHighlighting should get null.
    const calls = vi.mocked(useHighlighting).mock.calls
    // At least one call should have null as hapStream.
    expect(calls.some(call => call[1] === null)).toBe(true)
  })

  // ---- Error diagnostics (S7) ----

  it('calls setEvalError when error prop is set', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    const testError = new Error('syntax error')
    render(<EditorView fileId="f1" error={testError} />)

    expect(setEvalError).toHaveBeenCalledWith(stubMonaco, stubModel, testError)
  })

  it('calls clearEvalErrors when error prop is cleared to null', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    const testError = new Error('syntax error')
    const { rerender } = render(
      <EditorView fileId="f1" error={testError} />,
    )

    vi.mocked(clearEvalErrors).mockClear()

    rerender(<EditorView fileId="f1" error={null} />)

    expect(clearEvalErrors).toHaveBeenCalledWith(stubMonaco, stubModel)
  })

  it('calls clearEvalErrors when error prop is undefined (no error)', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    render(<EditorView fileId="f1" />)

    // undefined error → clearEvalErrors called (no squiggles).
    expect(clearEvalErrors).toHaveBeenCalled()
  })

  // ---- #2412 — zone rebuilds carry the host's CURRENT ✎ / ✂ callbacks ----

  /** The actions object handed to the most recent addInlineViewZones call. */
  function lastZoneActions(): { onEdit?: (...a: any[]) => void; onCrop?: (...a: any[]) => void } {
    const calls = vi.mocked(addInlineViewZones).mock.calls
    return (calls[calls.length - 1][3] ?? {}) as any
  }

  const vizPayload = (): AudioPayload => ({
    inlineViz: { vizRequests: new Map([['$0', { vizId: 'pianoroll', afterLine: 1 }]]) } as any,
  })

  it('#2412: a crop-override rebuild hands the zones the latest onCropViz, with the file it belongs to', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    const firstCrop = vi.fn()
    const latestCrop = vi.fn()
    const { rerender } = render(<EditorView fileId="f1" onCropViz={firstCrop} />)
    act(() => {
      workspaceAudioBus.publish('f1', vizPayload())
    })
    // The host re-renders with a new handler (its closure moved on).
    rerender(<EditorView fileId="f1" onCropViz={latestCrop} />)

    // Saving a crop writes the override → the override subscription rebuilds the zones.
    vi.mocked(addInlineViewZones).mockClear()
    act(() => {
      setZoneCropOverride('f1', '$0', { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 'pianoroll')
    })
    expect(addInlineViewZones).toHaveBeenCalledTimes(1)

    // ✂ on the rebuilt strip must reach the CURRENT handler, never the first one.
    lastZoneActions().onCrop?.('pianoroll', 'preset-1', '$0')
    expect(firstCrop).not.toHaveBeenCalled()
    expect(latestCrop).toHaveBeenCalledWith('pianoroll', 'preset-1', '$0', 'f1')
  })

  it('#2412: a new evaluation after the host re-rendered also uses the latest ✎ / ✂ handlers', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    const firstCrop = vi.fn()
    const firstEdit = vi.fn()
    const latestCrop = vi.fn()
    const latestEdit = vi.fn()
    const { rerender } = render(
      <EditorView fileId="f1" onCropViz={firstCrop} onEditViz={firstEdit} />,
    )
    rerender(<EditorView fileId="f1" onCropViz={latestCrop} onEditViz={latestEdit} />)
    act(() => {
      workspaceAudioBus.publish('f1', vizPayload())
    })
    const actions = lastZoneActions()
    actions.onCrop?.('pianoroll', null, '$0')
    actions.onEdit?.('pianoroll', null)
    expect(firstCrop).not.toHaveBeenCalled()
    expect(firstEdit).not.toHaveBeenCalled()
    expect(latestCrop).toHaveBeenCalledWith('pianoroll', null, '$0', 'f1')
    expect(latestEdit).toHaveBeenCalledWith('pianoroll', null)
  })

  it('#2412: with no ✎ / ✂ handlers the zones get no actions (no floating bar)', () => {
    createWorkspaceFile('f1', 'f1.strudel', '// code', 'strudel')
    render(<EditorView fileId="f1" />)
    act(() => {
      workspaceAudioBus.publish('f1', vizPayload())
    })
    const actions = lastZoneActions()
    expect(actions.onCrop).toBeUndefined()
    expect(actions.onEdit).toBeUndefined()
  })
})
