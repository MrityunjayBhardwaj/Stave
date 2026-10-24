/**
 * Hydra hover + completion — sourced from the hydra-synth function list
 * (`glsl-functions.js` vendored as `data/hydra.json` via
 * `scripts/fetch-docs/hydra.mjs`) plus a small hand-curated set of
 * runtime-only globals (output buffers, `hush`, `time`, etc.) that don't
 * live in the GLSL list.
 *
 * Re-sync with upstream:
 *   node packages/editor/scripts/fetch-docs/hydra.mjs
 */

import type * as Monaco from 'monaco-editor'
import type { CommonMistake, DocsIndex } from './types'
import { validateDocsIndex } from './types'
import { registerRuntimeProviders } from './providers'
import RAW from './data/hydra.json'

validateDocsIndex('hydra.json', RAW)

/**
 * Hand-curated overlay applied after JSON load (same pattern as p5).
 * Sonic Pi has its own (Ruby) error surface and isn't seeded here yet
 * — see issue tracker for follow-up curation.
 */
const HYDRA_GLOBAL_MISTAKES: CommonMistake[] = [
  {
    // `out` is a method on a chain (`osc().out()`), not a free fn.
    // Calling it bare surfaces as `out is not a function` (when it's
    // shadowed) or — more often — `out is not defined`. Levenshtein
    // would match `out` to itself as a symbol, but the existing fuzzy
    // path returns "Did you mean out?" which isn't useful.
    detect: { kind: 'message', match: /^out is not (?:a function|defined)$/ },
    hint: 'Hydra outputs render by calling `.out()` on a chain — try `s.osc().out()`.',
    example: 's.osc(20, 0.1, 1.0).out()',
  },
]

const HYDRA_RAW_INDEX = RAW as DocsIndex
export const HYDRA_DOCS_INDEX: DocsIndex = {
  ...HYDRA_RAW_INDEX,
  // A `.hydra` file gets the synth as `s` (hydraCompiler), not as globals.
  receiver: 's',
  globalMistakes: [
    ...(HYDRA_RAW_INDEX.globalMistakes ?? []),
    ...HYDRA_GLOBAL_MISTAKES,
  ],
}

export function registerHydraProviders(
  monaco: typeof Monaco,
): Monaco.IDisposable[] {
  return registerRuntimeProviders(monaco, HYDRA_DOCS_INDEX, {
    hover: true,
    dotCompletion: true,
    identifierCompletion: true,
  })
}
