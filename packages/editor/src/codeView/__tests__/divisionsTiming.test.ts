/**
 * What a bar's divisions cost against the parse the grid already runs (#2274, part of
 * #1833). An INSTRUMENT, not a gate: it runs only when `ZZ_DIVISIONS_TIMING` names a report file, because a
 * wall clock on a shared machine is not something a suite can assert on.
 *
 *   ZZ_DIVISIONS_TIMING=/path/report.json npx vitest run src/codeView/__tests__/divisionsTiming.test.ts
 *
 * The report is written to that path (the console is not reliably shown for a passing test).
 *
 * Per distinct corpus pattern, each timed as the minimum of REPS runs after one warm-up
 * pass over the whole corpus (the minimum is the cost of the work; the rest is the machine):
 *
 * - `grid` / `roll`: `parseStepGrid` / `parsePianoRoll` at the document's scale — what the
 *   Pattern tab runs on every parse. The surgical overlay inside them is lazy and memoised
 *   per model, not per text, so a repeat run is not served from a cache.
 * - `tree`: `miniPattern(mini)` and then `barDivisions` for bars 0–3, the bars the corpus
 *   test measures. Strudel is asked afresh each time: nothing is shared with the parses.
 *
 * The population is printed with the figures: patterns that do not evaluate are left out
 * of every column, and a refused tree is timed like a built one (the cost is paid either
 * way), with its count beside it.
 */
import { describe, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import os from 'node:os'
import { parsePianoRoll, parseStepGrid } from '../notation/parse'
import { barDivisions } from '../strudelMini/divisions'
import { miniPattern } from '../strudelMini/pattern'

const REPS = 5
const BARS = [0, 1, 2, 3]

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

function best(f: () => void): number {
  let min = Infinity
  for (let i = 0; i < REPS; i++) {
    const t = performance.now()
    f()
    min = Math.min(min, performance.now() - t)
  }
  return min
}

function stats(xs: number[]): Record<string, number> {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  const r = (x: number): number => Math.round(x * 1000) / 1000
  return { n: s.length, median: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(s[s.length - 1]), total: r(s.reduce((a, b) => a + b, 0)) }
}

const tree = (mini: string): string => {
  const pat = miniPattern(mini)
  let verdict = 'tree'
  for (const c of BARS) {
    const d = barDivisions(pat, c)
    if (!d.ok) verdict = d.why
  }
  return verdict
}
const quiet = (f: () => unknown): void => {
  try {
    f()
  } catch {
    /* a throw is timed like an answer */
  }
}

describe.skipIf(!process.env.ZZ_DIVISIONS_TIMING)('divisions timing (#2274)', () => {
  it('times the tree against the grid and roll parses, per corpus pattern', () => {
    const live: string[] = []
    let noEval = 0
    for (const mini of minis) {
      try {
        miniPattern(mini).hits(0)
        live.push(mini)
      } catch {
        noEval++
      }
    }
    // warm-up: one pass of everything, so the first patterns do not pay the JIT
    for (const mini of live) {
      quiet(() => parseStepGrid(mini))
      quiet(() => parsePianoRoll(mini))
      quiet(() => tree(mini))
    }
    const grid: number[] = []
    const roll: number[] = []
    const trees: number[] = []
    const ratio: number[] = []
    const verdicts: Record<string, number> = {}
    const slowest: { mini: string; tree: number; grid: number }[] = []
    for (const mini of live) {
      const g = best(() => quiet(() => parseStepGrid(mini)))
      const r = best(() => quiet(() => parsePianoRoll(mini)))
      let v = 'threw'
      const t = best(() =>
        quiet(() => {
          v = tree(mini)
        }),
      )
      verdicts[v] = (verdicts[v] ?? 0) + 1
      grid.push(g)
      roll.push(r)
      trees.push(t)
      ratio.push(t / Math.max(g, 1e-6))
      slowest.push({ mini: mini.length > 80 ? mini.slice(0, 77) + '...' : mini, tree: Math.round(t * 100) / 100, grid: Math.round(g * 100) / 100 })
    }
    slowest.sort((a, b) => b.tree - a.tree)
    const head = execSync('git rev-parse --short HEAD').toString().trim()
    writeFileSync(
      process.env.ZZ_DIVISIONS_TIMING!,
      JSON.stringify(
        {
          commit: head,
          when: new Date().toISOString(),
          node: process.version,
          load: os.loadavg().map((x) => Math.round(x * 10) / 10),
          population: { distinct: minis.length, doesNotEvaluate: noEval, timed: live.length, treeVerdicts: verdicts },
          unit: `ms per pattern, min of ${REPS}; tree = miniPattern + barDivisions for bars ${BARS.join(',')}`,
          grid: stats(grid),
          roll: stats(roll),
          tree: stats(trees),
          treeOverGrid: stats(ratio),
          slowestTrees: slowest.slice(0, 8),
        },
        null,
        1,
      ),
    )
  }, 1_800_000)
})
