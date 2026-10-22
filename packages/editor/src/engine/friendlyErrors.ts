/**
 * Turns a raw runtime error into a user-friendly `LogEntry` body.
 *
 * Inspired by p5.js's Friendly Error System (FES). We have a structural
 * advantage — every runtime ships its `DocsIndex` (the same one hover /
 * completion consume), so fuzzy-matching a misspelled identifier back
 * to a real symbol with its docs URL is a lookup, not a hard-coded
 * dictionary.
 *
 * Scope today:
 *   - Extract the offending identifier from a ReferenceError.
 *   - Fuzzy-match it (Levenshtein) against DocsIndex keys.
 *   - Format a friendly message + suggestion record.
 *
 * Not in scope yet:
 *   - Parsing TypeError arg-type mismatches (needs real signature parsing).
 *   - Parsing Sonic Pi's Ruby error format (different error surface).
 *   - Cross-runtime suggestions (*"stack is a Strudel fn; you're in Hydra"*).
 */

import type { CommonMistake, DocsIndex, RuntimeDoc } from '../monaco/docs/types'
import type { LogSuggestion, RuntimeId } from './engineLog'

export interface FriendlyErrorParts {
  /** Short sentence surfacing in toast + console row + Monaco marker. */
  message: string
  /** Populated when we found a confident fuzzy match in DocsIndex. */
  suggestion?: LogSuggestion
  /** Underlying stack, copied through so the Console panel can fold it. */
  stack?: string
  /**
   * 1-based source line parsed from a V8 / Firefox / Safari stack
   * trace when one was present. Feeds the engineLog → Monaco marker
   * bridge — entries without a line get no inline squiggle.
   */
  line?: number
  /** 1-based column, paired with `line`. */
  column?: number
}

/**
 * Parse the first user-code line/column out of an error's stack.
 *
 * We only trust frames that clearly originate from a runtime eval
 * path — `<anonymous>` for `new Function` / direct eval, or an
 * explicit `eval at` chain. Matching any `:LINE:COL` pair we see
 * would false-positive on bundled paths (e.g. a stack containing
 * `.../@stave/editor/dist/index.js:1234:56`) and hand back a line
 * number that has nothing to do with the user's file — the
 * downstream marker then clamps to full-document range and the user
 * sees the whole sketch underlined.
 *
 * Returns `null` when the stack only contains compiled-bundle or
 * framework frames. Caller should treat that as "line unknown" and
 * skip the inline marker rather than painting the whole file.
 */
export function parseStackLocation(
  err: unknown,
): { line: number; column: number } | null {
  const stack =
    typeof err === 'object' && err !== null && 'stack' in err
      ? String((err as { stack: unknown }).stack ?? '')
      : ''
  if (!stack) return null
  // V8: "at eval (<anonymous>:LINE:COL)" — user code in direct eval.
  const v8Eval = stack.match(/at eval[^(]*\(<anonymous>:(\d+):(\d+)\)/)
  if (v8Eval)
    return { line: parseInt(v8Eval[1], 10), column: parseInt(v8Eval[2], 10) }
  // V8 eval-WRAPPER: "at <Name> (eval at <outerFn> (<url>), <anonymous>:LINE:COL)"
  // — a `new Function` body invoked from inside another function (e.g. hydra's
  // reactive arrow run via `compileHydraCode`). Here `<anonymous>` follows the
  // wrapper's `), `, not `(`, so the patterns below miss it. The `eval at` token
  // marks it as a V8 eval frame and the lazy `.+?` stops at the FIRST `<anonymous>`
  // (the innermost = the user frame, since stacks are top-first). #330.
  const v8EvalWrap = stack.match(/eval at .+?<anonymous>:(\d+):(\d+)/)
  if (v8EvalWrap)
    return { line: parseInt(v8EvalWrap[1], 10), column: parseInt(v8EvalWrap[2], 10) }
  // V8: "at <FuncName> (<anonymous>:LINE:COL)" — a named user function
  // (setup / draw / a user helper) declared inside a `new Function`
  // body, throwing mid-execution. The `<anonymous>` token is the safe
  // anchor — it can't appear in a real bundled filename — so we don't
  // need line-start anchoring here.
  const v8Named = stack.match(/at\s+\S+\s+\(<anonymous>:(\d+):(\d+)\)/)
  if (v8Named)
    return { line: parseInt(v8Named[1], 10), column: parseInt(v8Named[2], 10) }
  // V8: bare "at <anonymous>:LINE:COL" frame — typical for code run
  // through `new Function(body)` when the parser points at the body
  // position. Anchored to line start so we don't match the tail of a
  // bundled filename.
  const v8Anon = stack.match(/^\s*at\s+<anonymous>:(\d+):(\d+)/m)
  if (v8Anon)
    return { line: parseInt(v8Anon[1], 10), column: parseInt(v8Anon[2], 10) }
  // Firefox: "name@<anonymous>:LINE:COL" or "@debugger eval:LINE:COL".
  // The alternation right after `@` keeps `@scope/package` npm paths
  // out — `@stave/editor` doesn't match any of the three tokens, so
  // the bundled-path false-positive is structural, not position-based.
  const ff = stack.match(
    /@(?:<anonymous>|debugger eval|eval):(\d+):(\d+)/,
  )
  if (ff) return { line: parseInt(ff[1], 10), column: parseInt(ff[2], 10) }
  return null
}

/**
 * Extract a source location from a parser error MESSAGE — the trailing
 * `(line:col)` that acorn/estree parsers append (e.g. Strudel's
 * "Unexpected token (3:11)"). Unlike `parseStackLocation`, which reads the
 * post-transpile eval stack (whose line is offset by Strudel's async-IIFE
 * wrapper and therefore dropped by callers), this location is reported in
 * the USER's original source coordinates — verified line-accurate across
 * positions — so it is safe to feed the marker bridge and the toast jump.
 *
 * Anchored to the END of the message and requires BOTH numbers so a stray
 * "(2)" or a parenthetical elsewhere in the text can't false-positive.
 * Returns `null` when the message carries no such trailing pair. Callers
 * should still range-check the line against the target file.
 */
export function parseMessageLocation(
  message: unknown,
): { line: number; column: number } | null {
  if (typeof message !== 'string') return null
  const m = message.match(/\((\d+):(\d+)\)\s*$/)
  if (!m) return null
  return { line: parseInt(m[1], 10), column: parseInt(m[2], 10) }
}

/**
 * Levenshtein edit distance. Small implementation — fine for runs of up
 * to a few thousand words, which is the order of magnitude of the
 * combined DocsIndex keys (~935).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  if (la === 0) return lb
  if (lb === 0) return la

  let prev = new Array<number>(lb + 1)
  let curr = new Array<number>(lb + 1)
  for (let j = 0; j <= lb; j++) prev[j] = j

  for (let i = 1; i <= la; i++) {
    curr[0] = i
    const ac = a.charCodeAt(i - 1)
    for (let j = 1; j <= lb; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1, // insert
        prev[j] + 1, // delete
        prev[j - 1] + cost, // substitute
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[lb]
}

export interface FuzzyMatch {
  name: string
  distance: number
}

/**
 * Return the closest identifiers to `word` from a corpus, sorted by
 * distance. `maxDistance` filters out anything beyond the threshold;
 * defaults to `Math.max(2, ceil(word.length / 3))` — generous for short
 * words, stricter for long ones. `limit` caps the returned list.
 */
export function fuzzyMatch(
  word: string,
  corpus: readonly string[],
  options: { maxDistance?: number; limit?: number } = {},
): FuzzyMatch[] {
  if (!word) return []
  const lower = word.toLowerCase()
  const threshold =
    options.maxDistance ??
    Math.max(2, Math.ceil(word.length / 3))
  const limit = options.limit ?? 5
  const hits: FuzzyMatch[] = []
  for (const candidate of corpus) {
    const d = levenshtein(lower, candidate.toLowerCase())
    if (d <= threshold) hits.push({ name: candidate, distance: d })
  }
  hits.sort(
    (a, b) =>
      a.distance - b.distance ||
      // Prefer case-matching names on ties (e.g. PI over Pi).
      (a.name === word ? -1 : b.name === word ? 1 : 0) ||
      a.name.localeCompare(b.name),
  )
  return hits.slice(0, limit)
}

const REFERENCE_ERROR_PATTERNS = [
  // Chrome / Edge / Node: "foo is not defined"
  /^(\w+) is not defined$/,
  // Firefox: "foo is not defined"
  /^ReferenceError: (\w+) is not defined$/,
  // Safari: "Can't find variable: foo"
  /^Can't find variable: (\w+)$/,
]

/**
 * Extract the undefined identifier from a ReferenceError's message.
 * Returns `null` when the error isn't a reference-miss we recognise.
 */
export function extractReferenceIdentifier(err: unknown): string | null {
  const message =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)
  if (!message) return null
  // Some engines prefix with "Uncaught " — strip for matching.
  const trimmed = message.replace(/^Uncaught\s+/, '').trim()
  for (const re of REFERENCE_ERROR_PATTERNS) {
    const m = re.exec(trimmed)
    if (m && m[1]) return m[1]
  }
  return null
}

export interface FormatOptions {
  /** DocsIndex for the runtime the code was running in. */
  index?: DocsIndex
  /** Override the base URL pattern used for suggestion.docsUrl. */
  docsUrlFor?: (runtime: RuntimeId, name: string) => string
  /**
   * A window of user source code around the throw — typically the line
   * the error happened on plus a couple of neighbours. Used by
   * `CommonMistake` detectors of `kind: 'code'` to recognise wrong-shape
   * idioms (`chord(C)` vs `chord("C")`) without needing a full parse.
   * Caller is free to omit it; `kind: 'code'` detectors simply won't fire.
   */
  codeContext?: string
  /**
   * Phase 20-14 β-5 — bare-name sound alias context. Distinct from the
   * doc-level `detect.alias` CommonMistake field (which is per-doc fuzzy
   * suggestion); this is the runtime alias-resolution layer that
   * `wrappedOutput` operates.
   *
   * - `resolutions`: ordered list of alias rewrites that fired during the
   *   current evaluate() window. Populated from
   *   `StrudelEngine.getLastAliasResolutions()`. The friendly-error path
   *   appends `(tried alias "kick" → "bd")` to the message when populated
   *   on the same error window.
   * - `lookupAlias`: project-injected resolver (today, `resolveAlias` from
   *   `./aliases`). The miss path uses this to distinguish "the alias
   *   map has no entry for `xyz`" from "we tried `xyz → target` but
   *   `target` is not loaded either."
   */
  aliasContext?: {
    resolutions?: ReadonlyArray<{ from: string; to: string }>
    lookupAlias?: (rawS: string) => string | undefined
  }
}

// Phase 20-14 β-5 — "sound X not found" pattern matchers. superdough throws
// `sound bell not found! Is it loaded?` (verified at
// superdough/superdough.mjs:167 in upstream). Both quoted and unquoted forms
// observed across engine versions.
const SOUND_NOT_FOUND_PATTERNS: RegExp[] = [
  /sound\s+["']?([\w.-]+)["']?\s+not\s+found/i,
]

function extractMissingSoundName(rawMessage: string): string | null {
  for (const re of SOUND_NOT_FOUND_PATTERNS) {
    const m = re.exec(rawMessage)
    if (m && m[1]) return m[1]
  }
  return null
}

// #561 — soundfont "no soundfont zone found for preset" (note out of range).
// Fired when a note's pitch falls outside the LOADED instrument's sampled
// key-range (@strudel/soundfonts/fontloader.mjs:87) — distinct from superdough's
// "sound X not found" (instrument not loaded at all). The upstream throw is
// `new Error('no soundfont zone found for preset ', name, 'pitch', pitch)` —
// Error() ignores every arg after the message, so the preset name AND pitch are
// dropped: the raw message is a useless empty `preset `. We can't recover them
// from the message; the engine's scheduler catch recovers them from the hap.
const SOUNDFONT_ZONE_RE = /no soundfont zone found/i

/** True when a thrown message is the soundfont out-of-range error. */
export function isSoundfontZoneError(message: string): boolean {
  return SOUNDFONT_ZONE_RE.test(message)
}

/** Generic, hap-less actionable hint — the fallback when the offending note /
 *  instrument can't be recovered (the raw message carries neither). */
export const SOUNDFONT_ZONE_HINT =
  "A note is outside the chosen instrument's sampled range — try a lower octave or a fuller-range instrument."

/**
 * Build the ACTIONABLE soundfont-range message from the offending hap's value
 * (`{ note | n, s }` — grounded by observing the scheduler catch on the Nightcall
 * doc: `{note:"c7", s:"gm_agogo", …}`). `note`/`n` may be a name string (`"c7"`)
 * or a MIDI number; both render as-is. Returns null when the shape carries
 * neither a pitch nor an instrument, so the caller falls back to
 * `SOUNDFONT_ZONE_HINT`. Pure — unit-tested directly.
 */
export function soundfontRangeMessage(
  hapValue: { note?: unknown; n?: unknown; s?: unknown } | null | undefined,
): string | null {
  const instrument = typeof hapValue?.s === 'string' && hapValue.s ? hapValue.s : null
  const pitchRaw = hapValue?.note ?? hapValue?.n
  const pitch =
    typeof pitchRaw === 'string' || typeof pitchRaw === 'number' ? String(pitchRaw) : null
  if (instrument === null && pitch === null) return null
  const who = pitch !== null ? `Note \`${pitch}\`` : 'A note'
  const where = instrument !== null ? ` for soundfont \`${instrument}\`` : ''
  return `${who} is outside the sampled range${where} — try a lower octave or a fuller-range instrument.`
}

/**
 * Build the alias-resolution suffix appended to "sound not found" friendly
 * errors. Returns an empty string when there's nothing to say. Exported
 * for unit testing — pure function over the inputs.
 */
export function buildAliasSuffix(
  missingName: string | null,
  ctx: FormatOptions['aliasContext'],
): string {
  if (!ctx) return ''
  const parts: string[] = []
  // Resolved path — surface any alias rewrites that fired on the same
  // evaluate window. Deduplicate `from` so a hot pattern firing 10 cycles
  // of kick→bd doesn't drown the message.
  if (ctx.resolutions && ctx.resolutions.length > 0) {
    const seen = new Set<string>()
    const lines: string[] = []
    for (const r of ctx.resolutions) {
      const key = `${r.from}→${r.to}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`\`${r.from}\` → \`${r.to}\``)
    }
    parts.push(`tried alias ${lines.join(', ')}`)
  }
  // Miss path — when we know which name was missing, say whether the alias
  // map has an entry for it (and the target was also missing) vs no entry.
  if (missingName && ctx.lookupAlias) {
    const target = ctx.lookupAlias(missingName)
    if (target) {
      parts.push(`alias map: \`${missingName}\` → \`${target}\` (but \`${target}\` is not loaded)`)
    } else {
      parts.push(`alias map: no entry for \`${missingName}\``)
    }
  }
  return parts.length > 0 ? ` (${parts.join('; ')})` : ''
}

/**
 * Coerce a string|RegExp `match` into a RegExp. Strings ship through
 * JSON-serialised DocsIndexes; we treat them as case-insensitive regex
 * sources so authors can write either `"chord\\(\\s*[A-G][^\"]*\\)"`
 * literally or use a runtime-constructed RegExp.
 */
function asRegExp(match: string | RegExp): RegExp {
  return match instanceof RegExp ? match : new RegExp(match, 'i')
}

interface MistakeHit {
  mistake: CommonMistake
  /** Specificity rank: higher beats lower when weights tie. */
  specificity: 3 | 2 | 1
  /** DocsIndex order — lower index wins on full ties (stable). */
  order: number
  /** Symbol the hint was attached to, if any. Used for the suggestion record. */
  symbol?: { name: string; doc: RuntimeDoc }
}

function evalMistake(
  mistake: CommonMistake,
  ctx: { rawMessage: string; identifier: string | null; codeContext?: string },
): boolean {
  const { detect } = mistake
  if (detect.kind === 'message') {
    return asRegExp(detect.match).test(ctx.rawMessage)
  }
  if (detect.kind === 'code') {
    if (!ctx.codeContext) return false
    return asRegExp(detect.match).test(ctx.codeContext)
  }
  // identifier
  return ctx.identifier !== null && ctx.identifier === detect.alias
}

const SPECIFICITY: Record<CommonMistake['detect']['kind'], 3 | 2 | 1> = {
  message: 3,
  code: 2,
  identifier: 1,
}

function rankHits(hits: MistakeHit[]): MistakeHit | null {
  if (hits.length === 0) return null
  hits.sort((a, b) => {
    const wa = a.mistake.weight ?? 1
    const wb = b.mistake.weight ?? 1
    if (wa !== wb) return wb - wa
    if (a.specificity !== b.specificity) return b.specificity - a.specificity
    return a.order - b.order
  })
  return hits[0]
}

function collectMistakes(
  index: DocsIndex,
  ctx: { rawMessage: string; identifier: string | null; codeContext?: string },
): MistakeHit | null {
  const hits: MistakeHit[] = []
  let order = 0
  // Per-symbol — prefer the symbol the user explicitly named when we
  // have one (right name, wrong shape); otherwise scan all symbols for
  // identifier-aliases and message detectors that key off other clues.
  if (ctx.identifier && index.docs[ctx.identifier]) {
    const doc = index.docs[ctx.identifier]
    for (const m of doc.commonMistakes ?? []) {
      if (evalMistake(m, ctx)) {
        hits.push({
          mistake: m,
          specificity: SPECIFICITY[m.detect.kind],
          order: order++,
          symbol: { name: ctx.identifier, doc },
        })
      }
    }
  }
  for (const [name, doc] of Object.entries(index.docs)) {
    if (name === ctx.identifier) continue // already scanned
    for (const m of doc.commonMistakes ?? []) {
      if (evalMistake(m, ctx)) {
        hits.push({
          mistake: m,
          specificity: SPECIFICITY[m.detect.kind],
          order: order++,
          symbol: { name, doc },
        })
      }
    }
  }
  for (const m of index.globalMistakes ?? []) {
    if (evalMistake(m, ctx)) {
      hits.push({
        mistake: m,
        specificity: SPECIFICITY[m.detect.kind],
        order: order++,
      })
    }
  }
  return rankHits(hits)
}

function defaultDocsUrl(runtime: RuntimeId, name: string): string {
  return `/docs/reference/${runtime}/#${name.toLowerCase()}`
}

/**
 * Build a FriendlyErrorParts from a raw thrown value. When `index` is
 * provided and the error is a ReferenceError, attempts a fuzzy-match
 * against the index and attaches the best suggestion.
 */
export function formatFriendlyError(
  err: unknown,
  runtime: RuntimeId,
  options: FormatOptions = {},
): FriendlyErrorParts {
  const rawMessage =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)
  const stack =
    typeof err === 'object' &&
    err !== null &&
    'stack' in err &&
    typeof (err as { stack: unknown }).stack === 'string'
      ? ((err as { stack: string }).stack)
      : undefined

  const loc = parseStackLocation(err)
  const identifier = extractReferenceIdentifier(err)

  // Phase 20-14 β-5 — alias-resolution suffix.
  //
  // The `aliasContext` is the runtime sound-alias layer (`kick → bd`) and
  // is ORTHOGONAL to the per-doc `detect.alias` CommonMistake field at
  // line ~240. The two never collide structurally:
  //   - detect.alias matches a user's typed identifier against a single
  //     known-misspelling alias from a curated doc entry.
  //   - aliasContext consults the runtime-wide bare-sample-name map and
  //     surfaces the result of an attempted hap rewrite.
  //
  // We compute the suffix once and append it to whichever message path
  // fires below. Missing-sound name extraction targets superdough's
  // "sound X not found! Is it loaded?" throw — when the rawMessage is
  // about something else, missingName is null and only the "resolutions"
  // path contributes.
  const missingName = extractMissingSoundName(rawMessage)
  const aliasSuffix = buildAliasSuffix(missingName, options.aliasContext)
  const appendAlias = (msg: string): string =>
    aliasSuffix ? `${msg}${aliasSuffix}` : msg

  // 1. Curated hints (commonMistakes + globalMistakes) — fire first.
  //    Higher specificity than algorithmic fuzzy match: when the author
  //    has hand-written the right hint for this case, it beats the
  //    Levenshtein neighbour every time.
  if (options.index) {
    const hit = collectMistakes(options.index, {
      rawMessage,
      identifier,
      codeContext: options.codeContext,
    })
    if (hit) {
      const suggestion: LogSuggestion | undefined = hit.symbol
        ? {
            name: hit.symbol.name,
            docsUrl: (options.docsUrlFor ?? defaultDocsUrl)(
              runtime,
              hit.symbol.name,
            ),
            example: hit.mistake.example ?? hit.symbol.doc.example,
            description: hit.symbol.doc.description,
          }
        : hit.mistake.example || hit.mistake.link
        ? {
            // Global mistake without a symbol — synthesise a minimal
            // suggestion so downstream UI still surfaces the example,
            // and the hint's own link when it has one (#2167).
            name: '',
            linkLabel: hit.mistake.link?.label,
            docsUrl: hit.mistake.link?.url ?? '',
            example: hit.mistake.example,
            description: hit.mistake.link?.description,
          }
        : undefined
      return {
        message: appendAlias(hit.mistake.hint),
        suggestion,
        stack,
        line: loc?.line,
        column: loc?.column,
      }
    }
  }

  // 2. ReferenceError fuzzy fallback (today's behaviour).
  if (identifier && options.index) {
    const matches = fuzzyMatch(
      identifier,
      Object.keys(options.index.docs),
    )
    if (matches.length > 0) {
      const hit = options.index.docs[matches[0].name]
      const docsUrl = (options.docsUrlFor ?? defaultDocsUrl)(
        runtime,
        matches[0].name,
      )
      const suggestion: LogSuggestion = {
        name: matches[0].name,
        docsUrl,
        example: hit?.example,
        description: hit?.description,
      }
      return {
        message: appendAlias(`\`${identifier}\` is not defined. Did you mean \`${matches[0].name}\`?`),
        suggestion,
        stack,
        line: loc?.line,
        column: loc?.column,
      }
    }
    return {
      message: appendAlias(`\`${identifier}\` is not defined.`),
      stack,
      line: loc?.line,
      column: loc?.column,
    }
  }

  // 3. Soundfont out-of-range backstop (#561). The engine's scheduler catch
  //    normally rewrites this into a note+instrument-specific message (it holds
  //    the hap); this generic hint covers any path that reaches here with the raw
  //    upstream message (which carries neither preset nor pitch — see
  //    SOUNDFONT_ZONE_RE) so the user never sees the empty `preset ` string.
  if (isSoundfontZoneError(rawMessage)) {
    return {
      message: appendAlias(SOUNDFONT_ZONE_HINT),
      stack,
      line: loc?.line,
      column: loc?.column,
    }
  }

  // 4. Non-reference, no curated hint — raw message.
  return {
    message: appendAlias(rawMessage || 'Unknown error'),
    stack,
    line: loc?.line,
    column: loc?.column,
  }
}
