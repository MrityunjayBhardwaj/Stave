/**
 * vitest-scope-reporter — the three shapes it must tell apart (#1183).
 *
 * ⚠ WHY THESE ARE SUBPROCESS RUNS AND NOT UNIT CALLS. The reporter's first draft
 * had correct branching logic and was still wrong: it asked vitest for the CLI's
 * file filter via `ctx.filenamePattern` / `ctx.filters` / `config.filters`, and on
 * 1.6.1 all three are undefined, so a run narrowed to ONE file printed "the WHOLE
 * configured package". The defect was in the model of someone else's API, not in
 * the branching — and a unit test calling the branching with hand-made inputs would
 * have passed against the same wrong model that produced the bug. Only executing a
 * real vitest run can falsify an assumption about what a real vitest run exposes.
 *
 * That is also why the fixture is a real package rather than a mock: the
 * denominator comes from `project.globTestFiles()` resolving `include` against an
 * actual filesystem, which is precisely the part that must not be faked.
 *
 * ⚠ WHY THE FIXTURE IS COMMITTED AT `src/__fixtures__/` AND NOT BUILT IN `tmpdir()`.
 * The first attempt wrote it to a temp directory, where it has no `node_modules`:
 * `npx` then fetched an unrelated vitest and the fixture config died on
 * `Cannot find module 'vitest/config'`. Inside the workspace, resolution walks up
 * to `packages/app/node_modules` and the installed vitest is the one under test.
 * `src/__fixtures__/` is specifically the directory BOTH collectors miss — this
 * package's vitest `include` requires a `__tests__` segment in the path, and
 * playwright's `testDir` is `./tests`. A fixture that were collected would run as
 * part of the app gate and inflate the very counts this reporter reports on.
 *
 * ⚠ AND WHY THE REPORTER IS NOT IN A TOP-LEVEL `tools/`. That was the first
 * location, and it put the file outside every check in the repo: the root
 * `tsconfig.json` declares no `include` (it sweeps in the vendored
 * `artifacts/reference/` app and is nobody's gate), and `vitest` could not even be
 * resolved for its types from there, since `tools/` is in no package's dependency
 * graph. A PR about files sitting silently outside every gate should not add one.
 * It now lives beside `tests/gate-population-reporter.ts`, its playwright
 * counterpart: inside the app package's `tsc`, and collected by neither runner —
 * playwright's `testMatch` wants `.spec`/`.test`, and this package's vitest
 * `include` wants a `__tests__` segment.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const REPORTER = resolve(__dirname, '..', '..', 'tests', 'gate-scope-reporter.ts')
const FIXTURE = resolve(__dirname, '..', '__fixtures__', 'scope-reporter')

/** Run vitest in the fixture package and return its combined output. */
function runVitest(extraArgs: string[]): string {
  try {
    return execFileSync(
      'npx',
      ['vitest', 'run', '--reporter=default', `--reporter=${REPORTER}`, ...extraArgs],
      { cwd: FIXTURE, encoding: 'utf8', stdio: 'pipe', timeout: 120_000 },
    )
  } catch (err) {
    // A non-zero exit is fine for our purposes — we assert on what it PRINTED.
    const e = err as { stdout?: string; stderr?: string }
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

describe('#1183 — the gate reporter states the population it actually covered', () => {
  it('positive control: the reporter and its fixture are both where this test thinks', () => {
    // Without this, a moved or deleted file makes every arm below fail on a
    // spawn error whose output merely LACKS the expected strings — which reads
    // identically to the reporter printing the wrong thing.
    expect(existsSync(REPORTER), `no reporter at ${REPORTER}`).toBe(true)
    expect(existsSync(FIXTURE), `no fixture at ${FIXTURE}`).toBe(true)
  })

  it('an unnarrowed run is reported as the WHOLE configured package', () => {
    const out = runVitest([])
    expect(out).toContain('scope: the WHOLE configured package')
    expect(out).toContain('2 executed')
    // It must not claim more than the config's own include.
    expect(out).toContain("this config's include")
  }, 120_000)

  it('a file-filtered run is reported as a SUBSET, with the ratio', () => {
    const out = runVitest(['suite/alpha.test.ts'])

    // THE REGRESSION ARM. This is the exact sentence the first draft printed for
    // this command, and the reason the reporter would have been worse than nothing.
    expect(
      out,
      'a run narrowed to one of two files was reported as covering the whole package',
    ).not.toContain('scope: the WHOLE configured package')

    expect(out).toContain('scope: a SUBSET')
    expect(out).toContain('covered 1 of the 2 file(s)')
  }, 120_000)

  it('narrowing is detected by a mechanism that is not a CLI path — --shard', () => {
    // The whole claim of this reporter is that it DETECTS narrowing rather than
    // being told about it. One filtering mechanism cannot demonstrate that: the
    // first draft "detected" CLI paths by asking for them, and was wrong. `--shard`
    // narrows through an entirely different route and must land in the same branch.
    const out = runVitest(['--shard=1/2'])
    expect(out).toContain('scope: a SUBSET')
    expect(out).toContain('covered 1 of the 2 file(s)')
    expect(out).not.toContain('scope: the WHOLE configured package')
  }, 120_000)

  it('a filter matching NO files is reported as 0 of N, not left silent', () => {
    // Until vitest 4 this was the honest limit: with zero matches vitest printed
    // "No test files found" and exited before any reporter hook ran, so there was
    // no scope line at all. Vitest 4 still calls `onTestRunEnd` (#2154), so the
    // narrowing is now stated. Pinned both ways: the "0 of" line must be there,
    // and it must not read as the whole package.
    //
    // ⚠ ZERO MATCHES IS SUMMONED DIRECTLY, NOT VIA `--changed HEAD` (#1192). That was
    // the first version, and it asks GIT what changed: with a clean tree nothing has,
    // so the arm passed — and with uncommitted work in the tree the fixture runs and
    // it failed. The gate then reddened for anyone mid-edit, which is precisely when
    // gates get run. Its break test had passed too, because break and verification
    // shared the same clean tree. A filter that cannot match anything needs no help
    // from the environment.
    const out = runVitest(['no-such-file.test.ts'])
    expect(out).toContain('No test files found')
    expect(out).toContain('scope: a SUBSET — this run covered 0 of the 2 file(s)')
    expect(out).not.toContain('scope: the WHOLE configured package')
  }, 120_000)

  it('a run that executes nothing says so, instead of reading as a pass', () => {
    // `-t '$^'` matches no test name: every file is imported, none is executed.
    // This is `gate:editing:instruments`, whose "67 skipped" summary reads in a
    // roundup exactly like a suite that passed.
    const out = runVitest(['-t', '$^'])
    expect(out).toContain('scope: COLLECTION ONLY')
    expect(out).toContain('ZERO were executed')
    expect(out).toContain('asserts NOTHING about behaviour')
    expect(out).not.toContain('scope: the WHOLE configured package')
  }, 120_000)
})
