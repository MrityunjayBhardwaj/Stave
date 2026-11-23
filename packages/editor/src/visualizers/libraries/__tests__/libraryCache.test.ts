import { describe, it, expect, vi } from 'vitest'
import { chooseEvictions, createLibraryCache, isLibraryGraph } from '../libraryCache'
import { libraryGraphBytes as canonicalGraphBytes, libraryGraphHash, type LibraryGraph } from '../graphHash'

/**
 * #2640 — the parts of the library cache that need no IndexedDB. What IndexedDB does
 * with them (hits, corrupt entries, quota, eviction on disk) is measured in real
 * Chromium, Firefox and WebKit by `packages/app/tests/library-cache.spec.ts`; jsdom has
 * no IndexedDB, and a fake one would only test the fake.
 */

// Two modules given out of order, one with a non-ASCII character so UTF-8 and
// `text.length` (UTF-16 code units) differ.
const graph: LibraryGraph = {
  entry: 'https://esm.sh/a.mjs',
  modules: {
    'https://esm.sh/b.mjs': 'export const b = "é"\n',
    'https://esm.sh/a.mjs': 'import "./b.mjs"\n',
  },
}

// Computed outside this code, with Node's crypto over the same rule:
//   sorted urls, url + "\n" + text.length + "\n" + text + "\n", utf8, sha384, base64
const GOLDEN = 'qamrGClHNySiaOWnWOIUw4D4iXJX4Y9PajIqigGrE0zXEEHwYJr3RBwsKEcYPZES'

describe('libraryGraphHash', () => {
  it('matches a hash computed independently with Node crypto', async () => {
    expect(await libraryGraphHash(graph)).toBe(GOLDEN)
  })

  it('takes the modules in URL order, whatever order they were given in', () => {
    const text = new TextDecoder().decode(canonicalGraphBytes(graph))
    expect(text.indexOf('https://esm.sh/a.mjs')).toBeLessThan(text.indexOf('https://esm.sh/b.mjs'))
    expect(canonicalGraphBytes(graph).byteLength).toBe(89)
  })

  it('changes when one character of one module changes', async () => {
    const edited = { ...graph, modules: { ...graph.modules, 'https://esm.sh/b.mjs': 'export const b = "e"\n' } }
    expect(await libraryGraphHash(edited)).not.toBe(GOLDEN)
  })

  it('cannot be fooled by moving text across the boundary between url and source', async () => {
    const a: LibraryGraph = { entry: 'u', modules: { u: 'x\n1\ny' } }
    const b: LibraryGraph = { entry: 'u\n5\nx', modules: { 'u\n5\nx': '1\ny' } }
    expect(new TextDecoder().decode(canonicalGraphBytes(a))).not.toBe(new TextDecoder().decode(canonicalGraphBytes(b)))
  })
})

describe('isLibraryGraph', () => {
  it('accepts a graph whose entry is one of its modules', () => {
    expect(isLibraryGraph(graph)).toBe(true)
  })
  it.each([
    ['null', null],
    ['a string', 'x'],
    ['no modules', { entry: 'a' }],
    ['empty modules', { entry: 'a', modules: {} }],
    ['an entry that is not a module', { entry: 'z', modules: { a: '' } }],
    ['a module that is not text', { entry: 'a', modules: { a: 1 } }],
    ['modules as an array', { entry: '0', modules: ['x'] }],
  ])('refuses %s', (_name, value) => {
    expect(isLibraryGraph(value)).toBe(false)
  })
})

describe('chooseEvictions', () => {
  const day = 24 * 60 * 60 * 1000
  const now = 100 * day
  const e = (sha384: string, bytes: number, ageDays: number) => ({ sha384, bytes, lastUsed: now - ageDays * day })

  it('drops least recently used first once past the size cap', () => {
    const entries = [e('old', 40, 3), e('mid', 40, 2), e('new', 40, 1)]
    expect(chooseEvictions(entries, { maxBytes: 100, maxAgeMs: 60 * day, now })).toEqual(['old'])
  })

  it('never drops the entry just stored, and counts it first', () => {
    const entries = [e('just', 90, 10), e('recent', 20, 0)]
    expect(chooseEvictions(entries, { maxBytes: 100, maxAgeMs: 60 * day, now, keep: 'just' })).toEqual(['recent'])
  })

  it('drops an entry unused past the age limit even with room to spare', () => {
    const entries = [e('stale', 1, 61), e('fresh', 1, 59)]
    expect(chooseEvictions(entries, { maxBytes: 1e9, maxAgeMs: 60 * day, now })).toEqual(['stale'])
  })

  it('keeps everything within both limits', () => {
    const entries = [e('a', 50, 1), e('b', 50, 2)]
    expect(chooseEvictions(entries, { maxBytes: 100, maxAgeMs: 60 * day, now })).toEqual([])
  })

  it('a smaller older entry still fits after a larger one is dropped', () => {
    const entries = [e('big', 80, 2), e('small', 10, 3), e('newest', 50, 1)]
    expect(chooseEvictions(entries, { maxBytes: 100, maxAgeMs: 60 * day, now })).toEqual(['big'])
  })
})

describe('without IndexedDB (jsdom has none)', () => {
  it('every lookup misses, nothing throws, and it says so once', async () => {
    expect(typeof indexedDB).toBe('undefined')
    const warn = vi.fn()
    const cache = createLibraryCache({ warn })
    await expect(cache.getGraph(GOLDEN)).resolves.toBeNull()
    await expect(cache.putGraph(GOLDEN, graph)).resolves.toBeUndefined()
    await expect(cache.getGraph(GOLDEN)).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/can't be kept on this device \(no IndexedDB here\)/)
  })
})
