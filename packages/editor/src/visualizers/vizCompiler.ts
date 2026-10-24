import type { VizDescriptor } from './types'
import type { VizPreset } from './vizPreset'
import { makeP5Renderer } from './renderers/makeP5Renderer'
import { makeHydraRenderer } from './renderers/makeHydraRenderer'
import { makeGLSLRenderer } from './renderers/makeGLSLRenderer'
import { compileP5Code, isFullLifecycleSketch } from './p5Compiler'
import { compileHydraCode } from './hydraCompiler'

// Re-export the pure compile functions so existing consumers that
// import from `./vizCompiler` keep working. The implementations live
// in `./p5Compiler` / `./hydraCompiler` to keep unit-test module
// graphs free of the transitive `p5` / `gifenc` dependency chain
// that comes in via `P5VizRenderer`.
export { compileP5Code, isFullLifecycleSketch, compileHydraCode }

/**
 * Compiles user-authored viz code into a VizDescriptor.
 *
 * Hydra code: evaluated in a function scope with the hydra synth
 *   object as `s` and a `stave` namespace mirroring the p5 convention:
 *     - `stave.scheduler` — IRPattern | null (combined pattern scheduler)
 *     - `stave.tracks`    — Map<trackId, IRPattern> (per-track)
 *   Sketches that reference only `s` keep working — the `stave` arg
 *   is additive. Uses `new Function()`.
 *
 * p5 code: evaluated as a full p5 sketch script. Users write real
 *   `function preload/setup/draw` declarations and access injected
 *   Stave-specific inputs via a single `stave` namespace global:
 *     - `stave.scheduler`  — PatternScheduler | null
 *     - `stave.analyser`   — AnalyserNode | null
 *     - `stave.hapStream`  — HapStream | null
 *   Legacy draw-body snippets (no `function draw` declaration) are
 *   auto-wrapped for backwards compatibility.
 */
export function compilePreset(preset: VizPreset): VizDescriptor {
  const { id, name, renderer, code, requires } = preset
  // Errors are reported against a FILE. A preview's preset is named by its
  // path already; a visual used by name (`.viz("Prism")`) carries the path it
  // was saved from in `filePath`, while `name` stays its label (#2209, #2210).
  const source = preset.filePath ?? name

  if (renderer === 'hydra') {
    return {
      id,
      label: name,
      renderer: 'hydra',
      requires,
      ...(preset.nativeSize ? { nativeSize: preset.nativeSize } : {}),
      // B-5: `makeHydraRenderer` returns a worker-offloaded renderer (with
      // main-thread fallback) when the flag is on + the browser is capable, else
      // the main-thread HydraVizRenderer. User `.hydra` code is a transferable
      // string, so it can cross to the worker (built-in hydra closures can't yet).
      factory: () => makeHydraRenderer(code, source),
    }
  }

  if (renderer === 'glsl') {
    return {
      id,
      label: name,
      renderer: 'glsl',
      requires,
      ...(preset.nativeSize ? { nativeSize: preset.nativeSize } : {}),
      // #281: `makeGLSLRenderer` returns a worker-offloaded renderer (with
      // main-thread fallback) when the flag is on + the browser is capable, else
      // the main-thread GLSLVizRenderer. A `.glsl` sketch is the wrapped fragment
      // source — a plain transferable string, so it crosses to the worker cleanly.
      factory: () => makeGLSLRenderer(code, source),
    }
  }

  if (renderer === 'p5') {
    return {
      id,
      label: name,
      renderer: 'p5',
      requires,
      ...(preset.nativeSize ? { nativeSize: preset.nativeSize } : {}),
      // Pass the workspace path (`source`) so the factory's
      // runtime-error catch can attribute the engineLog entry back to
      // the file. Without it, a top-level `new Mp()` typo surfaced on
      // the preview canvas but nowhere else — no Console row, no
      // Monaco squiggle.
      // B-3: `makeP5Renderer` returns a worker-offloaded renderer when the flag
      // is on + the browser is capable, else the main-thread P5VizRenderer.
      factory: () => makeP5Renderer(code, source),
    }
  }

  throw new Error(`Unknown renderer: ${renderer}`)
}

