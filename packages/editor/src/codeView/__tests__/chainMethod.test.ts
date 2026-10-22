import { describe, it, expect } from 'vitest'
import { readChainMethod } from '../chainMethod'
import type { ChunkInfo } from '../chunkDetect'

/** minimal ChunkInfo carrying just the chain the reader inspects */
function chunk(calls: Array<{ name: string; args: string[] }>): ChunkInfo {
  return {
    chain: calls.map((c) => ({
      name: c.name,
      range: [0, 0] as [number, number],
      args: c.args.map((raw) => ({ raw, numeric: null, range: [0, raw.length] as [number, number] })),
    })),
  } as unknown as ChunkInfo
}

describe('readChainMethod (#514/#515)', () => {
  it('reads a quoted .sound value and the matched method name', () => {
    const c = chunk([{ name: 'note', args: ['"c e g"'] }, { name: 'sound', args: ["'sawtooth'"] }])
    const r = readChainMethod(c, ['sound', 's'])
    expect(r?.value).toBe('sawtooth')
    expect(r?.name).toBe('sound')
  })

  it('matches the .s alias', () => {
    const c = chunk([{ name: 'note', args: ['"c"'] }, { name: 's', args: ['"piano"'] }])
    expect(readChainMethod(c, ['sound', 's'])?.value).toBe('piano')
  })

  it('reads .bank', () => {
    const c = chunk([{ name: 's', args: ['"bd sd"'] }, { name: 'bank', args: ["'RolandTR909'"] }])
    expect(readChainMethod(c, ['bank'])?.value).toBe('RolandTR909')
  })

  it('returns null when the method is absent (→ insert path)', () => {
    const c = chunk([{ name: 'note', args: ['"c"'] }])
    expect(readChainMethod(c, ['sound', 's'])).toBeNull()
  })

  it('hands off a non-string (signal/identifier) arg', () => {
    const c = chunk([{ name: 's', args: ['"bd"'] }, { name: 'bank', args: ['someSignal'] }])
    expect(readChainMethod(c, ['bank'])).toBeNull()
  })

  it('exposes the arg range for in-place replacement', () => {
    const c = chunk([{ name: 's', args: ['"bd"'] }, { name: 'bank', args: ["'tr909'"] }])
    expect(readChainMethod(c, ['bank'])?.range).toEqual([0, "'tr909'".length])
  })
})
