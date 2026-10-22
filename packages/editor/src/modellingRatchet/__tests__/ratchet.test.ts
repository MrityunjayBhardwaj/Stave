import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { appendOnlyProblems, assertRatchet, LEDGER_PATH, ledgerOnMain, ledgerProblems, loadLedger, ratchetProblem, type Ledger } from '../ratchet'

const entry = (value: number, extra: object = {}) => ({ value, date: '2026-09-30', note: 'n', ...extra })
const one = (...history: ReturnType<typeof entry>[]): Ledger => ({
  c: { what: 'w', measuredBy: 'm', history },
})

describe('the modelling ratchet (#1866)', () => {
  it('the committed ledger is well formed', () => {
    expect(ledgerProblems(loadLedger())).toEqual([])
  })

  it('names every count a gate measures', () => {
    expect(Object.keys(loadLedger()).sort()).toEqual([
      'predicate-audit.anchored',
      'writer-census.p6-blocker',
      'writer-census.untransferable',
      'writer-census.unverified',
    ])
  })

  describe('a measurement against the ledger', () => {
    it('passes when it equals the last value', () => {
      expect(ratchetProblem('c', 5, one(entry(7), entry(5)))).toBeNull()
    })

    it('fails when it ROSE, and says an exemption is needed', () => {
      expect(ratchetProblem('c', 6, one(entry(5)))).toMatch(/ROSE 5 → 6.*exemption/s)
    })

    it('fails when it FELL, so the gain is recorded as the new ceiling', () => {
      expect(ratchetProblem('c', 4, one(entry(5)))).toMatch(/FELL 5 → 4/)
    })

    it('passes a rise once an exempted entry records it', () => {
      expect(ratchetProblem('c', 6, one(entry(5), entry(6, { exemption: '#1869 needed while the adapter lands' })))).toBeNull()
    })

    it('assertRatchet throws the whole instruction, not a truncated diff', () => {
      expect(() => assertRatchet('c', 6, one(entry(5)))).toThrow(/ROSE 5 → 6.*"exemption": "#<issue> <why>"/s)
      expect(() => assertRatchet('c', 5, one(entry(5)))).not.toThrow()
    })

    it('fails on a count the ledger does not name', () => {
      expect(ratchetProblem('missing', 1, one(entry(1)))).toMatch(/no ledger entry/)
    })
  })

  describe("the ledger's own history", () => {
    it('refuses a rise between entries without an exemption', () => {
      expect(ledgerProblems(one(entry(5), entry(6)))).toEqual(['c[1]: rose 5 → 6 without an exemption naming an issue'])
    })

    it('refuses an exemption that names no issue', () => {
      expect(ledgerProblems(one(entry(5), entry(6, { exemption: 'temporary' })))).toHaveLength(1)
    })

    it('accepts falls and equal entries without an exemption', () => {
      expect(ledgerProblems(one(entry(7), entry(5), entry(5)))).toEqual([])
    })

    it('refuses an empty history, a bad date, and a missing note', () => {
      expect(ledgerProblems(one())).toEqual(['c: empty history'])
      expect(ledgerProblems(one({ value: 1, date: '30/09/2026', note: 'n' }))).toHaveLength(1)
      expect(ledgerProblems(one({ value: 1, date: '2026-09-30', note: '' }))).toHaveLength(1)
    })

  })

  describe('append-only against origin/main', () => {
    it('accepts an appended entry', () => {
      expect(appendOnlyProblems(one(entry(5), entry(4)), one(entry(5)))).toEqual([])
    })

    it('refuses a last entry overwritten in place — the rise the other two rules cannot see', () => {
      // 5 → 6 edited into the only entry: well formed, and a measurement of 6 would pass
      const rewritten = one(entry(6))
      expect(ledgerProblems(rewritten)).toEqual([])
      expect(ratchetProblem('c', 6, rewritten)).toBeNull()
      expect(appendOnlyProblems(rewritten, one(entry(5)))).toHaveLength(1)
    })

    it('refuses a count removed from the ledger', () => {
      expect(appendOnlyProblems({}, one(entry(5)))).toEqual(['c: removed from the ledger (it is on origin/main)'])
    })

    it("the committed ledger only appends to origin/main's", () => {
      const main = ledgerOnMain()
      if (main.kind === 'absent') {
        // Only legitimate in the change that introduces the ratchet, and that change is the
        // only one whose ledger holds nothing but baselines. Once any history has grown, a
        // ledger missing from main means a stale fetch or a deletion — never a pass.
        const grown = Object.entries(loadLedger()).filter(([, c]) => c.history.length > 1).map(([n]) => n)
        expect(grown, 'origin/main has no ledger, but these counts already have history — fetch origin, or restore the ledger on main').toEqual([])
        console.warn('modelling ratchet: no ledger on origin/main yet (baselines only), so append-only is not checked in this run')
        return
      }
      expect(appendOnlyProblems(loadLedger(), main.ledger)).toEqual([])
    })

    it('ledgerOnMain finds a file that IS on origin/main (control: absent must not be the default answer)', () => {
      // A file main holds whatever else moves: packages/editor/tsup.config.ts (the ir/ audit it
      // used to read moved to codeView/ir/ in #1875, which would make this answer 'absent').
      const onMain = path.join(path.dirname(LEDGER_PATH), '..', '..', 'tsup.config.ts')
      // tsup.config.ts is not JSON, so reading it must THROW at the parse — which proves
      // the lookup found it rather than answering 'absent'
      expect(() => ledgerOnMain(onMain)).toThrow(SyntaxError)
    })
  })
})
