/**
 * #1476 PROBE — is "the outer Stack carries `unresolvedChain`" a SOUND
 * discriminator for "this Stack is one track's mini-notation, not N tracks"?
 *
 * The claim to falsify: a genuine multi-`$:` document also reaches
 * CHAIN-APPLIED with a chain on its OUTER Stack. If it ever does, the
 * discriminator is wrong and would collapse real tracks into one.
 */
import { describe, it } from 'vitest'
import { IR } from '../PatternIR'
import { runRawStage, runMiniExpandedStage } from '../parseStrudelStages'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

function miniExpanded(code: string): Record<string, unknown> {
  return runMiniExpandedStage(runRawStage(IR.code(code))) as unknown as Record<string, unknown>
}

const CASES: [string, string][] = [
  ['two real $: tracks, each chained', `$: note("a").gain(.5)\n$: note("b").gain(.8)`],
  ['three real $: tracks', `$: note("a")\n$: note("b")\n$: note("c")`],
  ['two real tracks, one with a comma stack', `$: note("a, b").gain(.5)\n$: note("c")`],
  ['ONE track, comma stack + chain', `$: note("a, b").gain(.8)`],
  ['ONE track, comma stack, no chain', `$: note("a, b")`],
  ['named labels', `drums: s("bd, cp").gain(.5)\nbass: note("c")`],
]

describe('#1476 discriminator', () => {
  for (const [name, code] of CASES) {
    it(name, () => {
      const m = miniExpanded(code)
      const outerChain = m.unresolvedChain !== undefined
      const perTrack = Array.isArray(m.tracks)
        ? (m.tracks as Record<string, unknown>[]).map((t) => t.unresolvedChain !== undefined)
        : null
      // eslint-disable-next-line no-console
      console.log(
        `\n--- ${name} ---\n  ${JSON.stringify(code)}\n` +
          `  MINI-EXPANDED tag=${m.tag}  OUTER chain=${outerChain}  per-track chain=${JSON.stringify(perTrack)}`,
      )
    })
  }

  it.skipIf(!hasCorpusArchive())('corpus: does ANY multi-track Stack carry an outer chain?', async () => {
    const corpus = await loadEveryCorpusDocument()
    let stacks = 0
    let stacksWithOuterChain = 0
    let alsoPerTrackChain = 0
    const names: string[] = []
    for (const { name, code } of corpus) {
      let m: Record<string, unknown>
      try { m = miniExpanded(code) } catch { continue }
      if (m.tag !== 'Stack') continue
      stacks++
      if (m.unresolvedChain === undefined) continue
      stacksWithOuterChain++
      names.push(name)
      const tracks = (m.tracks ?? []) as Record<string, unknown>[]
      if (tracks.some((t) => t.unresolvedChain !== undefined)) alsoPerTrackChain++
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== ${corpus.length} documents =====\n` +
        `MINI-EXPANDED root is a Stack: ${stacks}\n` +
        `  ...carrying an OUTER unresolvedChain: ${stacksWithOuterChain}\n` +
        `  ...of those, ALSO having a per-track chain (would be ambiguous): ${alsoPerTrackChain}\n` +
        names.join('\n'),
    )
  })
})

describe('#1476 blast radius', () => {
  it.skipIf(!hasCorpusArchive())('of the outer-chain Stacks, how many reach the multi-track branch?', async () => {
    const corpus = await loadEveryCorpusDocument()
    let outerChain = 0
    let wouldChange = 0   // outer chain AND userMethod === undefined → multi-track branch fires → chain dropped today
    let guarded = 0       // outer chain but userMethod set → single-track branch already → chain applied today
    for (const { code } of corpus) {
      let m: Record<string, unknown>
      try { m = miniExpanded(code) } catch { continue }
      if (m.tag !== 'Stack' || m.unresolvedChain === undefined) continue
      outerChain++
      if (m.userMethod === undefined) wouldChange++
      else guarded++
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== blast radius over ${corpus.length} documents =====\n` +
        `Stack + outer chain: ${outerChain}\n` +
        `  userMethod === undefined  (multi-track branch fires, chain DROPPED today): ${wouldChange}\n` +
        `  userMethod set            (single-track branch, chain applied today):      ${guarded}`,
    )
  })
})
