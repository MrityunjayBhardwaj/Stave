// #2256 — which sounds a warm-up loads, through which loader, on which context.
import { describe, expect, it, vi } from 'vitest'

import { runWarmJobs, soundWarmJobs, type SoundWarmDeps } from '../soundWarm'

const LIVE = { kind: 'live' } as unknown as BaseAudioContext

/** A registry with a drum bank, a banked kit, a two-font instrument and a synth. */
type FakeDeps = SoundWarmDeps & {
  loadBuffer: ReturnType<typeof vi.fn>
  getFontBufferSource: ReturnType<typeof vi.fn>
}

function fakeDeps(over: Partial<SoundWarmDeps> = {}): FakeDeps {
  const sounds: Record<string, unknown> = {
    bd: { data: { type: 'sample', samples: ['bd/0.wav', 'bd/1.wav'] } },
    rolandtr909_bd: { data: { type: 'sample', samples: ['909/bd.wav'] } },
    gm_piano: { data: { type: 'soundfont', fonts: ['0000_JCLive', '0000_Fluid'] } },
    sawtooth: { data: { type: 'synth' } },
  }
  const cached = new Set<string>()
  const deps: SoundWarmDeps = {
    getSound: (name: string) => sounds[name],
    // superdough picks `samples[n % len]`; the fake does the same
    getSampleInfo: (hap: Record<string, unknown>, bank: never) => {
      const list = bank as unknown as string[]
      const n = typeof hap.n === 'number' ? hap.n : 0
      return { url: `https://cdn/${list[n % list.length]}` }
    },
    getCachedBuffer: (url: string) => (cached.has(url) ? {} : undefined),
    loadBuffer: vi.fn(async (url: string) => { cached.add(url) }),
    getFontBufferSource: vi.fn(async () => ({})),
    soundMap: () => sounds,
    audioContext: () => LIVE,
    ...over,
  }
  return deps as FakeDeps
}

describe('soundWarmJobs', () => {
  it('loads each sample a note plays, once, through loadBuffer on the live context', async () => {
    const deps = fakeDeps()
    const jobs = soundWarmJobs([{ s: 'bd' }, { s: 'bd' }, { s: 'bd', n: 1 }], deps)
    expect(jobs.map((j) => j.key)).toEqual(['sample:https://cdn/bd/0.wav', 'sample:https://cdn/bd/1.wav'])
    await Promise.all(jobs.map((j) => j.run()))
    expect(deps.loadBuffer).toHaveBeenCalledWith('https://cdn/bd/0.wav', LIVE, 'bd', 0)
    expect(deps.loadBuffer).toHaveBeenCalledWith('https://cdn/bd/1.wav', LIVE, 'bd', 1)
  })

  it('skips a sample that is already cached', async () => {
    const deps = fakeDeps()
    await Promise.all(soundWarmJobs([{ s: 'bd' }], deps).map((j) => j.run()))
    expect(soundWarmJobs([{ s: 'bd' }], deps)).toEqual([])
  })

  it('adds the bank the way the trigger does', () => {
    const jobs = soundWarmJobs([{ s: 'bd', bank: 'RolandTR909' }], fakeDeps({
      getSound: (name) => (name === 'RolandTR909_bd' ? { data: { samples: ['909/bd.wav'] } } : undefined),
    }))
    expect(jobs.map((j) => j.key)).toEqual(['sample:https://cdn/909/bd.wav'])
  })

  it('loads the instrument font the trigger would pick, per pitch', async () => {
    const deps = fakeDeps()
    const jobs = soundWarmJobs([
      { s: 'gm_piano', note: 'c3' },
      { s: 'gm_piano', note: 'c3' },
      { s: 'gm_piano', note: 60, n: 1 },
      { s: 'gm_piano', freq: 440, n: 3 },
    ], deps)
    expect(jobs.map((j) => j.key)).toEqual(['font:0000_JCLive:c3', 'font:0000_Fluid:60', 'font:0000_Fluid:440'])
    await Promise.all(jobs.map((j) => j.run()))
    expect(deps.getFontBufferSource).toHaveBeenCalledWith('0000_JCLive', { note: 'c3' }, LIVE)
    expect(deps.getFontBufferSource).toHaveBeenCalledWith('0000_Fluid', { freq: 440 }, LIVE)
  })

  it('reads the live context when a load starts, not when the job is made', async () => {
    let ctx = { kind: 'first' } as unknown as BaseAudioContext
    const deps = fakeDeps({ audioContext: () => ctx })
    const [job] = soundWarmJobs([{ s: 'bd' }], deps)
    ctx = LIVE
    await job.run()
    expect(deps.loadBuffer).toHaveBeenCalledWith('https://cdn/bd/0.wav', LIVE, 'bd', 0)
  })

  it('makes no job for a synth, an unknown name or a value with no sound', () => {
    expect(soundWarmJobs([{ s: 'sawtooth' }, { s: 'nope' }, { note: 'c3' }, {}], fakeDeps())).toEqual([])
  })
})

describe('runWarmJobs', () => {
  it('waits for every load when they finish in time', async () => {
    const r = await runWarmJobs([{ key: 'a', run: async () => {} }, { key: 'b', run: async () => {} }], 1000)
    expect(r).toEqual({ loaded: 2, pending: 0 })
  })

  it('stops waiting at the cap, so a slow network still starts', async () => {
    const hang = { key: 'slow', run: () => new Promise<void>(() => {}) }
    const t0 = Date.now()
    const r = await runWarmJobs([{ key: 'a', run: async () => {} }, hang], 30)
    expect(Date.now() - t0).toBeLessThan(500)
    expect(r).toEqual({ loaded: 1, pending: 1 })
  })

  it('does not wait on a load that fails', async () => {
    const r = await runWarmJobs([{ key: 'bad', run: async () => { throw new Error('404') } }], 1000)
    expect(r).toEqual({ loaded: 0, pending: 1 })
  })
})
