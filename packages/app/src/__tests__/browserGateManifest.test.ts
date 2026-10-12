/**
 * browserGateManifest — every browser spec is classified, so none can go unrun quietly (#1265).
 *
 * WHAT WENT WRONG WITHOUT THIS. `gate:editing:browser` used to name its spec files by
 * hand. The list was written at #952 with four files and grew exactly once, at #1245.
 * Three specs added after that — `resolver-opens-a-grid` (#1247), `chord-chart-grid`
 * (#1252) and `counted-but-empty-views` (#1258) — were never added to it, and each of
 * them is the ONLY arm that mounts the panel it covers; `chord-chart-grid.spec.ts` says
 * so in its own docblock. A fourth, `sequencer-projection.spec.ts`, then went red and
 * stayed red, and no gate had anything to say about it (#1266).
 *
 * THE LIST IS GONE. The gate now runs the whole chromium project, so a spec is gated
 * from the moment it exists and the drift is impossible rather than merely detected.
 * That became affordable once it was measured: 640 tests, 511 passed, 129 deliberately
 * skipped, 0 failed, 5.1 minutes at default parallelism. The old nine-file list survives
 * as `gate:editing:browser:quick` for local iteration, and is explicitly not the gate.
 *
 * ⚠ SO WHY KEEP THIS FILE. Because the way back is one word: re-add a path filter to
 * the script and the gate silently narrows to whatever that filter names, with every
 * count still looking healthy — which is exactly how the four specs above were lost.
 * The first arm below refuses a path filter outright. That is the whole defence; the
 * rest is bookkeeping that keeps it honest.
 *
 * ⚠ AND WHY IT DOES NOT ASSERT A TOTAL. `gatePopulationReporter.test.ts` already argues
 * the case: a pinned count "would fail on every honest spec addition and teach the next
 * person to update it without reading why". A count asks you to bump a number. This asks
 * a question — is this spec gated, and if not, why not — and the answer is written down
 * next to the file it is about.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const APP = path.resolve(__dirname, '..', '..')
const TESTS = path.join(APP, 'tests')
const MANIFEST = path.join(TESTS, 'browser-gate-manifest.json')

type Runs = 'gate' | 'measurement' | 'touch' | 'ungated'
interface Entry {
  runs: Runs
  why: string
}

const manifest: Record<string, Entry> = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))

/** Browser specs are the `.spec.ts` files directly under `tests/`; `parity-corpus/` is vitest-only. */
const onDisk = fs
  .readdirSync(TESTS)
  .filter((f) => f.endsWith('.spec.ts'))
  .sort()

const gateScript: string = JSON.parse(
  fs.readFileSync(path.join(APP, '..', '..', 'package.json'), 'utf8'),
).scripts['gate:editing:browser']

/** `MEASUREMENT_SPECS` from the Playwright config, read from its source rather than duplicated. */
function measurementSpecs(): string[] {
  const src = fs.readFileSync(path.join(APP, 'playwright.config.ts'), 'utf8')
  const block = /const MEASUREMENT_SPECS = \[([\s\S]*?)\]/.exec(src)
  expect(block, 'MEASUREMENT_SPECS not found in playwright.config.ts').not.toBeNull()
  return [...block![1].matchAll(/\*\*\/([\w.-]+\.spec\.ts)/g)].map((m) => m[1]).sort()
}

/** `TOUCH_SPECS` and the projects that run them, read from the config's source (#2014). */
function touchProjects(): { pattern: string; projects: string[]; chromiumIgnoresThem: boolean } {
  const src = fs.readFileSync(path.join(APP, 'playwright.config.ts'), 'utf8')
  const block = /const TOUCH_SPECS = \['\*\*\/([\w.*-]+)'\]/.exec(src)
  expect(block, 'TOUCH_SPECS not found in playwright.config.ts').not.toBeNull()
  return {
    pattern: block![1],
    projects: [...src.matchAll(/\{ name: '([\w-]+)',[^\n]*testMatch: TOUCH_SPECS \}/g)].map((m) => m[1]),
    chromiumIgnoresThem: /name: 'chromium',[\s\S]*?testIgnore: \[[^\]]*\.\.\.TOUCH_SPECS[^\]]*\]/.test(src),
  }
}

const withRuns = (r: Runs) =>
  Object.entries(manifest)
    .filter(([, e]) => e.runs === r)
    .map(([f]) => f)
    .sort()

describe('#1265 — the browser gate cannot narrow quietly', () => {
  it('runs the whole project — the gate script names no spec paths', () => {
    const filters = [...gateScript.matchAll(/tests\/[\w.-]+\.spec\.ts/g)].map((m) => m[0])
    // A path filter here is the defect this issue is about, whatever it names. Whoever
    // adds one is narrowing the gate to it; the fast narrow loop is
    // `gate:editing:browser:quick`, which is a different script on purpose.
    expect(filters, 'gate:editing:browser names spec paths — it must run the whole project').toEqual([])
    expect(gateScript).toContain('--project=chromium')
  })

  it('classifies every browser spec on disk, and no spec that is not there', () => {
    // Named both ways: the failure has to say WHICH file, or it teaches nothing.
    expect(
      onDisk.filter((f) => !(f in manifest)),
      'specs on disk with no manifest entry — add one saying whether it is gated, and why',
    ).toEqual([])
    expect(
      Object.keys(manifest).filter((f) => !onDisk.includes(f)),
      'manifest entries whose spec file is gone — delete them',
    ).toEqual([])
  })

  it('agrees with the Playwright config about which specs the chromium project excludes', () => {
    // The measurement specs are the ONLY ones the gate does not reach, because the
    // config routes them to their own serialised project. Read from the config's own
    // source so the two cannot drift into disagreeing.
    expect(withRuns('measurement')).toEqual(measurementSpecs())
  })

  it('runs the touch specs on every touch project, and on nothing else (#2014)', () => {
    // A touch spec asserts what a finger does. On the desktop project it would fail (no
    // coarse pointer), and left out of the gate script it would simply never run — the
    // same quiet narrowing as a path filter, one project wide.
    const touch = touchProjects()
    expect(touch.pattern).toBe('touch-*.spec.ts')
    expect(touch.projects.length).toBeGreaterThan(0)
    expect(touch.chromiumIgnoresThem, 'the chromium project must ignore TOUCH_SPECS').toBe(true)
    for (const name of touch.projects) {
      expect(gateScript, `gate:editing:browser does not run the ${name} project`).toContain(`--project=${name} `)
    }
    // the file name decides where a spec runs, so the manifest has to agree with it
    expect(withRuns('touch')).toEqual(onDisk.filter((f) => f.startsWith('touch-')))
    expect(withRuns('touch').length).toBeGreaterThan(0)
  })

  it('leaves nothing ungated without saying so out loud', () => {
    // Currently empty, and that is the point of the change — but an entry may legitimately
    // land here later (a spec that cannot pass yet). It must carry a reason and an issue
    // number when it does, rather than quietly sitting outside the gate.
    for (const f of withRuns('ungated')) {
      expect(manifest[f].why, `${f} is ungated with no reason given`).toMatch(/#\d+/)
    }
  })

  it('gives every entry a stated reason', () => {
    // Deliberately over ALL entries, not just the ungated ones. Scoped to `ungated` this
    // arm would have gone silent the moment the gate widened — passing over an empty set
    // while reading like a check that ran.
    const silent = Object.entries(manifest)
      .filter(([, e]) => e.why.trim().length < 10)
      .map(([f]) => f)
    expect(silent, 'manifest entries whose reason says nothing').toEqual([])
  })

  it('is non-vacuous — there really are specs, and they really are classified', () => {
    expect(onDisk.length).toBeGreaterThan(100)
    expect(withRuns('gate').length).toBeGreaterThan(100)
    expect(withRuns('measurement').length).toBeGreaterThan(0)
  })
})
