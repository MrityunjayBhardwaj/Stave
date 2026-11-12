/**
 * backdropCall — which chain calls the ENGINE sends to the background, read from
 * the code without running it (#2387, #2394).
 *
 * The engine's rules (`StrudelEngine.evaluateCode`, the `.viz` and viz-method
 * wrappers) are:
 *  - `.viz(name, opts)` is the background when `opts.backdrop === true`, or when
 *    it runs inside a master `all(x => …)` transform (it belongs to no track);
 *    otherwise it is an inline zone;
 *  - a non-underscore viz method (`.pianoroll()`, `.scope()`, … — see
 *    STRUDEL_VIZ_METHODS) is always the background, under its renderer id;
 *  - an underscore viz method (`._pianoroll()`) is an inline zone, except inside
 *    a master `all()` transform, where it is the background too (#2387).
 * The background slot is SINGULAR and overwritten by each call, so the last one
 * to run wins: tracks run in source order, then the `all()` transforms do.
 *
 * Pure and parse-only: the caller hands in a `ChainCall` from `collectChain`.
 */
import { parseTopLevel, collectChain, type ChainCall } from '../chunkDetect'
import { STRUDEL_VIZ_METHODS } from '../../engine/strudelVizMethods'
import { readVizOptionsLiteral, type CodeVizOptions } from './vizOptionsLiteral'

/** A background call as the code says it. `name` is null when only an
 *  evaluation can tell it (a variable, a template with `${…}`). */
export interface BackdropCall {
  name: string | null
  options: CodeVizOptions | null
  call: ChainCall
}

/** A string literal's value, or null when the source is not one we can read. */
function stringLiteral(raw: string): string | null {
  const m = /^(['"`])([\s\S]*)\1$/.exec(raw)
  if (!m) return null
  if (m[1] === '`' && m[2].includes('${')) return null
  if (m[2].includes(m[1])) return null // escaped quotes etc. — not worth guessing
  return m[2]
}

function isVizMethod(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(STRUDEL_VIZ_METHODS, name)
}

/**
 * The call as a background request, or null when the engine would not send it
 * to the background. `onMaster` = the call sits in a master `all(x => …)` body.
 */
export function readBackdropCall(call: ChainCall, onMaster: boolean): BackdropCall | null {
  if (call.name === 'viz') {
    const nameArg = call.args[0]
    const optionsArg = call.args[1]
    const options = optionsArg ? readVizOptionsLiteral(optionsArg.raw) : null
    if (!onMaster && !(options?.kind === 'literal' && options.values.backdrop === true)) return null
    return { name: nameArg ? stringLiteral(nameArg.raw) : null, options, call }
  }
  const underscore = call.name.startsWith('_')
  const method = underscore ? call.name.slice(1) : call.name
  if (!isVizMethod(method)) return null
  if (underscore && !onMaster) return null
  const optionsArg = call.args[0]
  return {
    name: STRUDEL_VIZ_METHODS[method],
    options: optionsArg ? readVizOptionsLiteral(optionsArg.raw) : null,
    call,
  }
}

/**
 * The last background call on a TRACK line (#2394): a top-level statement —
 * `$:`/named label or a bare expression — other than a master `all(…)`. Only the
 * statement's own chain is read (`note(…).pianoroll().gain(…)`); a call nested in
 * an argument (`stack(a.scope(), b)`) or in a `const` is left to the last
 * evaluation. A muted track (`_lead:`) counts: its methods still run.
 *
 * `declaredOnly` keeps only calls that ASK to be the background in so many words,
 * `.viz(name, { backdrop: true })`, and skips the implicit viz methods
 * (`.scope()`, `.pianoroll()`). The engine still sends those to the background when
 * it plays, but a viz written on a track reads as an inline viz, so only a
 * declared one follows the code before Play (#2394, the user's rule). Clear still
 * reads every call, so it can remove whichever one is playing.
 */
export function lastTrackBackdropCall(
  doc: string,
  { declaredOnly = false }: { declaredOnly?: boolean } = {},
): BackdropCall | null {
  const statements = parseTopLevel(doc)
  if (!statements) return null
  let last: BackdropCall | null = null
  for (const node of statements) {
    const body = node.type === 'LabeledStatement' ? node.body : node
    if (body?.type !== 'ExpressionStatement') continue
    const expr = body.expression
    if (expr?.type === 'CallExpression' && expr.callee?.type === 'Identifier' && expr.callee.name === 'all') continue
    const chain = collectChain(doc, expr, { ref: null })
    // off the master line, a `.viz()` is a background only with `backdrop: true`
    // (readBackdropCall checks that), so keeping `.viz()` calls keeps exactly
    // the declared ones
    const r = lastBackdropCall(declaredOnly ? chain.filter((c) => c.name === 'viz') : chain, false)
    if (r) last = r
  }
  return last
}

/** The last background call in a chain (source order = run order), or null. */
export function lastBackdropCall(chain: readonly ChainCall[], onMaster: boolean): BackdropCall | null {
  let last: BackdropCall | null = null
  for (const c of chain) {
    const r = readBackdropCall(c, onMaster)
    if (r) last = r
  }
  return last
}
