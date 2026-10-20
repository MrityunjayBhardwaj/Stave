#!/usr/bin/env node
/**
 * vitest-guard — run vitest, raise the worker heap ceiling, and make a
 * MEMORY DEATH legible rather than indistinguishable from a regression (#1379).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The app suite intermittently stopped mid-run with no failing test and a
 * nonzero exit. That signature is identical to a real regression, and it cost
 * hours: the same death was attributed first to the environment, then to a
 * production diff, and neither was right. A suite's exit code cannot carry the
 * distinction between "your change broke something" and "the runner died", so
 * this wrapper carries it instead.
 *
 * ── THE TWO DEATHS, WHICH LOOK DIFFERENT ─────────────────────────────────────
 * Both were observed, and a guard that catches only one is a guard that lies:
 *
 *   1. The WORKER hits its heap limit. vitest survives, reports
 *      `ERR_WORKER_OUT_OF_MEMORY` as an unhandled error, and exits 1 with NO
 *      signal — so process-level signal detection never fires. Only the output
 *      names it.
 *   2. The PROCESS aborts. macOS records `Abort trap: 6` and the crash report
 *      names it exactly: `node::OOMErrorHandler` → `Heap::FatalProcessOutOfMemory`
 *      → `CheckIneffectiveMarkCompact`. Here there IS a signal and no marker in
 *      the output, because the process never got to print one.
 *
 * ── THE HEAP CEILING ─────────────────────────────────────────────────────────
 * vitest 1.6's `ThreadsOptions` does not expose `resourceLimits`, and a worker
 * thread REJECTS `--max-old-space-size` in `execArgv`
 * (`ERR_WORKER_INVALID_EXEC_ARGV`), so `vitest.config.ts` cannot set this.
 * `NODE_OPTIONS` on the parent does work — measured, 4288 MB → 8384 MB inside a
 * worker — because worker threads inherit it as their default resource limit.
 *
 * Since vitest 4 (#2154) test files run in forked child PROCESSES by default, not
 * worker threads. The same `NODE_OPTIONS` still reaches them: re-measured
 * 2026-10-20, a test sees 8384 MB through this wrapper and 4288 MB without it.
 *
 * Why raising it is a fix and not a postponement: no single test file needs
 * anything close to the limit (heaviest measured alone: 893 MB). The exhaustion
 * comes from ACCUMULATION across the ~10 files each worker handles, which is
 * BOUNDED by files-per-worker. The ceiling was simply set slightly too low for
 * the suite's real shape.
 *
 * ⚠ Lowering `maxThreads` would make this WORSE: fewer workers means more files
 * each, and files-per-worker is precisely the quantity that accumulates.
 *
 * ⚠ Running `vitest` directly bypasses this wrapper and keeps the 4288 MB
 * default — which is the configuration the failure was observed on.
 *
 * A caller's own `--max-old-space-size` is respected, so the abort path stays
 * testable with a deliberately small heap.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const HEAP_MB = 8192

// Resolve vitest's own CLI rather than trusting PATH. Invoked as a bare
// `node scripts/vitest-guard.mjs` there is no `node_modules/.bin` on PATH and a
// PATH lookup fails with ENOENT — which would turn this guard into its own
// version of the problem it exists to remove.
const require = createRequire(import.meta.url)
let cli = null
try {
  cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
} catch {
  cli = null
}

const existing = process.env.NODE_OPTIONS ?? ''
const env = {
  ...process.env,
  NODE_OPTIONS: existing.includes('--max-old-space-size')
    ? existing
    : `${existing} --max-old-space-size=${HEAP_MB}`.trim(),
}

/** The ceiling actually in effect — a caller's override wins, so say theirs. */
const effectiveHeapMb = () => {
  const m = /--max-old-space-size=(\d+)/.exec(env.NODE_OPTIONS ?? '')
  return m ? m[1] : String(HEAP_MB)
}

const args = process.argv.slice(2)
const child = cli
  ? spawn(process.execPath, [cli, 'run', ...args], { stdio: ['inherit', 'pipe', 'pipe'], env })
  : spawn('vitest', ['run', ...args], { stdio: ['inherit', 'pipe', 'pipe'], env })

/** Markers for death 1, which exits cleanly and is only visible in the output. */
const OOM_MARKERS = [
  'ERR_WORKER_OUT_OF_MEMORY',
  'Worker terminated due to reaching memory limit',
  'JavaScript heap out of memory',
  'FATAL ERROR: Reached heap limit',
]

// Keep a bounded tail so a long run cannot make the guard itself the memory
// problem. The markers appear near the end, in vitest's error summary.
let tail = ''
const TAIL_MAX = 64 * 1024
const watch = (stream, out) => {
  stream.on('data', (buf) => {
    out.write(buf)
    tail = (tail + buf.toString()).slice(-TAIL_MAX)
  })
}
watch(child.stdout, process.stdout)
watch(child.stderr, process.stderr)

child.on('error', (err) => {
  console.error(`\nvitest-guard: could not start vitest — ${err.message}`)
  process.exit(1)
})

child.on('close', (code, signal) => {
  const marker = OOM_MARKERS.find((m) => tail.includes(m))
  // 134 = SIGABRT, 137 = SIGKILL. A signal means the run DIED; it does not by
  // itself say WHY. V8's `FatalProcessOutOfMemory` aborts with SIGABRT — but so
  // do many other things, and one observed abort here carried none of the V8
  // OOM symbols at all. Claiming memory from the signal alone would make this
  // wrapper guilty of the confident-wrong-diagnosis it exists to prevent.
  // State what is known; point at what settles the rest.
  const died = Boolean(signal) || code === 134 || code === 137
  if (!died && !marker) process.exit(code ?? 1)

  const how = signal ?? (code === 134 ? 'SIGABRT' : code === 137 ? 'SIGKILL' : 'abnormal exit')
  const lines = [
    '',
    '='.repeat(74),
    marker
      ? '  THE TEST RUN RAN OUT OF MEMORY — this is NOT a test failure.'
      : `  THE TEST RUN WAS KILLED (${how}) — this is NOT a test failure.`,
    '='.repeat(74),
    '',
    '  No assertion failed. The run died partway through, so the results',
    '  above are incomplete and say nothing about the code under test.',
    '',
    '  Do NOT read this as a regression in your change, and do not re-run',
    '  until it passes and call that a result. See #1379.',
    '',
  ]
  if (marker) {
    lines.push(
      `  Evidence: the run printed "${marker}".`,
      `  Per-worker ceiling for this run: ${effectiveHeapMb()} MB. If that is`,
      '  already generous, the per-file residue needs fixing rather than the',
      '  ceiling raising again.',
      '',
    )
  } else {
    lines.push(
      '  The cause is NOT established. A signal says the process died, not why —',
      `  ${how} covers a memory abort and much else besides. To identify it:`,
      '',
      '    ls -t ~/Library/Logs/DiagnosticReports/node-*.ips | head -1',
      '',
      '  A memory death names `node::OOMErrorHandler` and',
      '  `Heap::FatalProcessOutOfMemory` in that report. If those symbols are',
      '  ABSENT this was something else, and raising the heap ceiling is not',
      '  the answer.',
      '',
    )
  }
  console.error(lines.join('\n'))
  process.exit(137)
})
