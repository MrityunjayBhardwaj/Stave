/**
 * The modelling ratchet (#1866, epic #1007) — counts of re-modelling that may only fall.
 *
 * The epic's promise is that Stave stops re-deriving what Strudel already answers. Its
 * gates measured reach, and pinned the figures as literals — and a literal the same change
 * may re-pin records drift instead of stopping it. The P6 blocker set grew 51 → 55 and the
 * untransferable set 68 → 77 that way, across #1827 and #1849, every gate green.
 *
 * So each count here has a LEDGER: an append-only history in `ledger.json`. The gate that
 * measures a count calls `checkRatchet`, and:
 *
 *   - measured == the ledger's last value      → pass
 *   - measured <  it (it fell)                   → FAIL until a lower entry is appended, so
 *                                                   every gain is recorded and becomes the
 *                                                   new ceiling
 *   - measured >  it (it rose)                   → FAIL until an entry is appended that
 *                                                   carries an `exemption` naming an issue
 *
 * and the ledger itself must never rise from one entry to the next without an exemption.
 * An increase is therefore always a visible edit to this one file, naming why — never a
 * number quietly changed beside the code that moved it.
 *
 * The ledger is also APPEND-ONLY against `origin/main`: every history there must be an
 * unchanged prefix of the history here. Without that, overwriting the last entry in place
 * (77 → 78) would pass both rules above.
 *
 * What this cannot check: that the named issue is open and sits under #1007. Tests run
 * offline, so that half is the reviewer's, and the exemption line is what they read.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LedgerEntry {
  value: number
  /** ISO date the value was measured */
  date: string
  /** what moved it, and by what mechanism */
  note: string
  /** required when `value` is above the previous entry's: `#<issue>` and why it was allowed */
  exemption?: string
}

export interface LedgerCount {
  /** what is counted, in one sentence */
  what: string
  /** the test that measures it and calls `checkRatchet` */
  measuredBy: string
  history: LedgerEntry[]
}

export type Ledger = Record<string, LedgerCount>

export const LEDGER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ledger.json')

export function loadLedger(file: string = LEDGER_PATH): Ledger {
  return JSON.parse(fs.readFileSync(file, 'utf8')).counts as Ledger
}

/** an exemption must name an issue: `#1234 …` */
const EXEMPTION = /^#\d+\b/

/** every rule the ledger's own history must satisfy — empty when it is well formed */
export function ledgerProblems(ledger: Ledger): string[] {
  const out: string[] = []
  for (const [name, count] of Object.entries(ledger)) {
    if (!count.what || !count.measuredBy) out.push(`${name}: missing "what" or "measuredBy"`)
    if (!Array.isArray(count.history) || count.history.length === 0) {
      out.push(`${name}: empty history`)
      continue
    }
    count.history.forEach((e, i) => {
      if (!Number.isInteger(e.value) || e.value < 0) out.push(`${name}[${i}]: value must be a non-negative integer`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) out.push(`${name}[${i}]: date must be YYYY-MM-DD`)
      if (!e.note) out.push(`${name}[${i}]: missing note`)
      if (e.exemption !== undefined && !EXEMPTION.test(e.exemption)) {
        out.push(`${name}[${i}]: exemption must start with an issue number (#1234), got ${JSON.stringify(e.exemption)}`)
      }
      const prev = count.history[i - 1]
      if (prev && e.value > prev.value && e.exemption === undefined) {
        out.push(`${name}[${i}]: rose ${prev.value} → ${e.value} without an exemption naming an issue`)
      }
    })
  }
  return out
}

/** every way `current` rewrites rather than extends `base` — empty when it only appends */
export function appendOnlyProblems(current: Ledger, base: Ledger): string[] {
  const out: string[] = []
  for (const [name, was] of Object.entries(base)) {
    const now = current[name]
    if (!now) {
      out.push(`${name}: removed from the ledger (it is on origin/main)`)
      continue
    }
    was.history.forEach((e, i) => {
      if (JSON.stringify(now.history[i]) !== JSON.stringify(e)) {
        out.push(`${name}[${i}]: rewritten — origin/main has ${JSON.stringify(e)}, the tree has ${JSON.stringify(now.history[i])}`)
      }
    })
  }
  return out
}

export type MainLedger = { kind: 'present'; ledger: Ledger } | { kind: 'absent' }

/**
 * The ledger as `origin/main` has it. 'absent' only when main has no such file (the change
 * that introduces the ratchet); any other git failure THROWS, because "could not look" must
 * never read as "nothing was rewritten".
 */
export function ledgerOnMain(file: string = LEDGER_PATH): MainLedger {
  const text = textOnMain(file)
  if (text === null) return { kind: 'absent' }
  return { kind: 'present', ledger: JSON.parse(text).counts as Ledger }
}

/**
 * A file's contents as `origin/main` has it, or null when main has no such file. Any other
 * git failure THROWS. Shared with the code↔view boundary's exception list (#1879), which is
 * shrink-only against main the way the ledger is append-only against it.
 */
export function textOnMain(file: string): string | null {
  const dir = path.dirname(file)
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const top = git('rev-parse', '--show-toplevel').trim()
  const rel = path.relative(top, file)
  if (rel.startsWith('..')) throw new Error(`${file} is outside the repository at ${top}`)
  git('rev-parse', '--verify', 'origin/main') // throws when there is no origin/main to compare against
  const listed = git('ls-tree', '--full-tree', '--name-only', 'origin/main', '--', rel).trim()
  if (listed === '') return null
  return git('show', `origin/main:${rel}`)
}

/**
 * The call a gate makes. Throws the WHOLE problem as the error message — `expect(p).toBeNull()`
 * truncates it at the arrow, so a failing run would never show the instruction to append.
 */
export function assertRatchet(name: string, measured: number, ledger?: Ledger): void {
  const problem = ratchetProblem(name, measured, ledger)
  if (problem !== null) throw new Error(`modelling ratchet (#1866): ${problem}`)
}

/**
 * Compare a freshly measured count against its ledger. Returns the problem, or null when
 * the measurement equals the ledger's last value. Callers assert it is null, so the
 * message is what a failing run prints.
 */
export function ratchetProblem(name: string, measured: number, ledger: Ledger = loadLedger()): string | null {
  const count = ledger[name]
  if (!count) return `no ledger entry named "${name}" in modellingRatchet/ledger.json`
  const own = ledgerProblems({ [name]: count })
  if (own.length) return own.join('\n')
  const last = count.history[count.history.length - 1]
  if (measured === last.value) return null
  if (measured < last.value) {
    return (
      `${name} FELL ${last.value} → ${measured}. Good — record it: append ` +
      `{ "value": ${measured}, "date": …, "note": "<what moved it>" } to its history in ` +
      `modellingRatchet/ledger.json, so ${measured} becomes the new ceiling.`
    )
  }
  return (
    `${name} ROSE ${last.value} → ${measured}. The epic (#1007) allows this only by exemption: ` +
    `append { "value": ${measured}, "date": …, "note": "<mechanism>", "exemption": "#<issue> <why>" } ` +
    `to its history in modellingRatchet/ledger.json, naming an open issue under #1007 that ` +
    `will bring it back down.`
  )
}
