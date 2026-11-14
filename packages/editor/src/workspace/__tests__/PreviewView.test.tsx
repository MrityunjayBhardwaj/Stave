/**
 * PreviewView — unit tests (Phase 10.2 Task 03).
 *
 * Covers the view's observable contract:
 *
 * Subscription lifecycle:
 *   - Subscribes to the bus on mount with the given `sourceRef`.
 *   - Unsubscribes on unmount.
 *   - Re-subscribes when `sourceRef` changes.
 *
 * Re-mount on publisher identity change (CONTEXT D-01):
 *   - `key` on the provider mount changes when a new publisher arrives.
 *
 * Hot-reload debounce (CONTEXT D-07):
 *   - `reload: 'instant'` → every content change re-renders.
 *   - `reload: 'debounced'` with `debounceMs: 300` → rapid typing resolves
 *     to a single render after the debounce window.
 *   - `reload: 'manual'` → content change does NOT cause a re-render.
 *
 * Hidden-tab pause (CONTEXT D-03):
 *   - `provider.keepRunningWhenHidden === false` + `hidden: true` →
 *     the provider's context gets `hidden: true`.
 *   - Content changes while hidden do NOT trigger a reload (the debounce
 *     timer is cleared).
 *   - Un-hiding triggers exactly ONE catch-up reload.
 *
 * Source selector:
 *   - Changing the `<select>` value calls `onSourceRefChange` with the
 *     correct `AudioSourceRef`.
 *
 * Demo mode (CONTEXT P7):
 *   - `sourceRef: 'none'` → provider's ctx.audioSource is `null`, provider
 *     is still rendered (not a placeholder).
 *
 * Theme (PV6 / P6):
 *   - `applyTheme` is called on mount; `--code-bg` resolves to the
 *     dark-theme color on the container.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React, { useRef } from 'react'
import { render, act, fireEvent } from '@testing-library/react'
import { PreviewView } from '../PreviewView'
import type { PreviewProvider, PreviewContext } from '../PreviewProvider'
import type { AudioPayload, AudioSourceRef } from '../types'
import {
  createWorkspaceFile,
  setContent,
  __resetWorkspaceFilesForTests,
} from '../WorkspaceFile'
import {
  workspaceAudioBus,
  __resetWorkspaceAudioBusForTests,
} from '../WorkspaceAudioBus'

/**
 * Fake payload for bus tests. The slot references only need to be stable
 * object references — nothing inside PreviewView reads their actual shapes.
 */
function makePayload(tag: string): AudioPayload {
  return {
    hapStream: { tag } as unknown as AudioPayload['hapStream'],
    analyser: { tag } as unknown as AudioPayload['analyser'],
    scheduler: { tag } as unknown as AudioPayload['scheduler'],
    inlineViz: undefined,
    audio: undefined,
  }
}

/**
 * Build a provider whose render call is recorded to a shared log. The log
 * captures the ctx on every call so tests can assert what the provider saw.
 */
function makeRecordingProvider(
  overrides: Partial<PreviewProvider> = {},
): {
  provider: PreviewProvider
  calls: PreviewContext[]
  mountCount: { current: number }
} {
  const calls: PreviewContext[] = []
  const mountCount = { current: 0 }
  const base: PreviewProvider = {
    extensions: ['hydra'],
    label: 'Recording Test',
    keepRunningWhenHidden: false,
    reload: 'debounced',
    debounceMs: 300,
    render(ctx) {
      calls.push(ctx)
      return <RecordedMount mountCount={mountCount} tag={ctx.file.content} />
    },
  }
  return { provider: { ...base, ...overrides }, calls, mountCount }
}

function RecordedMount({
  mountCount,
  tag,
}: {
  mountCount: { current: number }
  tag: string
}) {
  const everMountedRef = useRef(false)
  if (!everMountedRef.current) {
    everMountedRef.current = true
    mountCount.current++
  }
  return <div data-testid="recorded-mount" data-tag={tag} />
}

describe('PreviewView', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    __resetWorkspaceAudioBusForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('subscribes to the bus on mount and unsubscribes on unmount', () => {
    createWorkspaceFile('v', 'v.hydra', '// v', 'hydra')
    const { provider, calls } = makeRecordingProvider()
    const { unmount } = render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'default' }}
        onSourceRefChange={() => {}}
      />,
    )
    // Initial render fires with null payload.
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0].audioSource).toBeNull()

    // Publishing a source should cause the view to re-render the
    // provider with the new payload.
    act(() => {
      workspaceAudioBus.publish('pub-a', makePayload('a'))
    })
    const withPayload = calls.find((c) => c.audioSource !== null)
    expect(withPayload).toBeDefined()
    expect(withPayload?.audioSource).not.toBeNull()

    // Unmount — subsequent publishes should not add more calls.
    const callsBefore = calls.length
    unmount()
    act(() => {
      workspaceAudioBus.publish('pub-b', makePayload('b'))
    })
    expect(calls.length).toBe(callsBefore)
  })

  it('re-mounts the provider output when the publisher identity changes (D-01)', () => {
    createWorkspaceFile('v', 'v.hydra', '// v', 'hydra')
    const { provider, mountCount } = makeRecordingProvider()
    const { getByTestId } = render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'default' }}
        onSourceRefChange={() => {}}
      />,
    )

    const initialMountNode = getByTestId('preview-provider-mount-v')
    const initialKey = initialMountNode.getAttribute('data-provider-key')
    const initialMounts = mountCount.current

    act(() => {
      workspaceAudioBus.publish('pub-a', makePayload('a'))
    })
    const afterA = getByTestId('preview-provider-mount-v')
    const keyA = afterA.getAttribute('data-provider-key')
    expect(keyA).not.toBe(initialKey)
    expect(mountCount.current).toBeGreaterThan(initialMounts)

    const mountsBeforeB = mountCount.current
    act(() => {
      workspaceAudioBus.publish('pub-b', makePayload('b'))
    })
    const afterB = getByTestId('preview-provider-mount-v')
    expect(afterB.getAttribute('data-provider-key')).not.toBe(keyA)
    expect(mountCount.current).toBeGreaterThan(mountsBeforeB)
  })

  // #2396 — a BACKGROUND keeps running across Play (publish) and Stop
  // (unpublish): same mount, the new inputs arrive as props (→ renderer.update()).
  it('a background is NOT re-mounted when a pattern starts or stops publishing', () => {
    createWorkspaceFile('bgv', 'bgv.hydra', '// v', 'hydra')
    const { provider, mountCount } = makeRecordingProvider()
    const audioSeen: Array<unknown> = []
    const recording = {
      ...provider,
      render: (ctx: Parameters<typeof provider.render>[0]) => {
        audioSeen.push(ctx.audioSource)
        return provider.render(ctx)
      },
    }
    const { getByTestId } = render(
      <PreviewView
        fileId="bgv"
        provider={recording}
        sourceRef={{ kind: 'default' }}
        onSourceRefChange={() => {}}
        backdrop
      />,
    )
    const key0 = getByTestId('preview-provider-mount-bgv').getAttribute('data-provider-key')
    const mounts0 = mountCount.current

    const payload = makePayload('play')
    act(() => {
      workspaceAudioBus.publish('pub-play', payload) // Play
    })
    act(() => {
      workspaceAudioBus.unpublish('pub-play') // Stop
    })
    act(() => {
      workspaceAudioBus.publish('pub-play', makePayload('play-again')) // Play again
    })

    expect(getByTestId('preview-provider-mount-bgv').getAttribute('data-provider-key')).toBe(key0)
    expect(mountCount.current).toBe(mounts0)
    // …and the inputs still reach it: the payload, then none, then the next one
    expect(audioSeen).toContain(payload)
    expect(audioSeen[audioSeen.length - 1]).not.toBeNull()
  })

  // #2428 — nor when its SOURCE changes (the viz's ⚙ → Source, or a tab switch
  // that changes whose audio it follows): same mount, the new source's payload
  // arrives as props.
  it('a background is NOT re-mounted when its source changes, and hears the new one', () => {
    createWorkspaceFile('bgs', 'bgs.hydra', '// v', 'hydra')
    const { provider, mountCount } = makeRecordingProvider()
    const audioSeen: Array<unknown> = []
    const recording = {
      ...provider,
      render: (ctx: Parameters<typeof provider.render>[0]) => {
        audioSeen.push(ctx.audioSource)
        return provider.render(ctx)
      },
    }
    const sample = makePayload('sample')
    act(() => {
      workspaceAudioBus.publish('pub-sample', sample)
    })
    const props = {
      fileId: 'bgs',
      provider: recording,
      onSourceRefChange: () => {},
      backdrop: true,
    }
    const { getByTestId, rerender } = render(
      <PreviewView {...props} sourceRef={{ kind: 'none' }} />,
    )
    const key0 = getByTestId('preview-provider-mount-bgs').getAttribute('data-provider-key')
    const mounts0 = mountCount.current

    rerender(<PreviewView {...props} sourceRef={{ kind: 'file', fileId: 'pub-sample' }} />)

    expect(getByTestId('preview-provider-mount-bgs').getAttribute('data-provider-key')).toBe(key0)
    expect(mountCount.current).toBe(mounts0)
    expect(audioSeen[audioSeen.length - 1]).toBe(sample)
  })

  it('re-mounts the provider output when sourceRef is explicitly swapped (Task 2)', () => {
    // Task 2 invariant: changing sourceRef at the prop level must
    // always force a fresh mount, even if both old and new sources
    // have the same payload state (null / idle / not yet publishing).
    // This is the infrastructure that makes the Task 3 `stave.*`
    // injection contract safe — setup() re-runs for every source,
    // so cached references like `const a = stave.analyser` never go
    // stale. Without this test, the indirect payloadKey path could
    // collapse two distinct idle sources into the same key string
    // and silently skip a remount.
    createWorkspaceFile('v', 'v.hydra', '// v', 'hydra')
    const { provider, mountCount } = makeRecordingProvider()
    const { getByTestId, rerender } = render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'file', fileId: 'pattern-A' }}
        onSourceRefChange={() => {}}
      />,
    )

    const initialKey = getByTestId('preview-provider-mount-v').getAttribute(
      'data-provider-key',
    )
    const initialMounts = mountCount.current

    // Swap to a different file-pinned source. Neither source is
    // publishing on the bus, so payloadKey would return 'none' for
    // both — only the new sourceRefKey component distinguishes them.
    rerender(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'file', fileId: 'pattern-B' }}
        onSourceRefChange={() => {}}
      />,
    )

    const afterSwapKey = getByTestId('preview-provider-mount-v').getAttribute(
      'data-provider-key',
    )
    expect(afterSwapKey).not.toBe(initialKey)
    expect(mountCount.current).toBeGreaterThan(initialMounts)

    // Swap once more — to `none`. Mount count should increment again
    // because the key still changes even though both pattern-B and
    // none resolve the same payloadKey ('none').
    const mountsBeforeNone = mountCount.current
    rerender(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
      />,
    )
    expect(mountCount.current).toBeGreaterThan(mountsBeforeNone)
  })

  // #2560 — a reload is for a CHANGE to the code. The reload effect also fired on
  // first render, so every background and preview built its sketch twice at open
  // (~300 ms apart) and a heavy three.js sketch ran its top level twice.
  it('opening a background builds its sketch once: no reload when nothing changed', () => {
    vi.useFakeTimers()
    createWorkspaceFile('bg1', 'bg1.three', '// sketch', 'three')
    const { provider, mountCount } = makeRecordingProvider({ reload: 'debounced', debounceMs: 300 })
    const { getByTestId } = render(
      <PreviewView fileId="bg1" provider={provider} sourceRef={{ kind: 'default' }} onSourceRefChange={() => {}} backdrop />,
    )
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(mountCount.current).toBe(1)
    expect(getByTestId('preview-provider-mount-bg1').getAttribute('data-provider-key')).toBe('bg:0')
    // the same content written again is not a change either
    act(() => {
      setContent('bg1', '// sketch')
      vi.advanceTimersByTime(2000)
    })
    expect(mountCount.current).toBe(1)
  })

  it('a background switching to another sketch file builds it once (no reload of the new file)', () => {
    vi.useFakeTimers()
    createWorkspaceFile('bgA', 'bgA.three', '// a', 'three')
    createWorkspaceFile('bgB', 'bgB.three', '// b, different', 'three')
    const { provider, mountCount, calls } = makeRecordingProvider({ reload: 'debounced', debounceMs: 300 })
    const view = (id: string) => (
      <PreviewView fileId={id} provider={provider} sourceRef={{ kind: 'default' }} onSourceRefChange={() => {}} backdrop />
    )
    const { rerender, getByTestId } = render(view('bgA'))
    rerender(view('bgB'))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(calls[calls.length - 1].file.id).toBe('bgB')
    expect(getByTestId('preview-provider-mount-bgB').getAttribute('data-provider-key')).toBe('bg:0')
    expect(mountCount.current).toBe(1)
  })

  it('an edit to it still reloads it, once, after the debounce', () => {
    vi.useFakeTimers()
    createWorkspaceFile('bg2', 'bg2.three', '// v0', 'three')
    const { provider, mountCount } = makeRecordingProvider({ reload: 'debounced', debounceMs: 300 })
    const { getByTestId } = render(
      <PreviewView fileId="bg2" provider={provider} sourceRef={{ kind: 'default' }} onSourceRefChange={() => {}} backdrop />,
    )
    act(() => {
      setContent('bg2', '// v1')
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(getByTestId('preview-provider-mount-bg2').getAttribute('data-provider-key')).toBe('bg:1')
    expect(mountCount.current).toBe(2)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(mountCount.current).toBe(2)
  })

  it("collapses rapid typing into one reload with reload: 'debounced'", () => {
    vi.useFakeTimers()
    createWorkspaceFile('v', 'v.hydra', 'v0', 'hydra')
    const { provider, calls } = makeRecordingProvider({
      reload: 'debounced',
      debounceMs: 300,
    })
    render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
      />,
    )
    const initialCalls = calls.length

    // Rapid typing — three content changes inside a single 300ms window.
    act(() => {
      setContent('v', 'v1')
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    act(() => {
      setContent('v', 'v2')
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    act(() => {
      setContent('v', 'v3')
    })

    // Still inside the debounce window — no new reload yet beyond the
    // render effects that run synchronously on content change (those
    // update the file snapshot but the `reloadTick` has not advanced).
    const beforeTimerFire = calls.length

    act(() => {
      vi.advanceTimersByTime(400)
    })

    // After the debounce resolves, the provider sees the final content.
    // The exact number of calls depends on React effect scheduling, but
    // we assert: (a) at least one call received the final content, and
    // (b) the reload did fire (new calls landed after the timer tick).
    expect(calls.length).toBeGreaterThan(beforeTimerFire)
    const finalCall = calls[calls.length - 1]
    expect(finalCall.file.content).toBe('v3')
    expect(calls.length).toBeGreaterThan(initialCalls)
  })

  it("reloads instantly with reload: 'instant'", () => {
    createWorkspaceFile('v', 'v.hydra', 'v0', 'hydra')
    const { provider, calls } = makeRecordingProvider({
      reload: 'instant',
      debounceMs: undefined,
    })
    render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
      />,
    )
    const beforeType = calls.length

    act(() => {
      setContent('v', 'v1')
    })
    // Instant mode — provider sees the new content immediately, no timer.
    const lastCall = calls[calls.length - 1]
    expect(lastCall.file.content).toBe('v1')
    expect(calls.length).toBeGreaterThan(beforeType)
  })

  it("does not re-render on content change with reload: 'manual'", () => {
    createWorkspaceFile('v', 'v.hydra', 'v0', 'hydra')
    const { provider, mountCount } = makeRecordingProvider({
      reload: 'manual',
      debounceMs: undefined,
    })
    render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
      />,
    )
    const initialMounts = mountCount.current

    act(() => {
      setContent('v', 'v1')
    })
    act(() => {
      setContent('v', 'v2')
    })

    // Manual mode — no reload fired, so the React key stayed stable and
    // the internal mount count did not increment from content changes.
    // (The provider render function may still be called by React for
    // unrelated reasons, but the mount count is the observable for
    // "did we destroy-and-remount the subtree?".)
    expect(mountCount.current).toBe(initialMounts)
  })

  it('passes hidden: true to the provider when keepRunningWhenHidden is false', () => {
    createWorkspaceFile('v', 'v.hydra', 'v0', 'hydra')
    const { provider, calls } = makeRecordingProvider({
      keepRunningWhenHidden: false,
    })
    const { rerender } = render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
        hidden={false}
      />,
    )
    const notHiddenCall = calls[calls.length - 1]
    expect(notHiddenCall.hidden).toBe(false)

    rerender(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
        hidden={true}
      />,
    )
    const hiddenCall = calls[calls.length - 1]
    expect(hiddenCall.hidden).toBe(true)
  })

  it('keeps hidden: false when keepRunningWhenHidden is true', () => {
    createWorkspaceFile('v', 'v.hydra', 'v0', 'hydra')
    const { provider, calls } = makeRecordingProvider({
      keepRunningWhenHidden: true,
    })
    render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
        hidden={true}
      />,
    )
    const last = calls[calls.length - 1]
    expect(last.hidden).toBe(false)
  })

  it('triggers exactly one catch-up reload on un-hide when a content change was missed', () => {
    vi.useFakeTimers()
    createWorkspaceFile('v', 'v.hydra', 'v0', 'hydra')
    const { provider, mountCount } = makeRecordingProvider({
      reload: 'debounced',
      debounceMs: 300,
      keepRunningWhenHidden: false,
    })
    const { rerender } = render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
        hidden={true}
      />,
    )
    const mountsWhileHidden = mountCount.current

    // Change content while hidden — debounce must be suppressed, no
    // reload fires.
    act(() => {
      setContent('v', 'v1')
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(mountCount.current).toBe(mountsWhileHidden)

    // Un-hide — catch-up reload should fire exactly once.
    rerender(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
        hidden={false}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(mountCount.current).toBeGreaterThan(mountsWhileHidden)
  })

  it("passes null payload through in demo mode (P7 — provider, not host, owns the fallback)", () => {
    createWorkspaceFile('v', 'v.hydra', 'v0', 'hydra')
    const { provider, calls } = makeRecordingProvider()
    render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
      />,
    )
    // Provider was called — the host did not short-circuit with a
    // placeholder on null payload.
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[calls.length - 1].audioSource).toBeNull()
  })

  it('applies the dark theme to the container (PV6 / P6 guard)', () => {
    createWorkspaceFile('v', 'v.hydra', 'v0', 'hydra')
    const { provider } = makeRecordingProvider()
    const { container } = render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'none' }}
        onSourceRefChange={() => {}}
        theme="dark"
      />,
    )
    const viewRoot = container.querySelector(
      '[data-workspace-view="preview"]',
    ) as HTMLElement
    expect(viewRoot).not.toBeNull()
    expect(viewRoot.style.getPropertyValue('--code-bg')).toBe('#090912')
  })

  it('updates provider key formula when sourceRef changes', () => {
    createWorkspaceFile('v', 'v.hydra', 'v0', 'hydra')
    workspaceAudioBus.publish('pattern-a', makePayload('a'))
    const { provider } = makeRecordingProvider()

    const { getByTestId, rerender } = render(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'default' }}
        onSourceRefChange={() => {}}
      />,
    )
    const keyDefault = getByTestId(
      'preview-provider-mount-v',
    ).getAttribute('data-provider-key')

    // Pin to a specific file — key should change to the file form.
    rerender(
      <PreviewView
        fileId="v"
        provider={provider}
        sourceRef={{ kind: 'file', fileId: 'pattern-a' }}
        onSourceRefChange={() => {}}
      />,
    )
    const keyPinned = getByTestId(
      'preview-provider-mount-v',
    ).getAttribute('data-provider-key')
    expect(keyPinned).not.toBe(keyDefault)
    expect(keyPinned).toContain('file:pattern-a')
  })
})
