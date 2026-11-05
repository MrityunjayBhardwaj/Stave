/**
 * The piano roll's add, delete and length as edits of one step's own text (#2294).
 *
 * FIXTURES — on a nested melody, each edit's text, and STRUDEL IS ASKED: over two loops the
 * edited string plays exactly the intended note added, removed or lengthened, wherever the
 * written step plays, and nothing else. KRILL IS ASKED: the edited text parses.
 *
 * THE CORPUS, SIDE BY SIDE — every roll that opens today, each note deleted, each note made
 * a column longer and a column shorter, and a note added at every column, by today's roll
 * writer (`removeNote` / `resizeNote` / `placeNote` + `serializePianoRoll`, with its own
 * read-back) and by the new one. Every new edit is checked by Strudel; bytes per edit and
 * agreement are measured; differences are counted.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  applyStepEdit,
  chunkDivisions,
  midiToPitch,
  moveNote,
  parsePianoRoll,
  pitchToMidi,
  placeNote,
  removeNote,
  resizeNote,
  serializePianoRoll,
  type Frac,
  type PianoRollModel,
} from '..'
import { rollAdd, rollMove, rollRemove, rollResize, type RollEditResult, type RollPlace } from '../rollEdit'
import { miniPattern } from '../strudelMini/pattern'
import { miniTree } from '../strudelMini/tree'

/* ── asking Strudel ─────────────────────────────────────────────── */

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))
const F = (n: number, d = 1): Frac => {
  const g = gcd(n, d) || 1
  return { n: n / g, d: d / g }
}
const t = (x: { toFraction?: () => string; valueOf(): number }): string => x.toFraction?.() ?? String(x.valueOf())
const valueName = (v: unknown): string => (Array.isArray(v) ? v.join(':') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))

/** every hit over `cycles`, as `value@begin-end`, written in `[from, to)` when asked */
function plays(mini: string, cycles: number, within?: [number, number]): string[] {
  const pat = miniPattern(mini)
  const out: string[] = []
  for (let c = 0; c < cycles; c++) {
    for (const h of pat.hits(c)) {
      if (within && !h.locations.some((l) => l.start < within[1] && l.end > within[0])) continue
      out.push(`${valueName(h.value)}@${t(h.begin)}-${t(h.end)}`)
    }
  }
  return out.sort()
}
function difference(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const left = new Map<string, number>()
  for (const k of before) left.set(k, (left.get(k) ?? 0) + 1)
  const added: string[] = []
  for (const k of after) {
    const n = left.get(k) ?? 0
    if (n > 0) left.set(k, n - 1)
    else added.push(k)
  }
  const removed: string[] = []
  for (const [k, n] of left) for (let i = 0; i < n; i++) removed.push(k)
  return { added: added.sort(), removed: removed.sort() }
}

type Kind = 'add' | 'remove' | 'resize' | 'move'

/**
 * Does `edited` play exactly the intended change, over two loops? Every hit Strudel plays
 * differently is the note's pitch: a delete only removes, a length change removes and adds
 * at the same starts, an add only adds — save a split, whose step's own note comes back at
 * its start, shorter. The clicked note's own start is among them, so the change is at the
 * place asked; any other note moving, or the wrong place, fails it.
 */
function heard(mini: string, edited: string, edit: { from: number; to: number; insert: string }, kind: Kind, midi: number, start: string, cycles: number): boolean {
  void edit
  const got = difference(plays(mini, cycles), plays(edited, cycles))
  const pitchOf = (k: string): number | null => {
    const name = k.slice(0, k.lastIndexOf('@'))
    const n = Number(name)
    return Number.isFinite(n) && name.trim() !== '' ? n : pitchToMidi(name)
  }
  const begins = (xs: string[]): string[] => xs.map((k) => k.slice(k.lastIndexOf('@') + 1).split('-')[0]).sort()
  if (kind === 'add') {
    // a split shortens the step's own note: each removed hit comes back at the same start,
    // shorter, and what is left added is the new note, starting where it was asked
    const added = [...got.added]
    for (const r of got.removed) {
      const key = r.slice(0, r.lastIndexOf('-'))
      const i = added.findIndex((a) => a.slice(0, a.lastIndexOf('-')) === key)
      if (i < 0) return false
      added.splice(i, 1)
    }
    return added.length > 0 && added.every((k) => pitchOf(k) === midi) && begins(added).includes(start)
  }
  const mine = [...got.added, ...got.removed]
  if (mine.length === 0 || !mine.every((k) => pitchOf(k) === midi)) return false
  if (kind === 'remove') return got.added.length === 0 && begins(got.removed).includes(start)
  return got.added.length === got.removed.length && JSON.stringify(begins(got.added)) === JSON.stringify(begins(got.removed)) && begins(got.added).includes(start)
}

/**
 * Does a MOVE play exactly the note gone from where it was and arrived where it lands, at
 * every copy that moves? Every hit Strudel plays differently is either the note gone (its
 * pitch, its start among them) or the note arrived (the landing pitch, the landing start
 * among them), one arrived for each gone — so copies a move must leave alone play as before.
 */
function heardMove(mini: string, edited: string, edit: { from: number; to: number; insert: string }, midi: number, toMidi: number, start: string, landing: string, cycles: number): boolean {
  void edit
  const got = difference(plays(mini, cycles), plays(edited, cycles))
  const pitchOf = (k: string): number | null => {
    const name = k.slice(0, k.lastIndexOf('@'))
    const n = Number(name)
    return Number.isFinite(n) && name.trim() !== '' ? n : pitchToMidi(name)
  }
  const begins = (xs: string[]): string[] => xs.map((k) => k.slice(k.lastIndexOf('@') + 1).split('-')[0])
  // a move onto its own place (or a pitch change in place) can leave a hit unchanged on one side
  return (
    got.removed.length === got.added.length &&
    got.removed.length > 0 &&
    got.removed.every((k) => pitchOf(k) === midi) &&
    got.added.every((k) => pitchOf(k) === toMidi) &&
    begins(got.removed).includes(start) &&
    begins(got.added).includes(landing)
  )
}

/* ── the roll's columns, as places ──────────────────────────────── */

function barColumns(m: PianoRollModel, b: number): { start: number; per: number } {
  const bars = m.bars ?? 1
  if (m.barSteps) return { start: m.barSteps.slice(0, b).reduce((a, n) => a + n, 0), per: m.barSteps[b] }
  return { start: b * (m.steps / bars), per: m.steps / bars }
}
/** column `col` as a bar and the share of it, exactly */
function placeOf(m: PianoRollModel, col: number): RollPlace | null {
  for (let b = 0; b < (m.bars ?? 1); b++) {
    const { start, per } = barColumns(m, b)
    if (col >= start && col < start + per && Number.isInteger(col - start)) return { bar: b, at: F(col - start, per) }
  }
  return null
}
/** the end of a note `cols` long from `col`, as a share of the note's bar, or null past it */
function endOf(m: PianoRollModel, col: number, cols: number): Frac | null {
  const p = placeOf(m, col)
  if (!p) return null
  const { start, per } = barColumns(m, p.bar)
  const end = col + cols - start
  return Number.isInteger(end) && end > 0 && end <= per ? F(end, per) : null
}
const cycleOf = (p: RollPlace): string => {
  const x = F(p.at.n + p.bar * p.at.d, p.at.d)
  return x.d === 1 ? String(x.n) : `${x.n}/${x.d}`
}
const tokenFor = (m: PianoRollModel, midi: number): string => (m.numeric ? String(midi) : midiToPitch(midi))

/* ── fixtures ───────────────────────────────────────────────────── */

const MELODY = 'c4 [e4 [g4 a4]] b4'

function edit(mini: string, f: (trees: ReturnType<typeof chunkDivisions>) => RollEditResult, kind: Kind, midi: number, place: RollPlace, bars = 1): string {
  const trees = chunkDivisions(mini, bars)
  const r = f(trees)
  if (!r.ok) return `refused: ${r.why}`
  const edited = applyStepEdit(mini, r.edit)
  miniTree(edited) // krill reads it
  expect(heard(mini, edited, r.edit, kind, midi, cycleOf(place), bars * 2), `${mini} → ${edited}`).toBe(true)
  return edited
}

describe('the roll edits one step’s own text (#2294)', () => {
  const at = (n: number, d: number): RollPlace => ({ bar: 0, at: F(n, d) })
  it('add: a rest becomes the note, a note of another pitch gains it as a chord, a place inside a step splits it', () => {
    expect(edit('c4 ~ e4', (tr) => rollAdd('c4 ~ e4', tr, at(1, 3), 'g4'), 'add', 67, at(1, 3))).toBe('c4 g4 e4')
    expect(edit(MELODY, (tr) => rollAdd(MELODY, tr, at(0, 1), 'e4'), 'add', 64, at(0, 1))).toBe('[c4,e4] [e4 [g4 a4]] b4')
    expect(edit(MELODY, (tr) => rollAdd(MELODY, tr, at(1, 6), 'd4'), 'add', 62, at(1, 6))).toBe('[c4 d4] [e4 [g4 a4]] b4')
    // two equal hits of one note are `x*2` (#2326)
    expect(edit(MELODY, (tr) => rollAdd(MELODY, tr, at(5, 6), 'b4'), 'add', 71, at(5, 6))).toBe('c4 [e4 [g4 a4]] b4*2')
  })

  it('delete: the note becomes a rest, at any depth; a chord member leaves its chord', () => {
    expect(edit(MELODY, (tr) => rollRemove(MELODY, tr, at(1, 2), 67), 'remove', 67, at(1, 2))).toBe('c4 [e4 [~ a4]] b4')
    expect(edit('[c4,e4] b4', (tr) => rollRemove('[c4,e4] b4', tr, at(0, 1), 64), 'remove', 64, at(0, 1))).toBe('c4 b4')
    expect(rollRemove(MELODY, chunkDivisions(MELODY, 1), at(1, 2), 60)).toEqual({ ok: false, why: 'no-note-there' })
    // an add where that pitch already begins writes nothing — a toggle there would take it away
    expect(rollAdd('[c4,e4] b4', chunkDivisions('[c4,e4] b4', 1), at(0, 1), 'c4')).toEqual({ ok: false, why: 'note-already-there' })
  })

  it('length: the note takes in the rest after it as `@n`, or gives room back as rests', () => {
    expect(edit('c4 ~ e4 ~', (tr) => rollResize('c4 ~ e4 ~', tr, at(0, 1), 60, F(1, 2)), 'resize', 60, at(0, 1))).toBe('c4@2 e4 ~')
    expect(edit('c4@2 e4 ~', (tr) => rollResize('c4@2 e4 ~', tr, at(0, 1), 60, F(1, 4)), 'resize', 60, at(0, 1))).toBe('c4 ~ e4 ~')
    expect(rollResize(MELODY, chunkDivisions(MELODY, 1), at(0, 1), 60, F(2, 3))).toEqual({ ok: false, why: 'no-room-to-grow' })
  })

  it('move: a rest where it was, the note where it lands, every copy of the written step (case 1)', () => {
    const move = (mini: string, from: RollPlace, midi: number, to: RollPlace, pitch: string, toMidi: number): string => {
      const trees = chunkDivisions(mini, 1)
      const r = rollMove(mini, trees, from, midi, to, pitch, (s) => chunkDivisions(s, 1))
      if (!r.ok) return `refused: ${r.why}`
      const edited = applyStepEdit(mini, r.edit)
      miniTree(edited)
      expect(heardMove(mini, edited, r.edit, midi, toMidi, cycleOf(from), cycleOf(to), 2), `${mini} → ${edited}`).toBe(true)
      return edited
    }
    expect(move('c4 ~ e4 ~', at(0, 1), 60, at(1, 4), 'c4', 60)).toBe('~ c4 e4 ~')
    expect(move('c4 ~ e4 ~', at(0, 1), 60, at(1, 4), 'd4', 62)).toBe('~ d4 e4 ~')
    // written once, played twice: both copies move (the ruling of 2026-11-05)
    expect(move('[c4 ~]*2', at(0, 1), 60, at(1, 4), 'c4', 60)).toBe('[~ c4]*2')
  })

  it('move across places (case 2): the repeat the note sits in is written out, one copy changes, the rest stay `x!k`', () => {
    const move = (mini: string, from: RollPlace, midi: number, to: RollPlace, pitch: string, toMidi: number, bars = 1): string => {
      const trees = chunkDivisions(mini, bars)
      const r = rollMove(mini, trees, from, midi, to, pitch, (s) => chunkDivisions(s, bars))
      if (!r.ok) return `refused: ${r.why}`
      const edited = applyStepEdit(mini, r.edit)
      miniTree(edited)
      expect(heardMove(mini, edited, r.edit, midi, toMidi, cycleOf(from), cycleOf(to), bars * 2), `${mini} → ${edited}`).toBe(true)
      return edited
    }
    // copy 2's `e4` (3/8) dragged onto the rest after the repeat: that copy alone
    expect(move('[c4 e4]*2 ~', at(3, 8), 64, at(1, 2), 'e4', 64)).toBe('[[c4 e4] [c4 ~]] e4')
    // the last of four copies: the three left side by side are `!3` — "a repeat then the odd one"
    expect(move('[c4 e4]*4 ~', at(7, 16), 64, at(1, 2), 'e4', 64)).toBe('[[c4 e4]!3 [c4 ~]] e4')
    // a written repeat `!k`
    expect(move('[c4 e4]!3 ~', at(5, 8), 64, at(3, 4), 'e4', 64)).toBe('[c4 e4] [c4 e4] [c4 ~] e4')
    // copies that come from the loop playing again in every bar have no one text to write out
    expect(move('<c4 d4> e4', at(1, 2), 64, at(0, 1), 'e4', 64, 2)).toBe('refused: copies-come-from-outside-the-step')
    // a repeat whose alternation steps on each time round is not copies of one text
    expect(move('[c4 <e4 g4>]*2 ~', at(0, 1), 60, at(1, 2), 'c4', 60)).toBe('refused: repeat-plays-differently-each-time')
  })

  it('the move check can go red: moving every copy where one was dragged is heard', () => {
    // both copies of `e4` gone, one arrived: the change is not one note moved
    const mini = '[c4 e4]*2 ~'
    const wrong = '[c4 ~]*2 e4'
    const e = { from: 0, to: mini.length, insert: wrong }
    expect(heardMove(mini, wrong, e, 64, 64, '3/8', '1/2', 2)).toBe(false)
  })

  it('a note written once and played in two places changes in both', () => {
    expect(edit('[c4 ~]*2', (tr) => rollAdd('[c4 ~]*2', tr, at(1, 4), 'e4'), 'add', 64, at(1, 4))).toBe('[c4 e4]*2')
  })

  it('the Strudel check can go red: an edit at the wrong step is heard', () => {
    const mini = 'c4 ~ e4 ~'
    const wrong = { from: 7, to: 8, insert: 'g4' } // the last rest, not the clicked one
    expect(heard(mini, applyStepEdit(mini, wrong), wrong, 'add', 67, '1/4', 2)).toBe(false)
  })
})

/* ── the corpus ─────────────────────────────────────────────────── */

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

function changed(before: string, after: string): [number, number] {
  let a = 0
  while (a < before.length && a < after.length && before[a] === after[a]) a++
  let z = 0
  while (z < before.length - a && z < after.length - a && before[before.length - 1 - z] === after[after.length - 1 - z]) z++
  return [a, before.length - z]
}
function rewritten(before: string, after: string): number {
  const [a, z] = changed(before, after)
  return z - a + (after.length - before.length + (z - a))
}
const stats = (xs: number[]): string => {
  if (xs.length === 0) return 'n=0'
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return `n=${s.length} median=${at(0.5)} p95=${at(0.95)} max=${s[s.length - 1]}`
}

interface Side {
  asked: number
  agree: number
  sameMusic: number
  playsOther: number
  newRefuses: Record<string, number>
  todayRefusesNewWrites: number
  bothRefuse: number
  heardOk: number
  heardBad: string[]
  parseBad: string[]
  bytesNew: number[]
  bytesToday: number[]
}
const side = (): Side => ({ asked: 0, agree: 0, sameMusic: 0, playsOther: 0, newRefuses: {}, todayRefusesNewWrites: 0, bothRefuse: 0, heardOk: 0, heardBad: [], parseBad: [], bytesNew: [], bytesToday: [] })

interface Writers {
  add: typeof rollAdd
  remove: typeof rollRemove
  resize: typeof rollResize
  move: typeof rollMove
}

/** every roll that opens today, side by side, one gesture at a time */
function overCorpus(w: Writers, opts: { limit?: number } = {}): Record<Kind, Side> {
  const r: Record<Kind, Side> = { add: side(), remove: side(), resize: side(), move: side() }
  for (const mini of minis.slice(0, opts.limit)) {
    const g = parsePianoRoll(mini)
    if (!g.ok) continue
    const m = g.model
    const bars = m.bars ?? 1
    const trees = chunkDivisions(mini, bars)
    const compare = (kind: Kind, today: PianoRollModel, mine: RollEditResult, midi: number, place: RollPlace, landing?: RollPlace): void => {
      const s = r[kind]
      s.asked++
      const todayText = today === m ? null : serializePianoRoll(today)
      const mineText = mine.ok ? applyStepEdit(mini, mine.edit) : null
      if (mine.ok && mineText !== null) {
        s.bytesNew.push(rewritten(mini, mineText))
        let ok = false
        try {
          miniTree(mineText)
          ok = kind === 'move' ? heardMove(mini, mineText, mine.edit, midi, midi, cycleOf(place), cycleOf(landing!), bars * 2) : heard(mini, mineText, mine.edit, kind, midi, cycleOf(place), bars * 2)
        } catch {
          if (s.parseBad.length < 20) s.parseBad.push(`${JSON.stringify(mini)} → ${JSON.stringify(mineText)}`)
        }
        if (ok) s.heardOk++
        else if (s.heardBad.length < 40) s.heardBad.push(`${kind} ${JSON.stringify(mini)} midi ${midi} @${cycleOf(place)} → ${JSON.stringify(mineText)}`)
      }
      if (todayText !== null) s.bytesToday.push(rewritten(mini, todayText))
      if (todayText !== null && mineText !== null) {
        if (todayText === mineText) s.agree++
        else {
          let same = false
          try {
            same = JSON.stringify(plays(todayText, bars * 2)) === JSON.stringify(plays(mineText, bars * 2))
          } catch {
            same = false
          }
          if (same) s.sameMusic++
          else s.playsOther++
        }
      } else if (todayText !== null && !mine.ok) s.newRefuses[mine.why] = (s.newRefuses[mine.why] ?? 0) + 1
      else if (todayText === null && mine.ok) s.todayRefusesNewWrites++
      else s.bothRefuse++
    }
    for (const note of m.notes) {
      const midi = m.numeric ? Number(note.pitch) : pitchToMidi(note.pitch)
      const place = placeOf(m, note.start)
      if (midi === null || !place) continue
      compare('remove', removeNote(m, note.start, note.pitch, { readback: true }), w.remove(mini, trees, place, midi), midi, place)
      // a move one column later, same pitch, same bar
      const landing = placeOf(m, note.start + 1)
      if (landing && landing.bar === place.bar) {
        compare('move', moveNote(m, note.pitch, note.start, note.pitch, note.start + 1, { readback: true }), w.move(mini, trees, place, midi, landing, note.pitch, (s) => chunkDivisions(s, bars)), midi, place, landing)
      }
      const dur = Math.round(note.duration)
      if (Math.abs(dur - note.duration) > 1e-9) continue
      for (const cols of [dur + 1, dur - 1]) {
        if (cols < 1) continue
        const end = endOf(m, note.start, cols)
        if (!end) continue
        compare('resize', resizeNote(m, note.start, note.pitch, cols, { readback: true }), w.resize(mini, trees, place, midi, end), midi, place)
      }
    }
    // an add at every column, of the roll's lowest note, where that note does not already begin
    const low = Math.min(...m.notes.map((n) => (m.numeric ? Number(n.pitch) : pitchToMidi(n.pitch) ?? 999)))
    if (!Number.isFinite(low) || low === 999) continue
    const token = tokenFor(m, low)
    for (let col = 0; col < m.steps; col++) {
      if (m.notes.some((n) => n.start === col && (m.numeric ? Number(n.pitch) : pitchToMidi(n.pitch)) === low)) continue
      const place = placeOf(m, col)
      if (!place) continue
      compare('add', placeNote(m, token, col, 1, { readback: true }), w.add(mini, trees, place, token), low, place)
    }
  }
  return r
}

const summary = (r: Record<Kind, Side>): string =>
  (['add', 'remove', 'resize', 'move'] as Kind[])
    .map((k) => {
      const s = r[k]
      return [
        `## ${k}`,
        `asked ${s.asked}; both write: agree ${s.agree}, same music ${s.sameMusic}, play differently ${s.playsOther}`,
        `today writes, new refuses: ${JSON.stringify(s.newRefuses)}; new writes, today refuses: ${s.todayRefusesNewWrites}; both refuse: ${s.bothRefuse}`,
        `Strudel: ${s.heardOk} new edits play exactly the change, ${s.heardBad.length} not; krill: ${s.parseBad.length} do not parse`,
        `bytes per edit — new ${stats(s.bytesNew)}; today ${stats(s.bytesToday)}`,
        ...s.heardBad.slice(0, 10).map((x) => `  ${x}`),
      ].join('\n')
    })
    .join('\n\n')

describe('the roll writer, over the corpus, side by side with today’s (#2294)', () => {
  it('every new add, delete and length plays exactly the change and parses', () => {
    const r = overCorpus({ add: rollAdd, remove: rollRemove, resize: rollResize, move: rollMove })
    // `ROLL_EDIT_REPORT=/some/file.txt` writes the measurement; unset, nothing is written
    if (process.env.ROLL_EDIT_REPORT) writeFileSync(process.env.ROLL_EDIT_REPORT, summary(r))
    for (const k of ['add', 'remove', 'resize', 'move'] as Kind[]) {
      expect(r[k].asked, k).toBeGreaterThan(200)
      expect(r[k].heardBad, k).toEqual([])
      expect(r[k].parseBad, k).toEqual([])
    }
  }, 1_200_000)

  it('can go red: an add that writes the pitch a semitone off is heard', () => {
    const r = overCorpus(
      {
        add: (mini, trees, place, pitch) => rollAdd(mini, trees, place, /^[0-9]+$/.test(pitch) ? String(Number(pitch) + 1) : midiToPitch((pitchToMidi(pitch) ?? 60) + 1)),
        remove: rollRemove,
        resize: rollResize,
        move: rollMove,
      },
      { limit: 300 },
    )
    expect(r.add.heardBad.length).toBeGreaterThan(0)
  }, 600_000)
})
