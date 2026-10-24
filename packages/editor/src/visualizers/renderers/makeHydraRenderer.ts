/**
 * makeHydraRenderer — the hydra renderer factory that chooses, per mount, between
 * the OffscreenCanvas-worker renderer and the main-thread renderer (Phase B / B-5,
 * epic #228). The symmetric analog of `makeP5Renderer`.
 *
 * Worker rendering is selected on the SAME conditions (`shouldUseWorkerRenderer`):
 * flag on + worker factory registered + browser can offload. When selected it's
 * wrapped in a `FallbackVizRenderer` so a worker that fails to start degrades to
 * the proven main-thread `HydraVizRenderer` (#247). Otherwise — and ALWAYS for a
 * non-isolated/old browser or the flag off — the main-thread renderer runs.
 *
 * SCOPE (B-5): this routes the USER `.hydra(code)` path (a transferable code
 * string). The BUILT-IN hydra presets are `HydraPatternFn` CLOSURES (not strings),
 * so they can't cross to a worker as-is — they keep using the main-thread
 * `HydraVizRenderer` directly (string-conversion is a deferred follow-up).
 *
 * REF: makeP5Renderer (the p5 analog), FallbackVizRenderer (#247),
 *      hostVizWorker (kind 'hydra'), hydraStaveBag, PHASE-B-PLAN §5 B-5.
 */

import type { VizRenderer } from '../types'
import { HydraVizRenderer, type HydraPatternFn } from './HydraVizRenderer'
import { WorkerVizRenderer } from './WorkerVizRenderer'
import { FallbackVizRenderer } from './FallbackVizRenderer'
import { compileHydraCode } from '../hydraCompiler'
import { shouldUseWorkerRenderer } from './makeP5Renderer'

/** Build a hydra `VizRenderer` for a USER `.hydra` sketch — worker-offloaded (with
 *  main-thread fallback) when supported + enabled, else main-thread. `name` is the
 *  workspace path (error attribution). */
export function makeHydraRenderer(code: string, name: string): VizRenderer {
  return shouldUseWorkerRenderer()
    ? new FallbackVizRenderer(
        () => new WorkerVizRenderer('hydra', code, name),
        () => mainHydraRenderer(code, name),
      )
    : mainHydraRenderer(code, name)
}

/**
 * The main-thread renderer for `code`. A sketch that doesn't compile (a syntax
 * error) becomes one whose pattern throws that error at mount, where the
 * renderer reports it against `name` (#2219) — thrown here, it reached only the
 * browser console from an inline `.viz()`, and escaped the fallback's catch.
 */
function mainHydraRenderer(code: string, name: string): HydraVizRenderer {
  let pattern: HydraPatternFn
  try {
    pattern = compileHydraCode(code)
  } catch (e) {
    pattern = () => {
      throw e
    }
  }
  return new HydraVizRenderer(pattern, name)
}
