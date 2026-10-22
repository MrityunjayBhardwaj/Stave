import { describe, it, expect } from 'vitest'

import { detectAllChunks } from '../../chunkDetect'
import { applyEdits, type OffsetEdit } from '../../writeback'
import { gainEdit, panEdit, muteEdit, renameEdit, isValidTrackLabel } from '../writeStrip'

/** the nth detected chunk of a doc */
function chunkAt(src: string, i = 0) {
  return detectAllChunks(src)[i]
}
/** apply a strip edit to the source it was computed from */
function applied(src: string, edit: OffsetEdit | null): string {
  expect(edit).not.toBeNull()
  return applyEdits(src, [edit as OffsetEdit])
}

describe('gainEdit', () => {
  it('replaces a scalar gain literal in place', () => {
    const src = '$: s("bd").gain(0.6)'
    expect(applied(src, gainEdit(chunkAt(src), 0.8))).toBe('$: s("bd").gain(0.8)')
  })

  it('rescales a managed velocity gain to the new ceiling (shape kept)', () => {
    const src = '$: s("bd sn").gain("0.5 1")'
    expect(applied(src, gainEdit(chunkAt(src), 0.5))).toBe('$: s("bd sn").gain("0.25 0.5")')
  })

  it('appends .gain when absent', () => {
    const src = '$: s("bd")'
    expect(applied(src, gainEdit(chunkAt(src), 0.7))).toBe('$: s("bd").gain(0.7)')
  })

  it('hands off a signal gain (no edit)', () => {
    expect(gainEdit(chunkAt('$: s("bd").gain(sine)'), 0.5)).toBeNull()
  })
})

describe('panEdit', () => {
  it('replaces a scalar pan literal in place', () => {
    const src = '$: s("bd").pan(0.3)'
    expect(applied(src, panEdit(chunkAt(src), 0.8))).toBe('$: s("bd").pan(0.8)')
  })

  it('appends .pan when absent', () => {
    const src = '$: s("bd")'
    expect(applied(src, panEdit(chunkAt(src), 0.2))).toBe('$: s("bd").pan(0.2)')
  })

  it('hands off a patterned/signal pan (no edit)', () => {
    expect(panEdit(chunkAt('$: s("bd").pan(sine)'), 0.5)).toBeNull()
  })
})

describe('muteEdit', () => {
  it('mutes an anonymous $: by inserting the marker', () => {
    expect(applied('$: s("bd")', muteEdit(chunkAt('$: s("bd")'), true))).toBe('_$: s("bd")')
  })

  it('mutes a named track by inserting the marker', () => {
    expect(applied('d1: s("bd")', muteEdit(chunkAt('d1: s("bd")'), true))).toBe('_d1: s("bd")')
  })

  it('unmutes by deleting the leading marker (exact inverse — byte-identical round-trip)', () => {
    const src = 'd1: s("bd").gain(0.5)'
    const muted = applied(src, muteEdit(chunkAt(src), true))
    expect(muted).toBe('_d1: s("bd").gain(0.5)')
    expect(applied(muted, muteEdit(chunkAt(muted), false))).toBe(src)
  })

  it('is orthogonal to gain — muting never touches .gain (V-mixer-2)', () => {
    const src = '$: s("bd").gain(0.5).pan(0.3)'
    expect(applied(src, muteEdit(chunkAt(src), true))).toBe('_$: s("bd").gain(0.5).pan(0.3)')
  })

  it('no-ops when already in the requested state', () => {
    expect(muteEdit(chunkAt('_$: s("bd")'), true)).toBeNull()
    expect(muteEdit(chunkAt('$: s("bd")'), false)).toBeNull()
  })

  it('hands off an unlabelled statement (no marker to carry)', () => {
    expect(muteEdit(chunkAt('s("bd")'), true)).toBeNull()
  })
})

describe('muteEdit / renameEdit on a trailing `_` marker (#1679)', () => {
  it('unmuting a suffix-muted track removes the marker it HAS', () => {
    expect(applied('drums_: s("bd")', muteEdit(chunkAt('drums_: s("bd")'), false))).toBe('drums: s("bd")')
    expect(applied('$_: s("bd")', muteEdit(chunkAt('$_: s("bd")'), false))).toBe('$: s("bd")')
    // both markers → both go
    expect(applied('_d1_: s("bd")', muteEdit(chunkAt('_d1_: s("bd")'), false))).toBe('d1: s("bd")')
  })

  it('a suffix-muted track is already muted', () => {
    expect(muteEdit(chunkAt('drums_: s("bd")'), true)).toBeNull()
  })

  it('renaming keeps a suffix marker where it is', () => {
    expect(applied('drums_: s("bd")', renameEdit(chunkAt('drums_: s("bd")'), 'kick', new Set()))).toBe('kick_: s("bd")')
    // renaming to the bare name it already has is a no-op
    expect(renameEdit(chunkAt('drums_: s("bd")'), 'drums', new Set())).toBeNull()
  })
})

describe('renameEdit (#580 Phase C)', () => {
  // No sibling tracks → no name can collide. The #585 collision cases below pass
  // a populated set.
  const NO_SIBLINGS = new Set<string>()

  it('renames a named track in place', () => {
    expect(applied('bass: s("bd")', renameEdit(chunkAt('bass: s("bd")'), 'lead', NO_SIBLINGS))).toBe('lead: s("bd")')
  })

  it('names an anonymous $: track — inserts a label by replacing the `$`', () => {
    expect(applied('$: s("bd*4")', renameEdit(chunkAt('$: s("bd*4")'), 'drums', NO_SIBLINGS))).toBe('drums: s("bd*4")')
  })

  it('preserves the `_` mute marker — a muted track stays muted across rename', () => {
    expect(applied('_$: s("bd")', renameEdit(chunkAt('_$: s("bd")'), 'drums', NO_SIBLINGS))).toBe('_drums: s("bd")')
    expect(applied('_bass: s("bd")', renameEdit(chunkAt('_bass: s("bd")'), 'lead', NO_SIBLINGS))).toBe('_lead: s("bd")')
  })

  it('leaves the pattern expression byte-identical (only the label changes)', () => {
    const src = 'bass: note("c2 e2").s("sawtooth").gain(0.5).pan(0.3)'
    expect(applied(src, renameEdit(chunkAt(src), 'sub', NO_SIBLINGS))).toBe(
      'sub: note("c2 e2").s("sawtooth").gain(0.5).pan(0.3)',
    )
  })

  it('keeps sibling statements untouched when renaming one', () => {
    const src = '$: s("bd*4")\nlead: note("c4")\n$: s("hh*8")'
    const out = applyEdits(src, [renameEdit(chunkAt(src, 0), 'drums', NO_SIBLINGS) as OffsetEdit])
    expect(out).toBe('drums: s("bd*4")\nlead: note("c4")\n$: s("hh*8")')
  })

  it('no-ops when the new name equals the current (bare) label', () => {
    expect(renameEdit(chunkAt('bass: s("bd")'), 'bass', NO_SIBLINGS)).toBeNull()
    expect(renameEdit(chunkAt('_bass: s("bd")'), 'bass', NO_SIBLINGS)).toBeNull() // marker-stripped compare
  })

  it('rejects an invalid label (no write — the UI reverts)', () => {
    expect(renameEdit(chunkAt('$: s("bd")'), '2drums', NO_SIBLINGS)).toBeNull() // not an identifier
    expect(renameEdit(chunkAt('$: s("bd")'), 'my track', NO_SIBLINGS)).toBeNull() // space
    expect(renameEdit(chunkAt('$: s("bd")'), 'return', NO_SIBLINGS)).toBeNull() // reserved word
    expect(renameEdit(chunkAt('$: s("bd")'), '', NO_SIBLINGS)).toBeNull() // empty
  })

  it('hands off an unlabelled bare expression (no label slot)', () => {
    expect(renameEdit(chunkAt('s("bd")'), 'drums', NO_SIBLINGS)).toBeNull()
  })
})

describe('renameEdit — duplicate-name collision guard (#585)', () => {
  it('rejects a rename to a name another track already uses', () => {
    // bass → lead, but a `lead:` track already exists → reject (no duplicate).
    const taken = new Set(['lead', 'd3'])
    expect(renameEdit(chunkAt('bass: s("bd")'), 'lead', taken)).toBeNull()
  })

  it('rejects naming an anon track a name a sibling already uses', () => {
    expect(renameEdit(chunkAt('$: s("bd")'), 'drums', new Set(['drums']))).toBeNull()
  })

  it('rejects a rename onto a sibling anon track’s positional d{N} name', () => {
    // Renaming a named track to `d2` would collide with an anon track displayed
    // as `d2` (both then key the same colour-override). The caller passes the
    // anon display names in `takenNames`.
    expect(renameEdit(chunkAt('bass: s("bd")'), 'd2', new Set(['d2']))).toBeNull()
  })

  it('allows a rename to a free name even when other names are taken', () => {
    const taken = new Set(['lead', 'd3'])
    expect(applied('bass: s("bd")', renameEdit(chunkAt('bass: s("bd")'), 'sub', taken))).toBe(
      'sub: s("bd")',
    )
  })

  it('does not treat the track’s own current name as a collision', () => {
    // The caller excludes the renamed track; even if its own name leaks into the
    // set, the no-op check fires first for a named track, and an anon rename to a
    // free name still succeeds.
    expect(applied('$: s("bd*4")', renameEdit(chunkAt('$: s("bd*4")'), 'drums', new Set(['lead'])))).toBe(
      'drums: s("bd*4")',
    )
  })
})

describe('isValidTrackLabel', () => {
  it('accepts identifiers (incl. config-head words — valid AS labels)', () => {
    for (const ok of ['drums', 'bass2', '_kick', '$lead', 'setcps', 'hush']) {
      expect(isValidTrackLabel(ok), ok).toBe(true)
    }
  })
  it('accepts any identifier, not only ASCII ones (#1683, #1921)', () => {
    for (const ok of ['節奏', '前奏', 'café', 'x\u200Cy']) expect(isValidTrackLabel(ok), ok).toBe(true)
  })
  it('rejects non-identifiers and reserved words', () => {
    for (const bad of ['2drums', 'my track', 'a-b', '', 'return', 'class', 'for', 'interface', 'static']) {
      expect(isValidTrackLabel(bad), bad).toBe(false)
    }
  })
})

describe('write is surgical — siblings stay byte-identical', () => {
  it('editing one statement leaves the others untouched', () => {
    const src = '$: s("bd").gain(0.5)\nd1: note("c e").pan(0.2)\n$: s("hh*4")'
    // edit the gain on the SECOND statement's neighbour by index 0
    const out = applyEdits(src, [gainEdit(chunkAt(src, 0), 0.9) as OffsetEdit])
    expect(out).toBe('$: s("bd").gain(0.9)\nd1: note("c e").pan(0.2)\n$: s("hh*4")')
  })
})
