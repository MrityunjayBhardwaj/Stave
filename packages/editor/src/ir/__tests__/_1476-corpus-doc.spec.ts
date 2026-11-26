/**
 * #1476 PROBE — the REAL bytes of `0/-7zrPK5Bii8_`, not a transcription.
 *
 * Prints the document, its IR shape today, and the IR of the same document
 * with the `$:` removed from the interior comment — which is what the
 * interior rule would hand `applyChain`, since a `//` comment's CONTENT is
 * invisible to the chain walker either way.
 */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { hasCorpusArchive, loadCorpus } from '../../visualEdit/miniSource/__tests__/evalHarness'

/** Compact shape: tag path, with Code nodes annotated by their `via` method. */
function shape(n: unknown): string {
  if (n === null || typeof n !== 'object') return String(n)
  const r = n as Record<string, unknown>
  const tag = r.tag as string | undefined
  if (!tag) return '?'
  if (tag === 'Stack' && Array.isArray(r.tracks)) return `Stack[${r.tracks.map(shape).join(', ')}]`
  if (tag === 'Seq' && Array.isArray(r.children)) return `Seq(${r.children.length})`
  if (tag === 'Cycle' && Array.isArray(r.items)) return `Cycle(${r.items.length})`
  if (tag === 'Track') return `Track#${r.trackId}[${r.body ? shape(r.body) : 'EMPTY'}]`
  if (tag === 'Param') return `Param:${r.key}[${shape(r.body)}]`
  if (tag === 'Code') {
    const via = r.via as Record<string, unknown> | undefined
    return via
      ? `Code(code=${JSON.stringify(r.code)} via .${via.method})[${shape(via.inner)}]`
      : `Code(code=${JSON.stringify(r.code)}, NO via)`
  }
  return tag
}

/** Every sound-producing leaf, so "did we lose music?" is a number. */
function leaves(n: unknown): number {
  let c = 0
  const visit = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return void x.forEach(visit)
    const r = x as Record<string, unknown>
    if (r.tag === 'Play' || r.tag === 'Sound') c++
    for (const [k, v] of Object.entries(r)) { if (k === 'loc') continue; visit(v) }
  }
  visit(n)
  return c
}

describe('#1476 corpus doc', () => {
  it.skipIf(!hasCorpusArchive())('prints the real document and both parses', async () => {
    const docs = await loadCorpus()
    const doc = docs.find((d) => d.name === '0/-7zrPK5Bii8_')
    if (!doc) throw new Error(`not found; population = ${docs.length}`)

    const today = parseStrudel(doc.code)
    // Strip the `$:` from the interior comment ONLY — every other byte kept.
    // This is what the interior rule produces for `applyChain`: one statement
    // whose interior comments the chain walker skips wholesale.
    const unlabelled = doc.code.replace(/(\/\/\s*)\$:/g, '$1')
    const whole = parseStrudel(unlabelled)

    // eslint-disable-next-line no-console
    console.log(
      `\n===== 0/-7zrPK5Bii8_ (${doc.code.length} bytes) =====\n${doc.code}\n` +
        `\n----- TODAY -----\n${shape(today)}\n  leaves=${leaves(today)}\n` +
        `\n----- WHOLE CHAIN (interior comment de-labelled) -----\n${shape(whole)}\n  leaves=${leaves(whole)}\n` +
        `\n----- bytes differing: ${doc.code.length} -> ${unlabelled.length} -----`,
    )
  })
})
