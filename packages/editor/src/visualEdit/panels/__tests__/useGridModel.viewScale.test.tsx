/**
 * `useGridModel` at a refined view (#1057) — the WRITE side of the free zone.
 *
 * The free-zone tests in `notation/__tests__/resolution.test.ts` pin the pure rule:
 * which targets are a view change, and what a model collapses to. They cannot see
 * the thing that actually reaches the user's file, because the decision to absorb
 * the refinement and the choice of which model to serialize both live in the hook.
 *
 * That gap is not hypothetical: it is where a velocity drag respelled `bd ~ sn ~`
 * as `bd _ ~ ~ sn _ ~ ~` and widened the `.gain` mini to match, while every pure
 * test stayed green. So this drives the REAL hook against a real document and reads
 * the bytes back — the same question the panel asks, asked where the panel asks it.
 *
 * The Monaco surface is stood in for rather than mocked away: a single-line model
 * with the five methods `Writeback` actually calls, so the write goes through the
 * production `applyEdit` → `Writeback.replaceRanges` path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as React from 'react'
import { render, act } from '@testing-library/react'

// ── a single-line Monaco stand-in ────────────────────────────────────────────
let DOC = ''
let cursorOffset = 0
// #1909 — what the gesture / own-write cases read: undo boundaries pushed, and the
// content listeners the hooks subscribe (fired after every edit, as Monaco does).
let undoStops = 0
let contentListeners: (() => void)[] = []
let cursorListeners: (() => void)[] = []
/** Move the cursor the way Monaco reports it — the panel re-detects the chunk there. */
const moveCursor = (offset: number): void => {
  cursorOffset = offset
  for (const l of [...cursorListeners]) l()
}
const fireContentChange = (): void => {
  for (const l of [...contentListeners]) l()
}

class FakeRange {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

const fakeModel = {
  getValue: () => DOC,
  getOffsetAt: (p: { column: number }) => p.column - 1,
  getPositionAt: (o: number) => ({ lineNumber: 1, column: o + 1 }),
  onDidChangeContent: (l: () => void) => {
    contentListeners.push(l)
    return { dispose: () => (contentListeners = contentListeners.filter((x) => x !== l)) }
  },
  pushStackElement: () => {
    undoStops++
  },
  pushEditOperations: (_sel: unknown, ops: { range: FakeRange; text: string }[]) => {
    // right-to-left so earlier offsets stay valid, matching Monaco's own semantics
    for (const op of [...ops].sort((a, b) => b.range.startColumn - a.range.startColumn)) {
      DOC = DOC.slice(0, op.range.startColumn - 1) + op.text + DOC.slice(op.range.endColumn - 1)
    }
    fireContentChange() // inside the edit, while the writer's own-edit flag is up
    return null
  },
}

const fakeEditor = {
  getModel: () => fakeModel,
  getPosition: () => ({ lineNumber: 1, column: cursorOffset + 1 }),
  onDidChangeCursorPosition: (l: () => void) => {
    cursorListeners.push(l)
    return { dispose: () => (cursorListeners = cursorListeners.filter((x) => x !== l)) }
  },
}

// Every chunk detection, with the offset it was asked at — so a test can tell the
// cursor re-detect (at `cursorOffset`) from the write's own re-read (at the anchor).
const detectCalls: number[] = []
vi.mock('../../../codeView', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../codeView')>()
  return {
    ...real,
    detectChunk: (doc: string, offset: number) => {
      detectCalls.push(offset)
      return real.detectChunk(doc, offset)
    },
  }
})

vi.mock('../../../workspace/editorRegistry', () => ({
  getActiveEditor: () => fakeEditor,
  onActiveEditorChange: () => () => {},
  getMonacoNamespace: () => ({ Range: FakeRange }),
  requestReeval: () => {},
  getFileIdForEditor: () => 'test-file',
}))

import { parseStepGrid, applyStepGain } from '../../../codeView/notation/parse'
import { serializeStepGrid, serializeStepGain } from '../../../codeView/notation/serialize'
import { collapseStepGridToDocument } from '../../../codeView/notation/resolution'
import { isStepChunk } from '../../../codeView/patternKind'
import { useGridModel } from '../useGridModel'
import { setColumnGain } from '../inspector'
import { toggleCell } from '../../../codeView/notation/place'
import { UNREFINED, documentSteps, type ViewScale } from '../../../codeView/notation/viewResolution'
import type { StepGridModel } from '../../../codeView/notation/model'

// ── a harness wired exactly as `SequencerGrid` wires it ──────────────────────
interface Handle {
  model: StepGridModel | null
  mutate: (fn: (m: StepGridModel) => StepGridModel) => void
  settle: (m: StepGridModel) => void
  writeMini: (mini: string) => void
  beginGesture: () => void
  endGesture: () => void
  setViewScale: (s: ViewScale) => void
  viewScale: ViewScale
}
let h: Handle

function Harness(): React.ReactElement {
  const [viewScale, setViewScale] = React.useState<ViewScale>(UNREFINED)
  const { model, mutate, settle, writeMini, beginGesture, endGesture, patternKey } = useGridModel<StepGridModel>({
    source: 'seq',
    eligible: isStepChunk,
    parse: parseStepGrid,
    serialize: serializeStepGrid,
    applyGain: applyStepGain,
    serializeGain: serializeStepGain,
    viewScale,
    onViewScaleConsumed: () => setViewScale(UNREFINED),
    collapseToDocument: collapseStepGridToDocument,
  })
  React.useEffect(() => {
    setViewScale(UNREFINED)
  }, [patternKey])
  h = { model, mutate, settle, writeMini, beginGesture, endGesture, setViewScale, viewScale }
  return React.createElement('div')
}

describe('useGridModel — writing from a refined view (#1057)', () => {
  beforeEach(() => {
    DOC = 's("bd ~ sn ~")'
    cursorOffset = 5 // inside the mini
  })

  it('refining alone writes nothing', () => {
    render(React.createElement(Harness))
    const before = DOC
    expect(h.model?.steps).toBe(4)

    act(() => h.setViewScale(2))

    expect(DOC, 'a view preference must not reach the file').toBe(before)
    expect(h.model?.steps).toBe(8) // …but the panel really is drawing finer
    expect(documentSteps(h.model as StepGridModel)).toBe(4)
  })

  it('THE DEFECT: a velocity edit while refined leaves the notation alone', () => {
    render(React.createElement(Harness))
    act(() => h.setViewScale(2))

    act(() => h.mutate((prev) => setColumnGain(prev, 0, 0.42)))

    // the notation is byte-identical — only `.gain` was added
    expect(DOC).toBe('s("bd ~ sn ~").gain("0.42 ~ 1 ~")')
    // …and the user's zoom survived, because the document's spelling never changed
    expect(h.viewScale).toBe(2)
    expect(h.model?.steps).toBe(8)
  })

  it('CONTROL ARM: the same edit unrefined produces the same document', () => {
    // If these two diverged, the refinement would still be reaching the file.
    render(React.createElement(Harness))
    act(() => h.mutate((prev) => setColumnGain(prev, 0, 0.42)))
    expect(DOC).toBe('s("bd ~ sn ~").gain("0.42 ~ 1 ~")')
    expect(h.viewScale).toBe(UNREFINED)
  })

  it('an edit that USES a view-only column does spell it, and absorbs the view', () => {
    render(React.createElement(Harness))
    act(() => h.setViewScale(2))

    // drawn column 1 exists only at ×2 — this is what refining is FOR
    act(() => h.mutate((prev) => toggleCell(prev, 0, 1, true)))

    expect(DOC).toBe('s("[bd bd] ~ sn ~")')
    // the document now spells what was drawn, so the marker is dropped and the
    // panel returns to its own resolution — with no change in what is on screen
    expect(h.viewScale).toBe(UNREFINED)
    expect(h.model?.steps).toBe(8)
    expect(documentSteps(h.model as StepGridModel)).toBe(8)
  })

  /**
   * ⚠ EVERY OTHER CASE IN THIS FILE USES `bd ~ sn ~`, AND THAT IS HOW #1121 SHIPPED.
   * A flat pattern spells its content uniquely, so re-spelling it flat is the identity
   * — these tests drove the whole hook, read real bytes back, and still could not have
   * failed. This one uses a document whose REPRESENTATION can differ from its VALUE,
   * which is the only kind that can.
   *
   * Stated as an equivalence rather than a literal: the same edit made plainly and made
   * through a refined view must write the same document. "The notation did not change"
   * would be satisfied by a control that did nothing at all.
   *
   * ⚠ THE EDIT IS AN ERASE, NOT A VELOCITY DRAG, and the reason is worth keeping even
   * now that #1123 is fixed: the two are different write paths, and a gate that asserts
   * both cannot say which one broke. The first draft of this test used a velocity drag
   * and failed on a document where both arms were equally flat — which is how #1123 was
   * found. Its own hook-level case is the one below.
   */
  it('#1121: the same edit on a STRUCTURED document spells the same, refined or not', () => {
    const SRC = 's("bd [hh hh] sn cp")'

    DOC = SRC
    const plain = render(React.createElement(Harness))
    act(() => h.mutate((prev) => toggleCell(prev, 0, 0, false))) // erase the `bd`
    const unrefined = DOC
    expect(unrefined, 'the control arm really did write').not.toBe(SRC)
    plain.unmount()

    DOC = SRC
    render(React.createElement(Harness))
    act(() => h.setViewScale(2))
    expect(h.model?.steps, 'the panel really is drawing finer').toBe(16)
    act(() => h.mutate((prev) => toggleCell(prev, 0, 0, false))) // the same erase

    expect(DOC, 'the grouping the author wrote must survive').toContain('[hh hh]')
    expect(DOC).toBe(unrefined)
    // …and the user's zoom survives, because the document's spelling never changed
    expect(h.viewScale).toBe(2)
  })

  /**
   * #1123 through the real hook. The corpus gate proves the writer; this proves the
   * bytes that actually reach the file, on a document with structure — the last thing
   * the issue listed as owed.
   */
  it('#1123: a velocity drag leaves a STRUCTURED document spelled as written', () => {
    DOC = 's("bd [hh hh] sn cp")'
    render(React.createElement(Harness))

    act(() => h.mutate((prev) => setColumnGain(prev, 0, 0.42)))

    expect(DOC, 'the grouping the author wrote must survive').toContain('[hh hh]')
    expect(DOC.startsWith('s("bd [hh hh] sn cp")'), DOC).toBe(true)
    // …and the velocity really landed, so this does not pass by writing nothing
    expect(DOC).toContain('.gain(')
  })

  it('a second velocity edit does not drift the document', () => {
    // The write path is asked twice; a rule that only holds on the first ask would
    // show up here as an accumulating respelling.
    render(React.createElement(Harness))
    act(() => h.setViewScale(2))
    act(() => h.mutate((prev) => setColumnGain(prev, 0, 0.42)))
    const afterFirst = DOC
    // drawn column 4 is the `sn` — a column that CARRIES a hit, so its gain has
    // something to serialize. (Column 2 is the empty `~`, and gain on nothing is
    // nothing: the first draft asserted against that and passed vacuously.)
    act(() => h.mutate((prev) => setColumnGain(prev, 4, 0.7)))
    expect(DOC).not.toBe(afterFirst) // the second edit really did land…
    expect(DOC.startsWith('s("bd ~ sn ~")'), DOC).toBe(true) // …and notation held
    expect(h.viewScale).toBe(2)
  })
})

/**
 * #1909 — the binding under every grid (`useGridModel` on `useActiveChunk`) reaches
 * the writer only through the door. Two things it must keep doing: a gesture is one
 * undo step however many cells it writes, and the panel's OWN write never runs the
 * external-change re-detect (that path is for typed edits and other surfaces).
 */
describe('the grid binding through the door (#1909)', () => {
  beforeEach(() => {
    DOC = 's("bd ~ sn ~")'
    cursorOffset = 5
    undoStops = 0
    contentListeners = []
    detectCalls.length = 0
  })

  it('one write outside a gesture is its own undo step', () => {
    render(React.createElement(Harness))
    act(() => h.mutate((prev) => toggleCell(prev, 0, 1, true)))
    expect(DOC).toBe('s("bd bd sn ~")')
    expect(undoStops).toBe(2)
  })

  it('a gesture writing several cells is ONE undo step', () => {
    render(React.createElement(Harness))
    act(() => {
      h.beginGesture()
      h.mutate((prev) => toggleCell(prev, 0, 1, true))
      h.mutate((prev) => toggleCell(prev, 0, 3, true))
      h.endGesture()
    })
    expect(DOC).toBe('s("bd bd sn bd")')
    expect(undoStops).toBe(2) // one boundary opening the gesture, one closing it
  })

  it("the panel's own write does not re-detect at the cursor; an external edit does", () => {
    render(React.createElement(Harness))
    detectCalls.length = 0
    act(() => h.mutate((prev) => toggleCell(prev, 0, 1, true)))
    expect(detectCalls.filter((o) => o === cursorOffset)).toEqual([])
    expect(detectCalls.length).toBeGreaterThan(0) // the write's own re-read, at the anchor

    detectCalls.length = 0
    act(() => {
      DOC = 's("hh ~ sn ~")' // a typed edit: no writer is committing
      fireContentChange()
    })
    expect(detectCalls).toContain(cursorOffset)
  })
})

/**
 * #1964 — a zoom belongs to the pattern it was made on, and the panel's OWN edits do not
 * make it a different pattern. The reset used to be keyed on the pattern's text, and every
 * note edit changes the text, so clearing a cell while zoomed threw away the zoom and the
 * kept model with it — and an emptied lane lives only in that model (#1161).
 *
 * Every other change still drops the zoom, and the arms below say why it must: a scale
 * carried onto a different pattern, or onto text typed in the code, can refuse to draw it.
 */
describe('a zoom survives the panel’s own edits, and nothing else (#1964)', () => {
  beforeEach(() => {
    DOC = 's("bd ~ ~ ~, hh hh hh hh")'
    cursorOffset = 5
    contentListeners = []
    cursorListeners = []
  })

  const lanes = (): string[] => (h.model?.lanes ?? []).map((l) => l.sound)

  it('a note edit made while zoomed keeps the zoom and the emptied lane', () => {
    render(React.createElement(Harness))
    act(() => h.setViewScale(2))
    expect(h.model?.steps).toBe(8)

    act(() => h.mutate((prev) => toggleCell(prev, 0, 0, false))) // clear bd's only hit

    expect(DOC, 'the edit really landed').toBe('s("~ ~ ~ ~, hh hh hh hh")')
    expect(h.viewScale, 'the zoom the user set').toBe(2)
    expect(h.model?.steps).toBe(8)
    expect(lanes(), 'the emptied lane, kept only in the model').toEqual(['bd', 'hh'])
  })

  it('CONTROL: the same clear at the document’s own scale keeps the lane too', () => {
    render(React.createElement(Harness))
    act(() => h.mutate((prev) => toggleCell(prev, 0, 0, false)))
    expect(DOC).toBe('s("~ ~ ~ ~, hh hh hh hh")')
    expect(lanes()).toEqual(['bd', 'hh'])
  })

  it('an edit typed in the code drops the zoom — a carried ×8 would refuse a 64-step pattern', () => {
    render(React.createElement(Harness))
    act(() => h.setViewScale(8))
    expect(h.model?.steps).toBe(32)

    const long = Array.from({ length: 64 }, (_, i) => (i % 4 === 0 ? 'bd' : '~')).join(' ')
    act(() => {
      DOC = `s("${long}")` // typed: no writer is committing
      fireContentChange()
    })

    expect(h.viewScale).toBe(UNREFINED)
    expect(h.model, 'the typed pattern opens').not.toBeNull()
    expect(h.model?.steps).toBe(64)
  })

  it('moving the cursor to another pattern drops the zoom (#1117)', () => {
    DOC = 'stack(s("bd ~ sn ~"), s("hh hh"))'
    cursorOffset = 10 // inside the first mini
    render(React.createElement(Harness))
    act(() => h.setViewScale(2))
    expect(h.model?.steps).toBe(8)

    act(() => moveCursor(DOC.indexOf('hh') + 1))

    expect(h.viewScale).toBe(UNREFINED)
    expect(h.model?.steps).toBe(2)
  })

  it('moving the cursor within the same pattern keeps the zoom', () => {
    DOC = 'stack(s("bd ~ sn ~"), s("hh hh"))'
    cursorOffset = 10
    render(React.createElement(Harness))
    act(() => h.setViewScale(2))

    act(() => moveCursor(13))

    expect(h.viewScale).toBe(2)
    expect(h.model?.steps).toBe(8)
  })
})

describe('a look-only pattern is held and never written (#1975)', () => {
  beforeEach(() => {
    DOC = 's("[hh ~]!16")'
    cursorOffset = 5
  })

  /**
   * A model an op built from scratch: no mark, no source — the rebuild spells it.
   * Whole-column notes on purpose: `[hh ~]!16` plays half-column ones, which the
   * rebuild declines for its own reason, and the door would then go untested.
   */
  const unmarked = (m: StepGridModel): StepGridModel => ({
    steps: m.steps,
    lanes: m.lanes.map((l) => ({ ...l, cells: l.cells.map((c, i) => (i === 0 || !c ? false : { duration: 1 })) })),
  })

  it('the panel holds what the pattern plays', () => {
    render(React.createElement(Harness))
    expect(h.model?.lookOnly?.gate).toBe('view-unusable')
    expect(h.model?.steps).toBe(16)
    expect(h.model?.lanes.map((l) => l.sound)).toEqual(['hh'])
  })

  it('no route through the hook writes: an op, a from-scratch model, a settle, a text rewrite', () => {
    render(React.createElement(Harness))
    const before = DOC
    const held = h.model
    act(() => h.mutate((prev) => toggleCell(prev, 0, 0, false)))
    act(() => h.mutate((prev) => setColumnGain(prev, 0, 0.4)))
    // the case the ops cannot cover: the transform dropped the mark
    act(() => h.mutate((prev) => unmarked(prev)))
    act(() => h.settle(unmarked(held as StepGridModel)))
    act(() => h.writeMini('hh*16'))
    expect(DOC).toBe(before)
    expect(h.model, 'and the view on screen is still the played one').toBe(held)
  })

  it('CONTROL: the same from-scratch model on an editable pattern does write', () => {
    // If this stayed put too, the arm above would be passing for no reason.
    DOC = 's("hh hh hh hh")'
    render(React.createElement(Harness))
    expect(h.model?.lookOnly).toBeUndefined()
    act(() => h.mutate((prev) => unmarked(prev)))
    expect(DOC).toBe('s("~ hh hh hh")')
  })

  it('typing an editable pattern over it opens the editable grid again', () => {
    render(React.createElement(Harness))
    expect(h.model?.lookOnly).toBeDefined()
    act(() => {
      DOC = 's("hh ~ hh ~")'
      fireContentChange()
    })
    expect(h.model?.lookOnly).toBeUndefined()
    act(() => h.mutate((prev) => toggleCell(prev, 0, 1, true)))
    expect(DOC).toBe('s("hh hh hh ~")')
  })
})
