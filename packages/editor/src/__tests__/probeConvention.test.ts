/**
 * A probe must not be collected as a gate — the editor half (#1113).
 *
 * The app package has had this since #1111, enforced there by a directory scan.
 * The mechanism cannot be shared, because the two packages collect differently:
 *
 *   packages/app     `include` matches only `*.test.ts`, so `_name.spec.ts` is
 *                    inert by extension. 19 probes rely on that, and the app-side
 *                    guard's job is to catch a probe misnamed `_name.test.ts`.
 *   packages/editor  no `include` at all, so vitest's default collects BOTH
 *                    `*.test.ts` and `*.spec.ts`. Renaming a probe changes nothing
 *                    here, so the convention is enforced by an `exclude` instead.
 *
 * What its absence cost: `_coverageDecomp.analysis.test.ts` states in its own header
 * that "Console output is the deliverable; the assertion is trivial so the run always
 * passes". It has one assertion, and it was contributing a meaningless green plus a
 * console dump to the editor gate.
 *
 * ⚠ WHY THIS ASKS VITEST INSTEAD OF READING THE CONFIG. Asserting that the exclude
 * ARRAY contains a pattern proves only that a string is present — not that the string
 * matches the files it is meant to, and not that vitest applies it. Both of those are
 * the actual property. So each arm filters a real run to one path and reads whether
 * anything was collected. It costs a couple of seconds and cannot pass on a pattern
 * that silently matches nothing.
 *
 * ⚠ AND WHY IT DOES NOT USE `vitest list`: that subcommand does not exist in 1.6.1
 * (run | related | watch | dev | bench | typecheck), so it is parsed as a filename
 * filter and drops into WATCH MODE, hanging until killed. See #1195.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

const PKG = resolve(__dirname, '..', '..')

/** Ask vitest to collect exactly one path. Returns its combined output. */
function collect(relPath: string): string {
  try {
    return execFileSync('npx', ['vitest', 'run', relPath], {
      cwd: PKG,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120_000,
    })
  } catch (err) {
    // A no-files run exits non-zero; we assert on what it printed.
    const e = err as { stdout?: string; stderr?: string }
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

/** Every underscore-prefixed test/spec file under src/, as package-relative paths. */
function underscoreProbes(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      underscoreProbes(full, acc)
      continue
    }
    if (/^_.*\.(test|spec)\.tsx?$/.test(entry)) acc.push(relative(PKG, full))
  }
  return acc
}

describe('#1113 — an underscore-prefixed probe is not collected by the editor suite', () => {
  const probes = underscoreProbes(join(PKG, 'src'))

  it('control: at least one probe exists, so the assertion below has a subject', () => {
    // Without this, deleting every probe would make the guard vacuously green — a
    // zero-hit scan is not absence, and a guard over an empty list guards nothing.
    expect(
      probes,
      'no underscore-prefixed probe found under src/ — either the convention has ' +
        'fallen out of use, or this scan is looking in the wrong place',
    ).not.toEqual([])
  })

  it('control: a normal test file IS collectable, so the check can tell them apart', () => {
    // The negative arm below passes if vitest collects nothing FOR ANY REASON —
    // a bad path, a broken binary, a wrong cwd. This proves the same call collects
    // a real file, so "nothing collected" means excluded rather than broken.
    const out = collect('src/codeView/ir/__tests__/arrange-materialize-haps.test.ts')
    expect(out).not.toContain('No test files found')
    expect(out).toContain('1 passed')
  }, 120_000)

  it('every probe is refused by the collector', () => {
    for (const probe of probes) {
      const out = collect(probe)
      expect(
        out,
        `${probe} was collected. An underscore-prefixed file is a probe: it need ` +
          'not assert, so running it adds a green that cannot mean anything. Either ' +
          "rename it without the underscore, or check the config's exclude.",
      ).toContain('No test files found')
    }
  }, 120_000)
})
