import { defineConfig } from 'tsup'

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
  entry: ['src/index.ts', 'src/visualizers/worker/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom'],
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
