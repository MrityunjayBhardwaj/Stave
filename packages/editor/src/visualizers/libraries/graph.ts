/**
 * graph — fetch a library's whole ES-module graph, and hash it (#2639).
 *
 * `loadLibraryGraph(entryUrl)` fetches the entry and follows every import:
 *   - a host module (`'three'`, `'three/addons/…'`) is left as is; it is
 *     Stave's own and is never fetched (instantiate.ts points it at a shim);
 *   - a relative or absolute URL is fetched and followed;
 *   - any other bare specifier is an error naming the module and the specifier.
 * It returns the texts exactly as fetched. Nothing runs here: instantiate.ts
 * turns a checked graph into modules, so a cache (#2640) can sit between.
 *
 * `libraryGraphHash(graph)` is the SHA-384 a `stave.libs.json` entry pins. It
 * covers every module, not only the entry, so a CDN that changes a file the
 * entry imports is caught too. Canonical form: modules sorted by absolute URL,
 * each contributing `url + "\n" + String(text.length) + "\n" + text + "\n"`,
 * UTF-8 encoded, SHA-384, base64.
 */

import { init as lexerReady, parse } from 'es-module-lexer'
import { hostModuleName, parseThreeSpecifier, unsupportedImportMessage } from './hostModules'

export type LibraryGraph = {
  /** Absolute URL of the entry module. */
  entry: string
  /** Absolute URL → source text, as fetched. */
  modules: Record<string, string>
}

export interface LoadLibraryGraphOptions {
  /** How a URL becomes text (a test, or a cache, can supply its own). Default: fetch. */
  fetchText?: (url: string) => Promise<string>
}

/** A library that can't be loaded, with why. */
export class LibraryLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryLoadError'
  }
}

/** More than any library in practice; a graph past these is refused, not walked forever. */
export const MAX_GRAPH_MODULES = 256
export const MAX_GRAPH_CHARS = 64 * 1024 * 1024

export async function defaultFetchText(url: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (e) {
    throw new LibraryLoadError(`fetching ${url} failed (${e instanceof Error ? e.message : String(e)})`)
  }
  if (!res.ok) throw new LibraryLoadError(`fetching ${url} failed (HTTP ${res.status})`)
  return res.text()
}

/** One import a module makes, with where its specifier sits in the text. */
export interface ModuleImport {
  readonly specifier: string
  readonly start: number
  readonly end: number
  /** Dynamic `import("x")`: the range includes the quotes. */
  readonly dynamic: boolean
}

/** Every import with a literal specifier in `text` (static, re-export, dynamic). */
export async function moduleImports(text: string): Promise<ModuleImport[]> {
  await lexerReady
  const [imports] = parse(text)
  const out: ModuleImport[] = []
  for (const i of imports) {
    if (typeof i.specifier !== 'string') continue // import.meta, import(expr)
    out.push({ specifier: i.specifier, start: i.start, end: i.end, dynamic: i.type === 'dynamic' })
  }
  return out
}

/** Why a library module's bare import can't be resolved. */
export function bareImportMessage(fromUrl: string, specifier: string): string {
  // A three.js path Stave knows but won't provide (pointer-input controls, a left-out file).
  if (parseThreeSpecifier(specifier)) return `${fromUrl} imports '${specifier}', which Stave doesn't provide: ${unsupportedImportMessage(specifier).replace(/\.$/, '')}`
  return `${fromUrl} imports '${specifier}', which is neither a URL nor a module Stave provides ('three' or 'three/addons/…'). Use a build of the library that bundles '${specifier}' or imports it by URL`
}

const URL_LIKE = /^(?:\.{0,2}\/|[a-zA-Z][a-zA-Z\d+.-]*:)/

/** What a library module's import points at. */
export type ImportTarget = { kind: 'host'; name: string } | { kind: 'url'; url: string } | { kind: 'bare' }

export function classifyImport(specifier: string, fromUrl: string): ImportTarget {
  const host = hostModuleName(specifier)
  if (host) return { kind: 'host', name: host }
  if (URL_LIKE.test(specifier)) return { kind: 'url', url: new URL(specifier, fromUrl).href }
  return { kind: 'bare' }
}

/** Fetch `entryUrl` and every module it reaches. See the header for the rules. */
export async function loadLibraryGraph(entryUrl: string, options: LoadLibraryGraphOptions = {}): Promise<LibraryGraph> {
  const fetchText = options.fetchText ?? defaultFetchText
  const entry = new URL(entryUrl).href
  const modules: Record<string, string> = {}
  const pending = new Map<string, Promise<void>>()
  let chars = 0

  const visit = (url: string): Promise<void> => {
    let p = pending.get(url)
    if (p) return p
    if (pending.size >= MAX_GRAPH_MODULES) {
      return Promise.reject(new LibraryLoadError(`it reaches more than ${MAX_GRAPH_MODULES} modules`))
    }
    p = (async () => {
      const text = await fetchText(url)
      chars += text.length
      if (chars > MAX_GRAPH_CHARS) throw new LibraryLoadError(`its files add up to more than ${MAX_GRAPH_CHARS} characters`)
      modules[url] = text
      const next: Promise<void>[] = []
      for (const imp of await moduleImports(text)) {
        const t = classifyImport(imp.specifier, url)
        if (t.kind === 'url') next.push(visit(t.url))
        else if (t.kind === 'bare') throw new LibraryLoadError(bareImportMessage(url, imp.specifier))
      }
      await Promise.all(next)
    })()
    pending.set(url, p)
    return p
  }

  await visit(entry)
  return { entry, modules }
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** The canonical bytes {@link libraryGraphHash} digests (exported for tests and tools). */
export function libraryGraphBytes(graph: LibraryGraph): Uint8Array {
  const urls = Object.keys(graph.modules).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  let s = ''
  for (const url of urls) {
    const text = graph.modules[url]
    s += `${url}\n${String(text.length)}\n${text}\n`
  }
  return new TextEncoder().encode(s)
}

/** base64 SHA-384 over the whole graph (canonical form in the header). */
export async function libraryGraphHash(graph: LibraryGraph): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-384', libraryGraphBytes(graph) as BufferSource)
  return toBase64(new Uint8Array(digest))
}
