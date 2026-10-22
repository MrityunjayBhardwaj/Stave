/**
 * A bar as the pattern's own divisions (#1833).
 *
 * The fixtures pin one rule each. The corpus arm is the claim: over every real pattern,
 * a bar either has a tree in which every row tiles the slot it cuts and every hit sits
 * in the step that wrote it, or it is refused with the rule that failed — and the counts
 * of each are PINNED, so a change in what the tree can hold shows as a number that moved.
 *
 * Two things in the corpus arm are checked by a second route, not by the builder's own
 * arithmetic: a plain note's slot (asked through a marked copy) must be the note's own
 * hit (asked of the pattern itself), and the tiling is re-walked in floating point.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { barDivisions, type BarDivisions, type DivisionsRefusal, type Frac, type Row, type Slot, type Step } from '../divisions'
import { miniPattern, type MiniHit, type MiniPattern } from '../pattern'

const bar = (mini: string, cyc = 0): BarDivisions => barDivisions(miniPattern(mini), cyc)
const tree = (mini: string, cyc = 0): Row[] => {
  const d = bar(mini, cyc)
  if (!d.ok) throw new Error(`${JSON.stringify(mini)} bar ${cyc}: refused, ${d.why}`)
  return d.parts
}
const f = (x: Frac): string => (x.d === 1 ? String(x.n) : `${x.n}/${x.d}`)
/** `0-1/4`, with `<` when it began before the bar and `>` when it runs past the end */
const span = (s: Slot): string => `${s.fromBefore ? '<' : ''}${f(s.begin)}-${f(s.end)}${s.pastEnd ? '>' : ''}`
const text = (s: Step): string => (s.element.content.kind === 'atom' ? s.element.content.text : '[…]')
/** a row as `name@slot,slot` per step */
const row = (r: Row): string[] => r.steps.map((s) => `${text(s)}@${s.slots.map(span).join(',')}`)

describe('barDivisions — every written step has its slot', () => {
  it('the top-level split is the pulse, and a group cuts its own slot again', () => {
    const [part] = tree('bd [~ bd] sd ~')
    expect(row(part)).toEqual(['bd@0-1/4', '[…]@1/4-1/2', 'sd@1/2-3/4', '~@3/4-1'])
    const inner = part.steps[1].rows!
    expect(inner.length).toBe(1)
    expect(row(inner[0])).toEqual(['~@1/4-3/8', 'bd@3/8-1/2'])
    // groups in one bar cut differently: a half and a third
    const [mixed] = tree('[e4 g4] [hh hh hh]')
    expect(row(mixed.steps[0].rows![0])).toEqual(['e4@0-1/4', 'g4@1/4-1/2'])
    expect(row(mixed.steps[1].rows![0])).toEqual(['hh@1/2-2/3', 'hh@2/3-5/6', 'hh@5/6-1'])
  })

  it('a rest has a slot, and plays nothing', () => {
    const [part] = tree('a ~ - b')
    expect(row(part)).toEqual(['a@0-1/4', '~@1/4-1/2', '-@1/2-3/4', 'b@3/4-1'])
    expect(part.steps.map((s) => s.rest)).toEqual([false, true, true, false])
    expect(part.steps.map((s) => s.hits.length)).toEqual([1, 0, 0, 1])
  })

  it('a weight is the width Strudel gives it, however it is written', () => {
    expect(row(tree('a@3 b')[0])).toEqual(['a@0-3/4', 'b@3/4-1'])
    expect(row(tree('bd _ _ sd')[0])).toEqual(['bd@0-3/4', 'sd@3/4-1'])
    expect(row(tree('a@1.5 b')[0])).toEqual(['a@0-3/5', 'b@3/5-1'])
    expect(row(tree('a b c')[0])).toEqual(['a@0-1/3', 'b@1/3-2/3', 'c@2/3-1'])
  })

  it('a generated step is ONE written step: its slot is the step, its hits carry the arguments', () => {
    const [euclid] = tree('bd(3,8) sd')
    expect(row(euclid)).toEqual(['bd@0-1/2', 'sd@1/2-1'])
    expect(euclid.steps[0].hits.length).toBe(3)
    for (const h of euclid.steps[0].hits) expect(h.args.map((a) => a.text)).toEqual(['3', '8'])
    const [fast] = tree('hh*4')
    expect(row(fast)).toEqual(['hh@0-1'])
    expect(fast.steps[0].hits.map((h) => h.args.map((a) => a.text))).toEqual([['4'], ['4'], ['4'], ['4']])
    // `!` is a generator too: one written step, as wide as its copies together
    const [bang] = tree('bd! sd')
    expect(row(bang)).toEqual(['bd@0-2/3', 'sd@2/3-1'])
    expect(bang.steps[0].hits.length).toBe(2)
    const [held] = tree('a _ b!2 _')
    expect(row(held)).toEqual(['a@0-2/5', 'b@2/5-1'])
    // a step that plays nothing this bar still has its slot — it is not a rest
    const [maybe] = tree('a? b')
    expect(row(maybe)).toEqual(['a@0-1/2', 'b@1/2-1'])
    expect(maybe.steps[0].hits.length).toBe(0)
    expect(maybe.steps[0].rest).toBe(false)
  })

  it('a group repeated by its own op: the row inside cuts each copy', () => {
    const [part] = tree('[a b]*2@2 c')
    expect(row(part)).toEqual(['[…]@0-2/3', 'c@2/3-1'])
    const group = part.steps[0]
    expect(group.copies!.map(span)).toEqual(['0-1/3', '1/3-2/3'])
    expect(row(group.rows![0])).toEqual(['a@0-1/6,1/3-1/2', 'b@1/6-1/3,1/2-2/3'])
    // no op of its own: no copies, the row cuts the slot
    expect(tree('[a b] c')[0].steps[0].copies).toBe(null)
    // a step inside may run from one copy into the next; it is one slot, not two
    const across = tree('<a@2 b>*3')[0].steps[0]
    expect(across.copies!.map(span)).toEqual(['0-1/3', '1/3-2/3', '2/3-1'])
    expect(row(across.rows![0])).toEqual(['a@0-2/3', 'b@2/3-1'])
  })

  it('an alternation is the arm this bar plays', () => {
    expect(row(tree('<a b> c', 0)[0].steps[0].rows![0])).toEqual(['a@0-1/2'])
    expect(row(tree('<a b> c', 1)[0].steps[0].rows![0])).toEqual(['b@0-1/2'])
    // sped up, both arms sit in one bar
    expect(row(tree('<a b>*2')[0].steps[0].rows![0])).toEqual(['a@0-1/2', 'b@1/2-1'])
  })

  it('one row per comma part, at every depth', () => {
    const parts = tree('bd sd, hh hh hh')
    expect(parts.map(row)).toEqual([
      ['bd@0-1/2', 'sd@1/2-1'],
      ['hh@0-1/3', 'hh@1/3-2/3', 'hh@2/3-1'],
    ])
    const inner = tree('<a b, c d e>', 1)[0].steps[0].rows!
    expect(inner.map(row)).toEqual([['b@0-1'], ['d@0-1']])
    const nested = tree('x [a, b c]')[0].steps[1].rows!
    expect(nested.map(row)).toEqual([['a@1/2-1'], ['b@1/2-3/4', 'c@3/4-1']])
  })

  it('a polymeter row is cut by its step count: a step can sit in the bar twice', () => {
    expect(row(tree('{a b c}%4')[0].steps[0].rows![0])).toEqual(['a@0-1/4,3/4-1', 'b@1/4-1/2', 'c@1/2-3/4'])
    expect(tree('{a b c, d e}')[0].steps[0].rows!.map(row)).toEqual([
      ['a@0-1/3', 'b@1/3-2/3', 'c@2/3-1'],
      ['d@0-1/3,2/3-1', 'e@1/3-2/3'],
    ])
  })

  it('a step longer than a bar is there in every bar it covers, marked at the edge it crosses', () => {
    const slow = '[a b c]/2'
    expect(tree(slow, 0)[0].steps[0].copies!.map(span)).toEqual(['0-1>'])
    expect(row(tree(slow, 0)[0].steps[0].rows![0])).toEqual(['a@0-2/3', 'b@2/3-1>'])
    expect(row(tree(slow, 1)[0].steps[0].rows![0])).toEqual(['b@<0-1/3', 'c@1/3-1'])
    // the held arm of an alternation: its slot is there, its hit was in the first bar
    const held = tree('<a@3 b>', 1)[0].steps[0].rows![0]
    expect(row(held)).toEqual(['a@<0-1>'])
    expect(held.steps[0].hits.length).toBe(0)
    expect(tree('<a@3 b>', 0)[0].steps[0].rows![0].steps[0].hits.length).toBe(1)
  })

  it('a random choice: the row this bar chose has the steps, and the tree says it is a choice', () => {
    const rows = [0, 1, 2, 3].map((c) => tree('a | b c', c).map((r) => row(r).length))
    for (const r of rows) expect(r.filter((n) => n > 0).length).toBe(1)
    const choice = bar('a | b c')
    expect(choice.ok && choice.oneOf).toBe(true)
    const stack = bar('a, b c')
    expect(stack.ok && stack.oneOf).toBe(false)
    const inner = tree('x [a | b c]')[0].steps[1]
    expect(inner.oneOf).toBe(true)
    expect(inner.rows!.filter((r) => r.steps.length > 0).length).toBe(1)
  })

  it('says why when a bar has no tree', () => {
    const why = (mini: string, cyc = 0): DivisionsRefusal | null => {
      const d = bar(mini, cyc)
      return d.ok ? null : d.why
    }
    expect(why('a b . c d e')).toBe('feet')
    expect(why('zzq1 bd')).toBe('marker-in-pattern')
    // a hit that names no place at all cannot be put in any step
    const fake: MiniPattern = {
      mini: 'bd sd',
      hits: (): MiniHit[] => [{ begin: { valueOf: () => 0 }, end: { valueOf: () => 1 }, value: 'bd', locations: [] }],
    }
    expect(barDivisions(fake, 0)).toEqual({ ok: false, why: 'unpaired-hit' })
  })
})

/* ── the corpus ─────────────────────────────────────────────────── */

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]
const CYCLES = [0, 1, 2, 3]

const num = (x: Frac): number => x.n / x.d
const EPS = 1e-9

interface Walk {
  rows: number
  steps: number
  rests: number
  hits: number
  generated: number
  plainNotes: number
  plainNoteMismatch: string[]
  floatTilingBroken: string[]
  maxDepth: number
  crossing: number
}

/** re-walk a tree by a second route; `cut` is what the rows must tile */
function walk(mini: string, cyc: number, rows: Row[], cut: Slot[], random: boolean, depth: number, w: Walk): void {
  w.maxDepth = Math.max(w.maxDepth, depth)
  // side-by-side rows tile the stretch their slots make together; a choice, each slot
  const held: Slot[] = []
  for (const s of [...cut].sort((a, b) => num(a.begin) - num(b.begin))) {
    const last = held[held.length - 1]
    if (!random && last && Math.abs(num(last.end) - num(s.begin)) <= EPS) held[held.length - 1] = { ...last, end: s.end }
    else held.push({ ...s })
  }
  for (const c of held) {
    let tiled = 0
    for (const r of rows) {
      const mine = r.steps
        .flatMap((s) => s.slots)
        .filter((s) => num(s.begin) >= num(c.begin) - EPS && num(s.begin) < num(c.end) - EPS)
        .sort((a, b) => num(a.begin) - num(b.begin))
      if (mine.length === 0) continue
      let at = num(c.begin)
      let ok = true
      for (const s of mine) {
        if (Math.abs(num(s.begin) - at) > EPS) ok = false
        at = num(s.end)
      }
      if (ok && Math.abs(at - num(c.end)) <= EPS) tiled++
      else w.floatTilingBroken.push(`${JSON.stringify(mini)} bar ${cyc}`)
    }
    if (random ? tiled !== 1 : tiled !== rows.length) w.floatTilingBroken.push(`${JSON.stringify(mini)} bar ${cyc} (rows)`)
  }
  for (const r of rows) {
    w.rows++
    for (const s of r.steps) {
      w.steps++
      if (s.rest) w.rests++
      w.hits += s.hits.length
      if (s.slots.some((x) => x.fromBefore || x.pastEnd)) w.crossing++
      if (s.hits.some((h) => h.args.length > 0)) w.generated++
      // A PLAIN NOTE, ASKED TWICE: the marked copy gave its slot, the pattern itself gave
      // its hit. With no op of its own the two must be the same span.
      if (s.element.content.kind === 'atom' && !s.rest && s.element.ops.length === 0) {
        for (const h of s.hits) {
          w.plainNotes++
          const b = h.hit.begin.valueOf() - cyc
          const e = h.hit.end.valueOf() - cyc
          const hit = s.slots.some((x) => Math.abs(num(x.begin) - b) <= EPS && (x.pastEnd || Math.abs(num(x.end) - e) <= EPS))
          if (!hit) w.plainNoteMismatch.push(`${JSON.stringify(mini)} bar ${cyc}: ${text(s)} hit ${b}-${e} vs ${s.slots.map(span).join(',')}`)
        }
      }
      if (s.rows) walk(mini, cyc, s.rows, s.copies ?? s.slots, s.oneOf, depth + 1, w)
    }
  }
}

describe('barDivisions — the corpus', () => {
  it('every bar has a tree that holds, or the rule that failed; the counts are pinned', () => {
    const verdicts: Record<string, number> = {}
    const bump = (k: string): void => void (verdicts[k] = (verdicts[k] ?? 0) + 1)
    const perPattern: Record<string, number> = {}
    const examples: Record<string, string[]> = {}
    const w: Walk = { rows: 0, steps: 0, rests: 0, hits: 0, generated: 0, plainNotes: 0, plainNoteMismatch: [], floatTilingBroken: [], maxDepth: 0, crossing: 0 }
    let hitsInTrees = 0
    let hitsAsked = 0
    for (const mini of minis) {
      let pat: MiniPattern
      const seen = new Set<string>()
      try {
        pat = miniPattern(mini)
        pat.hits(0)
      } catch {
        perPattern['does not evaluate'] = (perPattern['does not evaluate'] ?? 0) + 1
        continue
      }
      for (const cyc of CYCLES) {
        let d: BarDivisions
        try {
          d = barDivisions(pat, cyc)
        } catch {
          bump('threw')
          seen.add('threw')
          continue
        }
        const k = d.ok ? 'tree' : d.why
        bump(k)
        seen.add(k)
        if (!d.ok) {
          const list = (examples[k] ??= [])
          if (list.length < 6 && !list.includes(mini)) list.push(mini)
          continue
        }
        const before = w.hits
        walk(mini, cyc, d.parts, [{ begin: { n: 0, d: 1 }, end: { n: 1, d: 1 }, fromBefore: false, pastEnd: false }], d.oneOf, 0, w)
        hitsInTrees += w.hits - before
        hitsAsked += pat.hits(cyc).length
      }
      const k = seen.size === 1 && seen.has('tree') ? 'a tree in every bar' : seen.has('tree') ? 'a tree in some bars' : 'no tree'
      perPattern[k] = (perPattern[k] ?? 0) + 1
    }
    const report = {
      patterns: minis.length,
      perPattern,
      bars: verdicts,
      inTrees: { rows: w.rows, steps: w.steps, rests: w.rests, hits: w.hits, stepsWithGeneratedHits: w.generated, stepsCutShort: w.crossing, deepest: w.maxDepth },
      plainNotesAskedTwice: w.plainNotes,
    }
    if (process.env.ZZ_DIVISIONS) console.log(JSON.stringify(report, null, 1), JSON.stringify(examples, null, 1))

    // the second routes agree with the builder
    expect(w.plainNoteMismatch.slice(0, 5)).toEqual([])
    expect(w.floatTilingBroken.slice(0, 5)).toEqual([])
    // every hit of a bar that has a tree is in that tree, once
    expect(hitsInTrees).toBe(hitsAsked)
    // the hard cases are in what was measured, or the counts prove nothing
    expect(w.rests).toBeGreaterThan(1000)
    expect(w.generated).toBeGreaterThan(1000)
    expect(w.crossing).toBeGreaterThan(100)
    expect(w.maxDepth).toBeGreaterThanOrEqual(3)
    expect(report).toEqual(PINNED)
  }, 600_000)
})

/**
 * Measured on main 58c6d2f2 + this change (2026-10-10), bars 0–3 of every distinct corpus
 * pattern. A number here moves only with a reason.
 *
 * The 28 bars with no tree are seven patterns: three written with feet (`a b . c d`),
 * two whose step is sped up by a stack (`<…>*[0.5,2]` — its copies overlap), one group
 * dropped at random (`[…]?0.5` — its row has nowhere to sit in the bars it is dropped),
 * and one range between two alternations.
 */
const PINNED = {
  patterns: 1625,
  perPattern: { 'a tree in every bar': 1617, 'no tree': 7, 'does not evaluate': 1 },
  bars: { tree: 6468, 'hit-outside-its-step': 4, feet: 12, 'steps-do-not-tile': 12 },
  inTrees: { rows: 18089, steps: 35638, rests: 5267, hits: 52283, stepsWithGeneratedHits: 5416, stepsCutShort: 892, deepest: 5 },
  plainNotesAskedTwice: 24251,
}
