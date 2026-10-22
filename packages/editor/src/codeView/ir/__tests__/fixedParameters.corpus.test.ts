/**
 * #1600 — the archive census for fixed values: every one offered, across every
 * document, is a value a lane can own, and the rewrite reads back as its steps.
 *
 * Population: `loadEveryCorpusDocument` — 558 documents by sha256 of `code`.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { fixedParameters, fixedToStepsEdit } from '../fixedParameters'
import { steppedAutomations } from '../steppedAutomation'
import { isSectionWindow } from '../parameterRoutes'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../miniSource/__tests__/evalHarness'

const STEPS = 4

describe('#1600 — fixed values across the archive', () => {
  it.skipIf(!hasCorpusArchive())(
    'every offered value plays song or section time, and its rewrite reads back as steps of it',
    async () => {
      const corpus = await loadEveryCorpusDocument()
      let docs = 0
      let offered = 0
      let withRange = 0
      const failures: string[] = []
      for (const { name, code } of corpus) {
        let found
        try {
          found = fixedParameters(parseStrudel(code) as never)
        } catch {
          continue
        }
        if (found.length > 0) docs++
        for (const f of found) {
          offered++
          const where = `${name} @${f.argSpan.start} .${f.method}(${code.slice(f.argSpan.start, f.argSpan.end)})`
          if (!f.placements.every((p) => p.every(isSectionWindow))) failures.push(`${where}: under a time warp`)
          const edit = fixedToStepsEdit(f, STEPS, code)
          if (!edit) {
            failures.push(`${where}: no edit`)
            continue
          }
          const next = code.slice(0, edit.range[0]) + edit.text + code.slice(edit.range[1])
          const back = steppedAutomations(parseStrudel(next) as never).find((a) => a.offset === f.offset)
          const values = back?.steps.map((s) => s.value)
          if (JSON.stringify(values) !== JSON.stringify(Array(STEPS).fill(f.value))) {
            failures.push(`${where}: read back ${JSON.stringify(values)}`)
          }
          if (fixedParameters(parseStrudel(next) as never).some((g) => g.offset === f.offset)) {
            failures.push(`${where}: still offered as fixed after the rewrite`)
          }
        }
        withRange += found.length
      }
      console.log(`[#1600 census] documents=${corpus.length} withFixed=${docs} offered=${offered}`)
      expect(corpus.length).toBe(558)
      expect(failures.slice(0, 20)).toEqual([])
      // Pinned from the first run. The issue's 2537 in 305 counts every fixed value;
      // these are the ones a lane can own — under no time warp, one section length.
      // A move here is a change in what is offered: read which documents moved.
      expect([docs, offered]).toEqual([290, 2244])
    },
    600_000,
  )
})
