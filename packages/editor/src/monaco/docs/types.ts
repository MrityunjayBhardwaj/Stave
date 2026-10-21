/**
 * Shared shape for every runtime's hover/completion documentation index.
 *
 * The goal is one schema across Strudel, Sonic Pi, p5.js, Hydra, and any
 * future runtime, so hover + completion providers are factory-built from
 * the same index — not hand-rolled per runtime.
 */

export type DocKind =
  | 'function'
  | 'method'
  | 'variable'
  | 'constant'
  | 'keyword'
  | 'synth'
  | 'sample'
  | 'fx'

/**
 * A curated friendly-error hint attached to a `RuntimeDoc` (per-symbol)
 * or to `DocsIndex.globalMistakes` (catch-alls). Consulted by
 * `formatFriendlyError` before the Levenshtein fallback.
 *
 * Three detector kinds, ordered by specificity:
 *   - `message` — regex / substring tested against the error's message.
 *   - `code`    — regex / substring tested against a window of user
 *                 source around the throw (caller passes `codeContext`).
 *   - `identifier` — old-name / cross-runtime alias for the
 *                    misspelling-fallback path.
 *
 * `match` accepts a string for forward-compat with JSON-shipped indexes
 * (regex literals don't survive JSON.stringify). Strings are treated as
 * the source of a `RegExp` with the `i` flag.
 */
export interface CommonMistake {
  detect:
    | { kind: 'message'; match: string | RegExp }
    | { kind: 'code'; match: string | RegExp }
    | { kind: 'identifier'; alias: string }
  /** Friendly one-liner. Renders in place of the raw error. */
  hint: string
  /** Optional inline example, rendered below the hint. */
  example?: string
  /**
   * #2167 — where to read more when the hint is not about one symbol (a
   * tracking issue, an outside page). Becomes the suggestion row's link;
   * a hint attached to a symbol links to that symbol's docs instead.
   */
  link?: { label: string; url: string; description?: string }
  /**
   * Confidence weight for ranking. Default 1. Bump for runtimes where
   * the curated hint is clearly better than the algorithmic suggestion.
   */
  weight?: number
}

export interface RuntimeDoc {
  /** Callable form, e.g. `note(pattern: string)` or `.fast(n)` */
  signature: string
  /** Prose description (Markdown allowed). */
  description: string
  /** Short inline example, shown verbatim. */
  example?: string
  /** Classification — drives the Monaco completion icon. */
  kind?: DocKind
  /** Return description, e.g. `Pattern` or `void`. */
  returns?: string
  /** Topic / category for filtering (e.g. `transform`, `shape`). */
  category?: string
  /** Permalink into the upstream reference. */
  sourceUrl?: string
  /**
   * Friendly-error hints scoped to this symbol. Consulted when the user
   * names this symbol but uses it wrong (right name, wrong arg shape /
   * idiom). See `CommonMistake`.
   */
  commonMistakes?: CommonMistake[]
}

export interface DocsIndex {
  /** Monaco language id. */
  runtime: string
  /** Identifier → doc entry. Identifier is the bare name, no `.` prefix. */
  docs: Record<string, RuntimeDoc>
  /** Optional alias → canonical name map (e.g. `bg` → `background`). */
  aliases?: Record<string, string>
  /**
   * Catch-alls that don't belong to a specific symbol — runtime-wide
   * gotchas, "you forgot to call play()", scheduler-not-set-up.
   * Matched after per-symbol `commonMistakes`, before the fuzzy fallback.
   */
  globalMistakes?: CommonMistake[]
  /** Provenance for sync scripts and staleness checks. */
  meta?: {
    version?: string
    fetchedAt?: string
    source?: string
    /**
     * Fallback URL for the hover "Reference →" link when an entry has no
     * `sourceUrl` of its own. Useful for runtimes whose docs don't carry
     * stable per-function permalinks (e.g. Strudel).
     */
    docsBaseUrl?: string
  }
}

/**
 * Look up a doc by word, honouring aliases. Returns `null` if unknown.
 */
export function resolveDoc(
  index: DocsIndex,
  word: string,
): { name: string; doc: RuntimeDoc } | null {
  const direct = index.docs[word]
  if (direct) return { name: word, doc: direct }
  const aliasTarget = index.aliases?.[word]
  if (aliasTarget && index.docs[aliasTarget]) {
    return { name: aliasTarget, doc: index.docs[aliasTarget] }
  }
  return null
}

/**
 * Assert that a vendored JSON blob conforms to `DocsIndex`. Runs at
 * module-load when each runtime's index is imported, so a malformed
 * `data/*.json` file from an upstream-regenerate surfaces as a loud
 * startup error rather than a silent hover/completion gap.
 *
 * Throws if `runtime` isn't a non-empty string, if `docs` isn't a
 * plain object, or if any entry is missing the required `signature` +
 * `description` fields. Unknown fields are permitted (forward-compat).
 */
export function validateDocsIndex(
  label: string,
  raw: unknown,
): asserts raw is DocsIndex {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${label}: docs index must be an object`)
  }
  const r = raw as Record<string, unknown>
  if (typeof r.runtime !== 'string' || r.runtime.length === 0) {
    throw new Error(`${label}: runtime must be a non-empty string`)
  }
  if (!r.docs || typeof r.docs !== 'object') {
    throw new Error(`${label}: docs must be an object`)
  }
  for (const [name, entry] of Object.entries(r.docs)) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${label}: entry "${name}" is not an object`)
    }
    const e = entry as Record<string, unknown>
    if (typeof e.signature !== 'string') {
      throw new Error(
        `${label}: entry "${name}" is missing string "signature"`,
      )
    }
    if (typeof e.description !== 'string') {
      throw new Error(
        `${label}: entry "${name}" is missing string "description"`,
      )
    }
    if (e.commonMistakes !== undefined) {
      validateMistakes(`${label}: entry "${name}".commonMistakes`, e.commonMistakes)
    }
  }
  if (r.globalMistakes !== undefined) {
    validateMistakes(`${label}: globalMistakes`, r.globalMistakes)
  }
}

function validateMistakes(label: string, raw: unknown): void {
  if (!Array.isArray(raw)) {
    throw new Error(`${label} must be an array`)
  }
  raw.forEach((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`${label}[${idx}] must be an object`)
    }
    const m = item as Record<string, unknown>
    if (typeof m.hint !== 'string' || m.hint.length === 0) {
      throw new Error(`${label}[${idx}] requires non-empty string "hint"`)
    }
    const detect = m.detect as Record<string, unknown> | undefined
    if (!detect || typeof detect !== 'object') {
      throw new Error(`${label}[${idx}] requires object "detect"`)
    }
    if (detect.kind === 'identifier') {
      if (typeof detect.alias !== 'string' || detect.alias.length === 0) {
        throw new Error(
          `${label}[${idx}].detect (identifier) requires non-empty string "alias"`,
        )
      }
    } else if (detect.kind === 'message' || detect.kind === 'code') {
      if (typeof detect.match !== 'string' && !(detect.match instanceof RegExp)) {
        throw new Error(
          `${label}[${idx}].detect (${detect.kind}) requires string|RegExp "match"`,
        )
      }
    } else {
      throw new Error(
        `${label}[${idx}].detect.kind must be "message" | "code" | "identifier"`,
      )
    }
  })
}
