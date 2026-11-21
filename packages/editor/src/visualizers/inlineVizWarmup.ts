/**
 * inlineVizWarmup — build the pattern's inline `.viz()` sketches hidden, before
 * Play (#2560).
 *
 * An inline viz used to be built only at Play (`addInlineViewZones` calls the
 * descriptor's `factory()`), so a heavy sketch — a three.js scene loading a 4K
 * HDRI and a model — spent its first seconds of the song frozen while it set up.
 * The code already says which sketches the pattern uses, so they are built
 * earlier: while the transport is stopped, each inline viz the code asks for
 * (`readInlineVizNames`) gets a renderer mounted into a container parked in a
 * hidden, off-screen host, paused, and marked as a warm-up so the worker draws
 * one frame once the sketch has loaded (its shaders compile now, not at Play).
 * At Play `addInlineViewZones` ADOPTS the warm renderer: the very container it
 * was mounted into becomes the zone's DOM node, so every renderer that captured
 * its container (the fallback, the off-screen teardown wrapper) keeps a valid one.
 *
 * Hidden by construction: the host is `visibility:hidden` and off-screen, and the
 * renderer is paused, so warming shows nothing — a track's own viz still appears
 * only on Play (the user's rule, #2455).
 *
 * Only sketches the code names warm up, and a sketch the code no longer names is
 * destroyed at the next `warmInlineViz` for that file. Entries are matched by
 * descriptor, or — when the registry rebuilt the descriptor from unchanged code —
 * by the source key the registry recorded (`setVizDescriptorSource`).
 *
 * ⚠ AND BY THE OPTIONS IT WAS MOUNTED WITH (#2630). A sketch may read
 * `stave.options` once, when its code runs at mount: a hydra sketch's
 * `s.solid(o.r, o.g, o.b)` takes plain numbers. Mounted with an empty bag and
 * adopted at Play, such a sketch kept drawing its defaults, and the zone's later
 * options update reached a slot nothing read again. So a sketch warms with the
 * options its code writes (when they are literal), records them, and Play adopts
 * it only when the zone's options are the same; otherwise Play builds it fresh,
 * as it did before the warm-up.
 */
import type { VizDescriptor, VizRenderer } from './types'
import { resolveDescriptor } from './resolveDescriptor'

/**
 * A stopped zone's sketch offered for the next Play (#2560). After Stop the zone
 * keeps its paused renderer on screen (its last frame); building a warm copy
 * beside it would hold a heavy sketch twice. Instead the warm-up claims it: the
 * zone stops owning it (its cleanup at Play will not destroy it) and the next
 * Play's zone adopts it, so Play still starts at once and nothing new is shown.
 */
export interface ReuseOffer {
  readonly descriptor: VizDescriptor
  /** the options the zone's sketch was mounted and last updated with */
  readonly options: Readonly<Record<string, unknown>>
  readonly container: HTMLDivElement
  readonly renderSize: { w: number; h: number }
  /** Take the renderer; null when the zone no longer holds a live one. */
  claim(): VizRenderer | null
}

export interface WarmInlineViz {
  readonly vizId: string
  readonly descriptor: VizDescriptor
  readonly renderer: VizRenderer
  /** The container the renderer was mounted into; adopted as the zone's node. */
  readonly container: HTMLDivElement
  readonly renderSize: { w: number; h: number }
  /** `optionsKey` of the options it was mounted with (#2630). */
  readonly optionsKey: string
  /** Reused from a stopped zone (`ReuseOffer`): its container is still that
   *  zone's node on screen, so it is never removed from here. */
  readonly reused?: boolean
}

/** One inline viz the code asks for: its name and the options its code writes
 *  (null when only an evaluation can tell; it then warms with none, and Play
 *  adopts it only if the zone gets none either). */
export interface WarmRequest {
  readonly vizId: string
  readonly options: Readonly<Record<string, unknown>> | null
}

/**
 * A key that two equal options bags share, whatever their key order (#2630).
 * Values that JSON cannot write (a function, a Pattern a string turned into)
 * make a key no other bag has, so such a sketch is never adopted on a guess.
 */
let unkeyable = 0
export function optionsKey(options: Readonly<Record<string, unknown>> | null | undefined): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted)
    if (v && typeof v === 'object') {
      if (Object.getPrototypeOf(v) !== Object.prototype) throw new Error('not plain data')
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]))
    }
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') throw new Error('not plain data')
    return v
  }
  try {
    return JSON.stringify(sorted(options ?? {}))
  } catch {
    return `unkeyable:${++unkeyable}`
  }
}

const byFile = new Map<string, WarmInlineViz[]>()
const descriptorSource = new WeakMap<VizDescriptor, string>()
let host: HTMLDivElement | null = null

/** Record what a descriptor was compiled from (renderer + code), so a descriptor
 *  rebuilt from the SAME code still matches its warm renderer. */
export function setVizDescriptorSource(descriptor: VizDescriptor, key: string): void {
  descriptorSource.set(descriptor, key)
}

function sameSketch(a: VizDescriptor, b: VizDescriptor): boolean {
  if (a === b) return true
  const ka = descriptorSource.get(a)
  return ka !== undefined && ka === descriptorSource.get(b)
}

/** The hidden, off-screen parking place for warm containers. */
function warmHost(): HTMLDivElement {
  if (host && host.isConnected) return host
  host = document.createElement('div')
  host.setAttribute('data-viz-warm-host', '')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText =
    'position:fixed;left:-100000px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none;'
  document.body.appendChild(host)
  return host
}

function destroyEntry(e: WarmInlineViz): void {
  try {
    e.renderer.destroy()
  } catch {
    /* a renderer's teardown failure must not stop the others */
  }
  if (!e.reused) e.container.remove()
}

function build(
  vizId: string,
  descriptor: VizDescriptor,
  size: { w: number; h: number },
  options: Readonly<Record<string, unknown>>,
): WarmInlineViz | null {
  if (typeof document === 'undefined') return null
  // A descriptor whose factory is a shared INSTANCE (not a function) can't be
  // built twice; leave it to Play, as before.
  if (typeof descriptor.factory !== 'function') return null
  let renderer: VizRenderer
  try {
    renderer = descriptor.factory()
  } catch {
    return null // the zone reports it at Play, where it always did
  }
  renderer.markWarmUp?.()
  const container = document.createElement('div')
  container.setAttribute('data-viz-warm', vizId)
  container.style.cssText = `position:relative;overflow:hidden;width:${size.w}px;height:${size.h}px;`
  warmHost().appendChild(container)
  try {
    renderer.mount(container, { options: { ...options } }, size, (e) => console.error('[stave] viz warm-up:', e))
    renderer.pause()
  } catch (e) {
    console.error('[stave] viz warm-up mount failed:', e)
    try {
      renderer.destroy()
    } catch {
      /* ignore */
    }
    container.remove()
    return null
  }
  return { vizId, descriptor, renderer, container, renderSize: { ...size }, optionsKey: optionsKey(options) }
}

/**
 * Make the warm set for `fileId` match `requests` (one per track that shows an
 * inline viz): keep the warm renderers still asked for with the same options,
 * build the missing ones, destroy the rest. Names that resolve to no descriptor are skipped (a viz file
 * not registered — e.g. a gallery file nobody agreed to run — never warms).
 */
export function warmInlineViz(
  fileId: string,
  requests: readonly WarmRequest[],
  descriptors: VizDescriptor[],
  sizeFor: (descriptor: VizDescriptor) => { w: number; h: number },
  /** #2560 — sketches held by this file's stopped zones, taken before building
   *  a copy (see `ReuseOffer`). */
  offers: readonly ReuseOffer[] = [],
): void {
  const pool = [...(byFile.get(fileId) ?? [])]
  const unclaimed = [...offers]
  const keep: WarmInlineViz[] = []
  for (const { vizId, options } of requests) {
    const descriptor = resolveDescriptor(vizId, descriptors)
    if (!descriptor) continue
    const wanted = options ?? {}
    const key = optionsKey(wanted)
    const i = pool.findIndex((e) => sameSketch(e.descriptor, descriptor) && e.optionsKey === key)
    if (i >= 0) {
      keep.push(pool.splice(i, 1)[0])
      continue
    }
    const o = unclaimed.findIndex((x) => sameSketch(x.descriptor, descriptor) && optionsKey(x.options) === key)
    if (o >= 0) {
      const offer = unclaimed.splice(o, 1)[0]
      const renderer = offer.claim()
      if (renderer) {
        keep.push({ vizId, descriptor, renderer, container: offer.container, renderSize: { ...offer.renderSize }, optionsKey: key, reused: true })
        continue
      }
    }
    const built = build(vizId, descriptor, sizeFor(descriptor), wanted)
    if (built) keep.push(built)
  }
  for (const e of pool) destroyEntry(e)
  if (keep.length > 0) byFile.set(fileId, keep)
  else byFile.delete(fileId)
}

/**
 * Take (and remove from the warm set) a warm renderer for this file's sketch, or
 * null when none is warm with these `options` (#2630: a sketch warmed with other
 * options is left for `releaseWarmInlineViz`, and Play builds a fresh one). The
 * caller owns it from here: it re-parents the container and eventually destroys
 * the renderer.
 */
export function takeWarmInlineViz(
  fileId: string,
  descriptor: VizDescriptor,
  options: Readonly<Record<string, unknown>>,
): WarmInlineViz | null {
  const list = byFile.get(fileId)
  if (!list) return null
  const key = optionsKey(options)
  const i = list.findIndex((e) => sameSketch(e.descriptor, descriptor) && e.optionsKey === key)
  if (i < 0) return null
  const [entry] = list.splice(i, 1)
  if (list.length === 0) byFile.delete(fileId)
  return entry
}

/** Destroy every warm renderer for `fileId` (the file closed, or Play adopted
 *  what it needed and the rest is surplus). */
export function releaseWarmInlineViz(fileId: string): void {
  const list = byFile.get(fileId)
  if (!list) return
  byFile.delete(fileId)
  for (const e of list) destroyEntry(e)
}

/** How many warm renderers are held (for one file, or all). */
export function warmInlineVizCount(fileId?: string): number {
  if (fileId !== undefined) return byFile.get(fileId)?.length ?? 0
  let n = 0
  for (const list of byFile.values()) n += list.length
  return n
}

/** Tests only. */
export function __resetInlineVizWarmupForTests(): void {
  for (const id of Array.from(byFile.keys())) releaseWarmInlineViz(id)
  host?.remove()
  host = null
}
