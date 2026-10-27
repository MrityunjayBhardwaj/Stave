import { describe, it, expect } from 'vitest'

import { detectAllChunks, detectChunk } from '../../chunkDetect'
import { parseStrudel } from '../../ir/parseStrudel'
import {
  buildStripModels,
  statementOffsetForSource,
  otherTrackNames,
  stripContainingOffset,
  isTrackChunk,
} from '../stripModel'
import { colorForTrack } from '../../trackColor'

/** strips for a whole document, the read path the Mixer actually uses */
function stripsOf(src: string) {
  return buildStripModels(detectAllChunks(src), src)
}
/** the names a bare document had before #1678 — positional over its statements */
function stripsOfBefore(src: string): string[] {
  return detectAllChunks(src).map((_, i) => `d${i + 1}`)
}

/** the Song timeline's id for the statement at `start` — the IR Track whose
 *  label line holds that statement (its `loc` is the LINE start, indentation
 *  included), or undefined when the parser gave it no Track. */
function timelineIdAt(src: string, start: number): string | undefined {
  const ir = parseStrudel(src)
  const roots = ir.tag === 'Stack' ? ir.tracks : [ir]
  for (const t of roots) {
    if (t.tag !== 'Track') continue
    const at = t.loc?.[0]?.start
    if (at !== undefined && at <= start && /^[ \t]*$/.test(src.slice(at, start))) return t.trackId
  }
  return undefined
}

describe('a track has the SAME name in the Mixer as on the Song timeline (#1678, #1682)', () => {
  // The Mixer numbered only the statements IT counts as tracks; the timeline
  // numbers the parser's list. Two ways they parted, both measured across the
  // archive (59 of 558 documents, 242 strips).
  it('a commented-out track above an unnamed one no longer shifts its number', () => {
    const src = '//$: s("hh*4")\n$: s("bd*2")'
    expect(stripsOf(src).map((s) => s.name)).toEqual(['d2'])
    expect(stripsOf('//p1: n("1")\np1: n("4")\n$: s("bd")').map((s) => s.name)).toEqual(['p1', 'd3'])
  })

  it('a statement that never plays no longer shifts the real tracks after it', () => {
    const src = 'await initHydra()\ncpm = 110\n$: s("bd*4")\n$: s("hh*8")'
    // the two drum tracks read what the timeline reads, and the two statements
    // that never play have no strip at all (#1682)
    expect(stripsOf(src).map((s) => s.name)).toEqual(['d1', 'd2'])
  })

  it('an INDENTED track is matched too — the parser anchors at the line start', () => {
    const src = '//$: s("hh*4")\n  $: s("bd*2")'
    expect(stripsOf(src).map((s) => s.name)).toEqual(['d2'])
  })

  it('an INDENTED statement in a document with no labels is matched too (#1685)', () => {
    // with no labels the parser anchors a Track at the statement, not its line
    const src = 's("bd")\n  s("hh")'
    expect(stripsOf(src).map((s) => s.name)).toEqual(['d1', 'd2'])
    // and a sibling of the archive shape: an indented first statement
    expect(stripsOf('  s("bd")\n  s("hh")\ns("cp")').map((s) => s.name)).toEqual(['d1', 'd2', 'd3'])
  })

  it('agrees with the timeline strip for strip, over mixed shapes', () => {
    const docs = [
      '//$: s("hh*4")\n$: s("bd*2")\nd1: s("cp")',
      'x2: s("bd")\n//x3: s("hh")\nx3: s("cp")',
      'setcps(1)\nawait initHydra()\n$: s("bd")\n_$: s("hh")\ndrums_: s("cp")\n$: s("oh")',
      'd2: s("bd*2")\n$: s("hh*4")\n$: s("cp")',
    ]
    let compared = 0
    for (const src of docs) {
      for (const s of stripsOf(src)) {
        const id = timelineIdAt(src, s.statementRange[0])
        if (id === undefined) continue
        compared++
        expect(s.name, `${JSON.stringify(src)} @${s.statementRange[0]}`).toBe(id)
      }
    }
    // Not vacuous — worked out by hand: strips that HAVE a timeline track are
    // 2 (the commented `$:` has no strip) + 2 (nor does `//x3:`) + 4 (`setcps` is
    // no strip, `initHydra()` has no Track) + 3.
    expect(compared).toBe(11)
  })

  it('a BARE document (no labels) agrees too — a guard line no longer counts', () => {
    // The shape of the last 5 disagreeing archive documents: a bare document
    // opening with a guard expression. The parser does not make it a track; the
    // Mixer did, so every track after it read one higher (`d2` for the timeline's
    // `d1`). Reduced from `500/3OGQAQ5-jyOE`.
    const src = "typeof setDefaultVoicings !== 'undefined' && setDefaultVoicings('legacy')\nawait samples('github:a/b')\nstack(s(\"bd\"), s(\"hh\"))"
    let compared = 0
    for (const s of stripsOf(src)) {
      const id = timelineIdAt(src, s.statementRange[0])
      if (id === undefined) continue
      compared++
      expect(s.name, `@${s.statementRange[0]}`).toBe(id)
    }
    // not vacuous: the timeline has tracks here to be compared against
    expect(compared).toBe(2)
    // and a plain bare document keeps the names it always had
    expect(stripsOf('s("bd")\ns("hh")').map((s) => s.name)).toEqual(stripsOfBefore('s("bd")\ns("hh")'))
  })
})

describe('with no live label, every strip has a timeline row of its own (#1686)', () => {
  // A commented-out label never runs and a muted one never registers, so the
  // document plays its last bare statement. The Mixer drew a strip for it; the
  // timeline had no row, so the strip's name pointed at nothing.
  it('each strip names the Track anchored at its own statement', () => {
    const docs = [
      'n("<A#2 C3 C4>").s("ptest")\n// $: chord("<Cm Cm^7>")\n// $: s("bd*4")',
      '// $: chord("<Cm>")\nn("c e").s("ptest")\ns("hh*8")',
      '_$: s("bd*4")\nn("c e g").s("ptest")',
      '// bass: s("bd")\ns("hh*8")',
    ]
    let compared = 0
    for (const src of docs) {
      for (const s of stripsOf(src)) {
        const id = timelineIdAt(src, s.statementRange[0])
        expect(id, `${JSON.stringify(src)} @${s.statementRange[0]} has no row`).toBeDefined()
        expect(s.name).toBe(id)
        compared++
      }
    }
    // 1 + 2 + 2 + 1 strips, every one compared — not vacuous
    expect(compared).toBe(6)
  })

  it('the ghost rows keep their numbers; the bare statement takes the next free one', () => {
    expect(stripsOf('n("c")\n// $: s("a")\n// $: s("b")').map((s) => s.name)).toEqual(['d3'])
    // a named ghost claims no `d{n}`, so the bare statement is d1
    expect(stripsOf('// bass: s("bd")\ns("hh*8")').map((s) => s.name)).toEqual(['d1'])
  })
})

describe('a statement that never plays has no strip (#1682)', () => {
  // Strudel stacks only what reached `.p()` and discards every other statement's
  // value (`repl.mjs:238-257`); a `_`-muted label returns silence WITHOUT
  // registering (`repl.mjs:171-174`). So whether an unlabelled statement can
  // play depends on whether any LIVE label exists — not on its head.
  const names = (src: string) => stripsOf(src).map((s) => s.name)

  it('beside a live label, unlabelled statements of every kind get no strip', () => {
    const src = [
      'await initHydra()',
      'cpm = 110',
      "window.speechda = speechda",
      "spagda('dog')",
      'silence',
      'osc(10, 0.1).out()',
      's("cp*2")',
      '$: s("bd*4")',
      'hats: s("hh*8")',
    ].join('\n')
    expect(names(src)).toEqual(['d1', 'hats'])
  })

  it('a LABELLED track always keeps its strip, muted ones included', () => {
    const src = 'await initHydra()\n$: s("bd")\n_$: s("hh")\ndrums_: s("cp")\nS$: s("oh")'
    expect(stripsOf(src).map((s) => s.statementRange[0])).toEqual(
      ['$: s', '_$: s', 'drums_: s', 'S$: s'].map((head) => src.indexOf(head)),
    )
  })

  it('a document whose every label is MUTED plays its last expression, so it keeps it', () => {
    // nothing registers, so strudel falls back to the evaluated value
    for (const src of ['_$: s("hh")\ns("bd")', 'drums_: s("hh")\ns("bd")']) {
      const strips = stripsOf(src)
      expect(strips, src).toHaveLength(2)
      expect(strips[1].headFn, src).toBe('s')
    }
  })

  it('muting the last live track moves no strip id (#1688)', () => {
    // The bare statement's strip comes back once nothing registers. It must not
    // renumber the anonymous strips after it: their `#k` is what expand/solo
    // state hangs on, and a mute toggle must never move it (#555).
    const idsBySource = (src: string) =>
      new Map(stripsOf(src).map((s) => [src.slice(s.statementRange[0]).replace(/^_/, '').slice(0, 12), s.id]))
    const live = 's("cp")\n$: s("bd")\n_$: s("hh")'
    const muted = 's("cp")\n_$: s("bd")\n_$: s("hh")'
    const before = idsBySource(live)
    const after = idsBySource(muted)
    // not vacuous: both labelled strips exist on both sides
    expect([...before.keys()].filter((k) => after.has(k))).toHaveLength(2)
    for (const [k, id] of before) expect(after.get(k), k).toBe(id)
  })

  it('a document with no labels at all keeps every statement (strudel plays the last)', () => {
    expect(names('cpm(120)\ns("bd")\ns("hh")')).toHaveLength(3)
  })

  it('agrees with the parser: no remaining strip lacks a timeline track in a labelled document', () => {
    const src = 'await initHydra()\ncpm = 110\n$: s("bd*4")\nsilence\n$: s("hh*8")\nlead: note("c")'
    const strips = stripsOf(src)
    for (const s of strips) expect(timelineIdAt(src, s.statementRange[0]), `@${s.statementRange[0]}`).toBeDefined()
    // not vacuous: three tracks were compared
    expect(strips).toHaveLength(3)
  })
})

describe('buildStripModels — one strip per top-level statement', () => {
  it('projects each $: / named statement in source order', () => {
    const strips = stripsOf(
      ['$: s("bd sn")', 'd1: note("c e g")', '$: s("hh*4")'].join('\n'),
    )
    expect(strips).toHaveLength(3)
    expect(strips.map((s) => s.index)).toEqual([0, 1, 2])
    expect(strips.map((s) => s.kind)).toEqual(['step', 'roll', 'step'])
  })

  it('gives anonymous $: tracks unique anonymous-position ids (label "$" is not a name)', () => {
    const strips = stripsOf(['$: s("bd")', '$: s("hh")'].join('\n'))
    expect(strips.map((s) => s.id)).toEqual(['#0', '#1'])
    expect(strips.every((s) => s.label === null)).toBe(true)
  })

  it('keeps a genuine label as the id, name and captureId', () => {
    const [strip] = stripsOf('drums: s("bd sn")')
    expect(strip.id).toBe('drums')
    expect(strip.label).toBe('drums')
    expect(strip.name).toBe('drums')
    expect(strip.captureId).toBe('drums')
  })

  it('numbers captureIds: named keep their name, anonymous get $0/$1 (GR1 candidate)', () => {
    const strips = stripsOf(['$: s("bd")', 'd1: s("hh")', '$: s("cp")'].join('\n'))
    expect(strips.map((s) => s.captureId)).toEqual(['$0', 'd1', '$1'])
  })
})

describe('buildStripModels — mute read-back (S3)', () => {
  it('reads the `_`-prefix marker as muted; an unmuted doc is not muted', () => {
    expect(stripsOf('_d1: s("bd")')[0].muted).toBe(true)
    expect(stripsOf('d1: s("bd")')[0].muted).toBe(false)
    expect(stripsOf('_$: s("bd")')[0].muted).toBe(true)
  })

  it('reads a trailing `_` as muted too, and keeps the bare name (#1679)', () => {
    // Strudel and the engine's capture hook both skip a suffixed id, so this
    // strip is silent — it must not show an unmuted button.
    const [s] = stripsOf('drums_: s("bd")')
    expect(s.muted).toBe(true)
    expect(s.name).toBe('drums')
    expect(s.label).toBe('drums')
    expect(stripsOf('$_: s("bd")')[0].muted).toBe(true)
    expect(stripsOf('$_: s("bd")')[0].name).toBe('d1')
  })

  it('keeps a named track id/name STABLE across mute (`_d1`→ id `d1`, name `d1`)', () => {
    const [s] = stripsOf('_d1: s("bd")')
    expect(s.id).toBe('d1')
    expect(s.captureId).toBe('d1')
    expect(s.name).toBe('d1') // marker stripped from the display name
    expect(s.label).toBe('d1')
  })

  it('only labelled statements are muteable; a bare expression is not', () => {
    expect(stripsOf('$: s("bd")')[0].muteable).toBe(true)
    expect(stripsOf('d1: s("bd")')[0].muteable).toBe(true)
    expect(stripsOf('s("bd")')[0].muteable).toBe(false)
  })

  it('muting a middle anonymous track keeps unmuted siblings\' captureIds aligned with the engine', () => {
    // Engine skips `_`-ids without bumping anonIndex (StrudelEngine.ts:735-739),
    // so the live scheduler keys are [$0, $1] for a/c. The captureIds must match.
    const strips = stripsOf(['$: s("a")', '_$: s("b")', '$: s("c")'].join('\n'))
    expect(strips.map((s) => s.muted)).toEqual([false, true, false])
    expect(strips.map((s) => s.captureId)).toEqual(['$0', '_$1', '$1'])
    // ids count ALL anonymous tracks (muted included) — unique and independent
    // of the captureId shift, so they don't move when `b` is muted.
    expect(strips.map((s) => s.id)).toEqual(['#0', '#1', '#2'])
  })

  it('two muted anonymous tracks get unique ids (no `#`/`_$` collision)', () => {
    const strips = stripsOf(['_$: s("a")', '_$: s("b")'].join('\n'))
    expect(strips.map((s) => s.muted)).toEqual([true, true])
    expect(strips.map((s) => s.id)).toEqual(['#0', '#1'])
    expect(new Set(strips.map((s) => s.id)).size).toBe(2)
  })
})

// #555 — strip identity (`id`) is decoupled from the engine-join key
// (`captureId`): muting must shift the positional captureId in lockstep with the
// engine, but must NOT shift the stable id that UI state (expand/solo) hangs on.
describe('buildStripModels — stable id vs positional captureId (#555)', () => {
  it('keeps every anonymous track\'s id stable when an EARLIER sibling is muted', () => {
    const before = stripsOf(['$: s("a")', '$: s("b")', '$: s("c")'].join('\n'))
    const after = stripsOf(['$: s("a")', '_$: s("b")', '$: s("c")'].join('\n'))
    // The third track `c` keeps id `#2` across the mute of `b` (its UI state stays
    // attached) even though its captureId moves $2 → $1 to track the engine.
    expect(before.map((s) => s.id)).toEqual(after.map((s) => s.id)) // ['#0','#1','#2']
    expect(before[2].captureId).toBe('$2')
    expect(after[2].captureId).toBe('$1')
  })

  it('keeps an anonymous track\'s OWN id stable when it is muted/unmuted', () => {
    const unmuted = stripsOf(['$: s("a")', '$: s("b")'].join('\n'))[1]
    const muted = stripsOf(['$: s("a")', '_$: s("b")'].join('\n'))[1]
    expect(unmuted.id).toBe('#1')
    expect(muted.id).toBe('#1') // own id survives its own mute toggle
    expect(unmuted.captureId).toBe('$1')
    expect(muted.captureId).toBe('_$1') // captureId reflects muted (dark meter)
  })

  it('numbers anonymous ids by anonymous position, skipping interleaved named tracks', () => {
    // `$: a / d1: b / $: c` → the 2nd anonymous track is `#1` (not `#2`): the id
    // counts anonymous tracks, so an interleaved named track does not consume a
    // `#`. captureId, separately, is positional-over-unmuted ($0 / d1 / $1).
    const strips = stripsOf(['$: s("a")', 'd1: s("b")', '$: s("c")'].join('\n'))
    expect(strips.map((s) => s.id)).toEqual(['#0', 'd1', '#1'])
    expect(strips.map((s) => s.captureId)).toEqual(['$0', 'd1', '$1'])
  })

  it('a named track keeps both id and captureId stable across mute', () => {
    const unmuted = stripsOf('d1: s("bd")')[0]
    const muted = stripsOf('_d1: s("bd")')[0]
    expect([unmuted.id, unmuted.captureId]).toEqual(['d1', 'd1'])
    expect([muted.id, muted.captureId]).toEqual(['d1', 'd1'])
  })
})

// #559 — a top-level transport/config statement (`setcps`, `samples`, …) is not
// a playable track: it must produce NO strip, and must not consume a positional
// `$<n>` slot (which would shift every real track's captureId off the engine).
describe('buildStripModels — transport/config statements are not tracks (#559)', () => {
  it('drops a leading setcps(...) line and keeps only the real tracks', () => {
    const strips = stripsOf(
      ['setcps(0.5)', '$: s("bd")', '$: note("c e g")'].join('\n'),
    )
    expect(strips).toHaveLength(2)
    // names = the display key (V-track-1): both anon → positional d{ordinal},
    // counting from 1 after the dropped config line (d1, d2 — never d2, d3).
    expect(strips.map((s) => s.name)).toEqual(['d1', 'd2'])
  })

  it('renumbers anonymous captureIds to $0.. after dropping setcps (no off-by-one)', () => {
    // Engine numbers anon $: patterns from $0 (StrudelEngine.ts:735-739); setcps
    // never calls .p(), so the first real anon track must be $0, not $1.
    const strips = stripsOf(
      ['setcps(0.5).gain(0.3)', '$: s("bd")', '$: s("hh")'].join('\n'),
    )
    expect(strips.map((s) => s.captureId)).toEqual(['$0', '$1'])
  })

  it('drops every known transport/config head (samples, hush, setbpm, …)', () => {
    for (const cfg of ['setcps(0.5)', 'setcpm(120)', 'samples("x")', 'hush()', 'all(x => x)']) {
      expect(stripsOf([cfg, '$: s("bd")'].join('\n'))).toHaveLength(1)
    }
  })

  it('keeps a bare pattern expression (unknown head) as a track — denylist is conservative', () => {
    // A document with no labels, where the head is the only thing that decides.
    // Beside a live label the same `s("bd")` never plays, and has no strip for
    // THAT reason (#1682) — not because of its head.
    const strips = stripsOf(['s("bd")', 'note("c e")'].join('\n'))
    expect(strips).toHaveLength(2)
    expect(strips[0].muteable).toBe(false) // bare expression, still a strip
  })

  it('keeps source-order index even when an earlier statement was filtered out', () => {
    // setcps is filtered; the surviving track keeps its TRUE source position (1).
    const [strip] = stripsOf(['setcps(0.5)', '$: s("bd")'].join('\n'))
    expect(strip.index).toBe(1)
  })
})

// #1174 — the `$<n>` counter must count the SAME statements the engine's
// `anonIndex` counts. The engine increments only inside `.p()`, which an
// UNLABELLED statement never reaches — so a bare statement consuming a slot
// pushed every track after it onto its neighbour's meter. Measured on the real
// surface: a bare drum statement's strip showed the hi-hat's level while the
// hi-hat sat dark. The #559 denylist above is one route to this; a bare
// statement is another, which is why the repair is on the counter.
describe('buildStripModels — an unlabelled statement takes no engine slot (#1174)', () => {
  /** the `$<n>` ids the mixer hands out, in source order */
  const liveSlots = (src: string) =>
    stripsOf(src)
      .map((s) => s.captureId)
      .filter((c) => /^\$\d+$/.test(c))

  it('a bare statement above a labelled one leaves the labelled track at $0', () => {
    const strips = stripsOf(['s("bd*8")', '$: s("hh*16")'].join('\n'))
    // The engine registers only the `$:` statement, and it registers it FIRST —
    // so the labelled strip must join on `$0`. It used to get `$1` and therefore
    // read the scheduler belonging to nothing at all.
    //
    // The bare statement used to keep a strip that joined on nothing live. It
    // never plays — strudel discards it once `$:` registers — so since #1682 it
    // has no strip, and the labelled track is the only one.
    expect(strips.map((s) => s.captureId)).toEqual(['$0'])
  })

  it('several bare statements do not push a labelled track along', () => {
    const strips = stripsOf(['s("bd*8")', 's("cp*4")', '$: s("hh*16")'].join('\n'))
    expect(strips.map((s) => s.captureId)).toEqual(['$0'])
    expect(liveSlots(['s("bd*8")', 's("cp*4")', '$: s("hh*16")'].join('\n'))).toEqual(['$0'])
  })

  it('a transport head the denylist has never heard of also takes no slot', () => {
    // `cpm` is absent from NON_TRACK_HEADS, but it is unlabelled, so it can no
    // longer displace the real tracks' meters. This is the head case fixed
    // WITHOUT extending the list — and since #1682 it draws no strip either,
    // because beside a `$:` it never plays.
    const strips = stripsOf(['cpm(120)', '$: s("bd*8")', '$: s("hh*16")'].join('\n'))
    expect(strips.map((s) => s.captureId)).toEqual(['$0', '$1'])
  })

  it('the unjoinable statements do not collide, and only the LAST one joins', () => {
    const ids = stripsOf(['s("bd")', 's("hh")'].join('\n')).map((s) => s.captureId)
    expect(new Set(ids).size).toBe(2)
    // Strudel plays the last expression, so exactly one of these is a live slot
    // and it is the last (#1096). Before that landed, BOTH were unjoinable and a
    // bare document could not meter at all.
    expect(ids.filter((c) => /^\$\d+$/.test(c))).toEqual(['$1'])
    expect(ids[0]).not.toMatch(/^\$\d+$/)
  })

  it('the lone bare document still joins on $0 — #1097 must survive this', () => {
    expect(stripsOf('s("bd*4")').map((s) => s.captureId)).toEqual(['$0'])
    // A second track no longer makes it ambiguous: the id names the LAST track,
    // which is the one strudel plays (#1096). `$0` is that same rule at n = 1,
    // not a special case, so this arm and the next describe one rule.
    expect(liveSlots(['s("bd*4")', 's("hh*8")'].join('\n'))).toEqual(['$1'])
    // ...and it is the SECOND strip that carries it, not merely some strip.
    const strips = stripsOf(['s("bd*4")', 's("hh*8")'].join('\n'))
    expect(strips[strips.length - 1].captureId).toBe('$1')
  })

  // ⚠ THIS ARM USED TO PIN A LIMITATION, and it now pins its removal — which is
  // why it was changed rather than deleted (#1177 asked for exactly that).
  //
  // It read: whether a lone bare pattern can meter depends on whether the
  // statement above it happens to be on the denylist, because an unrecognised
  // head counts as a second track and makes the id ambiguous. `setcps` was listed
  // and metered; `cpm` was not and went dark.
  //
  // Naming the LAST track (#1096) removes that dependency. An unrecognised head
  // still costs a spurious strip, but the pattern below it meters either way,
  // because "the last track" is well defined whether or not the head was
  // recognised. The denylist now decides only how many strips are DRAWN, never
  // whether the music can be heard on a meter.
  it('a lone bare pattern meters under a listed head AND under an unlisted one', () => {
    expect(stripsOf('setcps(0.5)\ns("bd*4")').map((s) => s.captureId)).toEqual(['$0'])
    // `cpm` is a real transport call the denylist has never heard of. It is still
    // counted as a track — hence a strip, and the slot shifts to `$1` — but the
    // pattern below it now joins instead of going dark.
    expect(liveSlots('cpm(120)\ns("bd*4")')).toEqual(['$1'])
    // The control that gives that meaning: the joining strip is the PATTERN, not
    // the transport call.
    const strips = stripsOf('cpm(120)\ns("bd*4")')
    expect(strips.find((s) => s.captureId === '$1')?.headFn).toBe('s')
    expect(strips.find((s) => s.headFn === 'cpm')?.captureId).not.toMatch(/^\$\d+$/)
  })

  it('the live slots are the anonymous $: numbering, OR one bare slot, never both', () => {
    // The engine's rule restated as a property and checked against the mixer's
    // output, rather than a literal that would pass if both sides moved together.
    //
    // The property gained a second arm with #1096. An all-unlabelled document now
    // issues exactly ONE live slot — the last track, the expression strudel plays
    // — while a document containing any labelled track issues the `$:` numbering
    // and no bare slot. The two populations cannot overlap, and that is what makes
    // the bare slot safe: a label is what makes a statement reach `.p()`, so where
    // the engine's `anonIndex` is counting, this rule is silent, and where this
    // rule speaks, `anonIndex` never incremented at all.
    for (const doc of [
      '$: s("a")\n$: s("b")',
      's("a")\n$: s("b")',
      'cpm(120)\ns("a")\n$: s("b")\n_$: s("c")\n$: s("d")',
      'drums: s("a")\n$: s("b")\ns("c")',
      's("a")\ns("b")',
      's("a")',
      'cpm(120)\ns("a")\ns("b")',
    ]) {
      const chunks = detectAllChunks(doc)
      const tracks = chunks.filter(isTrackChunk)
      const allBare = tracks.length > 0 && tracks.every((c) => c.label === null)
      const anonLabelled = chunks.filter((c) => c.label === '$').length
      expect(liveSlots(doc), doc).toEqual(
        allBare
          ? [`$${tracks.length - 1}`]
          : Array.from({ length: anonLabelled }, (_, i) => `$${i}`),
      )
    }
  })
})

describe('buildStripModels — per-strip read model', () => {
  it('reads source: .bank for drums, .sound/.s for melody', () => {
    const [drum] = stripsOf('$: s("bd sn").bank("RolandTR909")')
    expect(drum.source).toBe('RolandTR909')
    const [mel] = stripsOf('$: note("c e g").sound("piano")')
    expect(mel.source).toBe('piano')
  })

  it('reads pan, room and delay scalars; null when absent', () => {
    const [s] = stripsOf('$: s("bd").pan(0.3).room(0.4)')
    expect(s.pan).toBe(0.3)
    expect(s.sends.room).toBe(0.4)
    expect(s.sends.delay).toBeNull()
  })

  it('carries the gain state through to the strip', () => {
    expect(stripsOf('$: s("bd").gain(0.7)')[0].gain.kind).toBe('scalar')
    expect(stripsOf('$: s("bd sn").gain("0.5 1")')[0].gain.kind).toBe('managed')
    expect(stripsOf('$: s("bd").gain(sine)')[0].gain.kind).toBe('foreign')
    expect(stripsOf('$: s("bd")')[0].gain.kind).toBe('absent')
  })

  it('names + colours each strip by its display key — label, else positional d{N} (V-track-1, #579)', () => {
    // The display key matches what the Song Timeline shows: a NAMED track keys on
    // its label; an ANONYMOUS `$:` keys on `d{ordinal}` (its 1-based position) —
    // the same positional hap id the Timeline lanes by. Name AND colour derive
    // from that ONE key via the shared resolver, so they can't diverge.
    const strips = stripsOf(['bass: note("c2 e2")', '$: s("hh*8")', '$: note("c").sound("piano")'].join('\n'))
    expect(strips.map((s) => s.name)).toEqual(['bass', 'd2', 'd3'])
    expect(strips[0].color).toBe(colorForTrack('bass'))
    expect(strips[1].color).toBe(colorForTrack('d2'))
    expect(strips[2].color).toBe(colorForTrack('d3'))
    // anon names/colours follow position, NOT the instrument — so the strip never
    // auto-adopts a sample name (renaming stays the user's explicit edit).
    expect(strips[1].id).toBe('#0') // stable UI id is still positional `#k`
  })

  it('keeps same-sample anon tracks distinct in name AND colour (no collision)', () => {
    // Two identical `s("bd")` tracks → d1 / d2, distinct colours. This is why the
    // display key is positional, not the sample (which would collide).
    const dup = stripsOf(['$: s("bd*4")', '$: s("bd*4")'].join('\n'))
    expect(dup.map((s) => s.name)).toEqual(['d1', 'd2'])
    expect(dup[0].color).not.toBe(dup[1].color)
  })

  it('never repeats a name a LABEL already claimed (#1667)', () => {
    // `d2:` is a perfectly legal label, and the second track's positional name
    // would have been `d2` too — two strips, one name, one colour. The
    // positional name counts on past anything taken; the user's own label never
    // moves.
    const clash = stripsOf(['d2: s("bd*2")', '$: s("hh*4")'].join('\n'))
    expect(clash.map((s) => s.name)).toEqual(['d2', 'd3'])
    expect(clash[0].color).not.toBe(clash[1].color)
  })

  it('keeps counting past a name taken by a LATER label, and past itself (#1667)', () => {
    // Positions 2 and 4 are both unlabelled. Position 2 must pass `d2` AND `d3`
    // (both claimed by labels) and lands on `d4`; position 4 must then pass the
    // `d4` position 2 just took. Without the second half two POSITIONAL names
    // collide even though neither matches a label.
    const strips = stripsOf(
      ['d2: s("bd")', '$: s("hh")', 'd3: s("cp")', '$: s("sd")'].join('\n'),
    )
    expect(strips.map((s) => s.name)).toEqual(['d2', 'd4', 'd3', 'd5'])
    expect(new Set(strips.map((s) => s.name)).size).toBe(4)
  })

  it('classifies a stack(...) statement as a group', () => {
    expect(stripsOf('$: stack(s("bd"), note("c e"))')[0].kind).toBe('group')
  })

  it('is a pure function of the document (re-derive → identical)', () => {
    const src = '$: s("bd sn").gain(0.6)\nd1: note("c e").pan(0.2)'
    expect(buildStripModels(detectAllChunks(src), src)).toEqual(
      buildStripModels(detectAllChunks(src), src),
    )
  })
})

// #567 — locate a runtime error back to its track by instrument.
describe('statementOffsetForSource', () => {
  it('returns the char offset of the statement assigning that instrument', () => {
    const doc = ['$: s("bd")', "$: note(\"c e g\").sound('gm_agogo')"].join('\n')
    const offset = statementOffsetForSource(doc, 'gm_agogo')
    // points at the start of the 2nd statement (just after the first line + \n)
    expect(offset).toBe(doc.indexOf('$: note'))
  })

  it('matches .s the same as .sound, and .bank for drums', () => {
    expect(statementOffsetForSource('$: note("c").s("sawtooth")', 'sawtooth')).toBe(0)
    expect(statementOffsetForSource('$: s("bd").bank("RolandTR909")', 'RolandTR909')).toBe(0)
  })

  it('returns null when no statement uses that instrument', () => {
    expect(statementOffsetForSource('$: s("bd")', 'gm_agogo')).toBeNull()
  })

  // #2226 — a note carries the ONE sound it played; the track's is a pattern of them
  it('a track whose sound is a pattern matches on any of its sounds', () => {
    const doc = ['$: s("bd")', '$: note("48 67 63").sound("piano gm_electric_guitar_muted")'].join('\n')
    const second = doc.indexOf('$: note')
    expect(statementOffsetForSource(doc, 'gm_electric_guitar_muted')).toBe(second)
    expect(statementOffsetForSource(doc, 'piano')).toBe(second)
    expect(statementOffsetForSource('$: note("c").sound("<piano:2 ~>")', 'piano')).toBe(0)
    // a name that is only part of one is not a match
    expect(statementOffsetForSource(doc, 'gm_electric')).toBeNull()
  })

  it('a strip lists the sounds its source plays', () => {
    const src = '$: note("c").sound("piano")\n$: note("c").sound("<piano sawtooth piano>")\n$: note("c")'
    const [one, multi, none] = buildStripModels(detectAllChunks(src), src)
    expect(one.sounds).toEqual(['piano'])
    expect(multi.sounds).toEqual(['piano', 'sawtooth'])
    expect(none.sounds).toEqual([])
  })

  it('offset → 1-based line by newline count (the app conversion)', () => {
    const doc = ['setcps(0.5)', '$: s("bd")', "$: note(\"c7\").sound('gm_agogo')"].join('\n')
    const offset = statementOffsetForSource(doc, 'gm_agogo')!
    const line = doc.slice(0, offset).split('\n').length
    expect(line).toBe(3)
  })
})

describe('otherTrackNames — the rename collision set (#585)', () => {
  it('returns every track display name except the one at the given offset', () => {
    const doc = ['bass: s("bd")', '$: s("hh")', 'lead: note("c4")'].join('\n')
    // exclude the first statement (offset 0) → the OTHER names
    expect(otherTrackNames(doc, 0)).toEqual(['d2', 'lead'])
  })

  it('uses display names — anon tracks contribute their positional d{N}', () => {
    const doc = ['$: s("bd")', '$: s("hh")'].join('\n')
    // exclude the 2nd anon (d2) → the remaining display name is d1
    expect(otherTrackNames(doc, doc.indexOf('$: s("hh")'))).toEqual(['d1'])
  })

  it('drops config lines (not tracks) from the set, like the Mixer does', () => {
    const doc = ['setcps(0.5)', 'bass: s("bd")', 'lead: s("hh")'].join('\n')
    // excluding bass → only lead remains (setcps is not a track, #559)
    expect(otherTrackNames(doc, doc.indexOf('bass:'))).toEqual(['lead'])
  })

  it('an unmatched offset excludes nothing → all names', () => {
    const doc = ['bass: s("bd")', 'lead: s("hh")'].join('\n')
    expect(otherTrackNames(doc, 9999)).toEqual(['bass', 'lead'])
  })
})

describe('stripContainingOffset — owning strip for a nested chunk (#727)', () => {
  // A pickRestart "player" track: editing a section makes the active chunk NESTED
  // (its statementRange is the section span, not the owning statement).
  const PLAYER = `drums: "<~@4 verse@8 chorus@8>".pickRestart({
  verse: s("bd ~ sd ~ bd bd sd ~").bank("ajkpercusyn").gain(0.136),
  chorus: s("bd ~ [bd,sd] ~ bd ~ [bd,sd] ~").bank("RolandTR909"),
})._pianoroll()`

  it('resolves a pickRestart SECTION chunk back to its owning drums strip', () => {
    const strips = stripsOf(PLAYER)
    // cursor inside the `verse` section → nested chunk, label null
    const chunk = detectChunk(PLAYER, PLAYER.indexOf('bd ~ sd'))
    expect(chunk).not.toBeNull()
    expect(chunk!.label).toBeNull() // nested chunk carries no track label
    // pre-fix exact-start match found nothing → chip returned null (no name)
    expect(strips.some((s) => s.statementRange[0] === chunk!.statementRange[0])).toBe(false)
    // containment resolves it to the drums strip → the chip shows "drums"
    const owner = stripContainingOffset(strips, chunk!.statementRange[0])
    expect(owner?.name).toBe('drums')
  })

  it('still resolves a top-level chunk to its own strip', () => {
    const strips = stripsOf(PLAYER)
    const chunk = detectChunk(PLAYER, PLAYER.indexOf('verse@8')) // on the control string
    expect(stripContainingOffset(strips, chunk!.statementRange[0])?.name).toBe('drums')
  })

  it('resolves a stack(...) arm chunk to its owning strip', () => {
    const doc = 'lead: stack(\n  s("bd*4"),\n  note("c e g")\n)'
    const strips = stripsOf(doc)
    const chunk = detectChunk(doc, doc.indexOf('c e g'))
    expect(chunk!.label).toBeNull()
    expect(stripContainingOffset(strips, chunk!.statementRange[0])?.name).toBe('lead')
  })

  it('returns undefined for an offset in no statement', () => {
    expect(stripContainingOffset(stripsOf(PLAYER), 99999)).toBeUndefined()
  })
})

describe('shownName — what a strip shows (#2151)', () => {
  it('unnamed strips show `Track N`; named ones, and a written `d2:`, show their name', () => {
    const src = '$: s("bd*4")\nbass: note("c2")\nd2: s("hh*8")\n_$: s("cp")'
    const strips = stripsOf(src)
    expect(strips.map((s) => s.name)).toEqual(['d1', 'bass', 'd2', 'd4'])
    expect(strips.map((s) => s.shownName)).toEqual(['Track 1', 'bass', 'd2', 'Track 4'])
  })

  it('only the shown text changes: the name and colour stay keyed on `d1`', () => {
    const [strip] = stripsOf('$: s("bd*4")')
    expect(strip!.name).toBe('d1')
    expect(strip!.color).toBe(colorForTrack('d1'))
  })

  it('a bare document with no labels shows `Track 1`', () => {
    expect(stripsOf('s("bd*4")').map((s) => s.shownName)).toEqual(['Track 1'])
  })
})
