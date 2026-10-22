import { describe, it, expect, vi, beforeEach } from 'vitest'

// The clip preview (#2059) decodes a recording and plays it once. These tests count
// fetches to see what it keeps decoded between previews (#2063): only the clip
// previewed last, so a long take does not stay in memory after you move on.
// Each test uses its own URLs — the kept clip is module state.

const fetched: string[] = []
const pendingDecodes: Array<{ resolve: (b: unknown) => void; reject: (e: unknown) => void }> = []
let decodeMode: 'resolve' | 'hold' = 'resolve'

const ctx = {
  currentTime: 0,
  destination: {},
  resume: vi.fn(() => Promise.resolve()),
  decodeAudioData: vi.fn(() =>
    decodeMode === 'resolve'
      ? Promise.resolve({ duration: 1 })
      : new Promise((resolve, reject) => pendingDecodes.push({ resolve, reject })),
  ),
  createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
  createBufferSource: () => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  }),
}

vi.mock('@strudel/webaudio', () => ({
  superdough: vi.fn(() => Promise.resolve()),
  getAudioContext: () => ctx,
}))

vi.stubGlobal(
  'fetch',
  vi.fn((url: string) => {
    fetched.push(url)
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
  }),
)

import { startClipPreview } from '../audition'

const settle = () => new Promise((r) => setTimeout(r, 0))
const timesFetched = (url: string) => fetched.filter((u) => u === url).length

describe('startClipPreview keeps only the clip previewed last (#2063)', () => {
  beforeEach(() => {
    decodeMode = 'resolve'
    pendingDecodes.length = 0
  })

  it('a second preview of the same clip does not fetch it again', async () => {
    startClipPreview('blob:same').stop()
    await settle()
    startClipPreview('blob:same').stop()
    await settle()
    expect(timesFetched('blob:same')).toBe(1)
  })

  it('previewing another clip lets the first one go', async () => {
    startClipPreview('blob:first')
    await settle()
    startClipPreview('blob:second')
    await settle()
    startClipPreview('blob:first')
    await settle()
    // Kept every clip: 1. Keeps only the last: the first was let go, so it is fetched again.
    expect(timesFetched('blob:first')).toBe(2)
    expect(timesFetched('blob:second')).toBe(1)
  })

  it('a clip that would not decode is tried again next time', async () => {
    decodeMode = 'hold'
    startClipPreview('blob:broken')
    await settle()
    pendingDecodes.shift()!.reject(new Error('not audio'))
    await settle()
    decodeMode = 'resolve'
    startClipPreview('blob:broken')
    await settle()
    expect(timesFetched('blob:broken')).toBe(2)
  })

  it('an earlier clip failing late does not drop the clip previewed after it', async () => {
    decodeMode = 'hold'
    startClipPreview('blob:slow-broken')
    await settle()
    startClipPreview('blob:kept')
    await settle()
    pendingDecodes.shift()!.reject(new Error('not audio')) // the earlier one fails now
    pendingDecodes.shift()!.resolve({ duration: 1 })
    await settle()
    decodeMode = 'resolve'
    startClipPreview('blob:kept')
    await settle()
    expect(timesFetched('blob:kept')).toBe(1)
  })
})
