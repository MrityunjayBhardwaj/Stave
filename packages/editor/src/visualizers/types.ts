import type { RefObject } from 'react'
import type { HapStream } from '../engine/HapStream'
import type { EngineComponents } from '../engine/LiveCodingEngine'
import type { NormalizedHap } from '../engine/NormalizedHap'
import type { IRPattern } from '../codeView'

/**
 * PatternScheduler — backward-compatible alias for IRPattern.
 * New code should import IRPattern from '../ir' directly.
 */
export type PatternScheduler = IRPattern

/**
 * Bundled refs passed to every VizRenderer on mount.
 * @deprecated Use {@link EngineComponents} instead. VizRenderer.mount() now accepts
 * `Partial<EngineComponents>`. This type is retained for backward compatibility.
 */
export interface VizRefs {
  hapStreamRef: RefObject<HapStream | null>
  analyserRef:  RefObject<AnalyserNode | null>
  schedulerRef: RefObject<PatternScheduler | null>
}

/** Renderer-agnostic visualization lifecycle. */
export interface VizRenderer {
  mount(container: HTMLDivElement, components: Partial<EngineComponents>, size: { w: number; h: number }, onError: (e: Error) => void): void
  /** Refresh engine data refs (called each React render for live updates). */
  update(components: Partial<EngineComponents>): void
  resize(w: number, h: number): void
  pause(): void
  resume(): void
  destroy(): void
}

/** A factory function returning a VizRenderer, or a VizRenderer instance directly. */
export type VizRendererSource = (() => VizRenderer) | VizRenderer

/**
 * Descriptor for a visualization mode in the VizPicker.
 *
 * `requires` lists the engine component slots this viz needs. Used by VizPicker
 * to disable unavailable visualizations. This is about engine data requirements,
 * NOT renderer capabilities (e.g. WebGL) — renderer caps are a separate concern.
 *
 * IDs follow the `"mode:renderer"` convention when multiple renderers offer the
 * same visual concept (e.g. `"pianoroll"` vs `"pianoroll:hydra"`). The bare
 * `"mode"` form is the default renderer for that concept.
 */
export interface VizDescriptor {
  id: string
  label: string
  requires?: (keyof EngineComponents)[]
  /** Renderer technology name (e.g. 'p5', 'hydra', 'canvas2d'). Used for VizPicker grouping. */
  renderer?: string
  /**
   * Intrinsic drawing-surface size (the aspect the sketch is authored for).
   * `viewZones` mounts the renderer at this size, so it sets the inline zone's
   * aspect ratio. Omitted → the generic `DEFAULT_NATIVE` (2:1). The pianoroll
   * sets a taller aspect so pitch lanes aren't squashed vs the time axis.
   */
  nativeSize?: { w: number; h: number }
  factory: () => VizRenderer
}

/**
 * Live container size handed to user sketches via `stave.width` /
 * `stave.height`. The ref is maintained by `P5VizRenderer` — its
 * `current` field is updated on mount (from the container's initial
 * clientRect) and on every `resize(w, h)` call. User sketches read
 * these values inside `setup()` so `createCanvas(stave.width,
 * stave.height)` always matches the preview pane, regardless of the
 * browser window size or p5's internal `windowWidth` / `windowHeight`
 * globals.
 */
export interface ContainerSize {
  w: number
  h: number
}

/**
 * Free-form per-render options bag handed to a sketch via `stave.options`.
 * Populated from a Strudel viz call's argument, e.g. `.pianoroll({ labels: 1,
 * vertical: 1 })` — so a sketch can honour the official `@strudel/draw`
 * vocabulary. Empty `{}` when the viz was called with no argument.
 */
export type VizOptions = Record<string, unknown>

/**
 * Internal type alias for the existing p5 sketch factory signature.
 * Used only by P5VizRenderer — NOT exported from the package.
 *
 * `optionsRef` (5th, optional for back-compat) exposes the live per-render
 * options bag as `stave.options`; callers that don't wire it get `{}`.
 *
 * `staveUniformsRef` (6th, optional for back-compat — Phase 21) carries the
 * live named-signal uniform object (`uKick…`, `u(...)`) built by
 * `P5VizRenderer` from its per-renderer SignalBus. Callers that don't wire it
 * get an inert object (all signals 0). Type-only import to avoid a runtime
 * cycle with `p5Compiler`.
 */
export type P5SketchFactory = (
  hapStreamRef: RefObject<HapStream | null>,
  analyserRef: RefObject<AnalyserNode | null>,
  schedulerRef: RefObject<PatternScheduler | null>,
  containerSizeRef: RefObject<ContainerSize>,
  optionsRef?: RefObject<VizOptions>,
  staveUniformsRef?: RefObject<import('./p5Compiler').StaveUniforms>
) => (p: import('p5').default) => void
