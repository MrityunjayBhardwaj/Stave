/**
 * threeSketch — run a plain three.js sketch inside a Stave viz (#2516).
 *
 * A `.three` file is an ordinary three.js script, the kind a tutorial or the
 * official examples hold, pasted unchanged. There is no Stave dialect: Stave adds
 * only `sig`, `stave.options` and `stave.width` / `stave.height`, the same names
 * p5 sketches get. Everything else a sketch reaches for in a browser page is
 * mapped onto the viz underneath:
 *
 *   | the sketch does                         | Stave makes it                          |
 *   |-----------------------------------------|-----------------------------------------|
 *   | `import … from 'three'` / addons        | the bundled three.js + a fixed addon set |
 *   | `new THREE.WebGLRenderer(…)`            | a renderer on the viz's own canvas       |
 *   | `document.body.appendChild(…)`          | a no-op (the canvas is already placed)   |
 *   | `innerWidth`, `devicePixelRatio`, resize| the viz's size, firing on panel resize   |
 *   | `requestAnimationFrame`, `setAnimationLoop` | driven by Stave's frame pump          |
 *   | `new THREE.TextureLoader().load(url)`   | an image-bitmap load in a worker         |
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

// ── the bundled modules ──────────────────────────────────────────────────────

/** Addons a sketch may import, keyed by their path under `three/addons/`. A
 *  literal `import()` per entry so the bundler splits each into its own chunk and
 *  a sketch loads only what it names. */
const ADDONS: Record<string, () => Promise<unknown>> = {
  'environments/RoomEnvironment.js': () => import('three/addons/environments/RoomEnvironment.js'),
  'postprocessing/EffectComposer.js': () => import('three/addons/postprocessing/EffectComposer.js'),
  'postprocessing/RenderPass.js': () => import('three/addons/postprocessing/RenderPass.js'),
  'postprocessing/ShaderPass.js': () => import('three/addons/postprocessing/ShaderPass.js'),
  'postprocessing/OutputPass.js': () => import('three/addons/postprocessing/OutputPass.js'),
  'postprocessing/UnrealBloomPass.js': () => import('three/addons/postprocessing/UnrealBloomPass.js'),
  'postprocessing/BokehPass.js': () => import('three/addons/postprocessing/BokehPass.js'),
  'postprocessing/AfterimagePass.js': () => import('three/addons/postprocessing/AfterimagePass.js'),
  'postprocessing/FilmPass.js': () => import('three/addons/postprocessing/FilmPass.js'),
  'postprocessing/GlitchPass.js': () => import('three/addons/postprocessing/GlitchPass.js'),
  'postprocessing/SMAAPass.js': () => import('three/addons/postprocessing/SMAAPass.js'),
  'postprocessing/FXAAPass.js': () => import('three/addons/postprocessing/FXAAPass.js'),
  'shaders/CopyShader.js': () => import('three/addons/shaders/CopyShader.js'),
  'shaders/FXAAShader.js': () => import('three/addons/shaders/FXAAShader.js'),
  'shaders/RGBShiftShader.js': () => import('three/addons/shaders/RGBShiftShader.js'),
  'shaders/VignetteShader.js': () => import('three/addons/shaders/VignetteShader.js'),
  'loaders/GLTFLoader.js': () => import('three/addons/loaders/GLTFLoader.js'),
  'loaders/RGBELoader.js': () => import('three/addons/loaders/RGBELoader.js'),
  'loaders/HDRLoader.js': () => import('three/addons/loaders/HDRLoader.js'),
  'loaders/EXRLoader.js': () => import('three/addons/loaders/EXRLoader.js'),
  'geometries/RoundedBoxGeometry.js': () => import('three/addons/geometries/RoundedBoxGeometry.js'),
  'utils/BufferGeometryUtils.js': () => import('three/addons/utils/BufferGeometryUtils.js'),
  'math/SimplexNoise.js': () => import('three/addons/math/SimplexNoise.js'),
  'math/ImprovedNoise.js': () => import('three/addons/math/ImprovedNoise.js'),
}

/** The addon paths a sketch may import, for messages and tests. */
export const THREE_ADDONS: readonly string[] = Object.keys(ADDONS)

/** Addons that exist in three.js but need something a viz doesn't have. */
const NEEDS_INPUT = /(^|\/)(OrbitControls|TrackballControls|FlyControls|FirstPersonControls|PointerLockControls|DragControls|TransformControls|MapControls|ArcballControls)\.js$/

/** `'three'`, an addon path (`'three/addons/…'` or the older `'three/examples/jsm/…'`),
 *  or null when the specifier is outside the bundle. */
function resolveSpecifier(spec: string): { kind: 'three' } | { kind: 'addon'; path: string } | null {
  if (spec === 'three') return { kind: 'three' }
  const m = /^three\/(?:addons|examples\/jsm)\/(.+)$/.exec(spec)
  if (!m) return null
  const path = m[1].endsWith('.js') ? m[1] : `${m[1]}.js`
  return { kind: 'addon', path }
}

/** Why a specifier can't load, in words a sketch author can act on. */
function unsupportedImportMessage(spec: string): string {
  const resolved = resolveSpecifier(spec)
  if (resolved?.kind === 'addon' && NEEDS_INPUT.test(resolved.path)) {
    return `'${spec}' needs pointer input, which a Stave viz doesn't receive. Move the camera in code instead (for example from \`sig\` or the time).`
  }
  return `'${spec}' isn't available in Stave. A three.js sketch can import 'three' and these addons: ${THREE_ADDONS.map((p) => `three/addons/${p}`).join(', ')}.`
}

/** An import the sketch names that Stave can't provide, with the line it's on. */
export class ThreeImportError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(message)
    this.name = 'ThreeImportError'
  }
}

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
}

let threePromise: Promise<any> | null = null
function loadThree(): Promise<any> {
  threePromise ??= import('three')
  return threePromise
}

/** Load three.js and every addon the sketch imports. An import outside the
 *  bundle rejects with a {@link ThreeImportError} on its line. */
export async function loadThreeModules(compiled: CompiledThreeSketch): Promise<ThreeModules> {
  for (const imp of compiled.imports) {
    const r = resolveSpecifier(imp.spec)
    if (!r || (r.kind === 'addon' && !ADDONS[r.path])) {
      throw new ThreeImportError(unsupportedImportMessage(imp.spec), imp.line)
    }
  }
  const THREE = await loadThree()
  const modules = await Promise.all(
    compiled.imports.map((imp) => {
      const r = resolveSpecifier(imp.spec)!
      return r.kind === 'three' ? null : ADDONS[(r as { path: string }).path]()
    }),
  )
  return { THREE, modules }
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
  /** A fresh canvas for `document.createElement('canvas')` (canvas textures). */
  createCanvas(): HTMLCanvasElement | OffscreenCanvas
  /** A problem in the sketch, located in the user's file when the stack allows. */
  report(entry: { level: 'error' | 'warn'; message: string; line?: number; column?: number; stack?: string }): void
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
  /** Did the last `frame` render (a `renderer.render`, directly or via a composer)? */
  rendered(): boolean
  /** The host changed size: fire the sketch's `resize` listeners, or resize its
   *  renderers itself when it registered none. */
  resize(): void
  /** The live WebGL context of the sketch's first renderer, or null. */
  gl(): WebGLRenderingContext | WebGL2RenderingContext | null
  /** Stop the loop, dispose every renderer and lose its context. Idempotent. */
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
  let disposed = false
  let topLevelDone = false
  let renderedThisFrame = false
  const renderers: any[] = []
  const loops = new Map<any, (t: number, frame?: unknown) => void>()
  let rafQueue = new Map<number, (t: number) => void>()
  let rafSeq = 0
  const resizeListeners = new Set<(ev: unknown) => void>()
  const seen = new Set<string>()

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
  })

  const importDynamic = async (spec: string): Promise<unknown> => {
    const r = resolveSpecifier(String(spec))
    if (r?.kind === 'three') return THREE
    if (r?.kind === 'addon' && ADDONS[r.path]) return ADDONS[r.path]()
    throw new ThreeImportError(unsupportedImportMessage(String(spec)))
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

  return {
    done,
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
      loops.clear()
      rafQueue.clear()
      resizeListeners.clear()
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
