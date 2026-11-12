/**
 * The drum and chord examples render their loop before they play. A stop that
 * arrives during that render must still stop them: nothing else would, since the
 * shell has already moved on. A first click that both starts the sound (on its
 * press) and switches tab (on its release) lands in exactly that window (#2451).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { findBuiltinExampleSource } from '../builtinExampleSources'
import { DRUM_PATTERN_SOURCE_ID, isDrumPatternPlaying, stopDrumPattern } from '../drumPattern'
import {
  CHORD_PROGRESSION_SOURCE_ID,
  isChordProgressionPlaying,
  stopChordProgression,
} from '../chordProgression'
import { workspaceAudioBus } from '../WorkspaceAudioBus'

/** an audio node or param: every property is another stub, every call returns one */
function stub(): unknown {
  return new Proxy(function () {}, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : key === 'then' ? undefined : stub()),
    set: () => true,
    apply: () => stub(),
  })
}

let finishRenders: Array<() => void> = []
let contexts: Array<{ close: ReturnType<typeof vi.fn> }> = []

class FakeOffline {
  constructor(public a: number, public b: number, public c: number) {}
  destination = stub()
  createOscillator = () => stub()
  createGain = () => stub()
  createBufferSource = () => stub()
  createBiquadFilter = () => stub()
  createBuffer = () => stub()
  startRendering = () =>
    new Promise((resolve) => finishRenders.push(() => resolve(stub())))
}

class FakeContext {
  close = vi.fn()
  currentTime = 0
  destination = stub()
  createBufferSource = () => stub()
  createGain = () => stub()
  createAnalyser = () => stub()
  constructor() {
    contexts.push(this)
  }
}

const finishRender = async () => {
  for (const f of finishRenders.splice(0)) f()
  await new Promise((r) => setTimeout(r, 0))
}

describe.each([
  ['drums', DRUM_PATTERN_SOURCE_ID, isDrumPatternPlaying, stopDrumPattern],
  ['chords', CHORD_PROGRESSION_SOURCE_ID, isChordProgressionPlaying, stopChordProgression],
] as const)('%s: stopped while starting', (_name, id, isPlaying, stop) => {
  const source = findBuiltinExampleSource(id)!

  beforeEach(() => {
    finishRenders = []
    contexts = []
    vi.stubGlobal('OfflineAudioContext', FakeOffline)
    vi.stubGlobal('AudioContext', FakeContext)
  })
  afterEach(async () => {
    await finishRender()
    stop()
    vi.unstubAllGlobals()
  })

  it('plays once the render finishes when nothing stopped it (the control)', async () => {
    source.startIfIdle()
    await finishRender()
    expect(isPlaying()).toBe(true)
    expect(workspaceAudioBus.listSources().map((s) => s.sourceId)).toContain(id)
    expect(contexts[0].close).not.toHaveBeenCalled()
  })

  it('a stop during the render: it never plays, and its context is closed', async () => {
    source.startIfIdle()
    source.stopIfRunning()
    await finishRender()
    expect(isPlaying()).toBe(false)
    expect(workspaceAudioBus.listSources().map((s) => s.sourceId)).not.toContain(id)
    expect(contexts).toHaveLength(1)
    expect(contexts[0].close).toHaveBeenCalledTimes(1)
  })

  it('start, stop, start during the render: it plays, from the one render', async () => {
    source.startIfIdle()
    source.stopIfRunning()
    source.startIfIdle()
    await finishRender()
    expect(isPlaying()).toBe(true)
    expect(contexts).toHaveLength(1)
    expect(contexts[0].close).not.toHaveBeenCalled()
  })
})
