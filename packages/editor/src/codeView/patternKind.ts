/**
 * patternKind — the HEAD discriminator: which grid editor a chunk's chain head
 * asks for. `s`/`sound` make a drum/step pattern (Sequencer), `note`/`n` make a
 * melodic one (Piano Roll), and those are mutually exclusive.
 *
 * ⚠ KEEP THIS MODULE FREE OF THE NOTATION PARSER. `mixer/stripModel.ts` imports
 * it and the engine reaches that through `bareCapture.ts`, so a
 * `notation/parse.ts` edge here puts `@strudel/mini`'s krill parser into
 * `StrudelEngine`'s module graph — which breaks a `vi.mock` factory there at
 * LOAD and kills a 37-test suite, with both typechecks still at baseline.
 * Measured, not hypothetical: it happened while building #1240.
 *
 * That constraint is also the domain line. Until #1240 the head was the only
 * signal, so "what kind of head is this" and "which surface should this content
 * open" were one question. A resolver-supplied span has a head that says
 * nothing (`lpf`, `seq`, `pick`, none at all), so the second question now needs
 * the content parsed and the first still must not. The content-aware router
 * lives in `surfaceRoute.ts` and composes this one.
 *
 * One home per question, so the Sequencer, Piano Roll, the Pattern panel that
 * switches between them, and the coverage harness that scores them can't drift
 * on what counts as drum vs melody (PV108 spirit).
 */
import type { ChunkInfo } from './'

/** the sequencer only edits sound/sample patterns; notes go to the Piano Roll */
export function isStepChunk(chunk: ChunkInfo): boolean {
  return chunk.miniString !== null && (chunk.headFn === 's' || chunk.headFn === 'sound')
}

/** the piano roll only edits melodic patterns */
export function isRollChunk(chunk: ChunkInfo): boolean {
  return chunk.miniString !== null && (chunk.headFn === 'note' || chunk.headFn === 'n')
}

export type PatternKind = 'step' | 'roll' | null

/**
 * Which grid editor the chunk's HEAD asks for, or null.
 *
 * Head-only and deliberately so — this module must stay free of the notation
 * parser. `mixer/stripModel.ts` imports it and the engine reaches that through
 * `bareCapture.ts`, so a `notation/parse.ts` edge here puts the krill parser in
 * `StrudelEngine`'s graph and breaks a mocked test suite at load. For the
 * content-aware answer (a span the resolver named, whose head says nothing),
 * call `chunkSurface` in `surfaceRoute.ts`.
 */
export function patternKind(chunk: ChunkInfo | null): PatternKind {
  if (!chunk) return null
  if (isStepChunk(chunk)) return 'step'
  if (isRollChunk(chunk)) return 'roll'
  return null
}
