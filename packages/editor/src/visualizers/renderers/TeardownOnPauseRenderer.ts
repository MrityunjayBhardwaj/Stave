/**
 * TeardownOnPauseRenderer — a `VizRenderer` decorator that DESTROYS its inner
 * renderer after a sustained off-screen period and RE-CREATES it on return
 * (#263 part B — "teardown-on-long-pause").
 *
 * Why: Phase C (#259) `pause()` HALTS the draw loop but HOLDS the inner worker +
 * p5 + GL context + ~60–110MB (PV77 — measured at high-N-headroom.spec.ts). For
 * a zone left off-screen a long time that memory + a WebGL-context slot are pure
 * waste. This decorator escalates a sustained pause into a real `destroy()`
 * (reclaim) and transparently re-mounts on resume.
 *
 * Ownership split (so this class is renderer- AND site-agnostic):
 *   - WHEN to tear down / come back lives in `vizVisibility` (it alone knows
 *     on-screen vs tab-hidden — teardown is OFF-SCREEN ONLY). It calls
 *     `teardown()` when its off-screen timer fires and `resume()` on return.
 *   - HOW to re-create lives here: we remember the exact `mount()` args (kept
 *     fresh by `update`/`resize`) and replay them with a new instance from the
 *     factory. The outer instance is STABLE, so `viewZones`' `renderers[]` and
 *     the `vizVisibility` registration never need a ref-swap.
 *   - SITE-SPECIFIC DOM fix-ups (the inline crop-wrapper) are injected as
 *     `onAfterTeardown`/`onAfterReinit` hooks by the mount site.
 *
 * Mirrors the existing FallbackVizRenderer decorator pattern (PK23).
 *
 * REF: vizVisibility.ts (drives teardown/resume), WorkerVizRenderer.destroy
 *      (the reclaim), viewZones.ts (the inline hooks), PV77, #263.
 */
import type { EngineComponents } from '../../engine/LiveCodingEngine'
import type { VizRenderer } from '../types'

interface MountArgs {
  container: HTMLDivElement
  components: Partial<EngineComponents>
  size: { w: number; h: number }
  onError: (e: Error) => void
}

export interface TeardownHooks {
  /** Run right after the inner renderer is destroyed (e.g. drop the now-empty
   *  inline crop wrapper so reinit re-wraps the fresh canvas). */
  onAfterTeardown?: () => void
  /** Run right after the inner renderer is re-mounted (e.g. re-apply the inline
   *  layout transform to the freshly-created canvas). */
  onAfterReinit?: () => void
}

export class TeardownOnPauseRenderer implements VizRenderer {
  private inner: VizRenderer | null = null
  private args: MountArgs | null = null
  private tornDown = false

  constructor(
    private readonly factory: () => VizRenderer,
    private readonly hooks: TeardownHooks = {},
  ) {}

  /**
   * #2560 — take an inner renderer that is ALREADY mounted into `container` (a
   * warm-up built before Play) instead of building one in `mount`. The args are
   * remembered exactly as `mount` would, so an off-screen teardown re-creates it
   * the usual way. Call INSTEAD of `mount`.
   */
  adoptMounted(
    inner: VizRenderer,
    container: HTMLDivElement,
    components: Partial<EngineComponents>,
    size: { w: number; h: number },
    onError: (e: Error) => void,
  ): void {
    this.args = { container, components, size, onError }
    this.inner = inner
  }

  /** #2560 — the current inner renderer's loaded signal (taken as loaded when
   *  torn down, or when the inner has none). */
  whenLoaded(): Promise<void> {
    return this.inner?.whenLoaded?.() ?? Promise.resolve()
  }

  /** True while reclaimed (inner destroyed). Exposed for tests/observation. */
  get isTornDown(): boolean {
    return this.tornDown
  }

  mount(
    container: HTMLDivElement,
    components: Partial<EngineComponents>,
    size: { w: number; h: number },
    onError: (e: Error) => void,
  ): void {
    this.args = { container, components, size, onError }
    this.inner = this.factory()
    this.inner.mount(container, components, size, onError)
  }

  update(components: Partial<EngineComponents>): void {
    // Keep the remembered args fresh so a later reinit mounts with live refs.
    if (this.args) this.args.components = components
    this.inner?.update(components)
  }

  resize(w: number, h: number): void {
    if (this.args) this.args.size = { w, h }
    this.inner?.resize(w, h)
  }

  pause(): void {
    // A plain pause (off-screen / tab-hidden) — the inner renderer stays alive.
    // vizVisibility escalates to teardown() only after the off-screen threshold.
    this.inner?.pause()
  }

  resume(): void {
    if (this.tornDown) {
      this.reinit()
      return
    }
    this.inner?.resume()
  }

  destroy(): void {
    this.inner?.destroy()
    this.inner = null
    // Leave `tornDown` as-is; the instance is being discarded either way.
  }

  /** Reclaim: destroy the inner renderer (frees its worker/GL context + memory).
   *  Idempotent + safe to call while already torn down. */
  teardown(): void {
    if (this.tornDown || !this.inner) return
    this.inner.destroy()
    this.inner = null
    this.tornDown = true
    this.hooks.onAfterTeardown?.()
  }

  private reinit(): void {
    if (!this.args) return
    const { container, components, size, onError } = this.args
    this.inner = this.factory()
    this.inner.mount(container, components, size, onError)
    this.tornDown = false
    this.hooks.onAfterReinit?.()
  }
}
