import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // #2126 — a fresh localStorage/sessionStorage per test, the same on every Node.
    setupFiles: ['./vitest.setup.ts'],
    // Exclude Playwright specs (they live under packages/app/tests/) — they
    // import from `@playwright/test` and are not vitest-runnable.
    //
    // Phase 20-14 γ-2: the parity corpus spec lives under
    // `tests/parity-corpus/` alongside the vendored `.strudel` fixtures —
    // include that subdirectory explicitly. The corresponding `exclude`
    // entry below targets `tests/*.spec.ts` (Playwright glob) rather than
    // the whole `tests/` tree.
    include: [
      'src/**/__tests__/**/*.test.{ts,tsx}',
      'tests/parity-corpus/**/*.test.{ts,tsx}',
    ],
    exclude: ['node_modules', 'tests/*.spec.ts', '.next'],
    // ⚠ #1379 — THE WORKER HEAP CEILING IS NOT SET HERE, AND CANNOT BE.
    //
    // The suite intermittently died with `Abort trap: 6` — a run that stops
    // with no failing test, which is indistinguishable from a regression. The
    // macOS crash report named it exactly: `node::OOMErrorHandler` →
    // `Heap::FatalProcessOutOfMemory`, a V8 heap exhaustion inside ONE worker
    // (the machine had 24 GB free). The default worker ceiling is 4288 MB and a
    // measured run peaked at 4367 MB in a single process — just past it.
    //
    // vitest 1.6's `ThreadsOptions` does not expose `resourceLimits`, and a
    // worker thread REJECTS `--max-old-space-size` in `execArgv`
    // (`ERR_WORKER_INVALID_EXEC_ARGV`). So the ceiling is raised where it can
    // be — `NODE_OPTIONS` on the parent, set by `scripts/vitest-guard.mjs`,
    // which `pnpm test` and `gate:editing:app` both run. That file carries the
    // full measurement and reasoning.
    //
    // ⚠ Running `vitest` DIRECTLY bypasses the guard and keeps the 4288 MB
    // default — which is the configuration the failure was observed on.
    //
    // ⚠ Lowering `maxThreads` would make this WORSE, not better: fewer workers
    // means more files each, and files-per-worker is exactly what accumulates.

    // App-package projection helpers are pure functions that import
    // PatternIR types from @stave/editor. Real Strudel parsing in tests
    // means we still need the @strudel transitive imports to resolve via
    // vite-node — mirror the editor's stub + inline pattern.
    server: {
      deps: {
        // #1938 — p5 is what lets an app test load the editor's main entry.
        // p5's dist imports `gifenc`, a CommonJS module, and Node's ESM loader
        // cannot name its exports: `Named export 'GIFEncoder' not found`.
        // Inlining `gifenc` alone did not fix that (measured: the main-entry
        // probe still failed), and neither did inlining `@stave/editor`; the
        // importer has to go through Vite, and the importer is p5. With p5
        // inlined the full suite passes and the main entry loads.
        inline: [/@strudel\//, "gifenc", /[\\/]p5[\\/]/],
      },
    },
  },
  resolve: {
    alias: {
      '@kabelsalat/web': new URL(
        '../editor/test/stubs/kabelsalat-web.mjs',
        import.meta.url,
      ).pathname,
    },
  },
})
