/**
 * declaredLibraries — the second link of the import chain (#2639): a name the
 * project declares in `stave.libs.json`, loaded from its URL, checked against
 * its SHA-384, and run sharing Stave's three.js. Plus the chain a sketch gets,
 * and the refusal that says how to declare a name nobody provides.
 *
 * Loading one library, in order:
 *   1. fetch its whole module graph (graph.ts) — or take it from a cache (#2640);
 *   2. hash the graph and compare with the declared sha384 — nothing has run yet;
 *   3. instantiate it (instantiate.ts): host imports → shims, files → module URLs.
 * The result is kept per realm, keyed by URL + hash, so two sketches (or two
 * mounts) importing the same library share one copy.
 */

import { LIBS_FILE, parseLibraryDeclarations, type LibraryDeclaration, type ParsedLibraries } from './declarations'
import { libraryGraphHash, loadLibraryGraph, type LibraryGraph } from './graph'
import { hostResolver, parseThreeSpecifier, unsupportedImportMessage } from './hostModules'
import { instantiateLibraryGraph, type InstantiatedLibrary } from './instantiate'
import { ThreeImportError, type ImportChain, type ImportResolver } from './resolver'

/** Where verified graphs may be kept between loads (#2640 wires IndexedDB here). */
export interface LibraryGraphCache {
  getGraph(sha384: string): Promise<LibraryGraph | null>
  putGraph(sha384: string, graph: LibraryGraph): Promise<void>
}

export interface DeclaredLibraryDeps {
  fetchText?: (url: string) => Promise<string>
  cache?: LibraryGraphCache
  /** Instantiate a verified graph (tests swap the module-URL maker). */
  instantiate?: (graph: LibraryGraph) => Promise<InstantiatedLibrary>
}

const loaded = new Map<string, Promise<InstantiatedLibrary>>()

/** Forget every library loaded in this realm (the next import loads it again).
 *  For teardown (#2641) and tests; module URLs already made are not revoked here. */
export function forgetLoadedLibraries(): void {
  loaded.clear()
}

/** Load `name` as declared, or reject with a {@link ThreeImportError} that names it. */
export function loadDeclaredLibrary(name: string, decl: LibraryDeclaration, deps: DeclaredLibraryDeps = {}): Promise<InstantiatedLibrary> {
  const key = `${decl.url}\n${decl.sha384 ?? ''}`
  let p = loaded.get(key)
  if (!p) {
    p = loadOnce(name, decl, deps)
    loaded.set(key, p)
    p.catch(() => loaded.delete(key)) // a failure can be retried (after a fix, or when the network is back)
  }
  return p
}

async function loadOnce(name: string, decl: LibraryDeclaration, deps: DeclaredLibraryDeps): Promise<InstantiatedLibrary> {
  const from = `'${name}' (declared in ${LIBS_FILE})`
  let graph: LibraryGraph | null = decl.sha384 && deps.cache ? await deps.cache.getGraph(decl.sha384).catch(() => null) : null
  const fromCache = graph !== null
  if (!graph) {
    try {
      graph = await loadLibraryGraph(decl.url, { fetchText: deps.fetchText })
    } catch (e) {
      throw new ThreeImportError(`${from} couldn't be loaded: ${e instanceof Error ? e.message : String(e)}.`)
    }
  }
  const actual = await libraryGraphHash(graph)
  if (!decl.sha384) {
    throw new ThreeImportError(
      `${from} has no "sha384", so Stave can't check what it loads. What ${decl.url} serves now hashes to "${actual}": add "sha384": "${actual}" to its entry if that is the version you mean.`,
    )
  }
  if (actual !== decl.sha384) {
    throw new ThreeImportError(
      `${from} was refused: what ${decl.url} serves doesn't match the "sha384" in ${LIBS_FILE} (expected "${decl.sha384}", got "${actual}"). Nothing from it was run. If the library changed on purpose, put the new value in ${LIBS_FILE}.`,
    )
  }
  if (!fromCache && deps.cache) await deps.cache.putGraph(actual, graph).catch(() => {})
  try {
    return await (deps.instantiate ?? instantiateLibraryGraph)(graph)
  } catch (e) {
    throw new ThreeImportError(`${from} couldn't be started: ${e instanceof Error ? e.message : String(e)}.`)
  }
}

/** The declared-libraries link over a parsed `stave.libs.json`. */
export function declaredResolver(parsed: ParsedLibraries, deps: DeclaredLibraryDeps = {}): ImportResolver {
  return {
    name: 'declared',
    resolve(spec) {
      if (!parsed.ok || !Object.prototype.hasOwnProperty.call(parsed.libs, spec)) return null
      const decl = parsed.libs[spec]
      return { kind: 'module', load: async () => (await loadDeclaredLibrary(spec, decl, deps)).namespace }
    },
  }
}

const URL_SPEC = /^[a-zA-Z][a-zA-Z\d+.-]*:/
const RELATIVE = /^\.{0,2}\//

/** Why `spec` can't load once host and declared both said no, with how to fix it. */
export function refusalMessage(spec: string, parsed: ParsedLibraries): string {
  if (parseThreeSpecifier(spec) || RELATIVE.test(spec)) return unsupportedImportMessage(spec)
  if (!parsed.ok) return `'${spec}' can't be looked up: ${parsed.message}`
  if (URL_SPEC.test(spec)) {
    return `'${spec}' can't be imported by URL in a Stave sketch: declare it in ${LIBS_FILE} at the project root, { "<name>": { "url": ${JSON.stringify(spec)}, "sha384": "…" } }, then import '<name>'.`
  }
  return `'${spec}' isn't available in Stave. A three.js sketch can import 'three' and any 'three/addons/…' file. To use a library, declare it in ${LIBS_FILE} at the project root: { ${JSON.stringify(spec)}: { "url": "https://…", "sha384": "…" } }.`
}

/** The chain a sketch's imports go through, given the project's `stave.libs.json`
 *  text (null = the project has none): Stave's own modules, then the declared
 *  libraries, then a refusal that says how to fix it. */
export function sketchImportChain(libsText: string | null | undefined, deps: DeclaredLibraryDeps = {}): ImportChain {
  const parsed = parseLibraryDeclarations(libsText)
  return {
    links: [hostResolver, declaredResolver(parsed, deps)],
    refusal: (spec) => refusalMessage(spec, parsed),
  }
}
