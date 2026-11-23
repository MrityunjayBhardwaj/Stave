/**
 * hostShims — Stave's own modules as importable URLs, for code Stave fetches (#2638).
 *
 * three.js and its addons are part of Stave's bundle, so they have no URL a
 * fetched library could import, and import maps can't give them one: measured,
 * a page's import map resolves `'three'` on the main thread while the same
 * page's module worker refuses it in Chromium, Firefox and WebKit.
 *
 * So each host module a library imports is exposed as a generated module whose
 * body only re-exports the namespace Stave already loaded:
 *
 *   const m = globalThis.__staveHostModules["three"];
 *   const __0 = m["ACESFilmicToneMapping"]; …
 *   export { __0 as ACESFilmicToneMapping, … };
 *
 * The library's `import … from 'three'` is rewritten to that module's URL
 * (instantiate.ts), so it gets the very objects the sketch gets: one three.js,
 * shared. It works the same in the sketch worker and on the main thread, since
 * it reads only `globalThis`.
 */

import { hostModuleName, loadHostModule } from './hostModules'

/** Where the generated modules find the namespaces, per realm (worker or page). */
export const HOST_REGISTRY_KEY = '__staveHostModules'

type Registry = Record<string, unknown>

function registry(): Registry {
  const g = globalThis as unknown as Record<string, Registry | undefined>
  let r = g[HOST_REGISTRY_KEY]
  if (!r) {
    r = Object.create(null) as Registry
    Object.defineProperty(globalThis, HOST_REGISTRY_KEY, { value: r, enumerable: false, configurable: false, writable: false })
  }
  return r
}

/** Turns module source into a URL `import()` accepts. */
export type ModuleUrlMaker = (source: string) => string

export const blobModuleUrl: ModuleUrlMaker = (source) =>
  URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))

/** For hosts without blob URLs (Node, jsdom): a `data:` URL carries the source itself. */
export const dataModuleUrl: ModuleUrlMaker = (source) =>
  `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`

export function defaultModuleUrlMaker(): ModuleUrlMaker {
  return typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
    ? blobModuleUrl
    : dataModuleUrl
}

const IDENT = /^[A-Za-z_$][\w$]*$/

/** The source of a module that re-exports every export of `ns`, read from
 *  `globalThis[HOST_REGISTRY_KEY][key]`. */
export function shimSource(key: string, ns: object): string {
  const names = Object.keys(ns)
  const reads = names.map((n, i) => `const __${i} = m[${JSON.stringify(n)}];`)
  // An export name is an IdentifierName (reserved words allowed) or a string.
  const specs = names.map((n, i) => `__${i} as ${n === 'default' || IDENT.test(n) ? n : JSON.stringify(n)}`)
  return (
    `const m = globalThis[${JSON.stringify(HOST_REGISTRY_KEY)}][${JSON.stringify(key)}];\n` +
    `${reads.join('\n')}\n` +
    `export { ${specs.join(', ')} };\n`
  )
}

export interface HostShims {
  /** A URL for the host module `spec` names, or null when it isn't a host module. */
  urlFor(spec: string): Promise<string | null>
  /** The canonical host name for `spec` (`'three'`, `'three/addons/…'`), or null. */
  nameFor(spec: string): string | null
}

let shimSets = 0

/**
 * A set of host shims for this realm. `load` gives the namespace for a host
 * name (Stave's own by default; a test points it elsewhere to prove what a
 * second copy breaks); `makeUrl` turns source into a URL.
 */
export function createHostShims(
  options: { load?: (name: string) => Promise<unknown>; makeUrl?: ModuleUrlMaker } = {},
): HostShims {
  const load = options.load ?? loadHostModule
  const makeUrl = options.makeUrl ?? defaultModuleUrlMaker()
  const prefix = `s${++shimSets}:`
  const urls = new Map<string, Promise<string>>()
  return {
    nameFor: hostModuleName,
    urlFor(spec) {
      const name = hostModuleName(spec)
      if (!name) return Promise.resolve(null)
      let url = urls.get(name)
      if (!url) {
        url = load(name).then((ns) => {
          const key = prefix + name
          registry()[key] = ns
          return makeUrl(shimSource(key, ns as object))
        })
        urls.set(name, url)
        // A failed load can be retried by the next caller.
        url.catch(() => urls.delete(name))
      }
      return url
    },
  }
}

let shared: HostShims | null = null
/** This realm's shims over Stave's own modules (one per worker / page). */
export function hostShims(): HostShims {
  shared ??= createHostShims()
  return shared
}
