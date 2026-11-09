/**
 * makeThreeRenderer — the three.js renderer factory (#2516): the worker renderer
 * with a main-thread fallback when the browser can offload, else main-thread.
 * The analog of `makeGLSLRenderer` / `makeHydraRenderer`.
 *
 * A `.three` sketch is a code string, so it crosses to the worker as is; the
 * worker compiles and runs it with the same core (`threeSketch.ts`) the
 * main-thread `ThreeVizRenderer` uses. A sketch that fails in the worker before
 * its first frame (an unsupported import, a top-level error) falls back to the
 * main thread, which reports it against the file and line.
 *
 * REF: makeGLSLRenderer (the analog), FallbackVizRenderer (#247), hostVizWorker
 *      (kind 'three'), ThreeVizRenderer, threeSketch.
 */

import type { VizRenderer } from '../types'
import { ThreeVizRenderer } from './ThreeVizRenderer'
import { WorkerVizRenderer } from './WorkerVizRenderer'
import { FallbackVizRenderer } from './FallbackVizRenderer'
import { shouldUseWorkerRenderer } from './makeP5Renderer'

export function makeThreeRenderer(code: string, name: string): VizRenderer {
  return shouldUseWorkerRenderer()
    ? new FallbackVizRenderer(
        () => new WorkerVizRenderer('three', code, name),
        () => new ThreeVizRenderer(code, name),
      )
    : new ThreeVizRenderer(code, name)
}
