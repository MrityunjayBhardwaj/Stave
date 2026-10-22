/**
 * reconcileSoloMutes / soloMuteEdits — the whole solo-as-code-mutes policy (#735, #1909).
 *
 * These lock the behaviours a user relies on: soloing mutes every OTHER muteable
 * track and un-mutes the soloed one; the snapshot captures the pre-solo mutes on
 * first activation; clearing solo RESTORES that snapshot (so a hand-set mute
 * survives a solo→un-solo round-trip, not wiped); non-muteable strips are never
 * targeted.
 */
import { describe, it, expect } from 'vitest'

import { reconcileSoloMutes, soloMuteEdits, type SoloStripFacts } from '../writeStrip'
import { applyEdits } from '../../writeback'

// d1/d2/d3 named tracks (muteable); `bare` = a bare-expression strip (not muteable).
const base: SoloStripFacts[] = [
  { id: 'd1', muted: false, muteable: true },
  { id: 'd2', muted: false, muteable: true },
  { id: 'd3', muted: false, muteable: true },
]

describe('reconcileSoloMutes', () => {
  it('solo mutes every other track; captures an empty snapshot when nothing was muted', () => {
    const { targetMuted, nextSnapshot } = reconcileSoloMutes(base, new Set(['d2']), null)
    expect(targetMuted).toEqual(new Set(['d1', 'd3'])) // d2 soloed → audible
    expect(nextSnapshot).toEqual(new Set()) // no pre-solo mutes
  })

  it('soloing a track that was muted un-mutes it (it becomes the audible one)', () => {
    const strips = base.map((s) => (s.id === 'd2' ? { ...s, muted: true } : s))
    const { targetMuted, nextSnapshot } = reconcileSoloMutes(strips, new Set(['d2']), null)
    expect(targetMuted.has('d2')).toBe(false) // d2 un-muted despite being muted before
    expect(targetMuted).toEqual(new Set(['d1', 'd3']))
    expect(nextSnapshot).toEqual(new Set(['d2'])) // snapshot remembers d2 was muted
  })

  it('multiple solos keep all soloed tracks audible', () => {
    const { targetMuted } = reconcileSoloMutes(base, new Set(['d1', 'd3']), null)
    expect(targetMuted).toEqual(new Set(['d2']))
  })

  it('preserves the snapshot across further solo edits (does NOT re-capture)', () => {
    // d1 muted by hand; solo d2 (snapshot={d1}); now also solo d3 — snapshot must stay {d1}.
    const strips = base.map((s) => (s.id === 'd1' ? { ...s, muted: true } : s))
    const { nextSnapshot } = reconcileSoloMutes(strips, new Set(['d2', 'd3']), new Set(['d1']))
    expect(nextSnapshot).toEqual(new Set(['d1']))
  })

  it('clearing solo RESTORES the pre-solo mutes (hand-set mute survives)', () => {
    // Pre-solo: d1 was muted. Snapshot carried {d1}. Un-solo (empty set) → restore {d1}.
    const { targetMuted, nextSnapshot } = reconcileSoloMutes(base, new Set(), new Set(['d1']))
    expect(targetMuted).toEqual(new Set(['d1'])) // d1 stays muted; d2/d3 audible
    expect(nextSnapshot).toBeNull()
  })

  it('clearing solo with no snapshot un-mutes everything', () => {
    const { targetMuted, nextSnapshot } = reconcileSoloMutes(base, new Set(), null)
    expect(targetMuted).toEqual(new Set())
    expect(nextSnapshot).toBeNull()
  })

  it('never targets a non-muteable (bare-expression) strip', () => {
    const strips: SoloStripFacts[] = [
      ...base,
      { id: '#3', muted: false, muteable: false },
    ]
    const { targetMuted } = reconcileSoloMutes(strips, new Set(['d1']), null)
    expect(targetMuted.has('#3')).toBe(false) // can't carry `_` → left alone
    expect(targetMuted).toEqual(new Set(['d2', 'd3']))
  })
})

// #1909 — the same policy as the edits it makes to a real document.
describe('soloMuteEdits', () => {
  const doc = 'd1: s("bd*4")\nd2: s("hh*8")\n_d3: s("~ sd")\ns("cp")\n'
  const run = (d: string, solo: string[], snap: ReadonlySet<string> | null) => {
    const r = soloMuteEdits(d, new Set(solo), snap)
    return { ...r, text: applyEdits(d, r.edits) }
  }

  it('soloing d1 mutes the other named tracks, leaves a muted one alone, never touches the bare one', () => {
    const r = run(doc, ['d1'], null)
    expect(r.text).toBe('d1: s("bd*4")\n_d2: s("hh*8")\n_d3: s("~ sd")\ns("cp")\n')
    expect(r.edits).toHaveLength(1)
    expect([...(r.nextSnapshot ?? [])]).toEqual(['d3'])
  })

  it('soloing a muted track un-mutes it', () => {
    const r = run(doc, ['d3'], null)
    expect(r.text).toBe('_d1: s("bd*4")\n_d2: s("hh*8")\nd3: s("~ sd")\ns("cp")\n')
  })

  it('un-soloing restores the hand-set mutes from the snapshot, and drops it', () => {
    const soloed = run(doc, ['d1'], null)
    const cleared = run(soloed.text, [], soloed.nextSnapshot)
    expect(cleared.text).toBe(doc)
    expect(cleared.nextSnapshot).toBeNull()
  })

  it('nothing to write still carries the snapshot forward', () => {
    const soloed = run(doc, ['d1'], null)
    const again = run(soloed.text, ['d1'], soloed.nextSnapshot)
    expect(again.edits).toEqual([])
    expect(again.nextSnapshot).toBe(soloed.nextSnapshot)
  })
})

// A config line first: a strip's place in the strip list is NOT its statement's
// place in the document (#559). The edits must land on the strip's own statement.
describe('soloMuteEdits with a config line first', () => {
  it('mutes the right statements, never the config line', () => {
    const doc = 'setcps(0.5)\nd1: s("bd*4")\nd2: s("hh*8")\n'
    const r = soloMuteEdits(doc, new Set(['d1']), null)
    expect(applyEdits(doc, r.edits)).toBe('setcps(0.5)\nd1: s("bd*4")\n_d2: s("hh*8")\n')
  })
})
