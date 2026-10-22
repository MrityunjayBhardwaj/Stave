/**
 * SONICPI_RUNTIME — unit tests (Phase 10.2 Task 05).
 *
 * Provider shape + chrome render path. The createEngine path is shape-only
 * because instantiating a real `SonicPiEngine` would attempt the SuperSonic
 * CDN import — which is environment-coupled and not appropriate for unit
 * tests. End-to-end Sonic Pi engine wiring is verified in Task 10's
 * Lokayata pass.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { SONICPI_RUNTIME } from '../sonicpiRuntime'
import type { LiveCodingRuntime } from '../LiveCodingRuntime'
import type { ChromeContext, WorkspaceFile } from '../../types'

describe('SONICPI_RUNTIME provider', () => {
  it('declares .sonicpi extension and sonicpi language', () => {
    expect(SONICPI_RUNTIME.extensions).toContain('.sonicpi')
    expect(SONICPI_RUNTIME.language).toBe('sonicpi')
  })

  it('createEngine returns an object that conforms to LiveCodingEngine shape', () => {
    // Construct + immediately discard. Do not call init() — the SuperSonic
    // CDN load is environment-coupled and out of scope for unit tests.
    const engine = SONICPI_RUNTIME.createEngine()
    expect(typeof engine.init).toBe('function')
    expect(typeof engine.evaluate).toBe('function')
    expect(typeof engine.play).toBe('function')
    expect(typeof engine.stop).toBe('function')
    expect(typeof engine.dispose).toBe('function')
    // Dispose is safe pre-init (the adapter handles it).
    engine.dispose()
  })
})

describe('SONICPI_RUNTIME renderChrome', () => {
  afterEach(() => cleanup())

  function makeCtx(overrides: Partial<ChromeContext> = {}): ChromeContext {
    const file: WorkspaceFile = {
      id: 'file-2',
      path: '/loop.sonicpi',
      content: '',
      language: 'sonicpi',
    }
    return {
      runtime: {} as LiveCodingRuntime,
      file,
      isPlaying: false,
      error: null,
      bpm: undefined,
      onPlay: vi.fn(),
      onStop: vi.fn(),
      ...overrides,
    }
  }

  it('renders the play button when not playing', () => {
    const onPlay = vi.fn()
    const { getByTestId } = render(
      SONICPI_RUNTIME.renderChrome(makeCtx({ onPlay })) as React.ReactElement,
    )
    const btn = getByTestId('sonicpi-chrome-transport')
    expect(btn.textContent).toContain('Play')
    fireEvent.click(btn)
    expect(onPlay).toHaveBeenCalled()
  })

  it('renders the stop button when playing', () => {
    const onStop = vi.fn()
    const { getByTestId } = render(
      SONICPI_RUNTIME.renderChrome(
        makeCtx({ isPlaying: true, onStop }),
      ) as React.ReactElement,
    )
    const btn = getByTestId('sonicpi-chrome-transport')
    expect(btn.textContent).toContain('Stop')
    fireEvent.click(btn)
    expect(onStop).toHaveBeenCalled()
  })

  it('hides BPM when undefined', () => {
    const without = render(
      SONICPI_RUNTIME.renderChrome(makeCtx()) as React.ReactElement,
    )
    expect(without.queryByTestId('sonicpi-chrome-bpm')).toBeNull()
  })

  it('shows BPM when defined', () => {
    const with_ = render(
      SONICPI_RUNTIME.renderChrome(makeCtx({ bpm: 80 })) as React.ReactElement,
    )
    expect(with_.queryByTestId('sonicpi-chrome-bpm')?.textContent).toContain('80 BPM')
  })

  it('renders the error badge when error is set', () => {
    const err = new Error('synth not found: dx7')
    const { getByTestId } = render(
      SONICPI_RUNTIME.renderChrome(makeCtx({ error: err })) as React.ReactElement,
    )
    expect(getByTestId('sonicpi-chrome-error').textContent).toBe('synth not found: dx7')
  })

  it('the badge shows the error as the Console words it, whole in its tooltip (#2177)', () => {
    const words = '`dx7` is not a synth. Did you mean `dsaw`?'
    const { getByTestId } = render(
      SONICPI_RUNTIME.renderChrome(
        makeCtx({ error: new Error('synth not found: dx7'), errorMessage: words }),
      ) as React.ReactElement,
    )
    const badge = getByTestId('sonicpi-chrome-error')
    expect(badge.textContent).toBe(words)
    expect(badge.getAttribute('title')).toBe(words)
  })

  it('renders chromeExtras when provided', () => {
    const extras = <span data-testid="extras-bpm-input">extras</span>
    const { getByTestId } = render(
      SONICPI_RUNTIME.renderChrome(
        makeCtx({ chromeExtras: extras }),
      ) as React.ReactElement,
    )
    expect(getByTestId('sonicpi-chrome-extras')).toBeTruthy()
    expect(getByTestId('extras-bpm-input').textContent).toBe('extras')
  })
})
