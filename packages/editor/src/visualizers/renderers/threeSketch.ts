/**
 * threeSketch — run a plain three.js sketch inside a Stave viz (#2516).
 *
 * A `.three` file is an ordinary three.js script, the kind a tutorial or the
 * official examples hold, pasted unchanged. There is no Stave dialect: Stave adds
 * only `sig`, `stave.options`, `stave.width` / `stave.height` and
 * `stave.scheduler` (#2570: `.now()` and `.query(begin, end)` over the notes
 * around now, the same as p5's), the same names p5 sketches get. Everything else a sketch reaches for in a browser page is
 * mapped onto the viz underneath:
 *
 *   | the sketch does                         | Stave makes it                          |
 *   |-----------------------------------------|-----------------------------------------|
 *   | `import … from 'three'` / addons        | the bundled three.js + any of its addons |
 *   | `import … from '<library>'`             | the project's stave.libs.json (#2639)    |
 *   | `new THREE.WebGLRenderer(…)`            | a renderer on the viz's own canvas       |
 *   | `document.body.appendChild(…)`          | a no-op (the canvas is already placed)   |
 *   | `innerWidth`, `devicePixelRatio`, resize| the viz's size, firing on panel resize   |
 *   | `requestAnimationFrame`, `setAnimationLoop` | driven by Stave's frame pump          |
 *   | `new THREE.TextureLoader().load(url)`   | an image-bitmap load in a worker         |
 *   | `new Worker`, `URL.createObjectURL`, `setInterval` | ended when it stops (#2641)   |
 *
 * Prior art, read from source: the three.js editor's player (`editor/js/libs/
 * app.js`) runs scripts through `new Function` and drives the loop from the host;
 * Fragment's `THREERenderer.js` wraps `renderer.render` to know the sketch drew,
 * and on teardown calls `dispose` + `forceContextLoss` whatever the sketch did.
 * three's `WebGLRenderer` defines its methods per instance in the constructor
 * (`this.render = function …`, WebGLRenderer.js), so they are wrapped after
 * `super()`, never overridden on a subclass prototype (an override there would be
 * shadowed by the instance property).
 *
 * This module is shared by the worker host (`hostVizWorker`, kind `'three'`) and
 * the main-thread `ThreeVizRenderer`; it never touches the DOM itself, the host
 * hands it the canvas and a way to make more.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { parseModule } from '../../codeView'
import { VizSyntaxError } from '../vizSyntaxError'
import { parseStackLocation } from '../../engine/friendlyErrors'
import type { StaveUniforms } from '../p5Compiler'
import type { IRPattern } from '../../codeView'
import { HOST_CHAIN, loadThree } from '../libraries/hostModules'
import { resolveOrRefuse, ThreeImportError, type ImportChain } from '../libraries/resolver'

// ── where imports come from: the resolver chain (libraries/resolver.ts) ─────────

export { THREE_ADDONS } from '../libraries/hostModules'
export { ThreeImportError } from '../libraries/resolver'

// ── compile: rewrite imports, keep every line where the author wrote it ────────

interface ImportBinding {
  /** Index into the module array the sketch receives. */
  readonly module: number
  /** `default`, `*` (the namespace), or an exported name. */
  readonly imported: string
  readonly local: string
}

export interface CompiledThreeSketch {
  /** Each module specifier the sketch imports, in order, with its line. */
  readonly imports: readonly { spec: string; line: number }[]
  /** The sketch body handed to `new Function`. */
  readonly source: string
  /** Set when the code doesn't parse; nothing runs. */
  readonly syntaxError: VizSyntaxError | null
}

/**
 * The lines `new Function` puts before the sketch's first line: V8 renders it as
 * `function anonymous(__env,__mod,__import\n) {\n` + body, and the body opens with
 * one line of Stave's (the `with`, the async wrapper and every import binding). A
 * stack line minus this is the line in the user's file.
 */
export const THREE_LINE_OFFSET = 3

const PARAMS = ['__env', '__mod', '__import'] as const

function isIdent(s: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(s)
}

/**
 * Parse a sketch as an ES module and turn it into a function body. Static
 * imports are blanked in place (newlines kept, so line numbers don't move) and
 * their bindings declared up front on the wrapper's one line, which also keeps
 * module semantics: imports are bound before any statement runs. `export`
 * keywords are dropped; a dynamic `import(…)` goes through Stave's resolver.
 */
export function compileThreeSketch(code: string): CompiledThreeSketch {
  const parsed = parseModule(code)
  if (!parsed.ok) {
    return {
      imports: [],
      source: '',
      syntaxError: new VizSyntaxError(parsed.message, parsed.line, parsed.column !== undefined ? parsed.column + 1 : undefined),
    }
  }
  const ast = parsed.program

  const chars = code.split('')
  const blank = (start: number, end: number): void => {
    for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = ' '
  }
  const imports: { spec: string; line: number }[] = []
  const bindings: ImportBinding[] = []

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      const index = imports.length
      imports.push({ spec: String(node.source.value), line: node.loc.start.line })
      for (const s of node.specifiers) {
        if (s.type === 'ImportDefaultSpecifier') bindings.push({ module: index, imported: 'default', local: s.local.name })
        else if (s.type === 'ImportNamespaceSpecifier') bindings.push({ module: index, imported: '*', local: s.local.name })
        else {
          const imported = s.imported.type === 'Identifier' ? s.imported.name : String(s.imported.value)
          bindings.push({ module: index, imported, local: s.local.name })
        }
      }
      blank(node.start, node.end)
    } else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
      if (node.declaration) blank(node.start, node.declaration.start)
      else blank(node.start, node.end)
    } else if (node.type === 'ExportAllDeclaration') {
      blank(node.start, node.end)
    }
  }

  // Dynamic `import(x)` → `__import(x)`. Walk the tree; the keyword is the first
  // six characters of the node. Replacing them in place keeps every line.
  const dynamic: number[] = []
  const walk = (n: any): void => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ImportExpression') dynamic.push(n.start)
    for (const key of Object.keys(n)) {
      const v = n[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v)
    }
  }
  walk(ast)
  for (const at of dynamic) {
    chars[at] = '__import'
    for (let i = at + 1; i < at + 6; i++) chars[i] = ''
  }

  const decls = bindings.map((b) => {
    const from = `__mod[${b.module}]`
    if (b.imported === '*') return `const ${b.local} = ${from};`
    const key = isIdent(b.imported) ? `.${b.imported}` : `[${JSON.stringify(b.imported)}]`
    return `const ${b.local} = ${from}${key};`
  })
  const head = `with (__env) { return (async () => { 'use strict'; ${decls.join(' ')}`
  const source = `${head}\n${chars.join('')}\n})() }`
  return { imports, source, syntaxError: null }
}

// ── load the modules a sketch names ───────────────────────────────────────────

export interface ThreeModules {
  /** The three.js namespace (unpatched — each run patches its own copy). */
  readonly THREE: any
  /** One entry per `CompiledThreeSketch.imports`; `null` marks `'three'` itself. */
  readonly modules: readonly (unknown | null)[]
  /** Where the sketch's dynamic `import(x)` resolves (the chain its static imports
   *  went through). Stave's own modules when absent. */
  readonly chain?: ImportChain
}

/** Load three.js and every module the sketch imports, each through `chain`
 *  (Stave's own modules unless told otherwise). An import no link knows rejects
 *  with a {@link ThreeImportError} on its line, before anything loads. */
export async function loadThreeModules(compiled: CompiledThreeSketch, chain: ImportChain = HOST_CHAIN): Promise<ThreeModules> {
  const resolved = compiled.imports.map((imp) => resolveOrRefuse(chain, imp.spec, imp.line))
  const THREE = await loadThree()
  const modules = await Promise.all(
    resolved.map((r, i) =>
      r.kind === 'three'
        ? null
        : r.load().catch((e: unknown) => {
            // A library that fails to load (#2639) is placed on the line that imports it.
            if (e instanceof ThreeImportError && e.line === undefined) throw new ThreeImportError(e.message, compiled.imports[i].line)
            throw e
          }),
    ),
  )
  return { THREE, modules, chain }
}

// ── run ────────────────────────────────────────────────────────────────────────

/** What the host gives a running sketch. All reads are live. */
export interface ThreeSketchHost {
  /** The canvas the sketch's renderer draws on (the viz's own). */
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  size(): { w: number; h: number }
  dpr(): number
  uniforms(): StaveUniforms
  options(): Record<string, unknown>
  /** `stave.scheduler` (#2570): the worker's pre-queried window (now−4 … now+2
   *  cycles) or, on the main-thread fallback, the live scheduler. Null before
   *  the first evaluate. */
  scheduler(): IRPattern | null
  /** A fresh canvas for `document.createElement('canvas')` (canvas textures). */
  createCanvas(): HTMLCanvasElement | OffscreenCanvas
  /** A problem in the sketch, located in the user's file when the stack allows. */
  report(entry: { level: 'error' | 'warn'; message: string; line?: number; column?: number; stack?: string }): void
  /** #2641 — this sketch is the only one running in this JavaScript realm (the
   *  viz worker hosts one at a time). Then the workers and blob URLs made through
   *  the realm's own `Worker` and `URL.createObjectURL` while it runs are its too,
   *  including those of the libraries it imports, and go when it stops. Leave it
   *  unset on the main thread, where Stave's own code shares the realm. */
  readonly ownsRealm?: boolean
}

export interface ThreeSketchRun {
  /** Settles once the sketch's top level has finished (it may `await`). Never
   *  rejects: a failure resolves with the error, already reported. */
  readonly done: Promise<{ error: Error | null }>
  /** Run one frame: queued `requestAnimationFrame` callbacks, then each
   *  `setAnimationLoop` callback. An error in a callback is reported, not thrown. */
  frame(timeMs: number): void
  /** True once the sketch has a loop, a queued frame, or has finished its top level. */
  ready(): boolean
  /** #2560 — settles once the sketch has LOADED: its top level finished and no
   *  three.js loader item is still in flight (`DefaultLoadingManager`). A model
   *  or HDRI loaded with a callback (`new GLTFLoader().load(url, cb)`) keeps it
   *  open until the callback has run, so the work the callback does (building
   *  meshes from the model) is part of the load. Never rejects; settles at once
   *  after `dispose`. */
  whenLoaded(): Promise<void>
  /** Did the last `frame` render (a `renderer.render`, directly or via a composer)? */
  rendered(): boolean
  /** The host changed size: fire the sketch's `resize` listeners, or resize its
   *  renderers itself when it registered none. */
  resize(): void
  /** The live WebGL context of the sketch's first renderer, or null. */
  gl(): WebGLRenderingContext | WebGL2RenderingContext | null
  /** Stop the loop, dispose every renderer and lose its context, and end the
   *  workers, blob URLs and intervals the sketch left running (#2641). Idempotent. */
  dispose(): void
}

const INPUT_EVENTS = new Set([
  'pointerdown', 'pointerup', 'pointermove', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout', 'pointercancel',
  'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'click', 'dblclick',
  'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'keydown', 'keyup', 'keypress',
])

/** The user's line for an error thrown from sketch code, or undefined. */
export function threeUserLine(err: unknown): { line: number; column: number } | undefined {
  const loc = parseStackLocation(err)
  if (!loc) return undefined
  const line = loc.line - THREE_LINE_OFFSET
  return line >= 1 ? { line, column: loc.column } : undefined
}

function errorOf(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

/** Loader items in flight per `LoadingManager` (#2560). Counted by wrapping the
 *  manager's own `itemStart` / `itemEnd` (instance properties, LoadingManager.js:86,
 *  :110), once per manager; three calls `itemEnd` after `itemError` too, so the
 *  pair always balances. A worker hosts one sketch, so there the count is that
 *  sketch's; sketches sharing the main thread share it, and one then waits for
 *  the other's loads too (the main thread is the fallback path). */
interface LoadTracker {
  pending: number
  readonly idle: Set<() => void>
}
const loadTrackers = new WeakMap<object, LoadTracker>()

function trackLoads(manager: any): LoadTracker | null {
  if (!manager || typeof manager.itemStart !== 'function' || typeof manager.itemEnd !== 'function') return null
  const known = loadTrackers.get(manager)
  if (known) return known
  const t: LoadTracker = { pending: 0, idle: new Set() }
  const start = manager.itemStart
  const end = manager.itemEnd
  manager.itemStart = function (this: unknown, url: string) {
    t.pending++
    return start.call(this, url)
  }
  manager.itemEnd = function (this: unknown, url: string) {
    if (t.pending > 0) t.pending--
    const r = end.call(this, url)
    if (t.pending === 0) for (const fn of [...t.idle]) fn()
    return r
  }
  loadTrackers.set(manager, t)
  return t
}

// ── what a sketch starts that outlives its renderer (#2641) ─────────────────────

/** Workers, blob URLs and intervals a sketch started and hasn't ended itself. A
 *  pooled viz worker and the main thread both outlive one sketch, and a recompile
 *  is a new sketch, so whatever is left here when it stops would pile up. A
 *  pending `setTimeout` is not ended: it fires once, so a top level awaiting one
 *  still finishes, but a stopped sketch can't start another (that ends a
 *  `setTimeout` chain). */
interface SketchLedger {
  readonly workers: Set<Worker>
  readonly blobs: Set<string>
  readonly intervals: Set<unknown>
  closed: boolean
}

function newLedger(): SketchLedger {
  return { workers: new Set(), blobs: new Set(), intervals: new Set(), closed: false }
}

/** End everything still in the ledger. Idempotent; later arrivals are ended on sight. */
function closeLedger(l: SketchLedger): void {
  l.closed = true
  for (const w of l.workers) {
    try {
      w.terminate()
    } catch {
      /* ignore */
    }
  }
  l.workers.clear()
  for (const u of l.blobs) {
    try {
      URL.revokeObjectURL(u)
    } catch {
      /* ignore */
    }
  }
  l.blobs.clear()
  for (const id of l.intervals) clearInterval(id as any)
  l.intervals.clear()
}

/** Which ledger a worker was entered in, so its own `terminate()` takes it out. */
const workerLedger = new WeakMap<object, SketchLedger>()

function enterWorker(l: SketchLedger, w: Worker): void {
  if (l.closed) {
    w.terminate()
    return
  }
  l.workers.add(w)
  workerLedger.set(w, l)
}

function enterBlob(l: SketchLedger, url: string): void {
  if (l.closed) URL.revokeObjectURL(url)
  else l.blobs.add(url)
}

/** The ledger of the sketch that owns this realm (`ownsRealm`), if one is running. */
let realmLedger: SketchLedger | null = null
let realmPatched = false

/** Once per realm: route the realm's own `Worker` and `URL.createObjectURL` past
 *  {@link realmLedger}, so code the sketch doesn't compile itself (the libraries
 *  it imports) is counted too. With no owning sketch they pass straight through. */
function patchRealm(): void {
  if (realmPatched) return
  realmPatched = true
  const G = globalThis as any
  const NativeWorker = G.Worker
  if (typeof NativeWorker === 'function') {
    G.Worker = class TrackedWorker extends NativeWorker {
      constructor(...args: unknown[]) {
        super(...args)
        if (realmLedger) enterWorker(realmLedger, this as unknown as Worker)
      }
      terminate(): void {
        workerLedger.get(this)?.workers.delete(this as unknown as Worker)
        super.terminate()
      }
    }
  }
  const U = G.URL
  if (U && typeof U.createObjectURL === 'function') {
    const create = U.createObjectURL
    const revoke = U.revokeObjectURL
    U.createObjectURL = function (obj: Blob | MediaSource): string {
      const url = create.call(U, obj)
      if (realmLedger) enterBlob(realmLedger, url)
      return url
    }
    U.revokeObjectURL = function (url: string): void {
      realmLedger?.blobs.delete(url)
      revoke.call(U, url)
    }
  }
}

/** The `Worker`, `URL`, `setTimeout` and `setInterval` a sketch's own code sees: the real
 *  ones, with each thing made entered in `l`. */
function trackedGlobals(l: SketchLedger): Record<string, unknown> {
  const G = globalThis as any
  const out: Record<string, unknown> = {}
  const BaseWorker = G.Worker
  if (typeof BaseWorker === 'function') {
    out.Worker = class TrackedWorker extends BaseWorker {
      constructor(...args: unknown[]) {
        super(...args)
        enterWorker(l, this as unknown as Worker)
      }
      terminate(): void {
        l.workers.delete(this as unknown as Worker)
        super.terminate()
      }
    }
  }
  const BaseURL = G.URL
  if (typeof BaseURL === 'function') {
    out.URL = class TrackedURL extends BaseURL {
      static createObjectURL(obj: Blob | MediaSource): string {
        const url = BaseURL.createObjectURL(obj)
        enterBlob(l, url)
        return url
      }
      static revokeObjectURL(url: string): void {
        l.blobs.delete(url)
        BaseURL.revokeObjectURL(url)
      }
    }
  }
  out.setTimeout = (fn: unknown, ms?: number, ...args: unknown[]): unknown =>
    l.closed ? 0 : G.setTimeout(fn, ms, ...args)
  out.setInterval = (fn: unknown, ms?: number, ...args: unknown[]): unknown => {
    if (l.closed) return 0
    const id = G.setInterval(fn, ms, ...args)
    l.intervals.add(id)
    return id
  }
  out.clearInterval = (id: unknown): void => {
    l.intervals.delete(id)
    G.clearInterval(id)
  }
  return out
}

/**
 * Start a compiled sketch against `host`. The sketch's top level runs now (it is
 * async, so it may `await` loaders); frames run when the host calls `frame`.
 */
export function runThreeSketch(
  compiled: CompiledThreeSketch,
  loaded: ThreeModules,
  host: ThreeSketchHost,
): ThreeSketchRun {
  const BaseRenderer = loaded.THREE.WebGLRenderer
  // Before the top level runs, so the loads it starts are counted (#2560).
  const loads = trackLoads(loaded.THREE.DefaultLoadingManager)
  let disposed = false
  let topLevelDone = false
  let renderedThisFrame = false
  const renderers: any[] = []
  const loops = new Map<any, (t: number, frame?: unknown) => void>()
  let rafQueue = new Map<number, (t: number) => void>()
  let rafSeq = 0
  const resizeListeners = new Set<(ev: unknown) => void>()
  const seen = new Set<string>()
  // #2641 — before the top level runs, so the first worker it starts is counted.
  const ledger = newLedger()
  if (host.ownsRealm) {
    patchRealm()
    realmLedger = ledger
  }
  const tracked = trackedGlobals(ledger)

  const reportOnce = (level: 'error' | 'warn', e: unknown, prefix = ''): void => {
    const err = errorOf(e)
    const at = threeUserLine(err)
    const key = `${level}|${err.message}|${at?.line ?? ''}`
    if (seen.has(key)) return
    if (seen.size > 64) seen.clear()
    seen.add(key)
    host.report({
      level,
      message: prefix + err.message,
      line: at?.line,
      column: at?.column,
      stack: String(err.stack ?? '').split('\n').slice(0, 6).join('\n'),
    })
  }
  /** A warning about something the sketch tried, placed on the line that tried it. */
  const warnHere = (message: string): void => reportOnce('warn', new Error(message))

  const warnInput = (type: string): void =>
    warnHere(`'${type}' events don't reach a three.js sketch in Stave (a viz receives no pointer or keyboard input). Move things in code instead.`)
  const warnDom = (): void =>
    warnHere(`HTML overlays (panels, stats meters, text) aren't shown in Stave: a three.js sketch draws only on its canvas.`)

  const addListener = (type: string, fn: unknown): void => {
    if (type === 'resize' && typeof fn === 'function') resizeListeners.add(fn as (ev: unknown) => void)
    else if (INPUT_EVENTS.has(type)) warnInput(type)
  }
  const removeListener = (type: string, fn: unknown): void => {
    if (type === 'resize') resizeListeners.delete(fn as (ev: unknown) => void)
  }

  // ── the renderer: three's own, on the viz canvas, its loop on Stave's pump ──
  const canvas = host.canvas as any
  // three writes `canvas.style.width` in setSize; an OffscreenCanvas has no style.
  if (!('style' in canvas)) canvas.style = {}
  const canvasAddListener = canvas.addEventListener
  let canvasPatched = false

  class StaveWebGLRenderer extends BaseRenderer {
    constructor(params: Record<string, unknown> = {}) {
      if (disposed) throw new Error('this sketch was stopped')
      super({ ...params, canvas: host.canvas })
      const self = this as any
      renderers.push(self)
      // Instance methods (see the header): wrap after super().
      const render = self.render
      self.render = function (scene: unknown, camera: unknown) {
        renderedThisFrame = true
        return render.call(self, scene, camera)
      }
      // Stave places the canvas and sizes its box; the sketch sets only how many
      // pixels it renders. three's setSize also writes `canvas.style.width/height`
      // (updateStyle defaults to true), which on the main thread would pin the
      // host's `100%` canvas to a fixed px size.
      const setSize = self.setSize
      self.setSize = function (w: number, h: number) {
        return setSize.call(self, w, h, false)
      }
      self.setAnimationLoop = (cb: ((t: number, frame?: unknown) => void) | null) => {
        if (typeof cb === 'function') loops.set(self, cb)
        else loops.delete(self)
      }
      // Input listeners the sketch puts on the canvas never fire: say so. three's
      // own (context loss) were added inside super(), before this patch.
      if (!canvasPatched && typeof canvasAddListener === 'function') {
        canvasPatched = true
        canvas.addEventListener = function (type: string, ...rest: unknown[]) {
          if (INPUT_EVENTS.has(type)) warnInput(type)
          return canvasAddListener.call(canvas, type, ...rest)
        }
      }
    }
  }

  // A worker has no `document`, so three's TextureLoader (an <img> underneath)
  // can't load there. Load through ImageBitmapLoader instead; an ImageBitmap
  // ignores UNPACK_FLIP_Y, so flip at decode and clear the texture's flag.
  let TextureLoader = loaded.THREE.TextureLoader
  if (typeof document === 'undefined' && loaded.THREE.ImageBitmapLoader) {
    const { Loader, Texture, ImageBitmapLoader } = loaded.THREE
    TextureLoader = class StaveTextureLoader extends Loader {
      load(url: string, onLoad?: (t: unknown) => void, onProgress?: unknown, onError?: (e: unknown) => void) {
        const texture = new Texture()
        const loader = new ImageBitmapLoader(this.manager)
        loader.setOptions({ imageOrientation: 'flipY' })
        loader.setCrossOrigin(this.crossOrigin)
        loader.setPath(this.path)
        loader.load(
          url,
          (bitmap: unknown) => {
            texture.image = bitmap
            texture.flipY = false
            texture.needsUpdate = true
            onLoad?.(texture)
          },
          onProgress,
          onError,
        )
        return texture
      }
    }
  }

  const THREE = { ...loaded.THREE, WebGLRenderer: StaveWebGLRenderer, TextureLoader }
  const modules = loaded.modules.map((m) => (m === null ? THREE : m))

  // ── the page a sketch thinks it is in ──
  const requestAnimationFrame = (cb: (t: number) => void): number => {
    const id = ++rafSeq
    if (!disposed && typeof cb === 'function') rafQueue.set(id, cb)
    return id
  }
  const cancelAnimationFrame = (id: number): void => {
    rafQueue.delete(id)
  }
  const stave = {
    get width() {
      return host.size().w
    },
    get height() {
      return host.size().h
    },
    get options() {
      return host.options()
    },
    get scheduler() {
      return host.scheduler()
    },
    get sig() {
      return host.uniforms().sig
    },
  }
  const stubElement = (): any => {
    warnDom()
    const el: any = {
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild: (c: unknown) => c,
      removeChild: (c: unknown) => c,
      remove() {},
      setAttribute() {},
      getAttribute: () => null,
      addEventListener: addListener,
      removeEventListener: removeListener,
      textContent: '',
      innerHTML: '',
    }
    return el
  }
  const createElement = (tag: string): unknown =>
    String(tag).toLowerCase() === 'canvas' ? host.createCanvas() : stubElement()
  const body = {
    style: {},
    appendChild: (c: unknown) => c,
    removeChild: (c: unknown) => c,
    addEventListener: addListener,
    removeEventListener: removeListener,
  }
  const documentShim = {
    body,
    documentElement: body,
    createElement,
    createElementNS: (_ns: string, tag: string) => createElement(tag),
    getElementById: () => null,
    querySelector: () => null,
    addEventListener: addListener,
    removeEventListener: removeListener,
  }
  const own: Record<string, unknown> = {}
  Object.defineProperties(own, {
    innerWidth: { get: () => host.size().w, enumerable: true },
    innerHeight: { get: () => host.size().h, enumerable: true },
    devicePixelRatio: { get: () => host.dpr(), enumerable: true },
  })
  Object.assign(own, {
    addEventListener: addListener,
    removeEventListener: removeListener,
    requestAnimationFrame,
    cancelAnimationFrame,
    document: documentShim,
    ...tracked,
  })
  // `window.x` for anything not mapped reads the real global, bound so natives
  // (fetch, setTimeout) keep their receiver.
  const boundCache = new Map<PropertyKey, unknown>()
  const windowShim: any = new Proxy(own, {
    get(t, key) {
      if (key in t) return (t as any)[key]
      if (key === 'window' || key === 'self' || key === 'globalThis') return windowShim
      const v = (globalThis as any)[key]
      if (typeof v !== 'function') return v
      if (/^[A-Z]/.test(String(key))) return v // a constructor: keep it constructible as is
      if (!boundCache.has(key)) boundCache.set(key, v.bind(globalThis))
      return boundCache.get(key)
    },
    has(t, key) {
      return key in t || key in globalThis
    },
  })
  const env: Record<string, unknown> = {}
  Object.defineProperties(env, {
    innerWidth: { get: () => host.size().w },
    innerHeight: { get: () => host.size().h },
    devicePixelRatio: { get: () => host.dpr() },
    sig: { get: () => host.uniforms().sig },
  })
  Object.assign(env, {
    stave,
    window: windowShim,
    self: windowShim,
    document: documentShim,
    requestAnimationFrame,
    cancelAnimationFrame,
    addEventListener: addListener,
    removeEventListener: removeListener,
    ...tracked,
  })

  const chain = loaded.chain ?? HOST_CHAIN
  const importDynamic = async (spec: string): Promise<unknown> => {
    const r = resolveOrRefuse(chain, String(spec))
    return r.kind === 'three' ? THREE : r.load()
  }

  // ── the top level ──
  let done: Promise<{ error: Error | null }>
  try {
    const fn = new Function(...PARAMS, compiled.source) as (...a: unknown[]) => Promise<unknown>
    done = Promise.resolve(fn(env, modules, importDynamic)).then(
      () => {
        topLevelDone = true
        return { error: null }
      },
      (e) => {
        topLevelDone = true
        if (!disposed) reportOnce('error', e)
        return { error: errorOf(e) }
      },
    )
  } catch (e) {
    // `new Function` itself failed: compileThreeSketch parsed the code, so this is
    // the engine disagreeing with acorn. Report it with no line.
    topLevelDone = true
    const err = errorOf(e)
    host.report({ level: 'error', message: err.message })
    done = Promise.resolve({ error: err })
  }

  // #2560 — loaded = the top level finished AND no loader item is in flight.
  // When the count reaches zero it is read again a task later: a load callback
  // that starts the next load from a timer or a promise is not yet done.
  let loadedPromise: Promise<void> | null = null
  const whenLoadedOnce = (): Promise<void> => {
    if (loadedPromise) return loadedPromise
    loadedPromise = done.then(
      () =>
        new Promise<void>((resolve) => {
          const idle = (): boolean => disposed || !loads || loads.pending === 0
          const check = (): void => {
            if (!idle()) return
            setTimeout(() => {
              if (!idle()) return
              loads?.idle.delete(check)
              resolve()
            }, 0)
          }
          loads?.idle.add(check)
          check()
        }),
    )
    return loadedPromise
  }
  const settleOnDispose: Array<() => void> = []

  return {
    done,
    whenLoaded: () =>
      disposed
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            settleOnDispose.push(resolve)
            void whenLoadedOnce().then(resolve)
          }),
    ready: () => topLevelDone || loops.size > 0 || rafQueue.size > 0,
    rendered: () => renderedThisFrame,
    frame(timeMs: number) {
      if (disposed) return
      renderedThisFrame = false
      const queued = rafQueue
      rafQueue = new Map()
      for (const cb of queued.values()) {
        try {
          cb(timeMs)
        } catch (e) {
          reportOnce('error', e)
        }
      }
      for (const cb of [...loops.values()]) {
        try {
          cb(timeMs)
        } catch (e) {
          reportOnce('error', e)
        }
      }
    },
    resize() {
      if (disposed) return
      if (resizeListeners.size > 0) {
        const ev = { type: 'resize', target: windowShim }
        for (const fn of [...resizeListeners]) {
          try {
            fn(ev)
          } catch (e) {
            reportOnce('error', e)
          }
        }
        return
      }
      const { w, h } = host.size()
      for (const r of renderers) {
        try {
          r.setSize(w, h, false)
        } catch {
          /* a renderer mid-teardown — ignore */
        }
      }
    },
    gl() {
      try {
        return renderers[0]?.getContext?.() ?? null
      } catch {
        return null
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const fn of settleOnDispose.splice(0)) fn()
      loops.clear()
      rafQueue.clear()
      resizeListeners.clear()
      // #2641 — the workers, blob URLs and intervals it left running.
      closeLedger(ledger)
      if (realmLedger === ledger) realmLedger = null
      for (const r of renderers) {
        try {
          r.dispose()
        } catch {
          /* ignore */
        }
        try {
          const gl = r.getContext?.()
          if (gl && !gl.isContextLost?.()) r.forceContextLoss()
        } catch {
          /* ignore */
        }
      }
      renderers.length = 0
      if (canvasPatched) {
        try {
          delete canvas.addEventListener
        } catch {
          /* ignore */
        }
      }
    },
  }
}
