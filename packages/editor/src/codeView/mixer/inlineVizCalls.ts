/**
 * inlineVizCalls — the inline viz a pattern's CODE asks for, read without
 * running it (#2560), so their sketches can be warmed up hidden before Play.
 *
 * The engine's rules (`StrudelEngine.evaluateCode`; summarised in
 * `backdropCall.ts`): on a TRACK (a `$:` or named label), `.viz(name)` is an
 * inline zone unless its options say `backdrop: true`, and an underscore viz
 * method (`._pianoroll()`) is an inline zone under its renderer id. A muted
 * track (`_x:` / `x_:`) is never captured, so it gets no zone. Each track holds
 * one zone; a later call on the same chain replaces an earlier one, so the last
 * inline call on a track's chain wins. The master `all(x => …)` line makes
 * backgrounds, never inline zones.
 *
 * What only an evaluation can tell (a name in a variable, a call nested in an
 * argument) is not read here: such a sketch is built at Play as before. A
 * document that does not parse (mid-keystroke) reads as null, so the caller can
 * keep what it had.
 */
import { parseTopLevel, collectChain, type ChainCall } from '../chunkDetect'
import { STRUDEL_VIZ_METHODS } from '../../engine/strudelVizMethods'
import { readVizOptionsLiteral } from './vizOptionsLiteral'
import { splitMuteMarker } from '../ir/trackId'

function stringLiteral(raw: string): string | null {
  const m = /^(['"`])([\s\S]*)\1$/.exec(raw)
  if (!m) return null
  if (m[1] === '`' && m[2].includes('${')) return null
  if (m[2].includes(m[1])) return null
  return m[2]
}

/** The viz name an inline call asks for, or null when the call is not one. */
function inlineName(call: ChainCall): string | null {
  if (call.name === 'viz') {
    const optionsArg = call.args[1]
    const options = optionsArg ? readVizOptionsLiteral(optionsArg.raw) : null
    if (options?.kind === 'literal' && options.values.backdrop === true) return null
    return call.args[0] ? stringLiteral(call.args[0].raw) : null
  }
  if (!call.name.startsWith('_')) return null
  const method = call.name.slice(1)
  return Object.prototype.hasOwnProperty.call(STRUDEL_VIZ_METHODS, method) ? STRUDEL_VIZ_METHODS[method] : null
}

/** One entry per track that shows an inline viz, in source order: the viz name
 *  as the code writes it (a `.viz()` name or a viz method's renderer id). Null
 *  when the document does not parse. */
export function readInlineVizNames(doc: string): string[] | null {
  const statements = parseTopLevel(doc)
  if (!statements) return null
  const names: string[] = []
  for (const node of statements) {
    if (node?.type !== 'LabeledStatement') continue
    const mute = splitMuteMarker(node.label?.name ?? '')
    if (mute.prefix || mute.suffix) continue // muted: never captured
    const body = node.body
    if (body?.type !== 'ExpressionStatement') continue
    let last: string | null = null
    for (const call of collectChain(doc, body.expression, { ref: null })) {
      const name = inlineName(call)
      if (name !== null) last = name
    }
    if (last !== null) names.push(last)
  }
  return names
}
