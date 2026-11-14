import type { EngineComponents } from '../engine/LiveCodingEngine'
import type { VizRenderer } from './types'
import { registerVizVisibility } from './vizVisibility'

/**
 * attachVizLifecycle — THE single choke point for the per-mount viz concerns that
 * MUST attach to every mounted renderer (PV74 / #260): `renderer.mount()` + the
 * Phase C visibility pausing (`registerVizVisibility`, #258). A viz attaches to
 * the DOM at TWO seams and there is no shared mount path:
 *   - `mountVizRenderer` — picker (`useVizRenderer`/`VizPanel`), backdrop
 *     (`compiledVizProvider`), crop preview (`CropPopup`). Wraps this + a
 *     ResizeObserver.
 *   - `viewZones` — inline `.viz()` Monaco zones. Wraps this + a teardown wrapper
 *     (#263), Monaco-layout reflow, crop, decorations, action bar.
 * Routing BOTH through here means a future per-mount concern of this class wires
 * ONCE, not twice — closing the P107 footgun (a concern wired into only one seam
 * was silently dead on the other). Concerns that genuinely DIVERGE by seam
 * (resize: ResizeObserver vs Monaco-layout; teardown-wrap; crop) stay at the call
 * site — they are not "wire both" concerns and forcing them together would be the
 * wrong abstraction.
 *
 * Returns a `detach` that unwires ONLY what this attached (the visibility
 * registration). It does NOT call `renderer.destroy()` — the caller owns the
 * renderer's lifetime (both seams destroy their renderers themselves).
 *
 * `onMountError` lets a seam SWALLOW a mount throw and still wire visibility
 * (viewZones logs + continues so one bad zone can't abort the others); omit it and
 * a mount throw propagates (mountVizRenderer's contract).
 *
 * REF: PV74 (the two-seams invariant), P107 (the doc-lie that made inline wiring
 * dead), PK27 (#260 gate), vizVisibility.ts (registerVizVisibility),
 * mountVizRenderer.ts + viewZones.ts (the two callers).
 */
export function attachVizLifecycle(
  renderer: VizRenderer,
  container: HTMLDivElement,
  components: Partial<EngineComponents>,
  size: { w: number; h: number },
  onError: (e: Error) => void,
  opts: {
    teardownMs?: number
    onMountError?: (e: unknown) => void
    /** #2560 — the renderer is ALREADY mounted into `container` (a warm-up built
     *  before Play): hand it the live components instead of mounting it again. */
    adopted?: boolean
  } = {},
): () => void {
  try {
    if (opts.adopted) renderer.update(components)
    else renderer.mount(container, components, size, onError)
  } catch (e) {
    if (opts.onMountError) opts.onMountError(e)
    else throw e
  }
  // Visibility wiring runs even after a swallowed mount error (matches the prior
  // viewZones order: it registered visibility regardless of the mount try/catch).
  return registerVizVisibility(
    renderer,
    container,
    opts.teardownMs ? { teardownMs: opts.teardownMs } : undefined,
  )
}
