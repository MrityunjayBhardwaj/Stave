/**
 * bareCapture — the bare document's captureId, pinned against the rule that
 * actually assigns captureIds (#1097).
 *
 * The point of these tests is NOT that `resolveBareCaptureId` returns `'$0'`.
 * Asserting that against a literal would pass just as happily if the mixer
 * renumbered its strips tomorrow, and the failure would then show up as a dead
 * meter nobody could trace. So the agreement is asserted against
 * `buildStripModels` itself — the function the mixer joins on — and a literal is
 * used only where it is the fact under test (the id's own value).
 */
import { describe, it, expect } from 'vitest'

import { resolveBareCaptureId } from '../bareCapture'
import { detectAllChunks } from '../../codeView/chunkDetect'
// BARE_CAPTURE_ID is imported from the mixer, not from `bareCapture`, because
// that is where the id is ASSIGNED (#1174). Importing it from the engine side
// would be reading the answer from the party that only asks the question.
import { buildStripModels, BARE_CAPTURE_ID } from '../../codeView/mixer/stripModel'

/** the captureIds the mixer will draw for this document, in source order */
const stripCaptureIds = (code: string): string[] =>
  buildStripModels(detectAllChunks(code), code).map((s) => s.captureId)

describe('resolveBareCaptureId — accepts only the unambiguous single bare track', () => {
  it('a lone bare statement resolves, and to the id the mixer gives that strip', () => {
    const code = 's("bd*4")'
    const id = resolveBareCaptureId(code)
    expect(id).not.toBeNull()
    // THE JOIN, stated against the real numbering rather than a literal.
    expect(stripCaptureIds(code)).toEqual([id])
  })

  it('a config head before the track does not consume a slot', () => {
    // `setcps` is not a track, so the bare statement is still the only one and
    // still numbers `$0` — the off-by-one the strip model warns about.
    const code = 'setcps(0.5)\ns("bd*4")'
    const id = resolveBareCaptureId(code)
    expect(id).not.toBeNull()
    expect(stripCaptureIds(code)).toEqual([id])
  })

  it('TWO bare statements bind to the LAST — the one strudel plays (#1096)', () => {
    const code = 's("bd*4")\ns("hh*8")'
    const id = resolveBareCaptureId(code)
    // This case was REFUSED until #1096, and the refusal was right at the time:
    // the strips number from the first while strudel plays the last, so any id
    // was a guess and a meter on the wrong track is worse than a dark one. What
    // changed is not the courage to guess — it is that the id now names the last
    // statement explicitly, and the IR declares a lane for it to mean.
    expect(id).not.toBeNull()
    // THE JOIN, against the real numbering rather than a literal: the id must be
    // the LAST strip's, and the first must not be joinable at all.
    const ids = stripCaptureIds(code)
    expect(ids).toHaveLength(2)
    expect(ids[ids.length - 1]).toBe(id)
    expect(ids[0]).not.toBe(id)
    expect(ids[0]).not.toMatch(/^\$\d+$/)
  })

  it('THREE bare statements still bind exactly one — the last', () => {
    // The one pattern that exists is the last expression; giving every bare strip
    // the same key would meter one sound on three faders.
    const code = 's("bd*4")\ns("cp*2")\ns("hh*8")'
    expect(resolveBareCaptureId(code)).toBe('$2')
    expect(stripCaptureIds(code).filter((c) => /^\$\d+$/.test(c))).toEqual(['$2'])
  })

  it('a labelled track is refused — the .p() path owns it', () => {
    expect(resolveBareCaptureId('$: s("bd*4")')).toBeNull()
    expect(resolveBareCaptureId('d1: s("bd*4")')).toBeNull()
  })

  it('a MUTED lone track is refused, so the entry cannot contradict the mute', () => {
    const code = '_$: s("bd*4")'
    expect(resolveBareCaptureId(code)).toBeNull()
    // The mixer keys a muted anonymous track `_$<index>`, which is deliberately
    // never a live scheduler key — writing `$0` here would light a strip the
    // user silenced, and would not even be the strip's own id.
    expect(stripCaptureIds(code)).not.toContain(BARE_CAPTURE_ID)
  })

  it('with EVERY label muted, the last bare statement is what plays, and it joins (#1686)', () => {
    // A `_`-muted label returns silence without registering, so strudel plays
    // the last expression — the bare statement below it. Its meter was dark.
    const code = '_$: s("bd*4")\nn("c e g").s("ptest")'
    const id = resolveBareCaptureId(code)
    expect(id).not.toBeNull()
    // the id is the one the mixer gives THAT strip, and no other strip
    expect(stripCaptureIds(code)).toEqual(['_$0', id])
  })

  it('…but a muted label that is itself the last statement plays silence, owned by no strip', () => {
    expect(resolveBareCaptureId('n("c e g")\n_$: s("bd*4")')).toBeNull()
  })

  it('an empty or track-less document resolves to nothing', () => {
    expect(resolveBareCaptureId('')).toBeNull()
    expect(resolveBareCaptureId('setcps(0.5)')).toBeNull()
  })

  it('the id is the first anonymous slot — the value the hap→lane join maps to d1', () => {
    expect(BARE_CAPTURE_ID).toBe('$0')
    // ...and it is the n = 1 instance of the general rule, not a parallel one:
    // a single-track document resolves to exactly this value.
    expect(resolveBareCaptureId('s("bd*4")')).toBe(BARE_CAPTURE_ID)
  })
})
