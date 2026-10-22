#!/usr/bin/env node
/**
 * p6-cap-census.mjs — take the P6 blocker reading at a roll cap this tree does not ship,
 * and stamp it with an expiry (#1046).
 *
 * WHY IT EXISTS. `ROLL-CAP-SWEEP.md` and `WRITER-CENSUS.md` both report what the roll's
 * period cap does to the number #1012 is scoped against. Three of those four rows fall
 * out of an ordinary census run and are now GENERATED into both documents. The fourth
 * does not: the cap is a module constant on purpose, so reading the census at 12 means
 * rewriting `parse.ts` and running again, which no gate can do. That row was therefore
 * the only one with nothing at all behind it, and it is the row the whole phase is
 * scoped against — it has been quoted as 34, then 39, then 34 again across three
 * documents and one test comment, all of them stale.
 *
 * WHY IT EDITS THE SOURCE. Same reason `cap-sweep.mjs` does. The cap is a shipped
 * bound, not a knob; threading a parameter through the writer so a sweep could vary it
 * would measure a code path production never takes, which is the failure mode that put a
 * wrong cap in the tree to begin with. So it sets the constant to exactly the value a
 * ship would set it to, runs the real census, and puts the file back.
 *
 * WHY IT DERIVES NOTHING. It reads the `p6` block the census writes into
 * `WRITER-CENSUS.json` and copies it. A driver that re-implemented the columns in JS so
 * it could sweep them would be a second oracle over the same question ([[P519]]), and
 * would be free to agree with itself while both were wrong.
 *
 * WHY IT RUNS THE SHIPPED CAP TOO. The candidate reading cannot be re-taken by any gate,
 * so it is recorded next to the SAME RUN's reading at the shipped cap — which every gate
 * re-takes for free. `assertObservationCurrent` compares the two, and a corpus rebuild,
 * an admission change or a writer fix then reddens the census with "re-run this script"
 * instead of leaving a stale number in Markdown.
 *
 * WHY THE CONTROL ROW. Run 1 is deliberately unmutated. Without it, "the mutation applied
 * and the columns did not move" and "the mutation never applied" print identically, which
 * has produced four clean-looking rows off an unbroken tree before ([[P584]]). Every row
 * prints `applied=YES/NO` taken from `git status --porcelain` after the write and before
 * the run, and the cap each run actually used is read back out of the emitted artifact
 * rather than assumed from what was written.
 *
 *   node scripts/p6-cap-census.mjs 12
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')
const repoRoot = path.resolve(appDir, '../..')
const PARSE = path.resolve(appDir, '../editor/src/codeView/notation/parse.ts')
const CORPUS_DIR = path.resolve(appDir, 'tests/parity-corpus')
const CENSUS_JSON = path.join(CORPUS_DIR, 'WRITER-CENSUS.json')
const OUT = path.join(CORPUS_DIR, 'P6-CAP12.json')

/** the one line this rewrites; the grid's value is never touched */
const CAP_RE = /^(const LEAF_PROJECT_BARS: Record<Surface, number> = \{ grid: \d+, roll: )(\d+)( \})$/m

/** everything a census run writes — all of it goes back, not just the source */
const REGENERATED = [
  'packages/app/tests/parity-corpus/WRITER-CENSUS.json',
  'packages/app/tests/parity-corpus/ROLL-CAP-SWEEP.md',
  'packages/app/tests/parity-corpus/WRITER-CENSUS.md',
]

const die = (msg) => {
  console.error(`refusing: ${msg}`)
  process.exit(2)
}

const candidate = Number(process.argv[2])
if (!Number.isInteger(candidate) || candidate < 1) die('usage: node scripts/p6-cap-census.mjs 12')
// `detectPeriod` confirms a period p only once 2p cycles were probed, and PERIOD_PROBE is
// 24 — a cap above 12 would record a reading over periods this code has never verified.
if (candidate > 12) die('a cap above PERIOD_PROBE / 2 = 12 admits unverified periods')

const porcelain = () =>
  execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()

if (porcelain()) die(`the working tree is dirty — this rewrites and restores several files\n${porcelain()}`)

const original = fs.readFileSync(PARSE, 'utf8')
const found = CAP_RE.exec(original)
if (!found) die('could not find the LEAF_PROJECT_BARS line — the mutation would edit nothing')
const shipped = Number(found[2])
if (shipped === candidate)
  die(`the shipped cap is already ${candidate} — there is no other cap to observe`)

const restore = () => {
  fs.writeFileSync(PARSE, original)
  spawnSync('git', ['checkout', '--', ...REGENERATED], { cwd: repoRoot })
}

/** run the census at whatever `parse.ts` currently says, and return the reading it emitted */
function runCensus(label, expectApplied) {
  const applied = porcelain().includes('packages/editor/src/codeView/notation/parse.ts')
    ? 'YES'
    : 'NO'
  console.log(`\n######## ${label}  applied=${applied} ########`)
  if (applied !== expectApplied)
    die(`${label} expected applied=${expectApplied} and git says ${applied} — the instrument is wrong, not the result`)

  const run = spawnSync('pnpm', ['exec', 'vitest', 'run', 'tests/parity-corpus/writer-census.test.ts'], {
    cwd: appDir,
    encoding: 'utf8',
  })
  // The exit code is NOT the signal. At the candidate cap the census's cap-shipped pins
  // fail on purpose, which is why the P6 block is emitted before anything is asserted.
  const emitted = JSON.parse(fs.readFileSync(CENSUS_JSON, 'utf8'))
  if (!emitted.p6) die(`${label}: the census emitted no p6 block — it did not reach the artifact write`)
  console.log(
    `  cap read back ${emitted.p6.cap} · blocker ${emitted.p6.both.blocker} ` +
      `[grid ${emitted.p6.grid.blocker} + roll ${emitted.p6.roll.blocker}] · ` +
      `untransferable ${emitted.p6.both.untransferable} · transfers ${emitted.p6.both.transfers} · ` +
      `exit ${run.status}`,
  )
  return { p6: emitted.p6, corpusUnits: emitted.corpusUnits }
}

let companion
let observed
try {
  companion = runCensus(`cap-${shipped} CONTROL (shipped, unmutated)`, 'NO')

  fs.writeFileSync(PARSE, original.replace(CAP_RE, `$1${candidate}$3`))
  observed = runCensus(`cap-${candidate}`, 'YES')
} finally {
  restore()
}

// The driver knows what it WROTE; the artifact says what the code USED. Two readings that
// must agree — a run labelled with the wrong cap is the one thing a sweep must not produce.
if (companion.p6.cap !== shipped) die(`the control run reports cap ${companion.p6.cap}, not the shipped ${shipped}`)
if (observed.p6.cap !== candidate) die(`the candidate run reports cap ${observed.p6.cap}, not ${candidate}`)
if (companion.corpusUnits !== observed.corpusUnits)
  die(`the corpus changed between runs (${companion.corpusUnits} -> ${observed.corpusUnits})`)

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      note:
        `The P6 blocker at roll cap ${candidate} — an OBSERVATION, taken by rewriting ` +
        `LEAF_PROJECT_BARS.roll and running the real census. No gate can re-derive it. ` +
        `\`companion\` is the same run's reading at the shipped cap ${shipped}, which every ` +
        `census run re-takes; when it stops matching, this observation is stale.`,
      script: `node scripts/p6-cap-census.mjs ${candidate}`,
      corpusUnits: observed.corpusUnits,
      observed: observed.p6,
      companion: companion.p6,
    },
    null,
    2,
  ) + '\n',
)
console.log(`\nwrote ${path.relative(repoRoot, OUT)}`)

// Leave the tree committable: the documents were just restored to their pre-run state and
// the new observation has not been spliced into them yet. One more shipped-cap run does
// that, and its green is also the first exercise of the staleness check just written.
console.log('\n######## regenerating the documents at the shipped cap ########')
const final = spawnSync('pnpm', ['exec', 'vitest', 'run', 'tests/parity-corpus/writer-census.test.ts'], {
  cwd: appDir,
  stdio: 'inherit',
})
if (final.status !== 0)
  die('the census is red at the shipped cap after writing the observation — read it before committing')

const leftover = porcelain()
console.log(
  `\nfiles changed by this run:\n${leftover || '  (none — which would mean nothing was written)'}`,
)
