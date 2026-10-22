import { describe, it, expect } from 'vitest'
import { detectAllChunks, detectChunk } from '../chunkDetect'

/**
 * #866 — chunkDetect resolves bare-identifier `const/let/var` references to the
 * voice they name, so a `$: bass` / `stack(beat, …)` reference classifies as its
 * bound pattern (editable) instead of `unknown`/code-only.
 *
 * chunkDetect is the classifier behind BOTH the Mixer/Pattern editability views
 * and the edit-coverage harness oracle, so these pins guard the app win and the
 * measurement together.
 */
describe('#866 — chunkDetect binding resolution', () => {
  it('whole-track ref resolves to its voice (was unknown → roll)', () => {
    const doc = 'const bass = note("c2 e2 g2 e2")\n$: bass'
    const chunks = detectAllChunks(doc)
    // The `$: bass` usage yields one chunk; the `const` declaration yields none.
    expect(chunks).toHaveLength(1)
    expect(chunks[0].headFn).toBe('note')
    expect(chunks[0].miniString).toBe('c2 e2 g2 e2')
    expect(chunks[0].type).toBe('roll')
  })

  it('resolved chunk anchors at the DEFINITION (edits write to the const)', () => {
    const doc = 'const bass = note("c2 e2 g2 e2")\n$: bass'
    const c = detectAllChunks(doc)[0]
    // exprRange points into the `const bass = …` line (offset < the `$:` line),
    // so span-surgery writes to the single source of truth, not the `$: bass`.
    const dollarPos = doc.indexOf('$:')
    expect(c.exprRange[0]).toBeLessThan(dollarPos)
    // Freshness watches the const declaration statement.
    expect(c.statementText.startsWith('const bass')).toBe(true)
  })

  it('stack-arg ref resolves when the cursor is on it (bakery-140 shape)', () => {
    const doc = 'const beat = sound("bd*4")\n$: stack(beat, s("~ cp"))'
    const beatPos = doc.indexOf('beat, ') // the usage inside stack(...)
    const c = detectChunk(doc, beatPos)
    expect(c?.headFn).toBe('sound') // resolves to the bound `sound("bd*4")` voice
    expect(c?.type).toBe('step')
  })

  it('a named-label ref keeps its display label while anchoring at the def', () => {
    const doc = 'const bass = note("c2 e2")\ndrums: bass'
    const c = detectAllChunks(doc).find((x) => x.headFn === 'note')
    expect(c?.label).toBe('drums') // display label preserved (from the usage)
    expect(c?.statementText.startsWith('const bass')).toBe(true) // edits anchor at def
  })

  it('resolves transitive identifier bindings (a = b; b = note(...))', () => {
    const doc = 'const b = note("c2 e2")\nconst a = b\n$: a'
    const c = detectAllChunks(doc)[0]
    expect(c.headFn).toBe('note')
    expect(c.type).toBe('roll')
  })

  it('D-02: a reassigned name is ambiguous → stays unresolved (unknown)', () => {
    // `var` is redeclarable (so the doc still parses); the duplicate makes the
    // binding ambiguous → buildBindingIndex drops it → the ref stays unknown.
    const doc = 'var bass = note("c2 e2")\nvar bass = note("g2 a2")\n$: bass'
    const chunks = detectAllChunks(doc)
    const ref = chunks.find((c) => c.statementText.includes('$: bass'))
    expect(ref?.headFn ?? null).toBeNull()
    expect(ref?.type).toBe('unknown')
  })

  it('regression: a non-binding tune is classified exactly as before', () => {
    expect(detectAllChunks('$: note("c2 e2 g2")')[0].type).toBe('roll')
    expect(detectAllChunks('$: s("bd sd hh")')[0].type).toBe('step')
    // A bare identifier that is NOT a binding stays unknown (unchanged).
    expect(detectAllChunks('$: undefinedThing')[0].type).toBe('unknown')
  })
})
