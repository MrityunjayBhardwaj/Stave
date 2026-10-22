/**
 * statementHeads — the shared lists of top-level heads (#1178, #1927).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NON_TRACK_HEADS, NON_TRACK_HEAD_RE, TEMPO_SETTERS } from '../statementHeads'

describe('the owner stays importable from anywhere (#1927)', () => {
  it('has no imports at all, so the engine can reach it without the codeView entry', () => {
    // `visualizers/blockScan.ts` (in the engine's import graph, via
    // `engine/vizLineScan.ts`) imports `TEMPO_SETTERS` from this file directly,
    // under a named boundary entry. An import added here would travel into that
    // graph. Same rule, same arm, as `trackId.ts`.
    const source = readFileSync(path.join(__dirname, '..', 'statementHeads.ts'), 'utf8')
    const imports = source.match(/^\s*(import\s|export\s+\{[^}]*\}\s*from|.*\brequire\()/gm) ?? []
    expect(imports).toEqual([])
    // Control: the same read on a file that DOES import finds one.
    const parser = readFileSync(path.join(__dirname, '..', 'parseStrudel.ts'), 'utf8')
    expect(parser.match(/^\s*import\s/gm)?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('TEMPO_SETTERS', () => {
  it('is the four grounded names, and every one is also a non-track head', () => {
    expect([...TEMPO_SETTERS]).toEqual(['setcps', 'setCps', 'setcpm', 'setCpm'])
    for (const name of TEMPO_SETTERS) {
      expect(NON_TRACK_HEADS.has(name), name).toBe(true)
      expect(NON_TRACK_HEAD_RE.test(`${name}(1)`), name).toBe(true)
    }
  })

  it('leaves out the ungrounded setbpm pair, which stays only on the non-track list', () => {
    for (const name of ['setbpm', 'setBpm']) {
      expect((TEMPO_SETTERS as readonly string[]).includes(name), name).toBe(false)
      expect(NON_TRACK_HEADS.has(name), name).toBe(true)
    }
  })
})
