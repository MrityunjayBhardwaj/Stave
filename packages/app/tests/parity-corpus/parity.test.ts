/**
 * parity.test.ts — Strudel.cc parity corpus structural gate (γ-2).
 *
 * Phase 20-14 D-01 — structural parity rung only:
 *   - Parser-IR shape (tag tree)
 *   - Param keys per node
 *   - Tree topology (children/body slot population)
 *
 * Each `.strudel` file in this directory is a byte-faithful extraction
 * of a named export from upstream `tunes.mjs` at the SHA pinned in
 * `CORPUS-SOURCE.md`. The spec evals each file through Stave's pure
 * `parseStrudel(code)` (no audio context, no scheduler) and snapshots
 * the normalized IR shape. See `normalize.ts` for the strip-field
 * rationale and CORPUS-SOURCE.md for the parser-IR vs runtime-IR
 * choice with reasoning.
 *
 * Drift policy:
 *   - Non-corpus PRs that touch `packages/editor/src/engine/` or
 *     `packages/editor/src/codeView/ir/` and incidentally produce a snapshot
 *     diff MUST call out the diff in the PR body (PLAN §2).
 *   - Snapshot regeneration (`vitest -u`) belongs in a PR titled
 *     `corpus: refresh from upstream SHA <x>` after running γ-3's
 *     `pnpm parity:refresh`. NEVER run `-u` casually in development
 *     to "make the test green" — the diff IS the news.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Import parseStrudel directly from the editor source path rather than via
// `@stave/editor` (the package barrel). The barrel re-exports the full
// editor surface, which pulls in @strudel/draw → gifenc (CJS) → ESM
// import-resolver crash under vite-node. Existing app tests that need
// runtime values from the editor follow this same deep-path convention
// (see e.g. components/__tests__/IRInspectorPanel.test.tsx:32 for the
// HapStream/BreakpointStore precedent).
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'
import { normalizeIRShape } from './normalize'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))

// Read the corpus directory at test-collection time so each tune becomes
// its own `it()` block with its own snapshot. A new tune appearing in the
// directory shows up as a failing test on first run, prompting the
// maintainer to regenerate snapshots (or remove the tune if accidental).
const corpusFiles = fs
  .readdirSync(corpusDir)
  .filter((f) => f.endsWith('.strudel'))
  .sort()

describe('strudel.cc parity corpus — structural IR shape', () => {
  it('vendored corpus is non-empty (sanity gate)', () => {
    // If this fails, the directory got wiped or the test is running with
    // an unexpected cwd — every other test below would have nothing to
    // assert and the suite would pass vacuously.
    expect(corpusFiles.length).toBeGreaterThan(0)
  })

  for (const fileName of corpusFiles) {
    const tuneName = fileName.replace(/\.strudel$/, '')
    it(`${tuneName} parses to a stable IR shape`, () => {
      const code = fs.readFileSync(path.join(corpusDir, fileName), 'utf8')
      const ir = parseStrudel(code)
      const normalized = normalizeIRShape(ir)
      // Inline snapshot file shape: one entry per tune, keyed by the
      // test title above. Stored under `__snapshots__/parity.test.ts.snap`.
      expect(normalized).toMatchSnapshot()
    })
  }
})
