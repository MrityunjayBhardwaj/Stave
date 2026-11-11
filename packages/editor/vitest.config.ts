import { configDefaults, defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // Strudel's repl.mjs imports `SalatRepl` from `@kabelsalat/web`, which
      // ships a CJS UMD as its `main` field. Under vite-node Node-resolves
      // the package to that UMD and the static ESM linker rejects the named
      // import before any test setup runs. We never use the REPL surface
      // during tests, so redirect the import to a tiny ESM stub. This lets
      // `evalScope(core, mini); evaluate(code)` work end-to-end via the
      // documented Strudel boot sequence (RESEARCH §6.1).
      '@kabelsalat/web': fileURLToPath(
        new URL('./test/stubs/kabelsalat-web.mjs', import.meta.url),
      ),
      // #2148 — monaco-vim imports Monaco's ESM build by path; the build points those
      // imports at the page's Monaco (tsup.config.ts), and so do the tests.
      'monaco-editor/esm/vs/editor/editor.api': fileURLToPath(
        new URL('./src/extensions/vim/monacoApi.ts', import.meta.url),
      ),
      'monaco-editor/esm/vs/editor/common/commands/shiftCommand': fileURLToPath(
        new URL('./src/extensions/vim/shiftCommand.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    /**
     * An underscore-prefixed file is a PROBE, not a gate (#1113).
     *
     * This package sets no `include`, so it uses vitest's default, which collects
     * both `*.test.ts` and `*.spec.ts` anywhere under the package. That is why the
     * app package's convention does not transfer: over there `include` matches only
     * `*.test.ts`, so renaming a probe to `_name.spec.ts` makes it inert, and 19
     * files rely on that. Here a rename would change nothing — so the convention has
     * to be established rather than borrowed (#1111 is the app-side counterpart).
     *
     * What it costs to lack one: `_coverageDecomp.analysis.test.ts` says in its own
     * header that "the assertion is trivial so the run always passes". It contributed
     * a green that cannot mean anything, plus a console dump, to a gate suite.
     *
     * ⚠ `exclude` REPLACES vitest's defaults rather than extending them, so
     * `configDefaults.exclude` is spread first. Writing the bare array here would
     * silently start collecting `node_modules` and `dist`.
     */
    exclude: [...configDefaults.exclude, '**/_*.{test,spec}.{ts,tsx}'],
    server: {
      // Force vite-node to transform these packages instead of externalising
      // them through Node's resolver — Node ignores Vite aliases for
      // transitive imports inside externalised node_modules.
      deps: {
        // monaco-vim (#2148) too, so its Monaco imports take the aliases above
        inline: [/@strudel\//, /monaco-vim/],
      },
    },
  },
})
