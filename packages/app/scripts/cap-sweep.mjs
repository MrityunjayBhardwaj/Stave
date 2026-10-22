#!/usr/bin/env node
/**
 * cap-sweep.mjs — drive a cap sweep across candidate values of one field of
 * `LEAF_PROJECT_BARS`, then diff the emitted rows PER ASK (#1020; grid arm #1041).
 *
 * WHY IT EDITS THE SOURCE. The cap is a module constant on purpose — it is a shipped
 * bound, not a knob. Threading a parameter through `projectPianoRollByLeaf` so a sweep
 * could vary it would mean the sweep measures a code path production never takes, which
 * is the failure mode that put a wrong cap in the tree in the first place. So the sweep
 * sets the constant to exactly the value a ship would set it to, runs the real writers,
 * and puts the file back. The file is restored in a `finally`, and the script refuses to
 * start if the working tree already has changes to it.
 *
 * WHY IT DIFFS PER ASK. "The change is additive" is a claim about individual asks. Two
 * totals cannot check it: an ask lost and an ask gained net to zero and read as "no
 * change" ([[PV233]]). So every run emits one row per ask and the diff walks them by
 * (population, mini).
 *
 * WHY EACH POPULATION IS REPORTED ALONE. `writer-reach`'s population is defined as
 * `if (core.ok) continue` — the complement of the census's. A cap figure that mixes them
 * is a number about no population at all, and the null result that set this cap to 4 came
 * from reading one population's answer as general ([[P345]]).
 *
 *   node scripts/cap-sweep.mjs 4 6 8 12          # the roll (the default)
 *   node scripts/cap-sweep.mjs grid 4 6 8 10 12  # the grid
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')
const PARSE = path.resolve(appDir, '../editor/src/codeView/notation/parse.ts')

/**
 * The two halves of `LEAF_PROJECT_BARS`, each with the regex that rewrites ITS field only.
 *
 * ⚠ The capture groups matter: group 2 is always the swept surface's value, and the other
 * surface's digits sit inside group 1 or 3 so they are copied through untouched. A single
 * regex with one `\d+` for both fields would rewrite whichever came first and the run would
 * be labelled for a cap it did not set — which is the class of error the gate's
 * read-the-cap-back-out-of-the-refusal-sentence discipline exists to catch.
 *
 * ⚠ This file drives BOTH surfaces. The grid arm was added at #1041 and it kept the
 * roll's name until #1279, when it was renamed and both committed observations were
 * re-taken so the command each one records stays runnable verbatim.
 *
 * The roll remains the DEFAULT — `cap-sweep.mjs 4 6 8 12`, with no surface word, sweeps
 * it — so the grid names itself and the roll does not. That asymmetry is in the
 * recorded commands too, which is why they are not interchangeable.
 */
const SURFACES = {
  roll: {
    re: /^(const LEAF_PROJECT_BARS: Record<Surface, number> = \{ grid: \d+, roll: )(\d+)( \})$/m,
    runs: 'tests/parity-corpus/.roll-cap-runs',
    obs: 'tests/parity-corpus/ROLL-CAP-SWEEP.json',
    test: 'tests/parity-corpus/roll-cap-sweep.test.ts',
    defaults: '4 6 8 12',
  },
  grid: {
    re: /^(const LEAF_PROJECT_BARS: Record<Surface, number> = \{ grid: )(\d+)(, roll: \d+ \})$/m,
    runs: 'tests/parity-corpus/.grid-cap-runs',
    obs: 'tests/parity-corpus/GRID-CAP-SWEEP.json',
    test: 'tests/parity-corpus/grid-cap-sweep.test.ts',
    defaults: '4 6 8 10 12',
  },
}

const argv = process.argv.slice(2)
const surface = argv[0] in SURFACES ? argv.shift() : 'roll'
const S = SURFACES[surface]
/** what the observation records as the command that re-takes it */
const invocation = `node scripts/cap-sweep.mjs ${surface === 'roll' ? '' : `${surface} `}`
const RUNS = path.resolve(appDir, S.runs)
const CAP_RE = S.re

const caps = argv.map(Number)
if (!caps.length || caps.some((c) => !Number.isInteger(c) || c < 1)) {
  console.error(`usage: node scripts/cap-sweep.mjs [roll|grid] <caps…>`)
  console.error(`   eg: node scripts/cap-sweep.mjs ${S.defaults}            (the roll)`)
  console.error(`       node scripts/cap-sweep.mjs grid ${SURFACES.grid.defaults}   (the grid)`)
  process.exit(2)
}
// `detectPeriod` confirms period p only once 2p cycles were probed, and PERIOD_PROBE is
// 24 — so a cap above 12 would admit periods this code has never verified.
if (caps.some((c) => c > 12)) {
  console.error('refusing: a cap above PERIOD_PROBE / 2 = 12 admits unverified periods')
  process.exit(2)
}

const dirty = execFileSync('git', ['status', '--porcelain', '--', PARSE], { encoding: 'utf8' }).trim()
if (dirty) {
  console.error(`refusing: ${PARSE} has uncommitted changes — the sweep rewrites and restores it`)
  process.exit(2)
}

const original = fs.readFileSync(PARSE, 'utf8')
if (!CAP_RE.test(original)) {
  console.error('refusing: could not find the LEAF_PROJECT_BARS line — the sweep would edit nothing')
  process.exit(2)
}

fs.rmSync(RUNS, { recursive: true, force: true })
try {
  for (const cap of caps) {
    console.log(`\n######## LEAF_PROJECT_BARS.${surface} = ${cap} ########`)
    fs.writeFileSync(PARSE, original.replace(CAP_RE, `$1${cap}$3`))
    // THE EXIT CODE IS NOT THE SIGNAL, and using it as one broke this driver (#1270).
    // The gate's floors are pinned at the SHIPPED cap, so any run below it is red by
    // construction — which is exactly the run you need when the question is "what does a
    // regression of this cap actually cost?". `execFileSync` throws on a non-zero exit, so
    // the first sub-shipped cap aborted the sweep and the per-ask diff never ran: the
    // instrument refused to measure the case its own floors exist to catch. The rows the
    // run emits are the signal; the status is reported and carried on from.
    const run = spawnSync(
      'pnpm',
      ['exec', 'vitest', 'run', S.test],
      { cwd: appDir, stdio: 'inherit' },
    )
    if (run.status !== 0)
      console.log(`  (cap ${cap} exited ${run.status} — expected below the shipped cap, whose floors this gate pins)`)
  }
} finally {
  fs.writeFileSync(PARSE, original)
  console.log(`\nrestored ${PARSE}`)
}

/* ── the per-ask diff ───────────────────────────────────────────────────────── */

const load = (cap) => JSON.parse(fs.readFileSync(path.join(RUNS, `cap-${cap}.json`), 'utf8'))
const key = (r) => `${r.pop}\0${r.mini}`
/**
 * Worst → best. A move DOWN this list at any ask is what "additive only" forbids.
 *
 * `no-probe` ranks ABOVE `no-view`, and that is a judgement worth stating rather than
 * burying in an ordering: a view that opens but offers no cleanly-singleton note to
 * verify is still a view the user gets, whereas `no-view` is the panel refusing. It is
 * unverified, not broken — the same reading the census gives it. If that call is ever
 * reversed, the gains reported at cap 8 and 12 for population A (9 asks, all
 * `no-view → no-probe`) become zero rather than nine, which is precisely why the
 * headline for that population is its REACH (unmoved at 73) and not its opened count.
 */
const RANK = { 'view-corrupts': 0, 'no-view': 1, 'no-probe': 2, transfers: 3 }

const base = load(caps[0])
const baseBy = new Map(base.rows.map((r) => [key(r), r]))

/**
 * The two populations are carved by the surface's CORE parse, which does not read this cap —
 * so every run must contain exactly the same asks. Asserted rather than assumed, because
 * the diff below skips asks it cannot pair, and a population that quietly changed size
 * would turn a real loss into a silently dropped row.
 */
for (const cap of caps.slice(1)) {
  const run = load(cap)
  const missing = run.rows.filter((r) => !baseBy.has(key(r))).length
  if (missing || run.rows.length !== base.rows.length) {
    console.error(
      `refusing to diff: cap ${cap} has ${run.rows.length} asks against cap ${caps[0]}'s ` +
        `${base.rows.length} (${missing} unpairable) — the population is supposed to be cap-independent`,
    )
    process.exit(1)
  }
}

/* ── the committed observation ──────────────────────────────────────────────── */

/**
 * The non-shipped caps are the columns no gate can re-derive, so they are committed with
 * the SAME SWEEP's shipped-cap reading as an expiry stamp (#1270). The surface's own gate
 * re-takes that stamp on every run and reddens when it stops matching.
 *
 * Nothing is derived here. Each run emits its own `reading`, computed by the one function
 * the document, the gate and this file all share — a driver that re-implemented those
 * columns in JS would be a second oracle over the question the whole table is about.
 */
const OBS = path.resolve(appDir, S.obs)
const shipped = Number(CAP_RE.exec(original)[2])
if (!caps.includes(shipped)) {
  console.log(
    `\nNOT writing ${path.basename(OBS)}: the shipped cap ${shipped} was not among the swept ` +
      `caps, so this sweep has no companion reading to stamp the others with.`,
  )
} else {
  const readingFor = (cap) => {
    const r = load(cap).reading
    if (!r) throw new Error(`cap ${cap} emitted no reading — the gate did not reach its artifact write`)
    if (r.cap !== cap) throw new Error(`cap ${cap}'s run reports cap ${r.cap} — a row is mislabelled`)
    return r
  }
  fs.writeFileSync(
    OBS,
    JSON.stringify(
      {
        note:
          `The ${surface} cap sweep at caps this tree does not ship — OBSERVATIONS, taken by ` +
          `rewriting LEAF_PROJECT_BARS.${surface} and running the real writers. No gate can ` +
          `re-derive them. \`companion\` is the same sweep's reading at the shipped cap ` +
          `${shipped}, which every run re-takes; when it stops matching, these are stale.`,
        script: `${invocation}${caps.join(' ')}`,
        observed: caps.filter((c) => c !== shipped).sort((a, b) => a - b).map(readingFor),
        companion: readingFor(shipped),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`\nwrote ${path.relative(appDir, OBS)}`)
}

  // Leave the tree committable. The last run in the loop was at whichever cap came last,
  // so the document still holds the block from that run — or none at all on a bootstrap.
  // One more run at the shipped cap regenerates it, and its green is also the first
  // exercise of the staleness check just written.
  console.log('\n######## regenerating the document at the shipped cap ########')
  const back = spawnSync('pnpm', ['exec', 'vitest', 'run', S.test], {
    cwd: appDir,
    stdio: 'inherit',
  })
  if (back.status !== 0) {
    console.error('the sweep is RED at the shipped cap after writing the observation — read it before committing')
    process.exit(1)
  }

console.log(`\n\n################ PER-ASK DIFF vs cap ${caps[0]} ################`)
for (const cap of caps.slice(1)) {
  const run = load(cap)
  for (const pop of ['A-core-refused', 'B-core-served']) {
    const rows = run.rows.filter((r) => r.pop === pop)
    const gained = []
    const lost = []
    const reshaped = []
    for (const r of rows) {
      const b = baseBy.get(key(r))
      if (!b) continue
      if (RANK[r.outcome] > RANK[b.outcome]) gained.push({ b, r })
      else if (RANK[r.outcome] < RANK[b.outcome]) lost.push({ b, r })
      else if (r.outcome === 'transfers' && (r.notes !== b.notes || r.writer !== b.writer))
        reshaped.push({ b, r })
    }
    const t = (rs) => rs.filter((x) => x.outcome === 'transfers').length
    const live = rows.filter((r) => r.probed > 0)
    const alive = live.reduce((n, r) => n + r.alive, 0)
    const probed = live.reduce((n, r) => n + r.probed, 0)

    console.log(`\n=== ${pop} — cap ${caps[0]} → ${cap} ===`)
    console.log(`  transfers      ${t(base.rows.filter((r) => r.pop === pop))} → ${t(rows)}`)
    console.log(`  BETTER outcome ${gained.length}`)
    console.log(`  WORSE outcome  ${lost.length}   <-- must be 0 (additive only, per ask)`)
    console.log(`  same outcome, different view shape  ${reshaped.length}`)
    console.log(`  liveness over the whole population  ${alive}/${probed} = ${probed ? ((100 * alive) / probed).toFixed(1) : '—'}%`)
    for (const { b, r } of lost)
      console.log(`     ✗ LOST  ${b.outcome} → ${r.outcome}  ${JSON.stringify(r.mini)}`)
    for (const { b, r } of gained) {
      const l = r.probed > 0 ? `${r.alive}/${r.probed} live` : 'no probeable cell'
      // `notes` is the ROLL's model size and is absent on a grid model, which carries
      // lanes of cells instead — printing `notes=0 structured` for every grid row reads
      // as a contradiction. Omitted where the surface does not have it rather than
      // reported as a zero (#1041).
      const size = r.notes ? ` notes=${r.notes}` : ''
      console.log(
        `     + ${b.outcome} → ${r.outcome}  [${r.writer}] period=${r.period ?? '?'}${size} ${r.structured ? 'structured' : 'UNSTRUCTURED'} ${l}  ${JSON.stringify(r.mini)}`,
      )
    }
  }
}
