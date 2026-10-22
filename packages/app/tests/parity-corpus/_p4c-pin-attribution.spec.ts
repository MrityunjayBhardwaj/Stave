/**
 * WHY the pins moved — attribution, not adjustment (#1010 P4c).
 *
 * Four gates changed their numbers this phase. Re-basing a pin without naming the
 * mechanism is how a figure drifts: the next reader sees a literal and no reason, and
 * the gate stops being able to say whether a later move is the same cause or a new
 * defect. So each move is attributed against the writer as it stood at
 * `studio_v0.2.0`, unit by unit, using the base modules in `__p4c_base__/`.
 *
 * Not a gate. `.spec.ts` so the normal run skips it.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parseStepGridCore } from '../../../editor/src/codeView/notation/parse'
import { parseStepGrid as baseParseStepGrid } from './__p4c_base__/parse'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const minis: string[] = corpus.minis.map((o: { mini: string }) => o.mini)

type Path = 'syntactic' | 'derived' | 'derived+leaf' | 'ABSENT'

describe('P4c — attribute the moved pins', () => {
  it('cell-duration: which units left the population, and which changed path', () => {
    // The population gate is `parseStepGrid(...).ok`, and the PARSER calls the WRITER
    // before it offers a view (`parse.ts:1638` — "the writer must reproduce the user's
    // bytes before we offer the view at all", plus `leafViewUsable`). So a printer
    // change moves a READER population: that is the intended direction of
    // prove-before-offer, and the question is only whether it moved the right units.
    const classify = (
      r: { ok: boolean; model?: { leafSource?: unknown } },
      mini: string,
    ): Path =>
      !r.ok
        ? 'ABSENT'
        : parseStepGridCore(mini).ok
          ? 'syntactic'
          : r.model?.leafSource
            ? 'derived+leaf'
            : 'derived'

    const moves = new Map<string, string[]>()
    for (const mini of minis) {
      const a = classify(baseParseStepGrid(mini) as never, mini)
      const b = classify(parseStepGrid(mini) as never, mini)
      if (a === b) continue
      const k = `${a} -> ${b}`
      moves.set(k, [...(moves.get(k) ?? []), mini.trim()])
    }
    console.log('\n===== cell-duration population: base -> HEAD =====')
    for (const [k, v] of [...moves].sort()) {
      console.log(`\n  ${k}   (${v.length})`)
      for (const m of v) console.log(`     ${JSON.stringify(m).slice(0, 100)}`)
    }
    // Made available to the snapshot check below as the ONE set both must match.
    fs.writeFileSync(
      path.join(here, '_p4c-absent.json'),
      JSON.stringify((moves.get('derived -> ABSENT') ?? []).sort(), null, 1),
    )
  })

  it('the two SNAPSHOTS moved on exactly that set and nowhere else', () => {
    // [[P361]]: a snapshot refresh is READ by pinning the variable, not by eyeballing the
    // diff. Here the INPUT did not move — `mini-corpus.json` is byte-identical — so the
    // only variable is the code, and the question the reading must answer is narrow: did
    // every changed entry change for the one reason this phase claims?
    //
    // Answered by construction. The set of units the printer's decline removed from the
    // derived-grid population is derived from the CODE (base parse vs HEAD parse, the test
    // above). Both snapshots are then required to have moved on exactly that set.
    const absent: string[] = JSON.parse(fs.readFileSync(path.join(here, '_p4c-absent.json'), 'utf8'))
    const BASE = '5f008316'
    const show = (p: string) =>
      execFileSync('git', ['show', `${BASE}:${p}`], {
        cwd: path.resolve(here, '../../../..'),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })

    // vitest writes a multi-line mini with REAL newlines inside the quotes, so the literal
    // is not valid JSON until they are re-escaped. (Found by `JSON.parse` throwing "bad
    // control character" — the reason to read the file rather than trust the shape.)
    const unq = (lit: string): string =>
      JSON.parse(lit.replace(/\r/g, '\\r').replace(/\n/g, '\\n'))

    // ── mini-corpus: the grid verdict flips from "ok" to a refusal, for these and only these
    const snapPath = 'packages/app/tests/parity-corpus/__snapshots__/mini-corpus.test.ts.snap'
    const verdicts = (src: string): Map<string, string> => {
      // entries are `{ "grid": …, "mini": …, "roll": … }` — read the pair positionally,
      // which is enough to compare two generations of the same generator
      const out = new Map<string, string>()
      const re = /"grid":\s*("(?:[^"\\]|\\.)*"),\s*\n\s*"mini":\s*("(?:[^"\\]|\\.)*")/g
      for (const m of src.matchAll(re)) out.set(unq(m[2]), unq(m[1]))
      return out
    }
    const vOld = verdicts(show(snapPath))
    const vNew = verdicts(fs.readFileSync(path.resolve(here, '../../../..', snapPath), 'utf8'))
    expect(vOld.size, 'the verdict reader must actually find entries').toBeGreaterThan(1000)
    expect(vNew.size).toBe(vOld.size)
    const flipped = [...vOld].filter(([mini, v]) => vNew.get(mini) !== v).map(([mini]) => mini)
    console.log(`\nmini-corpus: ${flipped.length} grid verdicts flipped`)
    for (const m of flipped) console.log(`   ${JSON.stringify(m)}\n      ${JSON.stringify(vOld.get(m))} -> ${JSON.stringify(vNew.get(m))}`)
    expect(flipped.map((m) => m.trim()).sort()).toEqual([...absent].sort())
    // and every flip is ok → a refusal, never the reverse and never refusal → refusal
    for (const m of flipped) {
      expect(vOld.get(m), m).toBe('ok')
      expect(vNew.get(m), m).not.toBe('ok')
    }

    // ── round-trip: the same units leave the identity LOCK, and nothing joins the
    // `serializer-null` pin — that second half is the one that matters. A unit leaving
    // the lock into `closed` means "no view is offered"; a unit arriving in
    // `serializer-null` would mean "the view opens and then cannot write back", which is
    // the failure this phase must not have introduced.
    const rtPath = 'packages/app/tests/parity-corpus/__snapshots__/round-trip.test.ts.snap'
    const block = (src: string, key: string): string[] => {
      const i = src.indexOf(key)
      expect(i, `snapshot key not found: ${key}`).toBeGreaterThan(-1)
      const body = src.slice(i, src.indexOf('\n`;', i))
      return [...body.matchAll(/^\s*("(?:[^"\\]|\\.)*"),$/gm)].map((m) => unq(m[1]))
    }
    const rtOld = show(rtPath)
    const rtNew = fs.readFileSync(path.resolve(here, '../../../..', rtPath), 'utf8')
    const lockOld = block(rtOld, 'grid-round-trips-locked 1`]')
    const lockNew = block(rtNew, 'grid-round-trips-locked 1`]')
    expect(lockOld.length).toBeGreaterThan(500)
    const left = lockOld.filter((m) => !lockNew.includes(m))
    const joined = lockNew.filter((m) => !lockOld.includes(m))
    console.log(`\nround-trip lock: ${left.length} left, ${joined.length} joined`)
    expect(left.map((m) => m.trim()).sort()).toEqual([...absent].sort())
    expect(joined, 'nothing should JOIN the lock — this phase removes views, it adds none here').toEqual([])
    const nullOld = block(rtOld, 'grid-serializer-null 1`]')
    const nullNew = block(rtNew, 'grid-serializer-null 1`]')
    expect(
      nullNew,
      'a unit that OPENS and then refuses to write is the one regression this phase must not add',
    ).toEqual(nullOld)
  })
})
