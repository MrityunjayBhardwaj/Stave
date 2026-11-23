/**
 * hostModules — the modules Stave itself provides to a sketch (#2637): three.js
 * and the addons bundled with it. The first link of the import chain
 * (resolver.ts).
 */

import type { ImportChain, ImportResolver } from './resolver'

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
 *  or null when the specifier names neither. */
function parseThreeSpecifier(spec: string): { kind: 'three' } | { kind: 'addon'; path: string } | null {
  if (spec === 'three') return { kind: 'three' }
  const m = /^three\/(?:addons|examples\/jsm)\/(.+)$/.exec(spec)
  if (!m) return null
  const path = m[1].endsWith('.js') ? m[1] : `${m[1]}.js`
  return { kind: 'addon', path }
}

let threePromise: Promise<any> | null = null // eslint-disable-line @typescript-eslint/no-explicit-any
/** Stave's one three.js namespace (unpatched). */
export function loadThree(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  threePromise ??= import('three')
  return threePromise
}

/** The host link: `'three'` and the bundled addons. */
export const hostResolver: ImportResolver = {
  name: 'host',
  resolve(spec) {
    const r = parseThreeSpecifier(spec)
    if (!r) return null
    if (r.kind === 'three') return { kind: 'three' }
    return Object.prototype.hasOwnProperty.call(ADDONS, r.path) ? { kind: 'module', load: ADDONS[r.path] } : null
  },
}

/** Why a specifier can't load, in words a sketch author can act on. */
export function unsupportedImportMessage(spec: string): string {
  const parsed = parseThreeSpecifier(spec)
  if (parsed?.kind === 'addon' && NEEDS_INPUT.test(parsed.path)) {
    return `'${spec}' needs pointer input, which a Stave viz doesn't receive. Move the camera in code instead (for example from \`sig\` or the time).`
  }
  return `'${spec}' isn't available in Stave. A three.js sketch can import 'three' and these addons: ${THREE_ADDONS.map((p) => `three/addons/${p}`).join(', ')}.`
}

/** The chain with only Stave's own modules. */
export const HOST_CHAIN: ImportChain = {
  links: [hostResolver],
  refusal: unsupportedImportMessage,
}
