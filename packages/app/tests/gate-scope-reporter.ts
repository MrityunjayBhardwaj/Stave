/**
 * gate-scope-reporter — make every vitest gate state the population it covered.
 *
 * The vitest counterpart to `gate-population-reporter.ts` beside it, which does the
 * same job for the playwright browser gate.
 *
 * THE PROBLEM THIS EXISTS FOR (#1183, split out of #1175). A gate's NAME is not
 * its COMMAND, and nothing in the output says which is which. `gate:editing:app`
 * ran a 440-test filter for months while its name promised the app package; the
 * only way anyone found out was deleting a load-bearing line and seeing whether
 * anything reddened. That is not a reasonable standing cost for knowing what a
 * green run meant.
 *
 * THE SHARPEST CASE IS `gate:editing:instruments`, WHICH EXECUTES NOTHING.
 * It pairs `vitest.instruments.config.ts` with `-t '$^'` — a pattern matching no
 * test name — so vitest imports and transforms all 31 instrument files and then
 * runs zero of them. That is deliberate and useful (#1141): a broken static
 * import reddens at transform, which is a cheap guard against instruments rotting
 * into unrunnability. But its summary line, "40 files / 67 skipped", reads in a
 * four-gate roundup exactly like a suite that passed. Anyone quoting four green
 * gates has been quoting one that asserted nothing.
 *
 * WHY THE SHAPE IS DERIVED AND NOT DECLARED. The obvious implementation gives
 * each gate a label — `scope: 'whole package'`, `scope: 'collection only'`. That
 * reintroduces the original bug one level up: a label is a claim about the
 * command, kept in step by hand, and it goes stale the moment the command changes
 * without it. #1175 was exactly a name that had stopped matching its command.
 *
 * So every line below is read off the run that is actually happening:
 *   · executed === 0 while files collected  →  collection-only, stated as such.
 *   · fewer files ran than the config collects  →  a SUBSET, with the ratio.
 *   · all of them  →  the package's whole configured include.
 * A reporter that recomputes itself cannot drift; one that is told cannot help it.
 *
 * ⚠ HOW THE DENOMINATOR IS OBTAINED, AND WHY IT IS NOT THE OBVIOUS WAY. The first
 * draft asked the reporter context for the CLI's file filter — `ctx.filenamePattern`,
 * `ctx.filters`, `config.filters`. On vitest 1.6.1 **all three are undefined**: file
 * filters are applied during collection, before any reporter is constructed, and are
 * never handed on. That draft therefore printed "the WHOLE configured package … no
 * filter applied" for a run explicitly narrowed to ONE file — a subset labelled whole,
 * which is strictly worse than printing nothing, and is the very defect this file was
 * written to prevent. It was caught by running the filtered case rather than reasoning
 * about it; the API shape had been assumed, not read.
 *
 * The denominator now comes from `project.globTestFiles()` — vitest resolving its own
 * `include` against the filesystem, at run time. Ran-files vs collectable-files is a
 * comparison the reporter can actually make, so narrowing is DETECTED rather than
 * declared, independently of what caused it. Verified for two unrelated mechanisms:
 * positional CLI paths (1 of 87) and `--shard=1/2` (1 of 2, 50.0%).
 *
 * A filter that matches NO files at all (`--changed HEAD` with nothing changed)
 * is reported too, as "a SUBSET — 0 of N". Until vitest 4 it was not: vitest 1
 * printed "No test files found" and exited before any reporter hook ran, so this
 * file stayed silent there. Vitest 4 still calls `onTestRunEnd` in that case
 * (#2154), and the gate's own test pins the "0 of N" line so a return of the
 * silence shows up as a red test rather than as a missing line nobody notices.
 *
 * NOTHING IS HARDCODED, ESPECIALLY NOT A TOTAL. Its sibling
 * `gate-population-reporter.ts` makes the same point for the browser gate
 * and it has already been proved right twice over: the pinned reconciliation note
 * in the playwright config said 560, the docblock's own measured figure said
 * 594/176 on 2026-08-04, and the truth on 2026-08-07 was 612/180. Written-down
 * totals drift in days. This file prints counts and the command to re-derive them.
 */

import type { Reporter, TestModule, Vitest } from 'vitest/node'

interface Tally {
  collected: number
  passed: number
  failed: number
  skipped: number
}

/**
 * Count every test in the run. `allTests()` walks nested suites itself, so this
 * sees exactly the leaf tests the task-tree walk did before vitest 4 (#2154).
 */
function tally(modules: ReadonlyArray<TestModule>, acc: Tally): Tally {
  for (const module of modules) {
    for (const test of module.children.allTests()) {
      acc.collected += 1
      const state = test.result().state
      if (state === 'passed') acc.passed += 1
      else if (state === 'failed') acc.failed += 1
      else acc.skipped += 1
    }
  }
  return acc
}

class VitestScopeReporter implements Reporter {
  private ctx?: Vitest

  onInit(ctx: Vitest): void {
    this.ctx = ctx
  }

  /**
   * Ask each project to resolve its own `include` against the filesystem. This is
   * the denominator: how many files this CONFIG would collect, unnarrowed.
   * Returns null if the API shape is not what we expect, so an unknown denominator
   * is reported as unknown rather than silently becoming a confident ratio.
   *
   * ⚠ The null path is DEFENSIVE AND UNEXERCISED — it fires only if a future vitest
   * drops or reshapes `globTestFiles`, which cannot be provoked without mocking the
   * internals this reporter exists to observe honestly. It is written to degrade to
   * "reach UNKNOWN" rather than to "whole", because the failure that matters is a
   * narrowed run reading as a complete one. Treat it as untested code.
   */
  private async collectableFiles(): Promise<number | null> {
    const projects = this.ctx?.projects
    if (!Array.isArray(projects) || projects.length === 0) return null
    let total = 0
    for (const project of projects) {
      const glob = (project as { globTestFiles?: () => Promise<unknown> }).globTestFiles
      if (typeof glob !== 'function') return null
      const result = await glob.call(project)
      // 1.6.1 returned a plain array; vitest 4 returns { testFiles, … }.
      const list = Array.isArray(result)
        ? result
        : (result as { testFiles?: unknown[] } | null)?.testFiles
      if (!Array.isArray(list)) return null
      total += list.length
    }
    return total
  }

  // Vitest 4 no longer calls `onFinished`; `onTestRunEnd` is the run-end hook (#2154).
  async onTestRunEnd(files: ReadonlyArray<TestModule> = []): Promise<void> {
    const counts = tally(files, { collected: 0, passed: 0, failed: 0, skipped: 0 })
    const executed = counts.passed + counts.failed
    const include = this.ctx?.config?.include ?? []
    const namePattern = this.ctx?.config?.testNamePattern
    const collectable = await this.collectableFiles()

    const lines: string[] = []

    if (counts.collected > 0 && executed === 0) {
      // The case this reporter was written for. Say it in words a reader scanning
      // a roundup of green gates cannot mistake for a pass.
      lines.push(
        `  scope: COLLECTION ONLY — ${counts.collected} test(s) in ${files.length} file(s) were imported, and ZERO were executed.`,
        `  This run proves those files still load and parse. It asserts NOTHING about behaviour.`,
        `  Do not quote it as a passing gate. A broken static import reddens here;`,
        `  a broken dynamic import inside a test body does not.`,
      )
    } else if (collectable === null) {
      // The denominator could not be derived. Say so — a missing comparison must
      // not silently read as "nothing was narrowed".
      lines.push(
        `  scope: ${executed} executed / ${counts.collected} collected in ${files.length} file(s).`,
        `  Whether that is the whole of this config could NOT be derived from vitest's`,
        `  API here — treat the reach of this run as UNKNOWN rather than complete.`,
      )
    } else if (files.length < collectable) {
      lines.push(
        `  scope: a SUBSET — this run covered ${files.length} of the ${collectable} file(s) this config collects` +
          ` (${((files.length / collectable) * 100).toFixed(1)}%), ${executed} test(s) executed.`,
        `  Quote it as "N of ${collectable} files", never as a bare number. Whatever the`,
        `  other ${collectable - files.length} file(s) would have said, this run did not ask them.`,
      )
    } else {
      lines.push(
        `  scope: the WHOLE configured package — ${executed} executed / ${counts.collected} collected across all ${files.length} file(s) this config collects.`,
        `  "Whole" means everything matched by this config's include: ${include.join(', ') || '(default)'}`,
        `  — a smaller claim than "everything in the package". Files outside that glob`,
        `  are invisible to this gate and to this line.`,
      )
    }

    if (namePattern) {
      lines.push(
        `  ⚠ a name pattern (${String(namePattern)}) was applied, so tests within those files were filtered too.`,
      )
    }
    if (counts.skipped > 0 && executed > 0) {
      lines.push(`  ${counts.skipped} test(s) were skipped and asserted nothing.`)
    }

    // eslint-disable-next-line no-console
    console.log(`\n${lines.join('\n')}\n`)
  }
}

export default VitestScopeReporter
