/**
 * hostModules — the modules Stave itself provides (#2637, #2638): three.js and
 * every addon under `three/addons/`, each loaded on first use. The first link
 * of the import chain (resolver.ts).
 *
 * They are always Stave's own copy, never fetched: a sketch and a library that
 * ask for the same module get the same object (a library reaches them through
 * the shim modules in hostShims.ts). That matters because a three.js library
 * registers things on the three it imports; on a second copy it renders
 * nothing (measured with Spark: `Can not resolve #include <splatDefines>`).
 */

import type { ImportChain, ImportResolver, ResolvedImport } from './resolver'
import {
  THREE_ADDON_LOADERS,
  THREE_ADDONS_LEFT_OUT,
  THREE_ADDONS_VERSION,
} from './threeAddons.generated'

/** Every addon under `three/addons/`, one lazy chunk each (#2638), generated
 *  from three's own folder by scripts/gen-three-addons.mjs. */
const ADDONS = THREE_ADDON_LOADERS

/** The addon paths a sketch may import, for messages and tests. */
export const THREE_ADDONS: readonly string[] = Object.keys(ADDONS)

/** Addons that exist in three.js but need something a viz doesn't have. */
const NEEDS_INPUT = /(^|\/)(OrbitControls|TrackballControls|FlyControls|FirstPersonControls|PointerLockControls|DragControls|TransformControls|MapControls|ArcballControls)\.js$/

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** `'three'`, an addon path (`'three/addons/…'` or the older `'three/examples/jsm/…'`),
 *  or null when the specifier names neither. */
export function parseThreeSpecifier(spec: string): { kind: 'three' } | { kind: 'addon'; path: string } | null {
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

/** The canonical name of a host module (`'three'` or `'three/addons/<path>.js'`),
 *  or null when `spec` isn't one Stave provides. The pointer-input controls are
 *  not provided: a viz receives no input, so they are refused with a reason. */
export function hostModuleName(spec: string): string | null {
  const r = parseThreeSpecifier(spec)
  if (!r) return null
  if (r.kind === 'three') return 'three'
  if (NEEDS_INPUT.test(r.path)) return null
  return has(ADDONS, r.path) ? `three/addons/${r.path}` : null
}

/** Stave's namespace for a name from {@link hostModuleName}. */
export function loadHostModule(name: string): Promise<unknown> {
  if (name === 'three') return loadThree()
  return ADDONS[name.slice('three/addons/'.length)]()
}

/** The host link: `'three'` and every addon. */
export const hostResolver: ImportResolver = {
  name: 'host',
  resolve(spec): ResolvedImport | null {
    const name = hostModuleName(spec)
    if (!name) return null
    if (name === 'three') return { kind: 'three' }
    return { kind: 'module', load: () => loadHostModule(name) }
  },
}

/** Why a specifier can't load, in words a sketch author can act on. */
export function unsupportedImportMessage(spec: string): string {
  const parsed = parseThreeSpecifier(spec)
  if (parsed?.kind === 'addon') {
    if (NEEDS_INPUT.test(parsed.path)) {
      return `'${spec}' needs pointer input, which a Stave viz doesn't receive. Move the camera in code instead (for example from \`sig\` or the time).`
    }
    if (has(THREE_ADDONS_LEFT_OUT, parsed.path)) return `'${spec}' can't be loaded in Stave: ${THREE_ADDONS_LEFT_OUT[parsed.path]}.`
    return `'${spec}' isn't a three.js addon: three.js ${THREE_ADDONS_VERSION} has no file 'three/addons/${parsed.path}'.`
  }
  return `'${spec}' isn't available in Stave. A three.js sketch can import 'three' and any 'three/addons/…' file.`
}

/** The chain with only Stave's own modules. */
export const HOST_CHAIN: ImportChain = {
  links: [hostResolver],
  refusal: unsupportedImportMessage,
}
