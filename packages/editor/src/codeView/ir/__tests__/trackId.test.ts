/**
 * trackId — the mute-invariant identity rule (#737).
 *
 * A muted track (`_` label prefix) must resolve to the SAME lane identity as its
 * unmuted self, so muting keeps a track in its place (and doesn't collapse every
 * anon `_$:` onto one lane). Guards the P235 trap: identity must strip `_` the
 * same way the DISPLAY deriver (`labelAtOffset`) already does.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { trackIdFromLabel, trackIdsFromLabels, isMutedLabel, splitMuteMarker, isIdentifier, isWritableName, labelName, labelAtOffset, sectionNameAt, shownTrackName, LABEL_HEAD } from '../trackId'
import { parseStrudel } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'

function trackIds(ir: PatternIR): string[] {
  if (ir.tag === 'Stack') return ir.tracks.map((t) => (t.tag === 'Track' ? t.trackId : '?'))
  if (ir.tag === 'Track') return [ir.trackId]
  return []
}

describe('the owner stays importable from anywhere (#1679)', () => {
  it('has no imports at all, so the engine can reach it without the codeView entry', () => {
    // The engine's line scanners (`vizLineScan.ts`, `blockScan.ts`) import
    // `LABEL_HEAD` from this file directly, under named boundary entries, because
    // the engine's graph must not load the codeView entry. An import added here
    // would travel into that graph.
    const source = readFileSync(path.join(__dirname, '..', 'trackId.ts'), 'utf8')
    const imports = source.match(/^\s*(import\s|export\s+\{[^}]*\}\s*from|.*\brequire\()/gm) ?? []
    expect(imports).toEqual([])
    // Control: the same read on a file that DOES import finds one.
    const parser = readFileSync(path.join(__dirname, '..', 'parseStrudel.ts'), 'utf8')
    expect(parser.match(/^\s*import\s/gm)?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('trackIdFromLabel — mute-invariant identity', () => {
  it('anon `$:` (bare or muted) keeps the positional `d{i+1}`', () => {
    expect(trackIdFromLabel('$', 0)).toBe('d1')
    expect(trackIdFromLabel('_$', 0)).toBe('d1') // muted anon → still positional, NOT '_$'
    expect(trackIdFromLabel('$', 1)).toBe('d2')
    expect(trackIdFromLabel('_$', 1)).toBe('d2')
  })

  it('named track: mute is invariant (same id muted or not)', () => {
    expect(trackIdFromLabel('drums', 0)).toBe('drums')
    expect(trackIdFromLabel('_drums', 0)).toBe('drums') // muted named → same lane, NOT '_drums'
  })

  it('undefined label falls to positional', () => {
    expect(trackIdFromLabel(undefined, 0)).toBe('d1')
  })
})

describe('parseStrudel — muted tracks keep their lane (#737 regression)', () => {
  it('two muted anon `$:` do NOT collapse into one lane', () => {
    // Without the `_`-strip both became trackId `_$` → ONE lane.
    expect(trackIds(parseStrudel('_$: s("bd")\n_$: s("hh")'))).toEqual(['d1', 'd2'])
  })

  it('a muted named track keeps its unmuted identity', () => {
    // Without the strip the muted track became `_drums` — a new lane.
    expect(trackIds(parseStrudel('drums: s("bd")\n_lead: s("hh")'))).toEqual(['drums', 'lead'])
  })

  it('mixed muted/unmuted anon stay in their positional slots', () => {
    expect(trackIds(parseStrudel('$: s("bd")\n_$: s("hh")\n$: s("cp")'))).toEqual(['d1', 'd2', 'd3'])
  })
})

describe('trackIdsFromLabels — ids are unique across the DOCUMENT (#1667)', () => {
  it('leaves every non-colliding document byte-identical', () => {
    // The safety property: the positional id starts at its own position, so a
    // document whose names do not collide is assigned exactly what the
    // per-track rule assigned before.
    expect(trackIdsFromLabels(['$', '$', '$'])).toEqual(['d1', 'd2', 'd3'])
    expect(trackIdsFromLabels(['drums', '$', 'bass'])).toEqual(['drums', 'd2', 'bass'])
    expect(trackIdsFromLabels(['_$', '_drums'])).toEqual(['d1', 'drums'])
    expect(trackIdsFromLabels([])).toEqual([])
  })

  it('counts a positional id past a name a LABEL claimed', () => {
    // `d2:` is a legal label. The second statement's positional id was `d2` too
    // — the same string, for a different track.
    expect(trackIdsFromLabels(['d2', '$'])).toEqual(['d2', 'd3'])
    // The claim holds wherever the label sits, before or after.
    expect(trackIdsFromLabels(['$', 'd1'])).toEqual(['d2', 'd1'])
  })

  it('counts past a name ANOTHER POSITIONAL id took', () => {
    // Positions 2 and 4 are unlabelled. Position 2 passes `d2` and `d3` (both
    // claimed) to reach `d4`; position 4 must then pass THAT. Seeding the taken
    // set with labels alone leaves these two positional ids equal — a collision
    // between two ids the tool invented, with no label involved at all.
    expect(trackIdsFromLabels(['d2', '$', 'd3', '$'])).toEqual(['d2', 'd4', 'd3', 'd5'])
  })

  it('assigns a distinct id to every track, for any arrangement of labels', () => {
    const labels = ['d1', '$', 'd3', '$', 'd2', '$', '$']
    const ids = trackIdsFromLabels(labels)
    expect(new Set(ids).size).toBe(labels.length)
    // and the user's own labels are never moved
    expect([ids[0], ids[2], ids[4]]).toEqual(['d1', 'd3', 'd2'])
  })

  it('agrees with the per-track rule wherever that rule is still used', () => {
    // `trackIdFromLabel` is the single-track entry point (index 0) — no
    // siblings, so nothing to collide with. The two must not read a label
    // differently.
    for (const label of ['$', '_$', 'drums', '_drums', undefined]) {
      expect(trackIdsFromLabels([label])).toEqual([trackIdFromLabel(label, 0)])
    }
  })
})

describe('parseStrudel — no two tracks share an id (#1667 regression)', () => {
  it('a `d2:` label no longer swallows the track written after it', () => {
    // Both statements became `Track('d2')`. `declaredTracks` de-dupes by id, so
    // the Song timeline drew ONE row for two tracks and the second disappeared.
    expect(trackIds(parseStrudel('d2: s("bd*2")\n$: s("hh*4")'))).toEqual(['d2', 'd3'])
  })

  it('keeps all three when a label collides with a later position', () => {
    expect(trackIds(parseStrudel('d3: s("bd")\n$: s("hh")\n$: s("cp")'))).toEqual([
      'd3',
      'd2',
      'd4',
    ])
  })

  it('leaves a document with no collision exactly as it was', () => {
    expect(trackIds(parseStrudel('drums: s("bd")\n$: s("hh")'))).toEqual(['drums', 'd2'])
  })

  it('holds for a muted colliding label too', () => {
    // Identity strips the marker first, so `_d2:` claims `d2` just as `d2:`
    // does — a muted track still owns its lane.
    expect(trackIds(parseStrudel('_d2: s("bd")\n$: s("hh")'))).toEqual(['d2', 'd3'])
  })
})

describe('a commented-out copy never takes a LIVE track\'s name (#1673)', () => {
  // `//p1: …` above `p1: …` gave both statements `Track('p1')`. `declaredTracks`
  // keeps the first, so the row that survived was anchored on the COMMENT and the
  // live statement had no row of its own. Every duplicate id in the 558-document
  // archive was this shape.
  it('the live track keeps its name; the commented copy falls back to its position', () => {
    expect(trackIdsFromLabels(['p1', 'p1', '$'], [true, false, false])).toEqual(['d1', 'p1', 'd3'])
    // wherever the copy sits — below the live track as well as above it
    expect(trackIdsFromLabels(['p1', 'p1'], [false, true])).toEqual(['p1', 'd2'])
    // and the mute marker does not change whose name it is
    expect(trackIdsFromLabels(['_p1', 'p1'], [true, false])).toEqual(['d1', 'p1'])
  })

  it('a commented track with NO live twin keeps its own name', () => {
    // Commenting a track out must not change its identity — that is why a
    // commented track has a slot at all. Only a live claim outranks it.
    expect(trackIdsFromLabels(['p1', '$'], [true, false])).toEqual(['p1', 'd2'])
  })

  it('two commented copies of one name: the first keeps it, the second falls back', () => {
    expect(trackIdsFromLabels(['p1', 'p1', '$'], [true, true, false])).toEqual(['p1', 'd2', 'd3'])
  })

  it('a commented claim is settled before any positional id is handed out', () => {
    // Position 1 is anonymous and would reach `d2` only by skipping; the
    // commented `//d2:` at position 2 is the only thing naming `d2`, so it keeps
    // it and the positional id counts past it.
    expect(trackIdsFromLabels(['$', 'd2'], [false, true])).toEqual(['d1', 'd2'])
    // The live `d1:` owns `d1`, so the commented copy counts up from its own
    // position like any positional id — to `d2` — and the `$:` after it to `d3`.
    expect(trackIdsFromLabels(['d1', '$', 'd1'], [true, false, false])).toEqual(['d2', 'd3', 'd1'])
  })

  it('every archive shape comes out with one id per track', () => {
    const shapes: [string[], boolean[]][] = [
      [['p1', 'p1', 'p2', 'p2'], [true, false, true, false]],
      [['x2', 'x3', 'x3'], [false, true, false]],
      [['$_', '$_', 'd3', '$_'], [true, false, false, true]],
    ]
    for (const [labels, commented] of shapes) {
      const ids = trackIdsFromLabels(labels, commented)
      expect(new Set(ids).size).toBe(labels.length)
      // each live label still owns the name it claims — its bare name, once a
      // mute marker is read off it (`$_` is a muted anonymous track, #1679)
      labels.forEach((l, i) => {
        const { bare } = splitMuteMarker(l)
        if (!commented[i] && bare !== '$') expect(ids[i]).toBe(bare)
      })
    }
  })

  it('in the parser: the LIVE statement owns the name and its offset', () => {
    const code = '//p1: n("1 2 3")\np1:   n("4 5 6")\n$:    s("bd")'
    const ir = parseStrudel(code)
    expect(trackIds(ir)).toEqual(['d1', 'p1', 'd3'])
    const live = ir.tag === 'Stack' ? ir.tracks[1] : ir
    expect(live.loc?.[0]?.start).toBe(code.indexOf('\np1:') + 1)
  })

  it('leaves a document with no live twin exactly as it was', () => {
    expect(trackIds(parseStrudel('//p1: n("1 2 3")\n$: s("bd")'))).toEqual(['p1', 'd2'])
    expect(trackIds(parseStrudel('//$: s("hh")\n$: s("bd")'))).toEqual(['d1', 'd2'])
  })
})

describe('a trailing `_` is a mute marker too (#1679)', () => {
  // Strudel mutes an id that STARTS or ENDS with `_` (`@strudel/core`
  // repl.mjs:172 — "allows muting a pattern x with x_ or _x"), and the engine's
  // capture hook already mirrors both. Everything else read only the prefix, so
  // `drums_:` became a playing track NAMED `drums_`.
  it('strips a suffix marker from identity, exactly like a prefix one', () => {
    expect(trackIdFromLabel('drums_', 0)).toBe('drums')
    expect(trackIdFromLabel('$_', 1)).toBe('d2') // muted anonymous → positional
    expect(trackIdFromLabel('_drums_', 0)).toBe('drums')
  })

  it('reports a suffix-marked label as muted', () => {
    expect(isMutedLabel('drums_')).toBe(true)
    expect(isMutedLabel('$_')).toBe(true)
    expect(isMutedLabel('drums')).toBe(false)
  })

  it('splits a label into its bare name and its markers', () => {
    expect(splitMuteMarker('drums')).toEqual({ bare: 'drums', prefix: false, suffix: false })
    expect(splitMuteMarker('_drums')).toEqual({ bare: 'drums', prefix: true, suffix: false })
    expect(splitMuteMarker('drums_')).toEqual({ bare: 'drums', prefix: false, suffix: true })
    expect(splitMuteMarker('_$_')).toEqual({ bare: '$', prefix: true, suffix: true })
    // a lone `_` is one marker, not two, and names nothing
    expect(splitMuteMarker('_')).toEqual({ bare: '', prefix: true, suffix: false })
  })

  it('two `$_:` lines are two tracks, not one (the last duplicate ids in the archive)', () => {
    const code = '$_: note("c2*4")\n$_: n("0 2 4")\n$: sound("hh")'
    expect(trackIds(parseStrudel(code))).toEqual(['d1', 'd2', 'd3'])
  })
})

describe('isMutedLabel — the other half of the `_` prefix (#1488)', () => {
  it('reads the mute marker on both label spellings', () => {
    expect(isMutedLabel('_$')).toBe(true)
    expect(isMutedLabel('_drums')).toBe(true)
  })

  it('is false for an unmuted label', () => {
    expect(isMutedLabel('$')).toBe(false)
    expect(isMutedLabel('drums')).toBe(false)
  })

  it('is false — not unknown — for a statement with NO label', () => {
    // Muting is a prefix ON a label, so a bare `s("bd*4")` has nothing to
    // prefix and cannot be muted. Treating absence as unknown would make every
    // unwrapped document unreadable to the period rule.
    expect(isMutedLabel(undefined)).toBe(false)
  })

  it('agrees with the identity strip: same marker, opposite halves', () => {
    // `trackIdFromLabel` throws the marker away so a muted track keeps its
    // lane; this reads it. The two must never disagree about what a marker is.
    expect(trackIdFromLabel('_drums', 0)).toBe('drums')
    expect(isMutedLabel('_drums')).toBe(true)
    expect(trackIdFromLabel('_$', 2)).toBe('d3')
    expect(isMutedLabel('_$')).toBe(true)
  })
})

describe('one rule for a name (#1921)', () => {
  it('any JavaScript identifier is a name — and nothing else is', () => {
    for (const ok of ['drums', 'd1', '$', '_x', '前奏', 'café', '節奏', 'x‌y']) expect(isIdentifier(ok), ok).toBe(true)
    for (const no of ['', '1x', 'a b', 'a-b', 'a.b', '"a"', 's("bd")', '[4, a]']) expect(isIdentifier(no), no).toBe(false)
  })

  it('a writable name is an identifier that is not a reserved word (#1924)', () => {
    for (const ok of ['drums', '前奏', 'setcps', 'eval']) expect(isWritableName(ok), ok).toBe(true)
    for (const no of ['class', 'return', 'let', 'static', '1x', '']) expect(isWritableName(no), no).toBe(false)
  })

  it('a label names nothing when it is anonymous, muted or not', () => {
    expect(labelName('drums')).toBe('drums')
    expect(labelName('_drums')).toBe('drums')
    expect(labelName('drums_')).toBe('drums')
    expect(labelName('$')).toBeNull()
    expect(labelName('_$')).toBeNull()
    expect(labelName('_')).toBeNull()
    expect(labelName(null)).toBeNull()
    expect(labelName(undefined)).toBeNull()
  })

  it('the label at a statement offset, through the same rule', () => {
    const doc = '前奏: s("bd")\n  _bass: s("hh")\n$: s("cp")'
    expect(labelAtOffset(doc, 0)).toBe('前奏')
    expect(labelAtOffset(doc, doc.indexOf('\n') + 1)).toBe('bass') // indented and muted
    expect(labelAtOffset(doc, doc.indexOf('$:'))).toBeNull()
    expect(labelAtOffset(doc, -1)).toBeNull()
    expect(LABEL_HEAD.exec('_節奏: s("bd")')?.[1]).toBe('_節奏') // the raw label, marker and all
  })

  it('a section name: a tuple arm, a bare pattern arm, and an arm with no name', () => {
    const doc = 'arrange([4, 前奏], [8, s("bd")])'
    const t1 = doc.indexOf('[4'), t2 = doc.indexOf('[8')
    expect(sectionNameAt(doc, [t1, doc.indexOf(']', t1) + 1])).toBe('前奏')
    expect(sectionNameAt(doc, [doc.indexOf('前奏'), doc.indexOf('前奏') + 2])).toBe('前奏')
    expect(sectionNameAt(doc, [t2, doc.lastIndexOf(']') - 1])).toBeNull()
    expect(sectionNameAt(doc, [5, 2])).toBeNull()
  })
})

describe('shownTrackName — what an unnamed track shows (#2151)', () => {
  it('an unnamed track shows `Track N` for its positional `d{N}`', () => {
    expect(shownTrackName('d1', null)).toBe('Track 1')
    expect(shownTrackName('d12', undefined)).toBe('Track 12')
  })

  it('a track the user labelled `d2:` keeps showing `d2`', () => {
    expect(shownTrackName('d2', 'd2')).toBe('d2')
  })

  it('a named track shows its name', () => {
    expect(shownTrackName('bass', 'bass')).toBe('bass')
  })

  it('a name that is not positional is shown as it is, label or not', () => {
    // A producer id or a fallback lane key has no label to read and no number to show.
    expect(shownTrackName('bass', null)).toBe('bass')
    expect(shownTrackName('d0', null)).toBe('d0')
    expect(shownTrackName('d01', null)).toBe('d01')
    expect(shownTrackName('dx', null)).toBe('dx')
  })

  it('follows the id a collision moved: the 2nd track under a written `d2:` is `Track 3`', () => {
    const labels = ['d2', '$']
    const ids = trackIdsFromLabels(labels)
    expect(ids).toEqual(['d2', 'd3'])
    expect(ids.map((id, i) => shownTrackName(id, labelName(labels[i])))).toEqual(['d2', 'Track 3'])
  })
})
