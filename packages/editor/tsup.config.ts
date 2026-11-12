import { defineConfig, type Options } from 'tsup'
import path from 'node:path'

/**
 * #2148 — Vim's code is a file of its own, fetched only when someone switches Vim on.
 *
 *  - Its manifest's `load` is `import('./module')`. Here that import is kept out of the
 *    main bundle and pointed at the built file beside it, in the same format: the ESM
 *    build's `index.js` loads `vim.js`, the CommonJS build's `index.cjs` loads `vim.cjs`.
 *    So the app's bundler makes it a chunk of its own instead of the main bundle carrying
 *    it.
 *  - monaco-vim imports Monaco's ESM build by path. Stave's Monaco is loaded at run time,
 *    not bundled, so those imports are pointed at the page's Monaco
 *    (`src/extensions/vim/monacoApi.ts`) and at a public-API `ShiftCommand`
 *    (`src/extensions/vim/shiftCommand.ts`). `vitest.config.ts` points them the same way.
 */
type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number]

const VIM_DIR = path.resolve('src/extensions/vim')
const vimPlugin: EsbuildPlugin = {
  name: 'stave-vim',
  setup(build) {
    // tsup runs esbuild as ESM for both builds and names the CommonJS files by their
    // extension, so the extension is what tells the two apart here
    const built = build.initialOptions.outExtension?.['.js'] === '.cjs' ? './vim.cjs' : './vim.js'
    build.onResolve({ filter: /^\.\/module$/ }, (args) =>
      args.kind === 'dynamic-import' && path.resolve(path.dirname(args.importer)) === VIM_DIR
        ? { path: built, external: true }
        : undefined,
    )
    build.onResolve({ filter: /^monaco-editor\/esm\/vs\/editor\/editor\.api$/ }, () => ({
      path: path.join(VIM_DIR, 'monacoApi.ts'),
    }))
    build.onResolve({ filter: /^monaco-editor\/esm\/vs\/editor\/common\/commands\/shiftCommand$/ }, () => ({
      path: path.join(VIM_DIR, 'shiftCommand.ts'),
    }))
  },
}

export default defineConfig({
  // Two entries: the main editor bundle, and a SEPARATE worker-safe bundle
  // (`@stave/editor/worker`, Phase B / B-3) a Web Worker imports without dragging
  // the Monaco/React/yjs monolith into the worker chunk. `splitting: false` keeps
  // each entry a self-contained bundle; `p5` is `import()`'d lazily inside the
  // host (PV70 condition 1 — shim before p5 eval) so the final app bundler (Next)
  // emits it as the worker's own sub-chunk.
  // Four more entries (knobScale #1581, trackId #1679, chord #1799, noteToMidi #1928)
  // existed only because the app's TESTS could not load the main entry; #1938 fixed
  // that, and #1943 retired them. Their names are on the main entry.
  // A third entry (#2148): `vim`, the Vim extension's code with monaco-vim inside it,
  // which the main bundle reaches only through `import('./vim.js')` (`./vim.cjs` from the
  // CommonJS build; see above).
  entry: {
    index: 'src/index.ts',
    'visualizers/worker/index': 'src/visualizers/worker/index.ts',
    vim: 'src/extensions/vim/module.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom'],
  // #2148 — monaco-vim's two Monaco imports are pointed at our own files (vimPlugin), never
  // left as imports of the monaco-editor package, which is only ever loaded at run time.
  noExternal: [/^monaco-editor\/esm\//],
  esbuildPlugins: [vimPlugin],
  treeshake: true,
  splitting: false,
  // 20-17 A-1 (#141 / D-01 / P68): keep function + parameter names through
  // any (future) minification so the pervasive `bindings` optional-arg
  // refactor is a minification-STABLE P68 build-hygiene anchor. Without
  // this, grepping `bindings` in dist after a CORRECT refactor would
  // false-negative once minify is ever enabled (the plan-checker MAJOR
  // dim 2/4). esbuild `keepNames` preserves the names verbatim.
  keepNames: true,
})
