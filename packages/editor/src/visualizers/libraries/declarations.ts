/**
 * declarations — the project's `stave.libs.json` (#2639).
 *
 *   { "@sparkjsdev/spark": { "url": "https://esm.sh/@sparkjsdev/spark@2.4.0?external=three", "sha384": "…" } }
 *
 * Each key is an import specifier exactly as a library's docs write it; `url`
 * is where its ES module lives; `sha384` (base64, no `sha384-` prefix) pins
 * every file the library loads (libraryGraphHash in graph.ts).
 */

/** The file's path, at the project root. */
export const LIBS_FILE = 'stave.libs.json'

export interface LibraryDeclaration {
  readonly url: string
  /** base64 SHA-384 of the whole module graph; may be missing, then loading refuses and says the value. */
  readonly sha384?: string
}

export type LibraryDeclarations = Readonly<Record<string, LibraryDeclaration>>

export type ParsedLibraries = { ok: true; libs: LibraryDeclarations } | { ok: false; message: string }

const SHA384_B64 = /^[A-Za-z0-9+/]{64}$/

/** A URL a library may be loaded from: https anywhere, http only on this machine. */
export function isAllowedLibraryUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'https:') return true
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')
}

/** Read `stave.libs.json`'s text. No file (null / empty) = no libraries. */
export function parseLibraryDeclarations(text: string | null | undefined): ParsedLibraries {
  if (text == null || text.trim() === '') return { ok: true, libs: {} }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, message: `${LIBS_FILE} isn't valid JSON (${e instanceof Error ? e.message : String(e)}).` }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: `${LIBS_FILE} should be an object: { "<import name>": { "url": "https://…", "sha384": "…" } }.` }
  }
  const libs: Record<string, LibraryDeclaration> = {}
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return { ok: false, message: `${LIBS_FILE}: '${name}' should be { "url": "https://…", "sha384": "…" }.` }
    }
    const { url, sha384 } = v as { url?: unknown; sha384?: unknown }
    if (typeof url !== 'string' || !isAllowedLibraryUrl(url)) {
      return { ok: false, message: `${LIBS_FILE}: '${name}' needs a "url" that starts with https:// (got ${JSON.stringify(url ?? null)}).` }
    }
    if (sha384 !== undefined) {
      if (typeof sha384 !== 'string' || !SHA384_B64.test(sha384)) {
        const hint = typeof sha384 === 'string' && sha384.startsWith('sha384-') ? ' Leave out the "sha384-" prefix.' : ''
        return { ok: false, message: `${LIBS_FILE}: '${name}' has a "sha384" that isn't a base64 SHA-384 (64 characters).${hint}` }
      }
    }
    libs[name] = sha384 === undefined ? { url } : { url, sha384: sha384 as string }
  }
  return { ok: true, libs }
}
