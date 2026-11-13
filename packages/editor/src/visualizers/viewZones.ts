import type * as Monaco from 'monaco-editor'
import type { EngineComponents } from '../engine/LiveCodingEngine'
import type { VizRenderer, VizDescriptor } from './types'
import { resolveDescriptor } from './resolveDescriptor'
import { startsNamedTrack, startsTopLevelBlockRaw } from './blockScan'
import { attachVizLifecycle } from './attachVizLifecycle'
import { BufferedScheduler } from '../engine/BufferedScheduler'
import { VizPresetStore, type CropRegion, type VizPreset } from './vizPreset'
import { getZoneCropOverride, getZoneHeightOverride, setZoneHeightOverride, pruneZoneOverrides } from '../workspace/WorkspaceFile'
import { getInlineVizResolution, getInlineVizTeardownMs } from '../workspace/editorRegistry'
import { TeardownOnPauseRenderer } from './renderers/TeardownOnPauseRenderer'
import { takeWarmInlineViz, type ReuseOffer } from './inlineVizWarmup'
import { trackPatternVizLoad } from './vizLoadGate'

export interface InlineZoneHandle {
  cleanup(): void
  pause(): void
  resume(): void
  /** #2560 — this handle's sketches, for the warm-up to reuse after Stop. */
  offerForReuse?(): ReuseOffer[]
}

export interface VizZoneActions {
  /**
   * Fires when the user clicks the edit (✎) button on an inline zone.
   *
   * `presetId` is the preset this zone resolved (by name AND renderer), or
   * `null` while that async lookup is still pending. Hosts open the file
   * behind the preset — the viz actually drawn — and fall back to the name
   * only when it is `null`; a name alone can match a pattern file (#2322).
   */
  onEdit?: (vizId: string, presetId: string | null) => void
  /**
   * Fires when the user clicks the crop button on an inline zone.
   *
   * `trackKey` uniquely identifies THIS zone instance (same key the engine
   * uses for vizRequests / trackSchedulers / trackAnalysers). Required so
   * callers can save the crop as a per-instance override instead of
   * overwriting the shared VizPreset — otherwise two $: blocks using the
   * same preset would clobber each other's crop.
   */
  onCrop?: (vizId: string, presetId: string | null, trackKey: string) => void
}

/** Default native canvas dimensions for sketches that don't override them.
 *  2:1 aspect (1200×600) — good generic default for most viz types. */
const DEFAULT_NATIVE: { w: number; h: number } = { w: 1200, h: 600 }
/** Hard cap on inline zone height to prevent runaway tall viz. */
export const MAX_ZONE_HEIGHT = 600
/** Minimum zone height so short crops are still visible. */
export const MIN_ZONE_HEIGHT = 80

function nativeSizeFor(preset: VizPreset | null): { w: number; h: number } {
  const s = preset?.nativeSize
  if (s && s.w > 0 && s.h > 0) return { w: s.w, h: s.h }
  return DEFAULT_NATIVE
}

/** Max render width so a wide-short native scaled to a tall resolution can't
 *  blow up the backing store (e.g. 1100×200 @ res 1024 → 5632 wide). */
const MAX_RENDER_WIDTH = 4096

/**
 * The render backing-store size for an inline zone (#261 follow-up): the
 * configured `inlineVizResolution` (project setting) is the render HEIGHT; width
 * is derived to PRESERVE the native aspect. The renderer draws at this size and
 * the existing layout STRETCHES it to the display rect (computeLayout uses the
 * unchanged `native`, which has the same aspect → identical zone height, crop,
 * and transform). So display/crop/drag are untouched; only the rendered pixel
 * resolution changes — lower = cheaper blit, higher = crisper. Aspect-preserved
 * is what guarantees "all current behaviours just work": render aspect == display
 * aspect → uniform stretch, no distortion.
 */
/** #2560 — the size an inline zone mounts this descriptor's renderer at, for
 *  the pre-Play warm-up (`inlineVizWarmup`), which must build it exactly as the
 *  zone would. */
export function inlineRenderSizeFor(descriptor: VizDescriptor): { w: number; h: number } {
  return renderSizeFor(descriptor.nativeSize ?? DEFAULT_NATIVE)
}

function renderSizeFor(native: { w: number; h: number }): { w: number; h: number } {
  const n = getInlineVizResolution()
  const aspect = native.h > 0 ? native.w / native.h : 1
  let h = n
  let w = Math.round(n * aspect)
  // Clamp the WIDE dimension while PRESERVING aspect (scale both) — capping width
  // alone would distort a wide-short native (e.g. 1100×200 @ res 1024 → 5632 wide
  // → clamped 4096 → 4:1, not 5.5:1), which changes the displayed zone height
  // (the canvas displays at its backing aspect). Aspect-preserve is the whole
  // contract: render aspect == native aspect → identical display/crop/zone.
  if (w > MAX_RENDER_WIDTH) {
    w = MAX_RENDER_WIDTH
    h = Math.round(MAX_RENDER_WIDTH / aspect)
  }
  return { w: Math.max(1, w), h: Math.max(1, h) }
}

/**
 * Compute inline zone height + canvas transform.
 *
 * The cropped region fills the zone width — scale zooms so that
 * cropW × nativeW maps to contentW. Zone height follows the crop's
 * aspect. This is the original WYSIWYG model: what the user picks in
 * the crop popup is exactly what appears inline, edge-to-edge.
 *
 *   scale = contentW / (cropW × nativeW)
 *   zoneH = cropH × nativeH × scale
 *   tx    = -cropX × nativeW × scale
 *   ty    = -cropY × nativeH × scale
 */
function computeLayout(
  contentW: number,
  native: { w: number; h: number },
  crop: CropRegion,
): { zoneH: number; scale: number; tx: number; ty: number } {
  const cropW = Math.max(0.01, crop.w)
  const cropH = Math.max(0.01, crop.h)
  const scale = contentW / (cropW * native.w)
  let zoneH = cropH * native.h * scale
  if (zoneH > MAX_ZONE_HEIGHT) {
    const clamped = MAX_ZONE_HEIGHT / (cropH * native.h)
    return {
      zoneH: MAX_ZONE_HEIGHT,
      scale: clamped,
      tx: -crop.x * native.w * clamped,
      ty: -crop.y * native.h * clamped,
    }
  }
  if (zoneH < MIN_ZONE_HEIGHT) zoneH = MIN_ZONE_HEIGHT
  return {
    zoneH,
    scale,
    tx: -crop.x * native.w * scale,
    ty: -crop.y * native.h * scale,
  }
}

/**
 * The layout for a zone whose height the USER has set, as opposed to one sized
 * by its content (#1433).
 *
 * The stored number is the user's INTENT. What gets rendered is derived from it
 * on every layout, and never written back — which is the whole point. The canvas
 * is width-bound: the cropped region fills the column, so it can never draw
 * taller than the fit-to-width height no matter how tall the zone is. Assigning
 * the intent straight to the zone therefore opened a gap between the bottom of
 * the canvas and the resize bar pinned to the zone's bottom edge — 180px while
 * dragging past the fit height, 124px after narrowing the editor, 410px after
 * switching to a viz with a different aspect ratio. All three observed.
 *
 * So: render at the smaller of what the user asked for and what the width
 * allows, and keep asking that question rather than answering it once.
 *
 *   display = min(intent, fit-to-width height)
 *
 * ⚠ Storing the DERIVED height instead — the shape this replaces — freezes one
 * editor width into the record. Narrow the editor once and the user's height is
 * gone for good, because the smaller number becomes the new intent. Deriving
 * costs nothing and survives a resize in both directions.
 *
 * ⚠ The MIN_ZONE_HEIGHT floor can still leave a gap, and that is deliberate and
 * pre-existing: `computeLayout` has always floored a very short crop to 80px so
 * it stays visible and clickable rather than collapsing to a sliver. Flush beats
 * tall, but usable beats flush.
 */
export function layoutForIntent(
  contentW: number,
  native: { w: number; h: number },
  crop: CropRegion,
  intentH: number | null | undefined,
): { zoneH: number; scale: number; tx: number; ty: number } {
  const fit = computeLayout(contentW, native, crop)
  if (intentH == null) return fit
  // Height of the cropped region at scale 1 — the divisor that turns a height
  // in px into a scale, and back.
  const denom = Math.max(0.01, crop.h) * native.h
  // `fit.scale` already carries computeLayout's MAX_ZONE_HEIGHT cap, so taking
  // the min with it bounds this above without repeating the clamp.
  const scale = Math.min(fit.scale, intentH / denom)
  return {
    zoneH: Math.max(MIN_ZONE_HEIGHT, denom * scale),
    scale,
    tx: -crop.x * native.w * scale,
    ty: -crop.y * native.h * scale,
  }
}

/**
 * Read the canvas's actual intrinsic dimensions. p5 sketches call
 * createCanvas(W, H) asynchronously after mount, often with dimensions that
 * differ from preset.nativeSize. The transform math MUST use the canvas's
 * actual size or the viz overflows the zone.
 *
 * Returns null if the canvas hasn't been created yet (first-frame pre-rAF).
 */
function readCanvasNative(container: HTMLElement): { w: number; h: number } | null {
  const canvas = container.querySelector<HTMLCanvasElement>('canvas')
  if (!canvas) return null
  // Use CSS display dimensions, NOT canvas.width/height (buffer size).
  // On HiDPI/Retina (devicePixelRatio > 1), p5 doubles the buffer for
  // sharp rendering: canvas.width = CSS_width × DPR. Transform math must
  // use the CSS size — buffer size halves the visual width on Retina.
  const w = canvas.offsetWidth | 0
  const h = canvas.offsetHeight | 0
  if (w <= 0 || h <= 0) return null
  return { w, h }
}

/**
 * Give a container-filling canvas a real, constant CSS size (#1439).
 *
 * `WorkerVizRenderer`, `GLSLVizRenderer` and `HydraVizRenderer` all style their
 * canvas `width:100%; height:100%`. That is correct for `mountVizRenderer`'s
 * seam — the picker, the backdrop and the crop preview all want a canvas that
 * fills its box. The inline seam works the other way round: `applyLayout` wraps
 * the canvas in a shrink-to-fit div and TRANSFORMS it down to the column, which
 * needs the canvas to have a size of its own to be scaled FROM.
 *
 * Without one, `readCanvasNative` reports the CONTAINER's size — the very layout
 * it is being used to compute. `scale` then comes out as exactly 1 at the width
 * where it was measured, which is not a healthy identity but the error being
 * cancelled by the measurement that caused it; at every other width the canvas
 * is shrunk twice. Measured before this change, at a 760px column: a canvas
 * already down to 403px was scaled by a further 0.386 to 156px, leaving 51.7px
 * of empty space with the resize bar floating at the bottom of it.
 *
 * The size to pin is the one the renderer was handed. `renderSizeFor` states the
 * contract exactly — "the renderer draws at this size and the existing layout
 * STRETCHES it to the display rect" — and a stretch needs a source rect. The
 * main-thread p5 path, which sets real pixel dimensions itself, has always
 * behaved this way and is correct at every width; pinning makes the two paths
 * run ONE arithmetic instead of adding a second.
 *
 * ⚠ Deliberately NOT in the renderers: they are shared with `mountVizRenderer`'s
 * seam, where `100%` is what makes the picker and backdrop fill their boxes.
 * This is the divergence `attachVizLifecycle`'s docblock already documents —
 * resize belongs to the call site, and so does sizing.
 *
 * ⚠ CONSTANT, which is what makes it cheap: the column's width changes and the
 * scale changes with it, but the canvas does not. Nothing has to maintain this
 * on resize, and no synchronous layout is forced onto the scroll path.
 */
function pinCanvasIntrinsicSize(
  container: HTMLElement,
  size: { w: number; h: number },
): void {
  // ⚠ ONLY a canvas INSIDE the transform wrapper — by construction the one the
  // scale acts on. The gate is a DOM fact, not a guess about mount timing.
  // A hydra or GLSL zone's live canvas is a SIBLING of the wrapper: the wrapper
  // sits empty at 0x0 while the canvas fills the container untransformed
  // (observed on trunk — a separate, pre-existing defect). Pinning THAT canvas
  // would give it a 2816px width inside a 1043px `overflow:hidden` container and
  // show only its top-left third. Selecting through the wrapper makes that
  // impossible on any machine and any mount order, rather than merely unlikely.
  const canvas = container.querySelector<HTMLCanvasElement>(
    '[data-viz-canvas-wrap] canvas',
  )
  if (!canvas) return
  // A renderer that sets real pixel dimensions (main-thread p5) is already
  // correct. Leave it alone — overwriting it would be the same mistake reversed.
  if (!canvas.style.width.endsWith('%')) return
  canvas.style.width = `${size.w}px`
  canvas.style.height = `${size.h}px`
}

/** Apply the computed transform to the canvas inside the container.
 *  `zoneH` is optional — when provided, the container height is re-asserted
 *  in case Monaco reflowed it; otherwise the caller's pre-set height stands.
 */
function applyLayout(
  container: HTMLElement,
  canvas: HTMLElement | null,
  layout: { scale: number; tx: number; ty: number; zoneH?: number },
  /** Render size to pin onto a container-filling canvas (#1439). Supplied by
   *  the inline seam, which knows what the renderer was asked to draw at.
   *  Applied HERE because this is where the wrapper is owned, so the pin cannot
   *  miss a canvas that appeared after some polling budget ran out. */
  pinSize?: { w: number; h: number },
): void {
  if (typeof layout.zoneH === 'number') {
    container.style.height = `${layout.zoneH}px`
  }
  // The canvas (or its wrapper) gets the transform. We wrap the canvas
  // in a positioned div so we can transform it without fighting any
  // inline styles the renderer might set. The wrapper auto-sizes from the
  // canvas's intrinsic display size — do NOT override with explicit dims
  // or canvas CSS stretch, as that breaks the crop transform math.
  let wrapper = container.querySelector<HTMLElement>('[data-viz-canvas-wrap]')
  if (!wrapper && canvas) {
    wrapper = document.createElement('div')
    wrapper.setAttribute('data-viz-canvas-wrap', '')
    wrapper.style.cssText = `position:absolute;top:0;left:0;transform-origin:0 0;`
    canvas.parentElement?.insertBefore(wrapper, canvas)
    wrapper.appendChild(canvas)
  }
  if (wrapper) {
    if (pinSize) pinCanvasIntrinsicSize(container, pinSize)
    wrapper.style.transform = `translate(${layout.tx}px, ${layout.ty}px) scale(${layout.scale})`
  }
}

function createFloatingActionBar(editorDom: HTMLElement): HTMLElement {
  const bar = document.createElement('div')
  bar.setAttribute('data-viz-actions', '')
  bar.style.cssText = `
    position:absolute;z-index:100;
    display:flex;gap:4px;
    opacity:0;transition:opacity 0.15s;
    pointer-events:none;
  `
  const btnCss = `
    background:var(--bg-elevated,#1e1e38);
    border:1px solid var(--border-strong,#3a3a5a);
    border-radius:3px;padding:2px 6px;
    color:var(--text-primary,#e8e8f0);
    font-size:var(--inline-viz-action-size,11px);cursor:pointer;
    font-family:system-ui,sans-serif;
    pointer-events:auto;
  `
  const blockMonaco = (el: HTMLElement) => {
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); e.stopImmediatePropagation() }, true)
    el.addEventListener('mouseup', (e) => { e.stopPropagation(); e.stopImmediatePropagation() }, true)
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.stopImmediatePropagation() }, true)
    el.addEventListener('pointerup', (e) => { e.stopPropagation(); e.stopImmediatePropagation() }, true)
  }
  const editBtn = document.createElement('button')
  editBtn.textContent = '\u270E'
  editBtn.title = 'Edit viz file'
  editBtn.style.cssText = btnCss
  blockMonaco(editBtn)
  bar.appendChild(editBtn)
  const cropBtn = document.createElement('button')
  cropBtn.textContent = '\u2702'
  cropBtn.title = 'Crop inline region'
  cropBtn.style.cssText = btnCss
  blockMonaco(cropBtn)
  bar.appendChild(cropBtn)
  const guard = editorDom.querySelector('.overflow-guard') || editorDom
  guard.appendChild(bar)
  return bar
}

interface ZoneEntry {
  zoneId: string
  /** The zone descriptor object passed to addZone — kept so we can mutate
   *  heightInPx and have Monaco pick up the new value on layoutZone. */
  zoneDesc: { afterLineNumber: number; heightInPx: number; domNode: HTMLElement; suppressMouseDown: boolean }
  afterLine: number
  container: HTMLElement
  canvas: HTMLCanvasElement | null
  trackKey: string
  vizId: string
  /** Renderer of the resolved descriptor ('p5' | 'hydra'). Kept so the async
   *  preset lookup matches by name AND renderer — two presets can share a base
   *  name across renderers (e.g. scope.p5 + scope.hydra), so a name-only match
   *  would resolve the crop preview to the wrong viz. */
  renderer: VizDescriptor['renderer']
  presetId: string | null
  native: { w: number; h: number }
  /** The size the renderer was asked to draw at. Pinned onto a canvas that has
   *  none of its own, so the transform has a real rect to scale from (#1439). */
  renderSize: { w: number; h: number }
  crop: CropRegion
  /** Decoration on the `.viz("<vizId>")` source line — the anchor that
   *  survives edits to surrounding blocks. Null when the call couldn't be
   *  located at mount time; in that case the zone falls back to static
   *  positioning until the next evaluate. */
  vizDecoration: Monaco.editor.IEditorDecorationsCollection | null
}

const FULL_CROP: CropRegion = { x: 0, y: 0, w: 1, h: 1 }

/**
 * Mirror of StrudelEngine.buildVizRequestsWithLines' block scanner, run
 * against the live editor buffer. Returns an ordered array where index N
 * is the 1-indexed afterLine for the Nth `$:` block. Used to re-anchor
 * zones as the user edits between evaluations.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find the source line (1-indexed) of the `.viz("<vizId>")` call for the
 * block whose end matches `targetAfterLine`. Returns null if no such block
 * / call combination exists (happens e.g. after the user deletes the call
 * or renames the viz). Called once per zone at mount time to plant the
 * decoration anchor — live re-anchor then reads the decoration's current
 * line instead of re-running this search.
 */
function findVizCallLineForBlock(
  code: string,
  vizId: string,
  targetAfterLine: number,
): number | null {
  const lines = code.split('\n')
  const vizPattern = new RegExp(
    `\\.viz\\s*\\(\\s*["\`']${escapeRegex(vizId)}["\`']\\s*\\)`,
  )
  for (let i = 0; i < lines.length; i++) {
    // Anonymous `$:` OR a named top-level track (`drums:`) — both are blocks the
    // engine's scan emits zones for (#725).
    if (!lines[i].trim().startsWith('$:') && !startsNamedTrack(lines[i])) continue
    let blockEnd = i
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim()
      // Same boundary predicate as the engine's scan (#569) — must agree, since
      // we match `blockEnd + 1` against the engine-computed `targetAfterLine`.
      if (startsTopLevelBlockRaw(lines[j])) break
      if (next !== '' && !next.startsWith('//')) blockEnd = j
    }
    if (blockEnd + 1 !== targetAfterLine) continue
    for (let k = i; k <= blockEnd; k++) {
      if (vizPattern.test(lines[k])) return k + 1
    }
  }
  return null
}

export function addInlineViewZones(
  editor: Monaco.editor.IStandaloneCodeEditor,
  components: Partial<EngineComponents>,
  vizDescriptors: VizDescriptor[],
  actions?: VizZoneActions,
  /**
   * When provided, per-zone crop overrides stored on the file take precedence
   * over `preset.cropRegion`. Without it, viewZones falls back to the preset
   * default (legacy behaviour).
   */
  fileId?: string,
): InlineZoneHandle {
  const vizRequests = components.inlineViz?.vizRequests
  if (!vizRequests || vizRequests.size === 0) {
    return { cleanup: () => {}, pause: () => {}, resume: () => {} }
  }

  const renderers: VizRenderer[] = []
  // #2560 — sketches the warm-up took over after Stop: cleanup must not destroy
  // them (the next Play's zones adopt them).
  const donated = new Set<VizRenderer>()
  const offers: ReuseOffer[] = []
  // Phase C (#258): one detach fn per zone — pauses the renderer while its zone is
  // scrolled off-screen / collapsed or the tab is hidden. The inline path does its
  // OWN mount (Monaco-layout reflow, teardown-wrap, crop, decorations) so it can't
  // route through mountVizRenderer; it shares the mount+visibility core via
  // `attachVizLifecycle` (the #260 choke point), then adds the inline-only bits.
  const visibilityCleanups: Array<() => void> = []
  const bufferedSchedulers: BufferedScheduler[] = []
  const zoneEntries: ZoneEntry[] = []

  const audioCtx = components.audio?.audioCtx

  editor.changeViewZones((accessor) => {
    for (const [trackKey, { vizId, afterLine, ...reqExtra }] of vizRequests) {
      const contentHash: string = (reqExtra as any).contentHash ?? ''
      const descriptor = resolveDescriptor(vizId, vizDescriptors)
      if (!descriptor) {
        console.warn(`[stave] Unknown viz "${vizId}". Available: ${vizDescriptors.map(d => d.id).join(', ')}`)
        continue
      }

      let trackScheduler = components.queryable?.trackSchedulers.get(trackKey) ?? null
      const trackStream = components.inlineViz?.trackStreams?.get(trackKey)
      if (!trackScheduler && trackStream && audioCtx) {
        const buffered = new BufferedScheduler(trackStream, audioCtx)
        bufferedSchedulers.push(buffered)
        trackScheduler = buffered
      }

      // Prefer the per-track AnalyserNode published by the engine. If it's
      // missing (producer not wired for this engine, e.g. Sonic Pi today — see
      // .planning/phases/T-track-analyser/T-03-PARKED-sonic-pi.md), fall back
      // to the global master-mix analyser so the viz still reacts to SOMETHING
      // rather than sitting dead. Previous code returned `undefined` whenever
      // a trackStream existed without a trackAnalyser, which silently severed
      // audio for every Sonic Pi inline viz.
      const trackAnalyser = components.audio?.trackAnalysers?.get(trackKey)
      const zoneAudio = trackAnalyser && audioCtx
        ? { analyser: trackAnalyser, audioCtx, trackAnalysers: components.audio?.trackAnalysers }
        : components.audio

      // Per-render viz options (`.pianoroll({...})` arg) ride alongside the
      // request and become `stave.options` for this zone's sketch (#214).
      const zoneOptions = (reqExtra as { options?: Record<string, unknown> }).options
      const zoneComponents: Partial<EngineComponents> = {
        ...components,
        ...(trackStream ? { streaming: { hapStream: trackStream } } : {}),
        audio: zoneAudio,
        queryable: {
          scheduler: trackScheduler,
          trackSchedulers: components.queryable?.trackSchedulers ?? new Map(),
        },
        options: zoneOptions ?? {},
      }

      // Start with the descriptor's intrinsic aspect (pianoroll declares a
      // taller one so pitch lanes aren't squashed, #214 follow-up) + full crop;
      // refined async once the preset's measured canvas size lands.
      const native = descriptor.nativeSize ?? DEFAULT_NATIVE
      // The backing store the renderer draws at, and — for a canvas with no size
      // of its own — the CSS size pinned onto it (#1439). Computed ONCE so the
      // mount, the refine and every recompute cannot disagree about it.
      const renderSize = renderSizeFor(native)
      const crop = FULL_CROP
      const contentW = editor.getLayoutInfo().contentWidth || 400
      // Apply persisted height override immediately so remounted zones
      // don't flash at the computed height before the async block corrects them.
      const initHOverride = fileId ? getZoneHeightOverride(fileId, trackKey) : undefined
      const layout = layoutForIntent(contentW, native, crop, initHOverride)
      const initH = layout.zoneH

      // #2560 — a sketch warmed up before Play: its container (and the renderer
      // mounted in it) becomes this zone's node. Otherwise build it now, as before.
      const warm = fileId ? takeWarmInlineViz(fileId, descriptor) : null
      const container = warm?.container ?? document.createElement('div')
      container.removeAttribute('data-viz-warm')
      // A sketch reused from the last Play's zone brings that zone's container:
      // drop the old zone's resize strip (its listener answers only to it).
      if (warm?.reused) container.querySelectorAll('[data-viz-zone-resize]').forEach((el) => el.remove())
      container.setAttribute('data-viz-zone', '')
      container.setAttribute('data-viz-zone-track', trackKey)
      container.setAttribute('data-viz-zone-id', vizId)
      if (contentHash) container.setAttribute('data-viz-zone-hash', contentHash)
      container.style.cssText = `overflow:hidden;height:${initH}px;position:relative;`

      const zoneDesc = {
        afterLineNumber: afterLine,
        heightInPx: initH,
        domNode: container,
        suppressMouseDown: true,
      }
      const zoneId = accessor.addZone(zoneDesc)

      // Mount the renderer at the configured render RESOLUTION (#261): height =
      // inlineVizResolution, width = aspect-preserved from `native`. The canvas
      // renders at this backing-store size; the layout below (computeLayout uses
      // the unchanged `native`) stretches it to the display rect — so display,
      // crop, and drag-resize are identical, only the rendered resolution changes.
      const makeInner = (): VizRenderer =>
        typeof descriptor.factory === 'function'
          ? descriptor.factory()
          : (descriptor.factory as VizRenderer)
      // #263 B — off-screen teardown: when enabled, wrap the renderer so a zone
      // left off-screen past the threshold is DESTROYED (reclaims ~60–110MB + a
      // WebGL-context slot, PV77) and re-created on scroll-back. The wrapper is a
      // STABLE VizRenderer (renderers[]/visibility ref never swap); it replays the
      // mount and calls back here to fix the inline DOM. `relayout` is assigned
      // after `entry` exists (it reads the zone's current native/crop/height).
      let relayout: () => void = () => {}
      const teardownMs = getInlineVizTeardownMs()
      let renderer: VizRenderer
      if (teardownMs > 0) {
        const wrapper = new TeardownOnPauseRenderer(makeInner, {
          // Drop the now-empty crop wrapper so reinit re-wraps the fresh canvas
          // (applyLayout only creates+fills the wrapper when none exists).
          onAfterTeardown: () => container.querySelector('[data-viz-canvas-wrap]')?.remove(),
          onAfterReinit: () => relayout(),
        })
        if (warm) wrapper.adoptMounted(warm.renderer, container, zoneComponents, renderSize, console.error)
        renderer = wrapper
      } else {
        renderer = warm?.renderer ?? makeInner()
      }
      renderers.push(renderer)
      {
        const zoneRenderer = renderer
        offers.push({
          descriptor,
          container,
          renderSize,
          claim: () => {
            if (donated.has(zoneRenderer)) return null
            donated.add(zoneRenderer)
            return zoneRenderer instanceof TeardownOnPauseRenderer ? zoneRenderer.release() : zoneRenderer
          },
        })
      }
      // Shared per-mount lifecycle (#260): mount + visibility pausing via the one
      // choke point. `onMountError` keeps the prior inline behaviour — log + carry
      // on (one bad zone must not abort the others) and still wire visibility.
      // A warm renderer is already mounted: it gets the live components instead.
      visibilityCleanups.push(
        attachVizLifecycle(renderer, container, zoneComponents, renderSize, console.error, {
          teardownMs,
          onMountError: (e) => console.error('[stave] viz mount failed:', e),
          adopted: warm !== null,
        }),
      )
      if (warm && (warm.renderSize.w !== renderSize.w || warm.renderSize.h !== renderSize.h)) {
        // the resolution setting moved since the warm-up
        renderer.resize(renderSize.w, renderSize.h)
      }
      // #2560 — Play waits (capped) for this sketch to finish loading.
      trackPatternVizLoad(renderer)

      // The renderer may create the canvas asynchronously (p5 defers
      // to rAF). Apply layout now if the canvas is already present,
      // and again on next rAF to catch async p5 mounts.
      const canvas = container.querySelector<HTMLCanvasElement>('canvas')
      applyLayout(container, canvas, layout, renderSize)
      requestAnimationFrame(() => {
        applyLayout(container, container.querySelector('canvas'), layout, renderSize)
      })

      // Plant a decoration on the .viz("<vizId>") source line so the zone
      // follows its block when other blocks are inserted or removed. Uses
      // NeverGrowsWhenTypingAtEdges stickiness so adjacent edits don't
      // stretch the anchor. If the call can't be found (unlikely —
      // vizRequests came from the engine scanning the same code), skip
      // decoration and the zone will stay static until next evaluate.
      let vizDecoration: Monaco.editor.IEditorDecorationsCollection | null = null
      const modelForMount = editor.getModel?.()
      if (modelForMount) {
        const vizLine = findVizCallLineForBlock(
          modelForMount.getValue(),
          vizId,
          afterLine,
        )
        if (vizLine !== null) {
          const maxCol = modelForMount.getLineMaxColumn?.(vizLine) ?? 1
          vizDecoration = editor.createDecorationsCollection([
            {
              range: {
                startLineNumber: vizLine,
                startColumn: 1,
                endLineNumber: vizLine,
                endColumn: maxCol,
              },
              options: { stickiness: 1 },
            },
          ])
        }
      }

      const entry: ZoneEntry = {
        zoneId, zoneDesc, afterLine, container, canvas, trackKey, vizId, renderer: descriptor.renderer, presetId: null, native, renderSize, crop, vizDecoration,
      }
      zoneEntries.push(entry)

      // Re-apply the inline layout transform to the freshly-created canvas after
      // an off-screen teardown→reinit (#263 B). Reads the zone's CURRENT
      // native/crop from `entry` and the stored INTENT from the override store,
      // so a crop or drag-resize done before the teardown is preserved on
      // return — same derivation as every other site (#1433).
      relayout = () => {
        const cw = editor.getLayoutInfo().contentWidth || 400
        // Read the INTENT from the store, not `heightInPx` — that now holds the
        // DERIVED height, and feeding a derived height back in as an intent is
        // how a width gets baked in one reinit at a time.
        const intentH = fileId ? getZoneHeightOverride(fileId, entry.trackKey) : undefined
        const l = layoutForIntent(cw, entry.native, entry.crop, intentH)
        // No zoneH: this runs outside `changeViewZones`, so setting the
        // container height here would desync Monaco's own record of it. The
        // height already IS this value — every site that sets it derives it the
        // same way — so re-asserting it buys nothing and risks that desync.
        applyLayout(entry.container, entry.container.querySelector('canvas'), l, entry.renderSize)
        // p5 (main path) creates its canvas async — re-apply next frame to catch it.
        requestAnimationFrame(() =>
          applyLayout(entry.container, entry.container.querySelector('canvas'), l, entry.renderSize),
        )
      }

      // ── The wrapper must keep holding the LIVE canvas (#1444) ──
      //
      // `applyLayout` wraps "the canvas" ONCE — it creates the wrapper only when
      // none exists — and from then on the TRANSFORM lives on the wrapper. That
      // holds for the whole life of a zone whose renderer never changes.
      //
      // It does not hold when a renderer is SWAPPED under a live zone.
      // `FallbackVizRenderer` hands over from the worker to the main thread when
      // the worker renderer fails: it destroys the worker renderer (which takes
      // its canvas out of the wrapper) and mounts a main-thread one, which
      // appends a FRESH canvas to the container — as the wrapper's SIBLING.
      // From that moment the transform scales an empty 0x0 div while the visible
      // canvas just fills its box, so crop and aspect are silently dropped and
      // the zone height is derived from a canvas reporting its own container.
      //
      // ⚠ MEASURED, not assumed: of hydra/glsl x worker on/off, THREE arms are
      // healthy — including both main-thread renderer classes. Only the fallback
      // handover breaks, so the renderer family is not the discriminator.
      //
      // `TeardownOnPauseRenderer` — the other place a renderer is swapped under a
      // live zone — already does exactly this via its onAfterTeardown +
      // onAfterReinit pair. The fallback path has no such callback and is built
      // deep inside the renderer factories, out of this seam's reach. So the
      // seam OBSERVES instead: the wrapper invariant belongs to whoever owns the
      // wrapper, which is this file, not a renderer that should never have to
      // know the selector exists.
      //
      // Acts only when the wrapper is genuinely EMPTY. A wrapper still holding a
      // canvas while another appears is not a state anything has produced, and
      // tearing a good wrapper down on a guess is how this seam grows its next
      // cause.
      const canvasWatcher = new MutationObserver((records) => {
        let orphan = false
        for (const r of records) {
          for (const n of Array.from(r.addedNodes)) {
            if (n instanceof HTMLCanvasElement && !n.closest('[data-viz-canvas-wrap]')) orphan = true
          }
        }
        if (!orphan) return
        const wrap = container.querySelector('[data-viz-canvas-wrap]')
        if (wrap?.querySelector('canvas')) return // wrapper still holds one — leave it alone
        wrap?.remove() // drop the empty shell so applyLayout re-wraps the live canvas
        relayout()
      })
      canvasWatcher.observe(container, { childList: true })
      visibilityCleanups.push(() => canvasWatcher.disconnect())

      // ── Resize handle (bottom edge) ──
      // Thin strip at the bottom of the zone — reveals on hover, drag
      // to resize the zone height. Persists via setZoneHeightOverride.
      const resizeHandle = document.createElement('div')
      resizeHandle.setAttribute('data-viz-zone-resize', '')
      resizeHandle.style.cssText = `
        position:absolute;bottom:0;left:0;right:0;height:6px;
        cursor:row-resize;z-index:50;
        background:transparent;transition:background 150ms;
      `
      resizeHandle.addEventListener('mouseenter', () => {
        resizeHandle.style.background = 'var(--accent-strong, #7c7cff)'
        resizeHandle.style.opacity = '0.6'
      })
      resizeHandle.addEventListener('mouseleave', () => {
        if (!resizeHandle.dataset.dragging) {
          resizeHandle.style.background = 'transparent'
          resizeHandle.style.opacity = '1'
        }
      })
      // Register in CAPTURE phase on the container so the handler
      // fires before Monaco's scrollable-element pointer capture.
      // The resize handle is identified by checking the event target.
      container.addEventListener('pointerdown', (e) => {
        if (e.target !== resizeHandle) return
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        // Capture the pointer so move/up events route here instead
        // of being swallowed by Monaco's setPointerCapture.
        resizeHandle.setPointerCapture(e.pointerId)
        resizeHandle.dataset.dragging = '1'
        entry.container.dataset.resizing = '1'
        const startY = e.clientY
        const startH = entry.zoneDesc.heightInPx
        const contentW = editor.getLayoutInfo().contentWidth || 400
        const onMove = (ev: PointerEvent) => {
          ev.preventDefault()
          const delta = ev.clientY - startY
          const intentH = Math.max(MIN_ZONE_HEIGHT, Math.min(MAX_ZONE_HEIGHT, startH + delta))
          // Derive here too, so the bar stops where the canvas stops instead of
          // running away from it. Dragging past the fit-to-width height now
          // meets a wall rather than opening a growing gap — and because the
          // height then doesn't change, the persist guard below stores nothing,
          // so a drag into the wall leaves no record of a size never shown.
          const l = layoutForIntent(contentW, entry.native, entry.crop, intentH)
          entry.container.style.height = `${l.zoneH}px`
          entry.zoneDesc.heightInPx = l.zoneH
          // Tell Monaco the zone height changed so lines below
          // reflow in real time (resizing flag prevents recomputeAllZones
          // from resetting the height).
          editor.changeViewZones((acc) => acc.layoutZone(entry.zoneId))
          applyLayout(entry.container, entry.container.querySelector('canvas'), l, entry.renderSize)
        }
        const onUp = (ev: PointerEvent) => {
          resizeHandle.releasePointerCapture(ev.pointerId)
          resizeHandle.removeEventListener('pointermove', onMove)
          resizeHandle.removeEventListener('pointerup', onUp)
          delete resizeHandle.dataset.dragging
          resizeHandle.style.background = 'transparent'
          resizeHandle.style.opacity = '1'
          // Persist ONLY if the gesture actually changed the height (#1438).
          // A press with no movement is not a resize, and an override is not a
          // passive record: it takes the zone OUT of the fit-to-width layout
          // permanently, so it stops tracking the editor width and the viz's
          // aspect ratio. Planting one by accident is how a zone ends up with
          // empty space under its canvas (#1433) without anyone resizing it.
          // Compared against `startH` rather than a "did onMove fire" flag: a
          // drag that wanders and returns to where it began has changed
          // nothing, and should leave nothing behind either.
          if (fileId && entry.zoneDesc.heightInPx !== startH) {
            const hash = entry.container.getAttribute('data-viz-zone-hash') ?? undefined
            setZoneHeightOverride(fileId, entry.trackKey, entry.zoneDesc.heightInPx, hash, entry.vizId)
          }
          // Keep resizing flag ON during changeViewZones so the
          // triggered recomputeAllZones skips this zone. Clear after.
          editor.changeViewZones((acc) => acc.layoutZone(entry.zoneId))
          delete entry.container.dataset.resizing
        }
        resizeHandle.addEventListener('pointermove', onMove)
        resizeHandle.addEventListener('pointerup', onUp)
      }, true)
      container.appendChild(resizeHandle)

      // p5's createCanvas(W, H) may pick dimensions that differ from the
      // preset's declared nativeSize. The transform math MUST use the
      // canvas's ACTUAL intrinsic size or the viz overflows its zone.
      // Poll via rAF for up to 10 frames (~170ms) — once the canvas
      // appears with non-zero dims, refine entry.native and recompute.
      let refineAttempts = 0
      const tryRefine = () => {
        refineAttempts++
        // Pin before measuring, so `readCanvasNative` reports the canvas rather
        // than the container it happens to be filling (#1439). Idempotent — once
        // pinned the canvas no longer reports a percentage.
        pinCanvasIntrinsicSize(entry.container, entry.renderSize)
        const actual = readCanvasNative(entry.container)
        if (actual && (actual.w !== entry.native.w || actual.h !== entry.native.h)) {
          entry.native = actual
          entry.canvas = entry.container.querySelector<HTMLCanvasElement>('canvas')
          const contentW = editor.getLayoutInfo().contentWidth || 400
          // Honour the stored intent here too. `computeLayout` alone ignores it,
          // so a zone with a saved height was re-fitted to its content the
          // moment the real canvas size landed — throwing the user's resize away
          // a few frames after mount, before they could see it had survived.
          const intentH = fileId ? getZoneHeightOverride(fileId, entry.trackKey) : undefined
          const refined = layoutForIntent(contentW, entry.native, entry.crop, intentH)
          editor.changeViewZones((acc) => {
            entry.zoneDesc.heightInPx = refined.zoneH
            entry.container.style.height = `${refined.zoneH}px`
            acc.layoutZone(entry.zoneId)
          })
          applyLayout(entry.container, entry.container.querySelector('canvas'), refined, entry.renderSize)
          return
        }
        if (refineAttempts < 10) requestAnimationFrame(tryRefine)
      }
      requestAnimationFrame(tryRefine)
    }
  })

  // ── Prune stale zone overrides ──
  // Remove overrides for trackKeys that no longer exist in vizRequests
  // (block removed / anonymous keys shifted) or whose vizId changed.
  if (fileId) {
    const currentViz = new Map<string, { vizId: string; contentHash?: string }>()
    for (const [trackKey, req] of vizRequests) {
      currentViz.set(trackKey, { vizId: req.vizId, contentHash: (req as any).contentHash })
    }
    pruneZoneOverrides(fileId, currentViz)
  }

  // ── Async: load presets and refine native size + crop ──
  const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '')
  void (async () => {
    try {
      const presets = await VizPresetStore.getAll()
      editor.changeViewZones((accessor) => {
        for (const entry of zoneEntries) {
          // Read the per-instance crop override FIRST — this must happen
          // regardless of whether a VizPreset exists in IDB. The preset
          // seed is async and may not have finished yet on first load;
          // gating the override behind `if (!preset) continue` caused
          // crops to silently fail when the race lost.
          const override = fileId ? getZoneCropOverride(fileId, entry.trackKey) : undefined

          const normViz = normalize(entry.vizId)
          // Match name AND renderer — a base name can exist for both renderers
          // (scope.p5 + scope.hydra); a name-only match would point the crop
          // preview at the wrong viz. Fall back to name-only if no renderer
          // match exists (older single-renderer presets).
          const preset =
            presets.find(p => normalize(p.name) === normViz && p.renderer === entry.renderer) ??
            presets.find(p => normalize(p.name) === normViz) ??
            null
          if (preset) {
            entry.presetId = preset.id
          }
          // Prefer the canvas's actual intrinsic size if it's already been
          // created — sketches author their own dimensions via createCanvas()
          // and those are what the transform math must use. Preset nativeSize
          // is the fallback when the canvas hasn't appeared yet.
          // Same pin as the refine path (#1439) — whichever lands first, the
          // measurement must not be the container's own size.
          pinCanvasIntrinsicSize(entry.container, entry.renderSize)
          const actual = readCanvasNative(entry.container)
          entry.native = actual ?? (preset ? nativeSizeFor(preset) : entry.native)
          entry.crop = override ?? preset?.cropRegion ?? FULL_CROP
          const contentW = editor.getLayoutInfo().contentWidth || 400
          // User height override (drag-to-resize) takes precedence; the
          // rendered height is derived from it against the CURRENT width.
          const intentH = fileId ? getZoneHeightOverride(fileId, entry.trackKey) : undefined
          const layout = layoutForIntent(contentW, entry.native, entry.crop, intentH)
          entry.zoneDesc.heightInPx = layout.zoneH
          entry.container.style.height = `${layout.zoneH}px`
          accessor.layoutZone(entry.zoneId)
          applyLayout(entry.container, entry.container.querySelector('canvas'), layout, entry.renderSize)
        }
      })
      // After heights change, Monaco repositions zones — ensure the
      // canvas still fills each container via transform reapplication.
      for (const entry of zoneEntries) {
        const contentW = editor.getLayoutInfo().contentWidth || 400
        const intentH = fileId ? getZoneHeightOverride(fileId, entry.trackKey) : undefined
        const layout = layoutForIntent(contentW, entry.native, entry.crop, intentH)
        entry.zoneDesc.heightInPx = layout.zoneH
        entry.container.style.height = `${layout.zoneH}px`
        applyLayout(entry.container, entry.container.querySelector('canvas'), layout, entry.renderSize)
      }
    } catch { /* ignore */ }
  })()

  // ── Recompute on layout + scroll ──
  // Monaco re-applies the original addZone heightInPx when a zone
  // re-enters the viewport after scrolling away. We must re-assert the
  // crop-adjusted height whenever layout changes OR the user scrolls.
  const recomputeAllZones = () => {
    editor.changeViewZones((accessor) => {
      for (const entry of zoneEntries) {
        if (entry.container.dataset.resizing) continue
        const contentW = editor.getLayoutInfo().contentWidth || 400
        // This is the path a WIDTH CHANGE arrives on, and the one that made
        // route B of #1433 visible: a height stored at one column width was
        // re-asserted verbatim at another, while the canvas re-fitted itself to
        // the new width. Deriving here is what keeps the two in step.
        const intentH = fileId ? getZoneHeightOverride(fileId, entry.trackKey) : undefined
        const layout = layoutForIntent(contentW, entry.native, entry.crop, intentH)
        entry.zoneDesc.heightInPx = layout.zoneH
        entry.container.style.height = `${layout.zoneH}px`
        accessor.layoutZone(entry.zoneId)
        applyLayout(entry.container, entry.container.querySelector('canvas'), layout, entry.renderSize)
      }
    })
  }
  const layoutChangeDisposable = editor.onDidLayoutChange?.(recomputeAllZones)
  const scrollDisposable = editor.onDidScrollChange?.(recomputeAllZones)

  // ── Live re-anchor on content edits ──
  // The engine computes `afterLine` from `lastEvaluatedCode`, so between
  // evaluations zones stay pinned to stale line numbers. As the user types
  // above/inside a $: block, its last line shifts but the zone stays put.
  // On every content change, rescan the model for $: block ends and move
  // any zone whose block has grown or shrunk. Matched by anonymous index
  // ($0/$1/…) against the existing trackKey — stable as long as block count
  // doesn't change, which is the common edit-within-block case. Block
  // count changes defer to the next evaluate (engine re-keys the map).
  const reAnchorZones = () => {
    const model = editor.getModel?.()
    if (!model) return
    const lines = model.getValue().split('\n')

    const changed: ZoneEntry[] = []
    for (const entry of zoneEntries) {
      // Decoration-based: the decoration follows its text through every
      // edit, so its current line is a reliable pointer to where .viz()
      // lives NOW. This replaces the earlier positional trackKey $N →
      // afterLines[N] mapping, which was fragile when other blocks were
      // added or removed. Zones without a decoration (call not found at
      // mount) stay static until the next evaluate.
      if (!entry.vizDecoration) continue
      const ranges = entry.vizDecoration.getRanges()
      if (ranges.length === 0) continue

      const vizLineIdx = ranges[0].startLineNumber - 1 // back to 0-indexed
      if (vizLineIdx < 0 || vizLineIdx >= lines.length) continue

      // Walk backward to the $: / named label that opens this block (#725).
      let blockStart = vizLineIdx
      while (
        blockStart >= 0 &&
        !lines[blockStart].trim().startsWith('$:') &&
        !startsNamedTrack(lines[blockStart])
      ) {
        blockStart--
      }
      if (blockStart < 0) continue // decoration sits above any block start, bail

      // Scan forward for the block's last non-empty, non-comment line.
      // Stop at the .viz() call — anything typed after it is new content,
      // not a block continuation. Without this, gibberish typed after
      // .viz() extends blockEnd and the zone drops below the gibberish.
      let blockEnd = blockStart
      let foundViz = false
      for (let j = blockStart; j < lines.length; j++) {
        const next = lines[j].trim()
        if (j > blockStart && startsTopLevelBlockRaw(lines[j])) break
        if (next !== '' && !next.startsWith('//')) blockEnd = j
        if (/\.viz\s*\(/.test(next)) { foundViz = true; blockEnd = j; break }
      }
      // If no .viz() found (deleted?), fall back to last non-empty line.
      if (!foundViz) {
        blockEnd = blockStart
        for (let j = blockStart + 1; j < lines.length; j++) {
          const next = lines[j].trim()
          if (startsTopLevelBlockRaw(lines[j])) break
          if (next !== '' && !next.startsWith('//')) blockEnd = j
        }
      }

      const newAfterLine = blockEnd + 1
      if (newAfterLine !== entry.afterLine) {
        entry.afterLine = newAfterLine
        entry.zoneDesc.afterLineNumber = newAfterLine
        changed.push(entry)
      }
    }

    if (changed.length === 0) return
    editor.changeViewZones((accessor) => {
      for (const entry of changed) {
        accessor.removeZone(entry.zoneId)
        entry.zoneId = accessor.addZone(entry.zoneDesc)
      }
    })
  }
  const contentChangeDisposable = editor.onDidChangeModelContent?.(reAnchorZones)

  // ── Floating action bar (unchanged from before) ──
  const editorDom = editor.getDomNode?.()
  let floatingBar: HTMLElement | null = null
  let mouseMoveDisposable: { dispose(): void } | null = null
  let scrollHitTestDisposable: { dispose(): void } | null = null

  if (editorDom && actions && (actions.onEdit || actions.onCrop)) {
    floatingBar = createFloatingActionBar(editorDom)
    const editBtn = floatingBar.children[0] as HTMLElement
    const cropBtn = floatingBar.children[1] as HTMLElement

    editBtn.onclick = (e) => {
      e.stopPropagation()
      const vizId = floatingBar?.getAttribute('data-viz-id')
      const presetId = floatingBar?.getAttribute('data-preset-id') || null
      if (vizId && actions.onEdit) actions.onEdit(vizId, presetId)
    }
    cropBtn.onclick = (e) => {
      e.stopPropagation()
      const vizId = floatingBar?.getAttribute('data-viz-id')
      const presetId = floatingBar?.getAttribute('data-preset-id') || null
      const trackKey = floatingBar?.getAttribute('data-track-key') || ''
      if (vizId && trackKey && actions.onCrop) actions.onCrop(vizId, presetId, trackKey)
    }

    // Track last mouse position so we can re-run hit-testing on scroll.
    // (Scrolling doesn't fire mouseMove, so without this the action bar
    // gets stuck visible after the zone scrolls away from the cursor.)
    let lastMouseX = -1
    let lastMouseY = -1
    const hitTestAndUpdateBar = () => {
      if (!floatingBar || lastMouseX < 0) return
      let found: ZoneEntry | null = null
      for (const entry of zoneEntries) {
        const rect = entry.container.getBoundingClientRect()
        if (lastMouseY >= rect.top && lastMouseY <= rect.bottom && lastMouseX >= rect.left && lastMouseX <= rect.right) {
          found = entry
          break
        }
      }
      if (found) {
        const rect = found.container.getBoundingClientRect()
        const guardRect = (editorDom.querySelector('.overflow-guard') || editorDom).getBoundingClientRect()
        // Cluster both action icons (edit + crop) together in the TOP-LEFT
        // corner of the zone (#710). Auto-width bar pinned to the left edge with
        // a small inset — the icons sit adjacent (gap:4px), not spread apart.
        const BAR_INSET = 6
        floatingBar.style.top = `${rect.top - guardRect.top + 4}px`
        floatingBar.style.left = `${rect.left - guardRect.left + BAR_INSET}px`
        floatingBar.style.width = 'auto'
        floatingBar.style.opacity = '1'
        floatingBar.style.pointerEvents = 'auto'
        floatingBar.setAttribute('data-viz-id', found.vizId)
        floatingBar.setAttribute('data-preset-id', found.presetId || '')
        floatingBar.setAttribute('data-track-key', found.trackKey)
      } else {
        floatingBar.style.opacity = '0'
        floatingBar.style.pointerEvents = 'none'
      }
    }
    mouseMoveDisposable = editor.onMouseMove?.((ev: Monaco.editor.IEditorMouseEvent) => {
      lastMouseX = ev.event.posx
      lastMouseY = ev.event.posy
      hitTestAndUpdateBar()
    }) ?? null
    // Re-hit-test when scrolling — zones move under a stationary cursor,
    // so the bar's visible state must be re-evaluated.
    scrollHitTestDisposable = editor.onDidScrollChange?.(hitTestAndUpdateBar) ?? null
  }

  const mouseLeaveHandler = () => {
    if (floatingBar) {
      floatingBar.style.opacity = '0'
      floatingBar.style.pointerEvents = 'none'
    }
  }
  editorDom?.addEventListener('mouseleave', mouseLeaveHandler)

  return {
    cleanup() {
      mouseMoveDisposable?.dispose?.()
      scrollHitTestDisposable?.dispose?.()
      layoutChangeDisposable?.dispose?.()
      scrollDisposable?.dispose?.()
      contentChangeDisposable?.dispose?.()
      editorDom?.removeEventListener('mouseleave', mouseLeaveHandler)
      floatingBar?.remove()
      visibilityCleanups.forEach(fn => fn())
      renderers.forEach(r => {
        // a wrapper whose inner was released destroys nothing; a plain donated
        // renderer belongs to the warm-up now
        if (donated.has(r) && !(r instanceof TeardownOnPauseRenderer)) return
        r.destroy()
      })
      bufferedSchedulers.forEach(s => s.dispose())
      editor.changeViewZones((accessor) => {
        zoneEntries.forEach(e => accessor.removeZone(e.zoneId))
      })
      zoneEntries.forEach(e => e.vizDecoration?.clear())
    },
    pause() { renderers.forEach(r => r.pause()) },
    resume() { renderers.forEach(r => r.resume()) },
    // a claimed offer answers null to a second claim
    offerForReuse: () => offers.slice(),
  }
}
