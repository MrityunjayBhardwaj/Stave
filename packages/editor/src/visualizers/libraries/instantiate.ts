/**
 * instantiate — turn a fetched (and checked) library graph into live modules (#2639).
 *
 * Each module's imports are rewritten in place: a host module (`'three'`,
 * `'three/addons/…'`) to its shim URL (hostShims.ts, so the library shares
 * Stave's three.js), a URL to the module URL made for that file. Modules are
 * made dependencies first, so every URL a module names exists when it is made;
 * then the entry is imported. Blob URLs in the browser (worker and page alike),
 * `data:` URLs where there are none (Node tests).
 */

import { bareImportMessage, classifyImport, LibraryLoadError, moduleImports, type LibraryGraph } from './graph'
import { defaultModuleUrlMaker, hostShims as sharedHostShims, type HostShims, type ModuleUrlMaker } from './hostShims'

export interface InstantiateOptions {
  shims?: HostShims
  makeUrl?: ModuleUrlMaker
}

export interface InstantiatedLibrary {
  /** The entry module's namespace. */
  readonly namespace: Record<string, unknown>
  /** Every module URL made (the entry's last), for whoever tears them down. */
  readonly urls: readonly string[]
  /** How many imports were pointed at Stave's own modules. */
  readonly hostRewrites: number
}

export async function instantiateLibraryGraph(graph: LibraryGraph, options: InstantiateOptions = {}): Promise<InstantiatedLibrary> {
  const shims = options.shims ?? sharedHostShims()
  const makeUrl = options.makeUrl ?? defaultModuleUrlMaker()
  const made = new Map<string, string>()
  const visiting = new Set<string>()
  const urls: string[] = []
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
  const namespace = (await import(/* webpackIgnore: true */ /* @vite-ignore */ entryUrl)) as Record<string, unknown>
  return { namespace, urls, hostRewrites }
}
