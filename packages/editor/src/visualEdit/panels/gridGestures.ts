/**
 * The grids' keys as commands (#1801).
 *
 * A panel's keys are commands you can see in Settings → Keyboard Shortcuts,
 * rebind, and run from the palette, and they answer only while that panel has
 * focus (#1795, #1797). The command registry lives in the app, which this
 * package cannot import, so the grids meet it through this module instead:
 *
 * - `GRID_GESTURES` names each gesture — its id, the grid it belongs to, and
 *   its default keys. The app registers exactly these, so the list in Settings
 *   and the keys the grids answer to come from one table.
 * - The host calls `setGridKeyMatcher` with its own matcher (the registry's
 *   `matchScopedCommand`), so a rebind made in Settings reaches the grid. With
 *   no host matcher — component tests, any other host — a grid matches the
 *   defaults below through the one chord builder, and keeps working.
 * - A mounted grid installs what its gestures do with `mountGridGestures`;
 *   `runGridGesture` runs one there, or dry-runs it to ask whether it applies
 *   now (the palette offers a gesture only when it does).
 */

import { chordFromEvent, chordMatches } from '../../keys/chord'

export const GRID_SCOPE = {
  pianoRoll: 'pianoRoll',
  sequencer: 'sequencer',
} as const

export type GridScope = (typeof GRID_SCOPE)[keyof typeof GRID_SCOPE]

/**
 * What a grid gesture does. Each grid decides what that means on its own model:
 * `toggle` is what a click on the cursor cell does, `remove` takes away the note
 * under the cursor (the roll's Delete, the sequencer's Clear Step).
 */
export type GridAction =
  | CursorMove
  | NoteEdit
  | 'toggle'
  | 'remove'
  | 'copy'
  | 'paste'

/** Where a cursor key sends the cursor. */
export type CursorMove = 'left' | 'right' | 'up' | 'down' | 'rowStart' | 'rowEnd' | 'first' | 'last'

/**
 * What an edit key does to the note under the cursor (#1803): move it a column
 * earlier/later, a row or an octave up/down, or make it shorter/longer. A grid
 * that has no such operation (the sequencer cannot move a hit) declines it.
 */
export type NoteEdit =
  | 'nudgeLeft'
  | 'nudgeRight'
  | 'rowUp'
  | 'rowDown'
  | 'octaveUp'
  | 'octaveDown'
  | 'shorter'
  | 'longer'

const NOTE_EDITS = new Set<string>([
  'nudgeLeft',
  'nudgeRight',
  'rowUp',
  'rowDown',
  'octaveUp',
  'octaveDown',
  'shorter',
  'longer',
])

/** Is `action` an edit of the note under the cursor? */
export function isNoteEdit(action: GridAction): action is NoteEdit {
  return NOTE_EDITS.has(action)
}

export const GRID_GESTURE = {
  rollDelete: 'stave.pianoRoll.deleteNote',
  rollCopy: 'stave.pianoRoll.copyNote',
  rollPaste: 'stave.pianoRoll.pasteNote',
  rollToggle: 'stave.pianoRoll.toggleNote',
  rollLeft: 'stave.pianoRoll.cursorLeft',
  rollRight: 'stave.pianoRoll.cursorRight',
  rollUp: 'stave.pianoRoll.cursorUp',
  rollDown: 'stave.pianoRoll.cursorDown',
  rollRowStart: 'stave.pianoRoll.cursorRowStart',
  rollRowEnd: 'stave.pianoRoll.cursorRowEnd',
  rollFirst: 'stave.pianoRoll.cursorFirst',
  rollLast: 'stave.pianoRoll.cursorLast',
  seqToggle: 'stave.sequencer.toggleStep',
  seqClear: 'stave.sequencer.clearStep',
  seqLeft: 'stave.sequencer.cursorLeft',
  seqRight: 'stave.sequencer.cursorRight',
  seqUp: 'stave.sequencer.cursorUp',
  seqDown: 'stave.sequencer.cursorDown',
  seqRowStart: 'stave.sequencer.cursorRowStart',
  seqRowEnd: 'stave.sequencer.cursorRowEnd',
  seqFirst: 'stave.sequencer.cursorFirst',
  seqLast: 'stave.sequencer.cursorLast',
  rollNudgeLeft: 'stave.pianoRoll.nudgeLeft',
  rollNudgeRight: 'stave.pianoRoll.nudgeRight',
  rollRowUp: 'stave.pianoRoll.transposeUp',
  rollRowDown: 'stave.pianoRoll.transposeDown',
  rollOctaveUp: 'stave.pianoRoll.octaveUp',
  rollOctaveDown: 'stave.pianoRoll.octaveDown',
  rollShorter: 'stave.pianoRoll.shorter',
  rollLonger: 'stave.pianoRoll.longer',
  seqShorter: 'stave.sequencer.shorter',
  seqLonger: 'stave.sequencer.longer',
} as const

export type GridGestureId = (typeof GRID_GESTURE)[keyof typeof GRID_GESTURE]

export interface GridGestureDef {
  id: GridGestureId
  scope: GridScope
  action: GridAction
  title: string
  keybinding: string
  alternateKeybindings?: readonly string[]
}

/**
 * The cursor keys, the same in both grids. Arrows are Logic Pro 12.3's Step
 * Sequencer defaults (`Select Next Step` | `Right Arrow`, `Select Step Above` |
 * `Up Arrow`); Home/End and ⌘Home/⌘End are the ARIA grid pattern's (Logic has
 * no equivalent).
 */
function cursorKeys(
  scope: GridScope,
  ids: Record<CursorMove, GridGestureId>,
): GridGestureDef[] {
  const keys: Array<[CursorMove, string, string]> = [
    ['left', 'Move cursor left', 'arrowleft'],
    ['right', 'Move cursor right', 'arrowright'],
    ['up', 'Move cursor up', 'arrowup'],
    ['down', 'Move cursor down', 'arrowdown'],
    ['rowStart', 'Move cursor to the start of the row', 'home'],
    ['rowEnd', 'Move cursor to the end of the row', 'end'],
    ['first', 'Move cursor to the first cell', 'mod+home'],
    ['last', 'Move cursor to the last cell', 'mod+end'],
  ]
  return keys.map(([action, title, keybinding]) => ({ id: ids[action], scope, action, title, keybinding }))
}

/**
 * The roll's Delete/⌘C/⌘V are the keys it has always answered to; a Mac
 * keyboard's delete key sends `Backspace`, so delete takes both. Toggle is Logic
 * 12.3's `Toggle Selected Step` | `Apostrophe`, with Enter beside it. Space is
 * NOT a toggle: in Logic it is Play or Stop.
 */
export const GRID_GESTURES: readonly GridGestureDef[] = [
  {
    id: GRID_GESTURE.rollDelete,
    scope: GRID_SCOPE.pianoRoll,
    action: 'remove',
    title: 'Delete selected note',
    keybinding: 'delete',
    alternateKeybindings: ['backspace'],
  },
  {
    id: GRID_GESTURE.rollCopy,
    scope: GRID_SCOPE.pianoRoll,
    action: 'copy',
    title: 'Copy selected note',
    keybinding: 'mod+c',
  },
  {
    id: GRID_GESTURE.rollPaste,
    scope: GRID_SCOPE.pianoRoll,
    action: 'paste',
    title: 'Paste note at selected cell',
    keybinding: 'mod+v',
  },
  {
    id: GRID_GESTURE.rollToggle,
    scope: GRID_SCOPE.pianoRoll,
    action: 'toggle',
    title: 'Add or remove a note at the cursor',
    keybinding: "'",
    alternateKeybindings: ['enter'],
  },
  // #1803 — Logic 12.3's defaults: `Transpose … +1 Semitone` | `Option-Up Arrow`,
  // `Transpose … +12 Semitone` | `Option-Shift-Up Arrow`, `Nudge … Position Right by
  // Nudge Value` | `Option-Right Arrow`, `Nudge … Length Right by Nudge Value` |
  // `Option-Shift-Right Arrow`. The nudge value is the roll's snap division.
  { id: GRID_GESTURE.rollNudgeLeft, scope: GRID_SCOPE.pianoRoll, action: 'nudgeLeft', title: 'Move note earlier', keybinding: 'alt+arrowleft' },
  { id: GRID_GESTURE.rollNudgeRight, scope: GRID_SCOPE.pianoRoll, action: 'nudgeRight', title: 'Move note later', keybinding: 'alt+arrowright' },
  { id: GRID_GESTURE.rollRowUp, scope: GRID_SCOPE.pianoRoll, action: 'rowUp', title: 'Move note up a row', keybinding: 'alt+arrowup' },
  { id: GRID_GESTURE.rollRowDown, scope: GRID_SCOPE.pianoRoll, action: 'rowDown', title: 'Move note down a row', keybinding: 'alt+arrowdown' },
  { id: GRID_GESTURE.rollOctaveUp, scope: GRID_SCOPE.pianoRoll, action: 'octaveUp', title: 'Move note up an octave', keybinding: 'alt+shift+arrowup' },
  { id: GRID_GESTURE.rollOctaveDown, scope: GRID_SCOPE.pianoRoll, action: 'octaveDown', title: 'Move note down an octave', keybinding: 'alt+shift+arrowdown' },
  { id: GRID_GESTURE.rollShorter, scope: GRID_SCOPE.pianoRoll, action: 'shorter', title: 'Make note shorter', keybinding: 'alt+shift+arrowleft' },
  { id: GRID_GESTURE.rollLonger, scope: GRID_SCOPE.pianoRoll, action: 'longer', title: 'Make note longer', keybinding: 'alt+shift+arrowright' },
  ...cursorKeys(GRID_SCOPE.pianoRoll, {
    left: GRID_GESTURE.rollLeft,
    right: GRID_GESTURE.rollRight,
    up: GRID_GESTURE.rollUp,
    down: GRID_GESTURE.rollDown,
    rowStart: GRID_GESTURE.rollRowStart,
    rowEnd: GRID_GESTURE.rollRowEnd,
    first: GRID_GESTURE.rollFirst,
    last: GRID_GESTURE.rollLast,
  }),
  {
    id: GRID_GESTURE.seqToggle,
    scope: GRID_SCOPE.sequencer,
    action: 'toggle',
    title: 'Turn the step at the cursor on or off',
    keybinding: "'",
    alternateKeybindings: ['enter'],
  },
  // Logic 12.3: `Clear Step` | `Control-Delete`. Delete and ⌫ as well, because on
  // this grid removing the hit under the cursor and clearing the step are one edit.
  {
    id: GRID_GESTURE.seqClear,
    scope: GRID_SCOPE.sequencer,
    action: 'remove',
    title: 'Clear the step at the cursor',
    keybinding: 'delete',
    alternateKeybindings: ['backspace', 'ctrl+backspace'],
  },
  // Length only: the sequencer has no move operation, and a drag there paints (#1803).
  { id: GRID_GESTURE.seqShorter, scope: GRID_SCOPE.sequencer, action: 'shorter', title: 'Make step shorter', keybinding: 'alt+shift+arrowleft' },
  { id: GRID_GESTURE.seqLonger, scope: GRID_SCOPE.sequencer, action: 'longer', title: 'Make step longer', keybinding: 'alt+shift+arrowright' },
  ...cursorKeys(GRID_SCOPE.sequencer, {
    left: GRID_GESTURE.seqLeft,
    right: GRID_GESTURE.seqRight,
    up: GRID_GESTURE.seqUp,
    down: GRID_GESTURE.seqDown,
    rowStart: GRID_GESTURE.seqRowStart,
    rowEnd: GRID_GESTURE.seqRowEnd,
    first: GRID_GESTURE.seqFirst,
    last: GRID_GESTURE.seqLast,
  }),
]

const BY_ID = new Map<string, GridGestureDef>(GRID_GESTURES.map((g) => [g.id, g]))

/** What a gesture of `scope` does, or undefined for an id that is not one. */
export function gridGestureAction(scope: GridScope, id: string): GridAction | undefined {
  const g = BY_ID.get(id)
  return g && g.scope === scope ? g.action : undefined
}

/** A cell position: `row` top to bottom, `col` left to right. */
export interface GridCell {
  row: number
  col: number
}

/**
 * Where a cursor key moves the cursor on a `rows` × `cols` grid. Clamped at the
 * edges — it never wraps, so holding → stops at the last step instead of
 * jumping to the next row.
 */
export function moveCursor(at: GridCell, move: CursorMove, rows: number, cols: number): GridCell {
  const clamp = (v: number, n: number): number => Math.max(0, Math.min(n - 1, v))
  switch (move) {
    case 'left':
      return { row: at.row, col: clamp(at.col - 1, cols) }
    case 'right':
      return { row: at.row, col: clamp(at.col + 1, cols) }
    case 'up':
      return { row: clamp(at.row - 1, rows), col: at.col }
    case 'down':
      return { row: clamp(at.row + 1, rows), col: at.col }
    case 'rowStart':
      return { row: at.row, col: 0 }
    case 'rowEnd':
      return { row: at.row, col: Math.max(0, cols - 1) }
    case 'first':
      return { row: 0, col: 0 }
    case 'last':
      return { row: Math.max(0, rows - 1), col: Math.max(0, cols - 1) }
  }
}

/**
 * `moveCursor` on a grid whose rows are drawn as boxes `widthOf(row)` columns wide (#1855).
 * The cursor keeps a column and the box holding it is the one selected. ←/→ step over a
 * whole box and land on the next box's first column; ↑/↓ keep the column, so they land on
 * the box playing at that moment in the next row — which, after ←/→, is the moment the box
 * you were on starts. With a box per column this is `moveCursor`.
 */
export function moveBoxCursor(
  at: GridCell,
  move: CursorMove,
  rows: number,
  cols: number,
  widthOf: (row: number) => number,
): GridCell {
  if (move === 'up' || move === 'down') return moveCursor(at, move, rows, cols)
  const w = widthOf(at.row)
  const start = at.col - (at.col % w)
  // leave the box from the edge the key points out of
  const from = { row: at.row, col: move === 'right' ? start + w - 1 : start }
  const to = moveCursor(from, move, rows, cols)
  const tw = widthOf(to.row)
  return { row: to.row, col: to.col - (to.col % tw) }
}

/** the stop holding column `col`: the last one at or before it (the first stop when none is) */
export function stopAt(stops: readonly number[], col: number): number {
  let got = stops[0] ?? col
  for (const s of stops) if (s <= col) got = s
  return got
}

/**
 * `moveCursor` on a grid whose rows are drawn as their own STEPS (#2293): `stopsOf(row)` is
 * each box's first column, in order. ←/→ go to the step before or after, whatever depth it
 * is drawn at — into a group and out of it; ↑/↓ keep the moment, so the step of the next
 * row playing then is the one selected. Clamped like `moveCursor`. A row with no stops
 * falls back to one stop per column.
 */
export function moveStepCursor(
  at: GridCell,
  move: CursorMove,
  rows: number,
  cols: number,
  stopsOf: (row: number) => readonly number[] | null,
): GridCell {
  const stops = (row: number): readonly number[] => {
    const s = stopsOf(row)
    return s && s.length > 0 ? s : Array.from({ length: cols }, (_, c) => c)
  }
  const clampRow = (r: number): number => Math.max(0, Math.min(rows - 1, r))
  const here = stops(at.row)
  const i = here.indexOf(stopAt(here, at.col))
  switch (move) {
    case 'left':
      // from part-way through a step (after ↑/↓ kept a moment), ← is that step's start
      return { row: at.row, col: here[i] < at.col ? here[i] : here[Math.max(0, i - 1)] }
    case 'right': {
      // the next step that begins after the cursor; at the last one, the cursor stays
      const next = here.find((s) => s > at.col)
      return { row: at.row, col: next ?? at.col }
    }
    case 'up':
    case 'down':
      // the moment is kept, as `moveBoxCursor` keeps it: the step holding it is the one selected
      return { row: clampRow(at.row + (move === 'up' ? -1 : 1)), col: at.col }
    case 'rowStart':
      return { row: at.row, col: here[0] }
    case 'rowEnd':
      return { row: at.row, col: here[here.length - 1] }
    case 'first':
      return { row: 0, col: stops(0)[0] }
    case 'last': {
      const row = Math.max(0, rows - 1)
      const s = stops(row)
      return { row, col: s[s.length - 1] }
    }
  }
}

/** Is `action` a cursor move? */
export function isCursorMove(action: GridAction): action is CursorMove {
  return CURSOR_MOVES.has(action)
}

const CURSOR_MOVES = new Set<string>(['left', 'right', 'up', 'down', 'rowStart', 'rowEnd', 'first', 'last'])

/** Settings' group name and "where it works" line, per grid. */
export const GRID_SCOPE_LABEL: Record<GridScope, { category: string; where: string }> = {
  pianoRoll: { category: 'Piano roll', where: 'In the piano roll, on the selected cell' },
  sequencer: { category: 'Sequencer', where: 'In the sequencer, on the selected cell' },
}

/** Which gesture of `scope` a keystroke is bound to, if any. */
export type GridKeyMatcher = (scope: GridScope, e: KeyboardEvent) => string | undefined

function matchDefaults(scope: GridScope, e: KeyboardEvent): string | undefined {
  const chord = chordFromEvent(e)
  for (const g of GRID_GESTURES) {
    if (g.scope !== scope) continue
    if ([g.keybinding, ...(g.alternateKeybindings ?? [])].some((b) => chordMatches(chord, b))) return g.id
  }
  return undefined
}

let matcher: GridKeyMatcher = matchDefaults

/**
 * Install the host's matcher. Returns a release that restores the defaults,
 * only if this matcher is still the installed one.
 */
export function setGridKeyMatcher(fn: GridKeyMatcher): () => void {
  matcher = fn
  return () => {
    if (matcher === fn) matcher = matchDefaults
  }
}

/** What a keystroke in `scope`'s grid is bound to do, if anything. */
export function matchGridKey(scope: GridScope, e: KeyboardEvent): GridAction | undefined {
  const id = matcher(scope, e)
  return id ? gridGestureAction(scope, id) : undefined
}

/**
 * What a mounted grid does for one action. With `dryRun` it only answers
 * whether the action applies now; otherwise it acts and answers whether it did.
 */
export type GridGestureRunner = (action: GridAction, dryRun: boolean) => boolean

const mounted = new Map<GridScope, GridGestureRunner>()

/**
 * Install the mounted grid's runner for `scope`. Returns a release that only
 * removes THIS runner, so a remount that installed a newer one first keeps it.
 */
export function mountGridGestures(scope: GridScope, run: GridGestureRunner): () => void {
  mounted.set(scope, run)
  return () => {
    if (mounted.get(scope) === run) mounted.delete(scope)
  }
}

/** Run (or dry-run) a gesture in `scope`'s mounted grid. False when none is mounted. */
export function runGridGesture(scope: GridScope, id: string, dryRun: boolean): boolean {
  const action = gridGestureAction(scope, id)
  if (!action) return false
  return mounted.get(scope)?.(action, dryRun) ?? false
}
