/**
 * _1242-harvest-reach.spec.ts — INSTRUMENT for #1242. Measurement only, no product code.
 *
 * THE QUESTION: `harvest-mini-corpus.mjs` selects strings with the rule #1240
 * replaced — `HEADS.has(name)` on the first literal argument. The product now
 * resolves note content structurally. **How many strings does the product admit
 * that the harvest cannot see, and — the half the issue does not ask — how many
 * does the harvest see that the product's unit walk does NOT?**
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1242-harvest-reach.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * ── THE ONE RULE THAT IS RESTATED, AND ITS CONTROL ────────────────────────
 * NEW comes from `unitsWithStatus` — the same enumerator every corpus gate
 * scores against, which calls `detectAllChunks`/`detectChunk` and therefore the
 * shipped `resolveMini`. Nothing about it is spelled here.
 *
 * OLD is restated (the harvest's `HEADS` + `rootLiteral`), because attributing a
 * DEPARTURE needs the head it sat under and the committed JSON does not record
 * one. The restatement is not trusted: it is RECONCILED against the committed
 * `mini-corpus.json`, which was the old rule's own output, and both differences
 * are printed verbatim ([[P519]] paid for, not waived). On the run that decided
 * #1242 that reconciliation was exact but for 3 strings, and the 3 were the
 * finding — the script parsed with `sourceType: 'module'` where the product uses
 * `script`.
 *
 * ⚠ STALE CONTROL AFTER #1242 SHIPPED. `mini-corpus.json` is now the UNION, so
 * the reconciliation no longer reads zero: it reports ~98 committed-only rows,
 * which are this probe's own ARRIVALS having been adopted. That is the change
 * landing, not the instrument breaking. To re-run the original control, check
 * out the corpus at `9e4730e7`. The three threshold assertions below are
 * liveness guards on the probe and hold either way.
 *
 * ⚠ THE TWO RULES ANSWER DIFFERENT QUESTIONS, which is why departures exist and
 * are the deciding measurement:
 *   - harvest asks "which string literals in this document are note content"
 *     — every `s(...)`/`note(...)` call ANYWHERE, several per statement.
 *   - the unit walk asks "which editable UNITS exist, and what does each play"
 *     — one per top-level statement plus nested combinator voices, and a unit
 *     whose span is ambiguous is REFUSED on purpose (`resolveMini`'s
 *     `alternatives` gate).
 * A straight swap could therefore SHRINK the gated population.
 *
 * ⚠ Population note: the committed corpus names 7 input files; 24 sit on disk.
 * Verified before writing this: the extra 17 are RE-FETCHES of the same 360
 * tunes and the harvested mini list is byte-identical across both input sets
 * (only row-counted `uses`/`unparsedDocs` move). So OLD is comparable to a NEW
 * measured over all 24, and docs are deduped BY HASH here for the same reason.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unitsWithStatus } from './editCoverage'
import { parseTopLevel } from '../../../editor/src/codeView/chunkDetect'

const here = path.dirname(fileURLToPath(import.meta.url))
const runsDir = path.join(here, '.bakery-runs')

type Doc = { hash: string; code: string }

function loadDocs(): Doc[] {
  const byHash = new Map<string, string>()
  const files = fs
    .readdirSync(runsDir)
    .filter((f) => f.startsWith('edit-samples-') && f.endsWith('.json'))
    .sort()
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'))
    for (const s of raw.samples ?? raw) {
      if (s.hash && !byHash.has(s.hash)) byHash.set(s.hash, String(s.code))
    }
  }
  return [...byHash.entries()].map(([hash, code]) => ({ hash, code }))
}

/* ── the OLD rule, restated for attribution and controlled below ─────────── */
const OLD_HEADS = new Set(['s', 'sound', 'note', 'n'])
const MINI_ARG_FALLBACK = /\b(?:s|sound|note|n)\(\s*"([^"\\]*)"/g

/* eslint-disable @typescript-eslint/no-explicit-any */
function rootLiteral(node: any): string | null {
  let n = node
  while (n) {
    if (n.type === 'Literal')
      return typeof n.value === 'string' && n.raw?.[0] === '"' ? n.value : null
    if (n.type === 'TemplateLiteral')
      return n.expressions.length === 0 ? n.quasis[0].value.raw : null
    if (n.type === 'CallExpression') n = n.callee
    else if (n.type === 'MemberExpression') n = n.object
    else return null
  }
  return null
}

/** [mini, head] for every string the OLD rule admits from one document. */
function oldRuleHits(code: string): [string, string][] {
  const stmts = parseTopLevel(code)
  if (!stmts) {
    const out: [string, string][] = []
    for (const m of code.matchAll(MINI_ARG_FALLBACK)) out.push([m[1], '(fallback)'])
    return out
  }
  const out: [string, string][] = []
  const walk = (node: any) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return void node.forEach(walk)
    if (typeof node.type !== 'string') return
    if (node.type === 'CallExpression' && node.arguments.length > 0) {
      const c = node.callee
      const name =
        c?.type === 'Identifier'
          ? c.name
          : c?.type === 'MemberExpression' && c.property?.type === 'Identifier'
            ? c.property.name
            : null
      if (name && OLD_HEADS.has(name)) {
        const lit = rootLiteral(node.arguments[0])
        if (lit !== null) out.push([lit, name])
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
      walk(node[k])
    }
  }
  stmts.forEach(walk)
  return out
}

/** the statuses whose content a notation surface is actually ASKED to open */
const ASKED = new Set(['note', 'note-broken'])

describe('#1242 — what the harvest rule cannot see, and what the unit walk drops', () => {
  it('measures arrivals and departures between the two rules over the same tunes', () => {
    const docs = loadDocs()
    const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
    const COMMITTED = new Set<string>((corpus.minis as { mini: string }[]).map((m) => m.mini))

    const bump = (m: Map<string, Set<string>>, k: string, v: string) => {
      let s = m.get(k)
      if (!s) m.set(k, (s = new Set()))
      s.add(v)
    }

    const OLD = new Set<string>()
    const oldHeadOf = new Map<string, Set<string>>()
    const NEW = new Set<string>()
    const ASKED_SET = new Set<string>()
    const viaOf = new Map<string, Set<string>>()
    const headOf = new Map<string, Set<string>>()
    const statusOf = new Map<string, Set<string>>()
    const stmtOf = new Map<string, string>()
    const quoteOf = new Map<string, Set<string>>()
    let unitsSeen = 0

    for (const d of docs) {
      for (const [mini, head] of oldRuleHits(d.code)) {
        if (mini.trim() === '') continue
        OLD.add(mini)
        bump(oldHeadOf, mini, head)
      }
      let rows: ReturnType<typeof unitsWithStatus>
      try {
        rows = unitsWithStatus(d.code)
      } catch {
        continue
      }
      for (const { unit, status } of rows) {
        unitsSeen++
        const mini = unit.miniString
        if (mini === null || mini.trim() === '') continue
        NEW.add(mini)
        if (ASKED.has(status.status)) ASKED_SET.add(mini)
        bump(viaOf, mini, unit.miniVia ?? 'null')
        bump(headOf, mini, unit.headFn ?? '(none)')
        bump(statusOf, mini, status.status)
        if (!stmtOf.has(mini)) stmtOf.set(mini, unit.statementText)
        // QUOTE STYLE — the transpiler reifies double quotes and uninterpolated
        // templates ONLY. A single-quoted literal is a plain JS string Strudel
        // never parses as notation, so admitting one puts a sample name or a
        // bytebeat expression into a corpus that gates the notation readers.
        if (ASKED.has(status.status) && unit.miniRange) {
          const before = d.code[unit.miniRange[0] - 1] ?? '?'
          bump(quoteOf, mini, before === '"' ? 'double' : before === "'" ? 'SINGLE' : before === '`' ? 'backtick' : `other(${JSON.stringify(before)})`)
        }
      }
    }

    // CONTROL — the restated OLD rule must reproduce the committed corpus
    // EXACTLY, or every departure attribution below is about a different rule.
    const restateOnly = [...OLD].filter((m) => !COMMITTED.has(m))
    const committedOnly = [...COMMITTED].filter((m) => !OLD.has(m))
    console.log(
      `\nCONTROL restated-OLD vs committed corpus: ${OLD.size} vs ${COMMITTED.size}` +
        `  (restate-only ${restateOnly.length}, committed-only ${committedOnly.length})`,
    )
    for (const m of restateOnly) console.log('   restate-only  :', JSON.stringify(m))
    for (const m of committedOnly) console.log('   committed-only:', JSON.stringify(m))

    const arrivals = [...NEW].filter((m) => !OLD.has(m)).sort()
    const arrivalsAsked = [...ASKED_SET].filter((m) => !OLD.has(m)).sort()
    const departures = [...OLD].filter((m) => !NEW.has(m)).sort()

    const oneLine = (s: string) => JSON.stringify(s.length > 78 ? s.slice(0, 75) + '...' : s)
    const tally = (keys: string[], m: Map<string, Set<string>>) => {
      const h = new Map<string, number>()
      for (const k of keys) for (const v of m.get(k) ?? ['(unknown)']) h.set(v, (h.get(v) ?? 0) + 1)
      return [...h.entries()].sort((a, b) => b[1] - a[1])
    }

    console.log(`\n===== #1242 HARVEST REACH =====`)
    console.log(`documents (distinct by hash) : ${docs.length}`)
    console.log(`units enumerated             : ${unitsSeen}`)
    console.log(`OLD  harvest rule            : ${OLD.size}`)
    console.log(`NEW  unit walk, ANY status   : ${NEW.size}`)
    console.log(`NEW  unit walk, ASKED only   : ${ASKED_SET.size}   (status note | note-broken)`)
    console.log(`ARRIVALS  NEW\\OLD any status : ${arrivals.length}`)
    console.log(`ARRIVALS  NEW\\OLD ASKED only : ${arrivalsAsked.length}`)
    console.log(`DEPARTURES OLD\\NEW           : ${departures.length}`)
    console.log(`UNION(OLD, ASKED)            : ${new Set([...OLD, ...ASKED_SET]).size}`)

    console.log(`\n-- ASKED ARRIVALS by miniVia --`)
    for (const [k, n] of tally(arrivalsAsked, viaOf)) console.log(`   ${String(n).padStart(4)}  ${k}`)
    console.log(`-- ASKED ARRIVALS by head --`)
    for (const [k, n] of tally(arrivalsAsked, headOf)) console.log(`   ${String(n).padStart(4)}  ${k}`)
    console.log(`-- ASKED ARRIVALS by QUOTE STYLE of the resolved literal --`)
    for (const [k, n] of tally(arrivalsAsked, quoteOf)) console.log(`   ${String(n).padStart(4)}  ${k}`)
    console.log(`-- ASKED (whole set, not just arrivals) by QUOTE STYLE --`)
    for (const [k, n] of tally([...ASKED_SET], quoteOf)) console.log(`   ${String(n).padStart(4)}  ${k}`)
    console.log(`-- SINGLE-quoted ASKED arrivals, verbatim --`)
    for (const m of arrivalsAsked.filter((x) => quoteOf.get(x)?.has('SINGLE'))) console.log(`   ${oneLine(m)}  <-- ${oneLine(stmtOf.get(m) ?? '')}`)
    console.log(`-- ASKED ARRIVALS by status --`)
    for (const [k, n] of tally(arrivalsAsked, statusOf)) console.log(`   ${String(n).padStart(4)}  ${k}`)

    console.log(`\n-- DEPARTURES by the OLD head they sat under --`)
    for (const [k, n] of tally(departures, oldHeadOf)) console.log(`   ${String(n).padStart(4)}  ${k}`)

    console.log(`\n-- ASKED ARRIVALS with their STATEMENT, grouped by head --`)
    console.log(`   (the question: did the resolver anchor on NOTE CONTENT, or on a`)
    console.log(`    modifier literal like a mask/struct pattern? the count cannot say)`)
    const byHead = new Map<string, string[]>()
    for (const m of arrivalsAsked) {
      for (const h of headOf.get(m) ?? ['(unknown)']) {
        if (!byHead.has(h)) byHead.set(h, [])
        byHead.get(h)!.push(m)
      }
    }
    for (const [h, list] of [...byHead.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  ===== head ${h}  (${list.length}) =====`)
      for (const m of list) {
        console.log(`    mini : ${oneLine(m)}`)
        console.log(`    stmt : ${oneLine(stmtOf.get(m) ?? '(none)')}`)
      }
    }

    console.log(`\n-- 60 DEPARTURES, verbatim, with their old head --`)
    for (const m of departures.slice(0, 60))
      console.log(`   [${[...(oldHeadOf.get(m) ?? [])].join('/')}] ${oneLine(m)}`)

    // Instrument controls — a zero on either side is far more likely to be a
    // dead probe than a real result.
    expect(OLD.size).toBeGreaterThan(1000)
    expect(NEW.size).toBeGreaterThan(0)
    expect(unitsSeen).toBeGreaterThan(1000)
  })
})
