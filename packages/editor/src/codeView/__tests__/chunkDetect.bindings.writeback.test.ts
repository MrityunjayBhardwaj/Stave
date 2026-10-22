import { describe, it, expect } from 'vitest'
import { detectAllChunks, detectChunk, isChunkFresh } from '../chunkDetect'
import { applyEdits } from '../writeback'

/**
 * #866 follow-up — an edit made against a RESOLVED binding chunk writes back to
 * the binding's DEFINITION (the single source of truth), not the `$:` usage.
 *
 * The editability views commit through `applyEdits(doc, [{range, text}])` where
 * `range` comes from the chunk (e.g. `miniRange` for a roll/grid note edit).
 * Because a resolved chunk anchors its ranges at the `const` RHS, the write must
 * land on `const bass = note(...)`. This exercises the REAL offset write path.
 */
describe('#866 — write-back to a resolved binding', () => {
  it('a roll note edit rewrites the CONST mini, leaving the $: usage intact', () => {
    const doc = 'const bass = note("c2 e2")\n$: bass'
    const c = detectAllChunks(doc).find((x) => x.headFn === 'note')!
    expect(c.miniString).toBe('c2 e2')

    // Simulate the roll writing a new mini into the chunk's miniRange.
    const out = applyEdits(doc, [{ range: c.miniRange!, text: 'c2 e2 g2' }])
    expect(out).toBe('const bass = note("c2 e2 g2")\n$: bass') // const changed, usage intact
  })

  it('a stack-arg ref edit writes to that arg const definition', () => {
    const doc = 'const beat = sound("bd")\n$: stack(beat, s("~ cp"))'
    const c = detectChunk(doc, doc.indexOf('beat, '))!
    expect(c.headFn).toBe('sound')
    const out = applyEdits(doc, [{ range: c.miniRange!, text: 'bd sd' }])
    expect(out).toBe('const beat = sound("bd sd")\n$: stack(beat, s("~ cp"))')
  })

  it('#868: detectChunk RE-DETECTS at the resolved chunk’s const anchor', () => {
    // Every visual write re-anchors via `detectChunk(doc, chunk.statementRange[0])`
    // (useActiveChunk.applyEdit). For a resolved ref that anchor is the `const`
    // declaration — which used to yield null (VariableDeclaration), silently
    // no-opping the write.
    const doc = 'const bass = note("c2 e2").room(0.4)\n$: bass'
    const strip = detectAllChunks(doc).find((x) => x.headFn === 'note')!
    const anchor = strip.statementRange[0]

    const fresh = detectChunk(doc, anchor)
    expect(fresh).not.toBeNull()
    expect(fresh!.headFn).toBe('note')
    // The re-detected chunk matches the render-time one → the write commits.
    expect(fresh!.exprRange).toEqual(strip.exprRange)
    expect(fresh!.statementRange).toEqual(strip.statementRange)
    // And a write through it lands on the const.
    const room = fresh!.chain.find((c) => c.name === 'room')!
    const out = applyEdits(doc, [{ range: room.args[0].range, text: '0.9' }])
    expect(out).toBe('const bass = note("c2 e2").room(0.9)\n$: bass')
  })

  it('#868: a multi-declarator / destructuring declaration stays unresolved', () => {
    expect(detectChunk('const a = note("c2"), b = note("e2")\n$: a', 0)).toBeNull()
    expect(detectChunk('const {x} = obj\n$: s("bd")', 0)).toBeNull()
  })

  it('the resolved chunk is fresh against its OWN (const) statement', () => {
    const doc = 'const bass = note("c2 e2")\n$: bass'
    const c = detectAllChunks(doc).find((x) => x.headFn === 'note')!
    expect(isChunkFresh(doc, c)).toBe(true)
    // Editing the const line (its watched statement) makes it stale → a write
    // would be refused rather than corrupting a shifted offset.
    const edited = 'const bass = note("c2 e2 g2 a2")\n$: bass'
    expect(isChunkFresh(edited, c)).toBe(false)
  })
})
