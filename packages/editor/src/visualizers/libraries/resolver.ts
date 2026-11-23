/**
 * resolver — the one chain every sketch import goes through (#2637).
 *
 * A `.three` sketch's imports are rewritten to `__mod[i]` (static) and
 * `__import(x)` (dynamic) by `compileThreeSketch`; both ends land here. Each
 * link of the chain is asked in order and the first that knows the specifier
 * answers. When none does, the chain's `refusal` says why, in words a sketch
 * author can act on.
 *
 *   host modules  (three.js and its addons, Stave's own copy)   — hostModules.ts
 *   declared      (the project's stave.libs.json)                — #2639
 *   refused       (with how to fix it)                           — the chain's `refusal`
 *
 * The chain is a value, built per sketch load, so a link that depends on the
 * project (the declared libraries) is just one more entry.
 */

/** What a link answers for a specifier it knows. */
export type ResolvedImport =
  /** three.js itself: the sketch gets its own patched copy (see runThreeSketch). */
  | { readonly kind: 'three' }
  /** Any other module, loaded on demand. */
  | { readonly kind: 'module'; readonly load: () => Promise<unknown> }

export interface ImportResolver {
  /** For messages and tests. */
  readonly name: string
  /** The answer for `spec`, or null when this link doesn't know it. */
  resolve(spec: string): ResolvedImport | null
}

export interface ImportChain {
  readonly links: readonly ImportResolver[]
  /** Why `spec` can't load, once every link has said no. */
  refusal(spec: string): string
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

/** The first link's answer for `spec`, or null when no link knows it. */
export function resolveImport(chain: ImportChain, spec: string): ResolvedImport | null {
  for (const link of chain.links) {
    const r = link.resolve(spec)
    if (r) return r
  }
  return null
}

/** Resolve `spec` or throw the chain's refusal as a {@link ThreeImportError} on `line`. */
export function resolveOrRefuse(chain: ImportChain, spec: string, line?: number): ResolvedImport {
  const r = resolveImport(chain, spec)
  if (!r) throw new ThreeImportError(chain.refusal(spec), line)
  return r
}
