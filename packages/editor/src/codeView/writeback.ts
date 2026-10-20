/**
 * writeback — chunk → document.
 *
 * The mutation half of the visual-editing spine. Visual panels read a
 * `ChunkInfo` (see `chunkDetect.ts`) to learn the doc offsets they may edit,
 * then route every edit through here so it is:
 *
 *  1. **Surgical** — only the named offset range changes; the rest of the
 *     statement (mini-notation quotes, spacing, indent) stays byte-identical.
 *     This is the whole reason write-back panels edit TEXT and not the IR:
 *     `toStrudel` is a whole-statement canonical regenerator that would
 *     reformat the leaf layer (design doc Appendix A).
 *  2. **Own-edit visible** — while an edit is applied, the writer holds its
 *     source tag, so a surface's `onDidChangeModelContent` listener can ask
 *     `isCommitting(writer)` and tell its own write (keep what it shows) from an
 *     external one (re-read the document). Monaco's content-change event
 *     carries no source of its own, so the tag is set synchronously around the
 *     edit — the listener fires inside `pushEditOperations`, while it is up.
 *     Product code reads only WHETHER a tag is set, never which one (#1914);
 *     the tag names the surface for a reader of this code, not for a listener.
 *  3. **One undo step** — every write is a single `pushEditOperations`, so even
 *     a multi-cell drag is one Ctrl-Z.
 *
 * Range discipline: offsets come from a `ChunkInfo` and are valid ONLY against
 * the exact doc it was detected from. A panel re-detects its chunk against the
 * live document in the same turn it writes; `commitToFile` compares the whole
 * document instead. Stale offsets corrupt unrelated code.
 *
 * The pure helpers (`formatNumber`, `normalizeEdits`) are string/number math
 * with no Monaco dependency, so they unit-test with plain assertions. The
 * `Writeback` class is the thin Monaco-bound shell, observed in the app.
 */
import type * as Monaco from 'monaco-editor'
// One direction only (#1911): this area reads the registry (which editor shows a
// file, the monaco namespace, the re-eval seam); the registry imports nothing back.
import {
  requestReeval,
  getFileIdForEditor,
  getMonacoNamespace,
  getEditorForFile,
} from '../workspace/editorRegistry'

/** trailing-debounce window for the live re-eval — coalesces a quick burst of
 * commits into fewer re-evals (less eval churn) while staying snappy for a
 * single edit. Correctness under a burst (the final state winning) is guaranteed
 * by the app handler serialising re-evals per file, NOT by this window. */
const REEVAL_DEBOUNCE_MS = 120

/**
 * Which surface originated an edit. Required on every write, and held by the
 * writer while the edit applies — but product code reads it only as "is a tag
 * set right now" (`isCommitting`), never by value (#1914). It documents the
 * caller; no listener switches on it.
 */
export type WriteSource =
  | 'knob'
  | 'seq'
  | 'roll'
  | 'arrange.weights'
  | 'arrange.structure'
  | 'transport'
  | 'mixer'
  | 'rename'
  // #1464 Stage 2 — the Song Timeline's automation caption (a bound or a signal
  // kind edited in place on the lane).
  | 'automation'
  // #1527 — the Song Timeline's region trim: dragging a sample mark's own edge
  // to change which slice of its file it plays (`.begin` / `.end`). Its own
  // source rather than `knob` because it edits the same two controls the
  // inspector's knobs do, from a different surface with a different failure
  // mode, and a Console line that cannot tell them apart is not an instrument.
  | 'region.trim'
  // #345 — a `slider(…)` drawn in the code itself, moving its own number.
  | 'slider'

/** A single replacement, addressed by absolute pre-edit doc offsets. */
export interface OffsetEdit {
  /** absolute [start, end) offsets in the document as it was when detected */
  range: [number, number]
  /** replacement text ('' to delete) */
  text: string
}

/**
 * Format a number for insertion as a source literal. Drag handlers produce
 * values like `0.30000000000000004` or `2.9999999`; emitting those verbatim
 * would corrupt the user's code with float noise. We round to `maxDecimals`
 * and strip trailing zeros, so `0.3`, `2`, `-1.5` come out clean.
 *
 * Pure — no Monaco.
 */
export function formatNumber(v: number, maxDecimals = 4): string {
  if (!Number.isFinite(v)) return '0'
  if (Number.isInteger(v)) return String(v)
  // toFixed then trim trailing zeros and any orphaned decimal point.
  const fixed = v.toFixed(maxDecimals)
  return fixed.replace(/\.?0+$/, '')
}

/**
 * A number the user typed into a field, or null when the text is not one.
 *
 * ⚠ `Number('')` IS 0, and so is `Number('  ')`. Without the empty check,
 * clearing a field and pressing Enter writes a ZERO into the document — a
 * plausible value, so a silent corruption rather than a visible error.
 */
export function parseTypedNumber(text: string): number | null {
  const raw = text.trim()
  if (raw.length === 0) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Validate a batch of edits and return them sorted ascending by start offset.
 * Throws on any overlap — overlapping ranges in a single `pushEditOperations`
 * have undefined application order and would corrupt the doc. Zero-width edits
 * (inserts) are allowed and never count as overlapping a neighbour that starts
 * at the same offset only if texts don't both target it; we conservatively
 * reject ranges that share interior space.
 *
 * Pure — no Monaco.
 */
export function normalizeEdits(edits: OffsetEdit[]): OffsetEdit[] {
  for (const e of edits) {
    if (e.range[0] > e.range[1]) {
      throw new Error(`writeback: inverted range [${e.range[0]}, ${e.range[1]}]`)
    }
  }
  const sorted = [...edits].sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1])
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].range
    const cur = sorted[i].range
    // Overlap when the current edit starts strictly before the previous ends.
    // Touching at a point (prev.end === cur.start) is fine.
    if (cur[0] < prev[1]) {
      throw new Error(
        `writeback: overlapping edits [${prev[0]}, ${prev[1]}] and [${cur[0]}, ${cur[1]}]`,
      )
    }
  }
  return sorted
}

/**
 * Apply a batch of offset edits to a string and return the result. Pure mirror
 * of what the writer does to a Monaco model — used by callers that edit
 * plain text (arrangement round-trip / parity tests) and to preview an edit
 * before it touches the document. Edits are validated + sorted by
 * `normalizeEdits`, then spliced from the END so earlier offsets stay valid.
 *
 * Pure — no Monaco.
 */
export function applyEdits(doc: string, edits: OffsetEdit[]): string {
  const sorted = normalizeEdits(edits)
  let out = doc
  for (let i = sorted.length - 1; i >= 0; i--) {
    const { range, text } = sorted[i]
    out = out.slice(0, range[0]) + text + out.slice(range[1])
  }
  return out
}

/**
 * Monaco-bound edit sink. Built only by `createWriter`, and driven only by the
 * functions below it (`commit`, `commitToEditor`, `commitToFile`, `openGesture`,
 * `closeGesture`, `isCommitting`); outside this area it is a type a surface holds
 * and hands back, never something it calls (#1914). Every edit goes through
 * `apply`, which keeps the source tag up across the synchronous content-change
 * event.
 */
export class Writeback {
  private writingSource: WriteSource | null = null
  /** true between beginGesture/endGesture — suppresses per-edit undo boundaries */
  private inGesture = false
  /** whether the in-flight gesture has applied any edit — gates the one re-eval
   * on `endGesture` so a gesture that wrote nothing doesn't re-evaluate. */
  private gestureDidEdit = false
  /** trailing-debounce timer for the live re-eval (see `requestLiveReeval`). */
  private reevalTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly editor: Monaco.editor.IStandaloneCodeEditor,
    private readonly monaco: typeof Monaco,
  ) {}

  /**
   * Open a gesture: edits applied until `endGesture` coalesce into ONE undo
   * step. Used for a continuous knob drag or a multi-cell sweep so the whole
   * gesture is a single Ctrl-Z. Re-eval still fires per edit (live audio); only
   * the undo grouping is affected. Idempotent if already in a gesture.
   */
  beginGesture(): void {
    if (this.inGesture) return
    const model = this.editor.getModel()
    if (!model) return
    model.pushStackElement() // close any prior (typing) undo group
    this.inGesture = true
    this.gestureDidEdit = false
  }

  /** Close the gesture, sealing all its edits as one undo step — and, if the
   * gesture changed anything, make it audible immediately (one re-eval on
   * release, not per drag frame). */
  endGesture(): void {
    if (!this.inGesture) return
    this.inGesture = false
    this.editor.getModel()?.pushStackElement()
    if (this.gestureDidEdit) {
      this.gestureDidEdit = false
      this.requestLiveReeval()
    }
  }

  /**
   * The source of the edit currently being applied, or null. Non-null ONLY for
   * the duration of `apply`; `isCommitting` reads it, and only as null or not.
   */
  get currentSource(): WriteSource | null {
    return this.writingSource
  }

  /**
   * Replace several non-overlapping ranges as ONE edit — one undo step. Used
   * for multi-cell drags (toggle several steps, then a single Ctrl-Z reverts
   * the whole gesture).
   */
  replaceRanges(edits: OffsetEdit[], source: WriteSource): boolean {
    return this.apply(edits, source)
  }

  /** false when there is no document to write to — nothing was applied */
  private apply(edits: OffsetEdit[], source: WriteSource): boolean {
    const model = this.editor.getModel()
    if (!model) return false
    const normalized = normalizeEdits(edits)
    const ops: Monaco.editor.IIdentifiedSingleEditOperation[] = normalized.map((e) => {
      const start = model.getPositionAt(e.range[0])
      const end = model.getPositionAt(e.range[1])
      return {
        range: new this.monaco.Range(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column,
        ),
        text: e.text,
        forceMoveMarkers: true,
      }
    })
    // Outside a gesture, bracket the batch with undo boundaries so it is its
    // own single undo step. Inside a gesture, skip the boundaries so every
    // edit between beginGesture/endGesture coalesces into ONE undo step.
    if (!this.inGesture) model.pushStackElement()
    this.writingSource = source
    try {
      model.pushEditOperations([], ops, () => null)
    } finally {
      this.writingSource = null
    }
    if (!this.inGesture) model.pushStackElement()
    // Live visual editing: a committed mutation should be audible immediately
    // while playing. A single (non-gesture) edit re-evals now; a gesture's many
    // edits coalesce into ONE re-eval on `endGesture`.
    if (this.inGesture) this.gestureDidEdit = true
    else this.requestLiveReeval()
    return true
  }

  /**
   * Ask the app to re-evaluate the EDITED file so a visual mutation is audible
   * the moment it commits. Centralised here so every visual surface — sequencer,
   * piano roll, knobs, mixer — goes live from ONE place, not per panel. The app
   * re-evals only a PLAYING file, and only when live mode isn't already doing
   * it, so this never auto-starts audio nor double-evaluates.
   *
   * Trailing-debounced: rapid successive commits (e.g. clearing several
   * sequencer steps in a row) coalesce into ONE re-eval shortly after the last,
   * which also lets the Monaco→file-store sync settle so the re-eval reads the
   * final content rather than racing a not-yet-synced edit.
   */
  private requestLiveReeval(): void {
    if (this.reevalTimer) clearTimeout(this.reevalTimer)
    this.reevalTimer = setTimeout(() => {
      this.reevalTimer = null
      requestReeval(getFileIdForEditor(this.editor))
    }, REEVAL_DEBOUNCE_MS)
  }
}

/** What `commit` did with an operation's result. */
export type CommitOutcome =
  /** the edits are in the document, as one undo step (or inside the open gesture) */
  | 'written'
  /** the operation returned nothing to write — it refused, or the value is already there */
  | 'nothing-to-write'
  /** the writer has no document open; nothing was applied */
  | 'no-document'

/**
 * commit — the one way a code↔view operation's result reaches the open document
 * (#1900). A panel asks an operation what to write (`gainEdit`, `knobEdit`,
 * `renameEdit`, …), then hands the answer here with the writer it was given and
 * the tag that names it. It never calls the writer's methods itself, so where an
 * edit lands, how it groups for undo and what it is tagged as are decided in this
 * area alone.
 *
 * `edit` is what the operation returned: one edit, several (applied together as
 * one undo step), or null / empty when there is nothing to write. The outcome
 * lets a caller do follow-up work only when the edit really landed — e.g. move a
 * track's colour to its new name only after the rename was written.
 *
 * The editor route does not re-check freshness here: panels re-detect their
 * chunk against the live document immediately before asking the operation, in
 * the same synchronous turn. The file route (`commitToFile`) keeps its
 * stale-document check.
 */
export function commit(
  writer: Writeback,
  edit: OffsetEdit | readonly OffsetEdit[] | null,
  source: WriteSource,
): CommitOutcome {
  const edits = editList(edit)
  if (edits.length === 0) return 'nothing-to-write'
  return writer.replaceRanges(edits, source) ? 'written' : 'no-document'
}

/**
 * `commit` for a caller that holds an editor but no writer — a gesture that
 * reaches the live editor through the registry (the sidebar's sound / viz
 * assignment, #1906). Builds the writer here so no surface outside this area
 * constructs one. 'no-document' also covers Monaco not being loaded yet.
 */
export function commitToEditor(
  editor: Monaco.editor.IStandaloneCodeEditor,
  edit: OffsetEdit | readonly OffsetEdit[] | null,
  source: WriteSource,
): CommitOutcome {
  const writer = createWriter(editor)
  if (!writer) return 'no-document'
  return commit(writer, edit, source)
}

/**
 * The writer for `editor`, or null before Monaco has loaded (#1909). The one place
 * a writer is built for a surface that keeps it — a panel binding holds one per
 * active editor so its gestures and its own-edit check stay on the same writer.
 * Each holder gets its OWN writer: `isCommitting` answers for that writer alone, so
 * an edit made through another surface's writer still reads as external to it.
 */
export function createWriter(editor: Monaco.editor.IStandaloneCodeEditor): Writeback | null {
  const monaco = getMonacoNamespace()
  return monaco ? new Writeback(editor, monaco) : null
}

/**
 * Open a gesture on `writer` (#1909): every commit until `closeGesture` is ONE undo
 * step, and the gesture re-evaluates once, on close, if it wrote anything. For a
 * continuous drag (a fader, a sweep across grid cells) or a write that needs two
 * edits where the second is computed from the document after the first. Opening an
 * open gesture does nothing.
 */
export function openGesture(writer: Writeback | null): void {
  writer?.beginGesture()
}

/** Close the gesture `openGesture` opened; closing when none is open does nothing. */
export function closeGesture(writer: Writeback | null): void {
  writer?.endGesture()
}

/**
 * Is `writer` applying an edit right now? (#1909) True only inside the document's
 * synchronous content-change event for an edit this writer made, so a surface's
 * change listener can tell its own write (keep what it shows) from an external one
 * (re-read the document).
 */
export function isCommitting(writer: Writeback | null): boolean {
  return writer?.currentSource != null
}

/**
 * Why a write by file did not land. Each value names ONE refusal the file route
 * can actually tell apart, because a report that cannot name its cause cannot
 * drive the next decision (#1414) — "the edit was declined" and "the document
 * moved under you" call for opposite responses from a caller, and a bare `false`
 * says neither.
 */
export type WriteRefusal =
  /** No editor is registered for `fileId` — typically unmounted mid-gesture. */
  | 'no-editor'
  /** The monaco namespace was never captured, so no edit can be constructed. */
  | 'no-monaco'
  /** Nothing to write — upstream (usually a serializer) declined the gesture. */
  | 'no-edits'
  /** `expectedDoc` no longer matches the live model: the offsets are stale and
   *  applying them would corrupt unrelated code. RETRYABLE — unlike the rest. */
  | 'stale-document'
  /** The writer threw while applying the edits. */
  | 'writeback-threw'

/** `'applied'`, or the reason the file route refused. */
export type WriteOutcome = 'applied' | WriteRefusal

/**
 * `commit` addressed by FILE rather than by a writer — the route a surface takes
 * when it does not own the editor: the Song Timeline's gestures and the app's
 * backdrop write (#1906, #1911). The edits land in `fileId`'s editor as ONE undo
 * step tagged `source`, and the writer's debounced re-eval makes them audible.
 *
 * `expectedDoc` is REQUIRED (#1911): the document the edit's offsets were computed
 * against. A panel re-detects its chunk against the live document in the same
 * turn it writes; a caller of this route does not (the timeline computes from its
 * last IR snapshot, which lags typing by a debounce), so this comparison is the
 * only thing standing between stale offsets and unrelated code. A document that
 * moved is refused as 'stale-document' and nothing is written.
 *
 * ⚠ RETURNS A REASON, NOT A BOOLEAN (#1414). Every member of `WriteOutcome` is a
 * non-empty string, so a bare `if (outcome)` is always true and always a bug —
 * compare against 'applied'. Refusals are checked in a fixed order (no editor, no
 * monaco, nothing to write, stale document) so the cause a caller reports is the
 * same on every run.
 */
export function commitToFile(
  fileId: string,
  edit: OffsetEdit | readonly OffsetEdit[] | null,
  source: WriteSource,
  expectedDoc: string,
): WriteOutcome {
  const editor = getEditorForFile(fileId)
  if (!editor) return 'no-editor'
  const writer = createWriter(editor)
  if (!writer) return 'no-monaco'
  const edits = editList(edit)
  if (edits.length === 0) return 'no-edits'
  if (editor.getModel?.()?.getValue?.() !== expectedDoc) return 'stale-document'
  try {
    writer.replaceRanges(edits, source)
    return 'applied'
  } catch {
    return 'writeback-threw'
  }
}

/** what an operation returned, as the list the writer takes */
function editList(edit: OffsetEdit | readonly OffsetEdit[] | null): OffsetEdit[] {
  return edit == null ? [] : isEditList(edit) ? [...edit] : [edit]
}

function isEditList(edit: OffsetEdit | readonly OffsetEdit[]): edit is readonly OffsetEdit[] {
  return Array.isArray(edit)
}
