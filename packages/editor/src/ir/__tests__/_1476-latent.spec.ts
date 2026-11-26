/**
 * #1476 PROBE — is the CHAIN-APPLIED drop a PRE-EXISTING defect, independent
 * of the interior rule?
 *
 * Hypothesis: `runChainAppliedStage` takes its MULTI-TRACK branch on any
 * `Stack`, but a top-level comma INSIDE one track's mini-notation
 * (`note("[C G], <D …>")`) also produces a Stack — with the chain parked on
 * the OUTER node. `applyOnTrack` then runs on the inner arms, none of which
 * carries `unresolvedChain`, and the chain is dropped with nothing thrown.
 *
 * If true, these minimal documents diverge with NO commented label anywhere,
 * i.e. the interior rule only made an existing hole reachable.
 */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'

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
    return via ? `Code(via .${via.method})[${shape(via.inner)}]` : `Code(${JSON.stringify(String(r.code).slice(0, 50))})`
  }
  return tag
}

const CASES: [string, string][] = [
  ['comma stack + chain, one line', `$: note("[C G], <D E>").gain(.8)`],
  ['comma stack + chain, two methods', `$: note("a, b").sound("piano").gain(.8)`],
  ['comma stack, NO chain (control)', `$: note("a, b")`],
  ['NO comma (control), chain', `$: note("a").gain(.8)`],
  ['comma stack + chain on next line', `$: note("a, b")\n  .gain(.8)`],
  ['s() comma stack + chain', `$: s("bd, cp").gain(.8)`],
  ['bare (no $:) comma stack + chain', `note("a, b").gain(.8)`],
]

describe('#1476 latent — chain over a mini-notation comma stack', () => {
  for (const [name, code] of CASES) {
    it(name, () => {
      const mono = stripStageMeta(parseStrudel(code))
      const staged = stripStageMeta(pipeline(code))
      const equal = JSON.stringify(mono) === JSON.stringify(staged)
      // eslint-disable-next-line no-console
      console.log(
        `\n--- ${name} ---\n  ${JSON.stringify(code)}\n` +
          `  mono:   ${shape(mono)}\n  staged: ${shape(staged)}\n  PARITY: ${equal ? 'ok' : 'BROKE'}`,
      )
    })
  }
})
