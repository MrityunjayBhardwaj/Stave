/**
 * #1553 PROBE — at CHAIN-APPLIED, what distinguishes a Stack that came from
 * SEVERAL STATEMENTS from one that came from ONE statement's top-level comma?
 *
 * Retiring the parser's comma-arm split needs this to be exact, not a
 * heuristic: a wrong answer either collapses real tracks into one lane or
 * keeps fabricating wrappers for comma arms.
 *
 * Candidate: RAW threads `dollarStart`/`dollarEnd`/`trackLabel` onto the
 * children of a multi-STATEMENT stack. Does it do so for EVERY multi-statement
 * shape — labelled, named, and the BARE multi-statement one (#1376)?
 */
import { describe, it } from 'vitest'
import { IR } from '../PatternIR'
import { runRawStage, runMiniExpandedStage } from '../parseStrudelStages'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

function meta(code: string): string {
  const raw = runRawStage(IR.code(code)) as unknown as Record<string, unknown>
  const me = runMiniExpandedStage(raw as never) as unknown as Record<string, unknown>
  const kids = Array.isArray(me.tracks) ? (me.tracks as Record<string, unknown>[]) : []
  return (
    `RAW tag=${raw.tag} rawKids=${Array.isArray(raw.tracks) ? (raw.tracks as unknown[]).length : '-'}  ` +
    `ME tag=${me.tag} kids=${kids.length} outerChain=${me.unresolvedChain !== undefined}\n` +
    `    per-child: ${JSON.stringify(kids.map((k) => ({
      dollarStart: k.dollarStart,
      label: k.trackLabel,
      chain: k.unresolvedChain !== undefined,
    })))}`
  )
}

const CASES: [string, string][] = [
  ['MULTI-STATEMENT labelled', '$: s("bd")\n$: s("cp")'],
  ['MULTI-STATEMENT named', 'drums: s("bd")\nbass: s("cp")'],
  ['MULTI-STATEMENT bare (#1376)', 's("bd")\ns("cp")'],
  ['MULTI-STATEMENT bare, 3 stmts', 's("bd")\ns("cp")\ns("hh")'],
  ['ONE statement, comma', '$: s("bd, cp")'],
  ['ONE statement, comma + chain', '$: s("bd, cp").gain(.5)'],
  ['ONE statement bare, comma', 's("bd, cp")'],
  ['ONE statement, bracketed stack', '$: s("[bd,cp]")'],
  ['MIXED: 2 stmts, first has comma', '$: s("bd, cp")\n$: s("hh")'],
]

describe('#1553 provenance', () => {
  for (const [name, code] of CASES) {
    it(name, () => {
      // eslint-disable-next-line no-console
      console.log(`\n--- ${name} ---\n  ${JSON.stringify(code)}\n  ${meta(code)}`)
    })
  }

  it.skipIf(!hasCorpusArchive())('corpus: is dollarStart-on-children a clean discriminator?', async () => {
    const corpus = await loadEveryCorpusDocument()
    let stacks = 0
    let allKidsHaveDollar = 0
    let noKidHasDollar = 0
    let mixed = 0
    const mixedNames: string[] = []
    for (const { name, code } of corpus) {
      let me: Record<string, unknown>
      try {
        me = runMiniExpandedStage(runRawStage(IR.code(code))) as unknown as Record<string, unknown>
      } catch { continue }
      if (me.tag !== 'Stack') continue
      const kids = (me.tracks ?? []) as Record<string, unknown>[]
      if (kids.length === 0) continue
      stacks++
      const withDollar = kids.filter((k) => k.dollarStart !== undefined).length
      if (withDollar === kids.length) allKidsHaveDollar++
      else if (withDollar === 0) noKidHasDollar++
      else { mixed++; mixedNames.push(`${name} (${withDollar}/${kids.length})`) }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== ${corpus.length} documents =====\n` +
        `MINI-EXPANDED Stacks: ${stacks}\n` +
        `  ALL children carry dollarStart (multi-statement): ${allKidsHaveDollar}\n` +
        `  NO child carries dollarStart (comma-expanded):     ${noKidHasDollar}\n` +
        `  MIXED (would be ambiguous):                        ${mixed}\n` +
        mixedNames.slice(0, 20).join('\n'),
    )
  })
})
