/**
 * rollTree.ts — a piano roll drawn from the pattern's own divisions alone, for a melody
 * that has no roll model (#1834, epic #1832).
 *
 * The roll edits through columns too, and a melody the columns cannot hold — a hit
 * between them, a bar past the column cap, a note with no text of its own — opened as
 * "isn't grid-editable". Strudel's tree still says where every note plays, exactly. This
 * file turns it into what a roll draws: every note at its exact time and length on its
 * pitch row, and the lines and ruler of one part's steps. LOOK-ONLY: there are no columns
 * to write through.
 *
 * THE PITCH IS READ AS THE ROLL READS IT (`rollPitch`): from the value Strudel plays — a
 * number is a numeric pitch (MIDI for `note`, a degree for `n`, drawn on its own number's
 * row as the roll draws it), a note name is its MIDI note. Nothing here reads the text.
 *
 * Pure, like `treeGrid.ts`: `TreeRollGrid.tsx` only renders what this returns. Positions
 * are in cycles from the pattern's start.
 */
import { parsePianoRoll, pitchToMidi, rollPitch } from '../../codeView'
import { barStepsOrWhy, fracNum, type FracStep } from './gridZoom'
import { probeTrees, repeatingBars, type OkTree } from './treeGrid'
import type { BarTree, DivisionRow } from '../../codeView'
import { perText, type PerText } from './useDeferredPerText'

export interface TreeNote {
  /** cycles from the pattern's start */
  begin: number
  end: number
  /** the row it is drawn on: MIDI for a note name, the number itself for a numeric pitch */
  midi: number
  /** its comma part */
  part: number
}

export interface TreeRoll {
  bars: number
  /** the notes are numbers (`n("0 2 4")`), drawn on their own number's row */
  numeric: boolean
  notes: TreeNote[]
  parts: number
  /** the part whose steps draw the lines and the ruler: the one with the most notes */
  linesPart: number
  /** that part's steps, every bar; null when a bar's steps do not tile it (`linesWhy`) */
  lines: FracStep[][] | null
  linesWhy: string | null
}

export type TreeRollResult = ({ ok: true } & TreeRoll) | { ok: false; why: string }

/** every hit of the row, at any depth */
function eachHit(row: DivisionRow, visit: (h: DivisionRow['steps'][number]['hits'][number]) => void): void {
  for (const s of row.steps) {
    for (const h of s.hits) visit(h)
    for (const r of s.rows ?? []) eachHit(r, visit)
  }
}

/** a melody's tree roll, from its mini string — or why there is none */
export function treeRollOf(mini: string): TreeRollResult {
  return treeRollFrom(probeTrees(mini))
}

/** `treeRollOf`, from the trees of bars `0 … n−1` */
export function treeRollFrom(probed: readonly BarTree[]): TreeRollResult {
  const rep = repeatingBars(probed)
  if (!rep.ok) return rep
  const { bars, trees } = rep
  const parts = trees[0].parts.length
  const notes: TreeNote[] = []
  const perPart = new Array<number>(parts).fill(0)
  let numeric: boolean | null = null
  let why: string | null = null
  trees.forEach((t: OkTree, b) => {
    t.parts.forEach((row, p) => {
      eachHit(row, (h) => {
        if (why) return
        const read = rollPitch(h.value)
        // a sound name, or a value with no note in it: not a melody
        if (typeof read === 'string') {
          why = read
          return
        }
        if (numeric !== null && numeric !== read.numeric) {
          why = 'mixed-pitch-domain'
          return
        }
        numeric = read.numeric
        const midi = read.numeric ? Number(read.pitch) : pitchToMidi(read.pitch)
        if (midi === null || !Number.isFinite(midi)) {
          why = 'wrong-surface'
          return
        }
        notes.push({ begin: b + fracNum(h.begin), end: Math.min(bars, b + fracNum(h.end)), midi, part: p })
        perPart[p]++
      })
    })
  })
  if (why) return { ok: false, why }
  if (notes.length === 0) return { ok: false, why: 'no-hits' }
  notes.sort((x, y) => x.begin - y.begin || x.midi - y.midi)
  // the part with the most notes draws the lines, as the editable roll chooses (`rollPart`)
  let linesPart = 0
  perPart.forEach((n, p) => {
    if (n > perPart[linesPart]) linesPart = p
  })
  const lines: FracStep[][] = []
  let linesWhy: string | null = null
  for (const t of trees) {
    const steps = barStepsOrWhy(t.parts[linesPart], '')
    if (typeof steps === 'string') {
      linesWhy = steps
      break
    }
    lines.push(steps)
  }
  return { ok: true, bars, numeric: numeric ?? false, notes, parts, linesPart, lines: linesWhy ? null : lines, linesWhy }
}

/**
 * The refusals a tree roll does NOT stand in for: the pattern plays sound names (the step
 * grid's), nothing, or a mix of numbers and note names; or its text is not what Strudel
 * plays (a backslash escape). Every other refusal is about the roll's columns.
 */
const NOT_A_ROLL: ReadonlySet<string | undefined> = new Set<string | undefined>(['wrong-surface', 'no-note-content', 'mixed-pitch-domain', 'escaped-source'])

/**
 * What the roll draws for a melody it has no roll model for: the tree roll and the sentence
 * saying why it is look-only — or null when the roll has a model (editable or look-only) or
 * the refusal is not about columns; `{ why }` when the tree has no roll either. Kept per
 * text: reading the bars for the repeat is the expensive part.
 */
export const lookOnlyTreeRoll: PerText<{ roll: TreeRoll; reason: string } | { why: string } | null> = perText(lookOnlyTreeRollUncached)

function lookOnlyTreeRollUncached(mini: string): { roll: TreeRoll; reason: string } | { why: string } | null {
  const r = parsePianoRoll(mini)
  if (r.ok || r.lookOnly) return null
  if (NOT_A_ROLL.has(r.gate)) return null
  const t = treeRollOf(mini)
  if (!t.ok) return { why: t.why }
  const { ok: _ok, ...roll } = t
  return { roll, reason: r.reason }
}
