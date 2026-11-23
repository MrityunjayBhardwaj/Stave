/**
 * instantiate — turn a fetched (and checked) library graph into live modules (#2639).
 *
 * Each module's imports are rewritten in place: a host module (`'three'`,
 * `'three/addons/…'`) to its shim URL (hostShims.ts, so the library shares
 * Stave's three.js), a URL to the module URL made for that file. Modules are
 * made dependencies first, so every URL a module names exists when it is made;
 * then the entry is imported. Blob URLs in the browser (worker and page alike),
 * `data:` URLs where there are none (Node tests).
 *
 * Once the entry is imported, every module it reached statically is in the
 * realm's module map, so their blob URLs are revoked at once: the sketch's
 * teardown ledger (#2641) never sees them, since they are made before the
 * sketch runs. A module that is only the target of a dynamic `import("…")`
 * may still be fetched later, so its URL is kept (listed in `retained`).
 * Shim URLs are shared by every library in the realm and are never revoked here.
 */

import { bareImportMessage, classifyImport, LibraryLoadError, moduleImports, type LibraryGraph } from './graph'
import { defaultModuleUrlMaker, hostShims as sharedHostShims, type HostShims, type ModuleUrlMaker } from './hostShims'

export interface InstantiateOptions {
  shims?: HostShims
  makeUrl?: ModuleUrlMaker
  /** How a made module URL is released once imported. Default: `URL.revokeObjectURL` for `blob:` URLs. */
  revokeUrl?: (url: string) => void
}

const defaultRevoke = (url: string): void => {
  if (url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

export interface InstantiatedLibrary {
  /** The entry module's namespace. */
  readonly namespace: Record<string, unknown>
  /** Every module URL made (the entry's last). */
  readonly urls: readonly string[]
  /** The URLs still live after import: modules reached only by a dynamic `import()`. */
  readonly retained: readonly string[]
  /** How many imports were pointed at Stave's own modules. */
  readonly hostRewrites: number
}

export async function instantiateLibraryGraph(graph: LibraryGraph, options: InstantiateOptions = {}): Promise<InstantiatedLibrary> {
  const shims = options.shims ?? sharedHostShims()
  const makeUrl = options.makeUrl ?? defaultModuleUrlMaker()
  const made = new Map<string, string>()
  const visiting = new Set<string>()
  const urls: string[] = []
  /** Module URLs named by a dynamic import somewhere in the graph. */
  const dynamicTargets = new Set<string>()
  let hostRewrites = 0

  const make = async (url: string): Promise<string> => {
    const done = made.get(url)
    if (done) return done
    if (visiting.has(url)) {
      throw new LibraryLoadError(`its modules import each other in a cycle (at ${url}), which Stave can't load yet`)
    }
    const text = graph.modules[url]
    if (text === undefined) throw new LibraryLoadError(`${url} is missing from the fetched files`)
    visiting.add(url)
    let out = ''
    let last = 0
    for (const imp of await moduleImports(text)) {
      const t = classifyImport(imp.specifier, url)
      let to: string
      if (t.kind === 'host') {
        const shim = await shims.urlFor(imp.specifier)
        if (!shim) throw new LibraryLoadError(`${url} imports '${imp.specifier}', which Stave can't provide`)
        to = shim
        hostRewrites++
      } else if (t.kind === 'url') {
        to = await make(t.url)
        if (imp.dynamic) dynamicTargets.add(to)
      } else {
        throw new LibraryLoadError(bareImportMessage(url, imp.specifier))
      }
      out += text.slice(last, imp.start) + (imp.dynamic ? JSON.stringify(to) : to)
      last = imp.end
    }
    out += text.slice(last)
    visiting.delete(url)
    const moduleUrl = makeUrl(out)
    made.set(url, moduleUrl)
    urls.push(moduleUrl)
    return moduleUrl
  }

  const entryUrl = await make(graph.entry)
  const revoke = options.revokeUrl ?? defaultRevoke
  let namespace: Record<string, unknown>
  try {
    namespace = (await import(/* webpackIgnore: true */ /* @vite-ignore */ entryUrl)) as Record<string, unknown>
  } catch (e) {
    // Nothing will import these again: release them all.
    for (const u of urls) revoke(u)
    throw e
  }
  // Imported: every statically reached module is evaluated, so its URL is no longer needed.
  const retained = urls.filter((u) => dynamicTargets.has(u))
  for (const u of urls) if (!dynamicTargets.has(u)) revoke(u)
  return { namespace, urls, retained, hostRewrites }
}
