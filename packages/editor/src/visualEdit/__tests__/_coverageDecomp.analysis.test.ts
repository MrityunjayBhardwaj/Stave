/**
 * ANALYSIS (not a guard) — decompose the pattern-grid coverage blockers for #467.
 *
 * #468/#469 lifted `-` rest + numeric note/degree; the remaining "nested /
 * alternation / complex" bucket is too coarse to implement against. This walks
 * the cached Bakery sweep, extracts every s/sound/note/n mini-notation arg
 * (top-level AND nested, via acorn), runs the real grid parser, and buckets the
 * FAILURES by the offending mini-notation feature — so we pick the next slice by
 * frequency, not guesswork. Console output is the deliverable; the assertion is
 * trivial so the run always "passes".
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'acorn'
import { parseStepGrid, parsePianoRoll } from '../../codeView/notation/parse'

// Reads the app package's cached Bakery sweep — a dev-only artifact that may be
// absent on a clean clone / CI. Skip rather than fail when the dir isn't there.
const SAMPLES_DIR = join(
  __dirname,
  '../../../../app/tests/parity-corpus/.bakery-runs',
)
const HAVE_SAMPLES =
  existsSync(SAMPLES_DIR) &&
  readdirSync(SAMPLES_DIR).some((f) => f.startsWith('samples-offset') && f.endsWith('.json'))

function loadSamples(): string[] {
  const files = readdirSync(SAMPLES_DIR).filter(
    (f) => f.startsWith('samples-offset') && f.endsWith('.json'),
  )
  const codes: string[] = []
  const seen = new Set<string>()
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(SAMPLES_DIR, f), 'utf8'))
    const arr = Array.isArray(raw) ? raw : (raw.samples ?? raw.rows ?? [])
    for (const row of arr) {
      const code = typeof row === 'string' ? row : row?.code
      const key = typeof row === 'string' ? row : (row?.hash ?? code)
      if (code && !seen.has(key)) {
        seen.add(key)
        codes.push(code)
      }
    }
  }
  return codes
}

const HEADS = new Set(['s', 'sound', 'note', 'n'])

/** Walk the AST, collecting {head, mini} for every s/sound/note/n call whose
 *  first arg is a string literal — anywhere in the tree (nested arms included). */
function collectCandidates(code: string): Array<{ head: string; mini: string }> {
  const out: Array<{ head: string; mini: string }> = []
  let program: any
  try {
    program = parse(code, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true })
  } catch {
    return out
  }
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const c of node) visit(c)
      return
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && HEADS.has(node.callee.name)) {
      const a0 = node.arguments?.[0]
      if (a0?.type === 'Literal' && typeof a0.value === 'string') {
        out.push({ head: node.callee.name, mini: a0.value })
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end') continue
      visit(node[k])
    }
  }
  visit(program)
  return out
}

/** Categorize WHY a mini failed by the dominant unsupported feature it contains. */
function featureBucket(mini: string, reason: string): string {
  const has = (re: RegExp) => re.test(mini)
  if (has(/\{[^}]*\}(%\d+)?/)) return 'polymeter {}'
  if (has(/</) && has(/\[/)) return 'alternation+nested <[ ]>'
  if (has(/</)) return 'alternation <>'
  if (has(/\[[^\]]*\]/) && has(/,/)) return 'nested-with-comma []'
  if (has(/\[[^\]]*\]/)) return 'nested group []'
  if (has(/\?/)) return 'random ?'
  if (has(/:/)) return 'colon sample-index :'
  if (has(/\.\./)) return 'range ..'
  if (has(/[a-z]+\([^)]*\)/i)) return 'mini-fn call(...)'
  return `other (${reason.slice(0, 40)})`
}

describe('ANALYSIS: pattern-grid coverage blocker decomposition (#467)', () => {
  it.skipIf(!HAVE_SAMPLES)('buckets failing s/note/n minis by offending feature', () => {
    const codes = loadSamples()
    let candidates = 0
    let bound = 0
    const failBuckets = new Map<string, number>()
    const reasonBuckets = new Map<string, number>()
    const examples = new Map<string, string>()

    for (const code of codes) {
      for (const { head, mini } of collectCandidates(code)) {
        candidates++
        const res = head === 'note' || head === 'n' ? parsePianoRoll(mini) : parseStepGrid(mini)
        if (res.ok) {
          bound++
        } else {
          const bucket = featureBucket(mini, res.reason)
          failBuckets.set(bucket, (failBuckets.get(bucket) ?? 0) + 1)
          // Normalize the reason (strip the specific token) so they aggregate.
          const reason = res.reason.replace(/"[^"]*"/, '"…"')
          reasonBuckets.set(reason, (reasonBuckets.get(reason) ?? 0) + 1)
          if (!examples.has(bucket)) examples.set(bucket, `${mini.slice(0, 50)}  ⟶  ${res.reason}`)
        }
      }
    }

    const sorted = [...failBuckets.entries()].sort((a, b) => b[1] - a[1])
    console.log(`\n=== #467 coverage decomposition over ${codes.length} Bakery patterns ===`)
    console.log(`candidate minis (s/sound/note/n): ${candidates}`)
    console.log(`bind to a grid: ${bound} (${((bound / candidates) * 100).toFixed(1)}%)`)
    console.log(`fail: ${candidates - bound}\n`)
    console.log(`failure buckets (by offending feature, descending):`)
    for (const [bucket, count] of sorted) {
      console.log(`  ${String(count).padStart(4)}  ${bucket.padEnd(26)} e.g. ${examples.get(bucket)}`)
    }
    console.log('')
    const reasonSorted = [...reasonBuckets.entries()].sort((a, b) => b[1] - a[1])
    console.log(`failure REASONS (parser's own message, descending):`)
    for (const [reason, count] of reasonSorted) {
      console.log(`  ${String(count).padStart(4)}  ${reason}`)
    }
    console.log('')

    expect(candidates).toBeGreaterThan(0)
  })
})
