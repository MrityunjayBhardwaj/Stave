#!/usr/bin/env node
/**
 * edit-coverage-bakery.mjs — maintainer-only REAL-WORLD view-editability sampler.
 *
 * Sibling of parity-bakery.mjs. Same discipline:
 *   - Never runs on CI, never auto-commits. Pulls a FRESH live sample from the
 *     public `code_v1` Supabase backend and classifies each through the app's
 *     own visual-edit oracle (edit-coverage.spec.ts in LIVE mode), printing the
 *     real-world EDIT-% + the ranked blocker histogram.
 *   - Exit code is 0 when the network succeeds; non-zero means the live fetch
 *     itself failed (do NOT fabricate a %).
 *
 * Where parity-bakery answers "does the tune PARSE to a structured IR", this
 * answers the harder "can the tune be EDITED through a Stave view" — the
 * distinction spelled out in edit-coverage.spec.ts's header.
 *
 * The fetch (resolveUpstream / fetchSamples) MIRRORS parity-bakery.mjs — same
 * pinned upstream SHA, same PostgREST paging. Kept as a small independent copy
 * rather than a shared import so this sampler never perturbs the parse-parity
 * tool (two samplers is not yet a pattern demanding consolidation).
 *
 * Usage:  node packages/app/scripts/edit-coverage-bakery.mjs [--n 50] [--offset M]
 * Wired as `pnpm edit:coverage:bakery` (root package.json).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')
const runsDir = path.join(appDir, 'tests', 'parity-corpus', '.bakery-runs')

// Pinned upstream — same SHA the corpus + parity-bakery.mjs use.
const UPSTREAM_SHA = 'f73b395648645aabe699f91ba0989f35a6fd8a3c'
const UTIL_URL = `https://codeberg.org/uzu/strudel/raw/commit/${UPSTREAM_SHA}/website/src/repl/util.mjs`
const SUPABASE_BASE = 'https://pidxdsxphlhzjnzmifth.supabase.co'

const args = process.argv.slice(2)
let N = 50
let OFFSET = 0
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--n' && args[i + 1]) { N = Number(args[i + 1]); i++ }
  else if (args[i] === '--offset' && args[i + 1]) { OFFSET = Number(args[i + 1]); i++ }
}

async function resolveUpstream() {
  const res = await fetch(UTIL_URL)
  if (!res.ok) throw new Error(`util.mjs fetch failed (${res.status}): ${UTIL_URL}`)
  const src = await res.text()
  const colM = src.match(/\.from\('code_v1'\)\s*\.select\('([^']+)'\)/)
  const keyM = src.match(/createClient\(\s*'https:\/\/[^']+',\s*'([A-Za-z0-9._-]+)'/)
  if (!colM) throw new Error('Could not resolve code_v1 body column from upstream util.mjs')
  if (!keyM) throw new Error('Could not resolve Supabase anon key from upstream util.mjs')
  return { column: colM[1], anonKey: keyM[1] }
}

async function fetchSamples(anonKey, column, n, offset) {
  const url =
    `${SUPABASE_BASE}/rest/v1/code_v1?public=eq.true&select=hash,${column}` +
    `&order=hash.asc&limit=${n * 2}&offset=${offset}`
  const res = await fetch(url, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } })
  if (!res.ok) throw new Error(`code_v1 fetch failed (${res.status}): ${url}`)
  const rows = await res.json()
  if (!Array.isArray(rows)) throw new Error('code_v1 returned a non-array body')
  const samples = []
  for (const r of rows) {
    const code = r[column]
    if (typeof code === 'string' && code.trim().length > 0) samples.push({ hash: r.hash ?? null, code })
    if (samples.length >= n) break
  }
  return { samples, rawCount: rows.length }
}

async function main() {
  console.log('# edit:coverage:bakery — real-world view-editability')
  console.log(`# upstream pin:  ${UPSTREAM_SHA}`)
  console.log(`# target N:      ${N}`)
  console.log(`# offset window: ${OFFSET}${OFFSET === 0 ? ' (default — the historically-pinned window; NOT the full distribution)' : ''}`)
  console.log('')

  const { column, anonKey } = await resolveUpstream()
  console.log(`# resolved body column (R5): "${column}"`)
  const { samples, rawCount } = await fetchSamples(anonKey, column, N, OFFSET)
  console.log(`# Supabase returned ${rawCount} rows; ${samples.length} non-empty samples`)
  if (samples.length === 0) throw new Error('No non-empty samples — refusing to report a %')

  console.log('# --- first sample (eyeball the shape) ---')
  console.log(samples[0].code.split('\n').slice(0, 4).map((l) => `#   ${l}`).join('\n'))
  console.log('# ----------------------------------------\n')

  await fs.mkdir(runsDir, { recursive: true })
  const stamp = `${OFFSET === 0 ? '' : `offset${OFFSET}-`}${new Date().toISOString().replace(/[:.]/g, '-')}`
  const samplesPath = path.join(runsDir, `edit-samples-${stamp}.json`)
  await fs.writeFile(samplesPath, JSON.stringify({ stamp, UPSTREAM_SHA, column, offset: OFFSET, samples }, null, 2))

  // Classify through the app's visual-edit oracle. Same vite-node reason as
  // parity-bakery: the editor source path only resolves under vitest.
  const resultPath = path.join(runsDir, `edit-result-${stamp}.json`)
  const r = spawnSync(
    'pnpm',
    ['--filter', '@stave/app', 'exec', 'vitest', 'run', '--config', 'vitest.edit-coverage.config.ts', '--reporter', 'dot'],
    {
      cwd: path.resolve(appDir, '..', '..'),
      env: { ...process.env, EDIT_SAMPLES: samplesPath, EDIT_RESULT: resultPath },
      stdio: 'inherit',
    },
  )
  if (r.status !== 0) throw new Error('edit-coverage spec failed — see vitest output above')

  const result = JSON.parse(await fs.readFile(resultPath, 'utf8'))
  const tl = result.tuneLevel
  const ul = result.unitLevel

  console.log('\n# === REAL-WORLD EDIT-COVERAGE ===')
  console.log(`# N (measured tunes):   ${result.tunes}`)
  console.log(`# any editable surface: ${tl.anyEditable}/${result.tunes}  (${tl.anyEditablePct}%)`)
  console.log(`#   fully ${tl.fully} · partial ${tl.partial} · knobs-only ${tl.knobsOnly} · code-only ${tl.codeOnly} · unparse ${tl.unparseable}`)
  console.log(`# musical units structurally editable: ${ul.structurallyEditable}/${ul.totalUnits}  (${ul.structurallyEditablePct}%)`)
  console.log(`#   note ${ul.note} · clip ${ul.clip} · broken ${ul.noteBroken} · knobs ${ul.knobs} · code ${ul.codeOnly}  (setup ${ul.setup} excluded)`)
  console.log('')
  console.log('# === BLOCKERS — note-broken (offered a grid/roll, no round-trip) ===')
  const br = Object.entries(result.brokenReasons ?? {})
  if (br.length === 0) console.log('#   (none)')
  else {
    for (const [k, c] of br) {
      // One input per reason, so the label can be checked by eye; the full lists are in the result file.
      const first = result.brokenInputs?.[k]?.[0]
      console.log(`#   [${c}x] ${k}${first ? `   e.g. ${first.head}(${JSON.stringify(first.mini)})` : ''}`)
    }
  }
  console.log('')
  console.log('# === BLOCKERS — code-only heads (no view editor) ===')
  const ch = Object.entries(result.codeOnlyHeads ?? {}).slice(0, 15)
  if (ch.length === 0) console.log('#   (none)')
  else for (const [k, c] of ch) console.log(`#   [${c}x] ${k}`)
  console.log('')
  console.log(`# samples (gitignored, dated/SHA'd): ${path.relative(process.cwd(), samplesPath)}`)
  console.log(`# result:                            ${path.relative(process.cwd(), resultPath)}`)
  console.log('# Record the % + stamp + UPSTREAM_SHA when citing the real-world number.')
}

main().catch((err) => {
  console.error('edit:coverage:bakery failed:', err.message)
  console.error('(discipline: a failed live fetch must NOT be reported as a %.)')
  process.exit(1)
})
