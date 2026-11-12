/**
 * mountVizPreview — render a viz LIVE, muted, into a small container (#838).
 *
 * The single app-facing seam for the viz-library card's ShaderToy-style hover
 * preview: given a viz's raw source (renderer kind + code), it mounts the real
 * worker viz into `container` and drives it from the muted drum-pattern demo
 * feed (`demoSignalSource`) so an audio-reactive shader animates while nothing
 * is playing and no sound is produced. The worker presents directly onto the
 * on-screen canvas — there is NO frame readback / ImageBitmap capture.
 *
 * Worker-ONLY by design: the demo feed is a worker `SignalFrame` stream, and the
 * user wants previews rendered in the dedicated viz worker. Where the worker path
 * is unavailable (old/non-isolated browser, flag off) this returns `null` and the
 * caller keeps its static baked/placeholder tile — a preview is a best-effort
 * enhancement, never a requirement.
 *
 * Teardown is the caller's responsibility on mouse-leave: call `disconnect()`,
 * which stops the ResizeObserver/lifecycle AND destroys the renderer so the
 * worker + its GPU context are released immediately (only one preview is ever
 * alive, so the shared GPU never accumulates contexts — P122).
 *
 * REF: mountVizRenderer (the shared preview lifecycle), WorkerVizRenderer
 *      (setDemoSource), demoSignalSource, [[project_asset_library]] (#838).
 */

import { WorkerVizRenderer } from './renderers/WorkerVizRenderer'
import { shouldUseWorkerRenderer } from './renderers/makeP5Renderer'
import { mountVizRenderer } from './mountVizRenderer'
import { createDrumDemoSignalSource } from './demoSignalSource'

/** The renderer kind + raw source a library card knows about its viz. */
export interface VizPreviewSpec {
  readonly renderer: 'p5' | 'hydra' | 'glsl' | 'three'
  readonly code: string
  /** Display/attribution name (used for worker error messages). */
  readonly name: string
}

/** Mount a muted live preview, or return `null` if the worker path is unavailable
 *  (caller then keeps its static tile). `disconnect()` fully tears down. */
export function mountVizPreview(
  container: HTMLDivElement,
  spec: VizPreviewSpec,
  size: { w: number; h: number },
  onError: (e: Error) => void,
): { disconnect: () => void } | null {
  if (!shouldUseWorkerRenderer()) return null

  const demo = createDrumDemoSignalSource()
  const source = () => {
    const r = new WorkerVizRenderer(spec.renderer, spec.code, spec.name)
    r.setDemoSource(demo)
    return r
  }

  const { renderer, disconnect } = mountVizRenderer(container, source, {}, size, onError)
  return {
    disconnect: () => {
      disconnect()
      // Release the worker + GPU context now (mountVizRenderer's disconnect only
      // detaches the ResizeObserver/lifecycle — mirrors useVizRenderer cleanup).
      renderer.destroy()
    },
  }
}
