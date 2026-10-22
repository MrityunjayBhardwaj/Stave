/**
 * Where the tree the song depends on comes from — stated once (#1558).
 *
 * ## The rule
 *
 * The Inspector's three INTERMEDIATE tabs are `parseStrudelStages` — since #1387
 * derived from the parser's own record of each track body. The FINAL tree is the
 * PARSER's. Four tabs either way, same names.
 *
 * ## Why it needed saying
 *
 * `parseStrudelStages.ts` was a parallel reimplementation of decisions
 * `parseStrudel` makes, kept in sync by hand (#1387 replaced it with a
 * derivation). It existed so the Inspector could show a parse in steps —
 * `parseStrudel` did all of it in one pass and never stopped to show its work.
 * That made it a DEBUGGING affordance.
 *
 * But `MusicalTimeline` analyses `snapshot.ir`, and `snapshot.ir` was the
 * staged pipeline's output. So the song drank from the debugger's cup, and a
 * bug in a panel that is not even reachable today (the Inspector's tab
 * registration is commented out pending #680) could silence a track. #1553 did
 * exactly that: `runChainAppliedStage` dropped a chain applied over a comma
 * pattern, and six archive documents lost every method in their chain — one
 * kept 7 of its 66 notes, another kept every note and lost the instrument.
 *
 * ⚠ THAT BUG IS NOT EXPRESSIBLE IN `parseStrudel`, which passes the chain
 * straight from `parseRoot` to `applyChain` as a local. The staged path must
 * stash it on a node (`unresolvedChain`) to carry it across a stage boundary,
 * and #1553 was that stash landing on a `Stack`. The split creates the class.
 *
 * ⚠ THE FINAL TREE IS APPENDED AS A PASS, NOT ASSIGNED TO `ir` ALONE.
 * `IRSnapshot.ir` is documented as an alias of `passes[passes.length - 1].ir`,
 * with publishers required to keep them in sync (`irInspector.ts:27`), and
 * `irInspector.integration.test.ts` asserts it. Setting `ir` by itself would
 * break that invariant.
 *
 * The Inspector gains rather than being bypassed: its `Parsed` tab now shows
 * what the app actually uses, so future staged drift appears as a visible
 * difference between the CHAIN-APPLIED and Parsed tabs — in the debugger, where
 * it belongs, instead of silently in a song.
 *
 * ## Why the parsers can be handed in
 *
 * ⚠ PROVENANCE IS NOT OBSERVABLE FROM THE OUTPUT, SO IT HAS TO BE INJECTED TO BE
 * TESTED. Measured over all 558 archive documents: the two final trees are
 * byte-identical (corpus parity has been 0/558 since #1553 and #1476), and
 * NEITHER carries any of the five stage-only fields — `unresolvedChain`,
 * `chainOffset`, `dollarStart`, `dollarEnd`, `trackLabel` — 0 of 558 on both
 * sides. There is therefore no assertion over the tree that can tell which
 * implementation produced it. Without a seam, this module could silently revert
 * to the staged tree and every test would still pass. The test hands in
 * sentinels and checks which one came back, and pins `STRUDEL_PASS_DEPS` to the
 * real parsers, which every caller gets by default.
 *
 * This file lived in the app until #1940, which took its parsers from the call
 * site because the app's tests could not load the editor's main entry (#1938).
 *
 * ## Cost, measured over 558 documents
 *
 * Measured before #1387: `parseStrudel` 0.506ms/doc · staged 0.445ms/doc · both
 * 0.951ms/doc — once per
 * successful eval, on an already-debounced path.
 */
import type { PatternIR } from './PatternIR'
import { parseStrudel } from './parseStrudel'
import { parseStrudelStages } from './parseStrudelStages'

/** One `{name, ir}` entry, matching `IRSnapshot.passes[]`. */
export type NamedPass = { readonly name: string; readonly ir: PatternIR }

export interface StrudelPassDeps {
  /** The Inspector's INTERMEDIATE views — RAW, MINI-EXPANDED, CHAIN-APPLIED — in order. */
  readonly runStages: (code: string) => readonly NamedPass[]
  /** The parser. Never throws — falls back to a whole-program Code node. */
  readonly parse: (code: string) => PatternIR
}

/** The real parsers — what every caller gets unless a test hands in its own. */
export const STRUDEL_PASS_DEPS: StrudelPassDeps = {
  runStages: parseStrudelStages,
  parse: parseStrudel,
}

/** The name of the final tab. Unchanged — IRInspectorPanel persists by name. */
export const FINAL_PASS_NAME = 'Parsed'

/**
 * Build the four passes for one document. The last entry is always the
 * parser's tree, whatever the intermediate views said.
 */
export function buildStrudelPasses(
  code: string,
  deps: StrudelPassDeps = STRUDEL_PASS_DEPS,
): NamedPass[] {
  return [...deps.runStages(code), { name: FINAL_PASS_NAME, ir: deps.parse(code) }]
}
