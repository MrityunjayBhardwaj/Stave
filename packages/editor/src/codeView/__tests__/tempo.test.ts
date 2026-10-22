/**
 * #1925 — the tempo a document sets, read once. The cases are the ones measured
 * in the browser against the scheduler's own cps (the transport LCD):
 * `setcpm(30)` ran at 0.50 and the play bar showed nothing; a commented
 * `// setcps(0.25)` above `setcps(0.5)` ran at 0.50 and the play bar showed 60.
 */
import { describe, it, expect } from 'vitest'
import { writtenCps, writtenBpm } from '../tempo'
import { TEMPO_SETTERS } from '../ir/statementHeads'

describe('writtenCps — what the code sets (#1925)', () => {
  it('reads the whole setter family, cpm as per minute', () => {
    expect(writtenCps('setcps(0.5)\n$: s("bd")')).toBe(0.5)
    expect(writtenCps('setCps(0.5)')).toBe(0.5)
    expect(writtenCps('setcpm(30)\n$: s("bd")')).toBe(0.5) // the scheduler ran this at 0.50
    expect(writtenCps('setCpm(120/4)')).toBe(0.5)
  })

  it('reads every name on the shared setter list, and nothing else (#1927)', () => {
    // blockScan ends a block on the same list; a name this reader lacked would be a
    // block boundary with no tempo, and the play bar would show nothing for it.
    for (const name of TEMPO_SETTERS) expect(writtenCps(`${name}(30)`), name).not.toBeNull()
    expect(writtenCps('setcpsfoo(30)')).toBeNull()
    expect(writtenCps('setbpm(120)')).toBeNull() // on the non-track list, but not a grounded setter
  })

  it('reads literal arithmetic, the way tempos are written', () => {
    expect(writtenCps('setcps(92/240)')).toBeCloseTo(92 / 240, 12)
    expect(writtenCps('setcps(130/60/4)')).toBeCloseTo(130 / 60 / 4, 12)
    expect(writtenCps('setcps((1+1)*0.25)')).toBe(0.5)
  })

  it('a comment is not a tempo — the regex took the first match anywhere', () => {
    expect(writtenCps('// setcps(0.25)\nsetcps(0.5)\n$: s("bd")')).toBe(0.5)
    expect(writtenCps('/* setcps(0.25) */\n$: s("bd")')).toBeNull()
    expect(writtenCps('$: s("bd") // setcps(1)')).toBeNull()
  })

  it('the last setter wins — statements run in order', () => {
    expect(writtenCps('setcps(0.25)\nsetcpm(60)')).toBe(1)
  })

  it('a setter it cannot evaluate is unknown, never the earlier value', () => {
    expect(writtenCps('setcps(0.5)\nsetcps(tempo)')).toBe('unknown')
    expect(writtenCps('const t = 1\nsetcps(t / 2)')).toBe('unknown')
    expect(writtenCps('setcps(1/0)')).toBe('unknown')
  })

  it('no setter is null; a document that does not parse is unknown', () => {
    expect(writtenCps('$: s("bd")')).toBeNull()
    expect(writtenCps('$: s("bd").cpm(30)')).toBeNull() // a chain method, not the setter
    expect(writtenCps('setcps(0.5')).toBe('unknown')
  })
})

describe('writtenBpm — the play bar readout', () => {
  it('four quarter notes per cycle (#599)', () => {
    expect(writtenBpm('setcps(92/240)')).toBe(92)
    expect(writtenBpm('setcpm(30)')).toBe(120)
    expect(writtenBpm('// setcps(0.25)\nsetcps(0.5)')).toBe(120)
  })

  it('nothing it can read is no readout, not a guess', () => {
    expect(writtenBpm('$: s("bd")')).toBeUndefined()
    expect(writtenBpm('setcps(tempo)')).toBeUndefined()
  })
})
