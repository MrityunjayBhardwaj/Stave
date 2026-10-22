/**
 * useMixerModel — the channel-strip Mixer's binding to the document.
 *
 * Where `useActiveChunk` tracks the ONE chunk under the cursor, the Mixer needs
 * ALL of them: it is a row of strips, cursor-independent. This hook tracks the
 * active Monaco editor and re-derives the whole strip array from the document on
 * every content change, exactly like `useActiveChunk` re-detects on edits —
 * both take the editor and their writer from `useActiveWriter`, so the two can't
 * drift.
 *
 * `applyToStrip(id, mutate)` is `useActiveChunk.applyEdit` generalised from "the
 * chunk at the cursor" to "the chunk with this stable id": it re-derives the
 * strips against the live model, finds the one with `id`, and hands `mutate` its
 * FRESH chunk + the tagged `Writeback` (one write path, no fork). The strip
 * array re-derives from the resulting content change, so the fader/pan read back
 * exactly what they wrote (V-mixer-1).
 */
import * as React from 'react'

import { detectAllChunks, type ChunkInfo } from '../../codeView'
import { commit, openGesture, closeGesture, type Writeback } from '../../codeView'
import { buildStripModels, type StripModel } from '../../codeView'
import {
  readMasterGain,
  readMasterMute,
  detectMasterAudioAll,
  adaptMasterChunk,
  masterAudioLineEdit,
  type MasterGainState,
} from '../../codeView'
import { useActiveWriter } from '../useActiveWriter'
import { revealTakesFocus } from '../../workspace/editorRegistry'

export interface MixerModel {
  /** one strip per top-level statement, in source order (re-derived on edits) */
  strips: StripModel[]
  /**
   * The detected chunks behind `strips`, aligned 1:1 — `chunks[i]` is the chunk
   * `strips[i]` projects from. Alignment is by each strip's ABSOLUTE source index
   * (`strips[i].index`), NOT the strip-array position: `buildStripModels` drops
   * config/transport statements (`setcps`, `samples` — #559), so the k-th strip
   * is NOT the k-th detected chunk. The expand drawer (S4b) binds a strip's full
   * knob chain to `chunks[i]`. Stored alongside `strips` in one state so the two
   * never drift. (The write path still re-derives a FRESH chunk at write time —
   * `chunks` is for RENDER, `applyToStrip` for freshness.)
   */
  chunks: ChunkInfo[]
  /**
   * Mutate the strip with this id through its fresh chunk. Re-derives against
   * the live model, so offsets are valid even after earlier edits in the same
   * gesture changed a literal's length. No-op if the strip can't be re-found.
   */
  applyToStrip: (id: string, mutate: (fresh: ChunkInfo, wb: Writeback) => void) => void
  /**
   * Mutate the strip whose STATEMENT STARTS at `anchor`, re-detected fresh against
   * the live model (V-mixer-11, #877). Use this — never `applyToStrip` — for a
   * write that CHANGES the strip's own id: a strip is identified by `bare ?? #k`
   * (stripModel.ts), so naming an anonymous track both renames its id AND
   * renumbers every later anonymous strip's `#k`. Addressed by id, a second
   * application of the same rename therefore resolves to a DIFFERENT track and
   * corrupts it. The statement's start offset is invariant under the rename (the
   * label is rewritten in place, at the statement start), so it is the one anchor
   * that survives the write — the Song Timeline's rename handler already keys off
   * it, and this is the Mixer's half of the same funnel.
   */
  applyToStripAt: (
    anchor: number,
    mutate: (fresh: ChunkInfo, wb: Writeback, doc: string) => void,
  ) => void
  /**
   * The master strip's gain, projected from the document's
   * `all(x => x.mul(postgain()))` line, or a legacy `all(x => x.gain())` /
   * `.postgain()` one (#1711); unity when absent — the
   * untouched master reads the default from the ABSENCE of a line, #792.
   * Re-derived on every content change, so the fader reads back exactly what it
   * wrote — the master analog of a strip's gain.
   */
  masterGain: MasterGainState
  /**
   * The master strip's pan, projected from the document's `all(x => x.pan())`
   * scalar (centre 0.5 when absent — the untouched master reads the default from
   * the ABSENCE of a call). `foreign` disables the control on a signal/pattern
   * pan. The master analog of a strip's pan.
   */
  /**
   * Whether the master is muted — an `all(x => silence)` line is present in the
   * document. Orthogonal to the fader (the gain line is untouched while muted),
   * so unmute restores the exact pre-mute output. The master analog of a strip's
   * `_`-prefix mute.
   */
  masterMuted: boolean
  /**
   * The master's insert chain adapted to a `ChunkInfo`, for the expand drawer's
   * shared `MixerBody` (knobs + ＋More). Re-derived on content change; an empty
   * placeholder when the master has no audio `all()` line yet.
   */
  masterChunk: ChunkInfo
  /**
   * The master analog of `applyToStrip` for the expand drawer: re-derives the
   * master audio `all()` line FRESH, adapts it to a `ChunkInfo`, and hands
   * `mutate` that chunk + the tagged `Writeback`. When no audio line exists, a
   * deliberate add gesture first materializes the base `all(x => x)` line (one
   * undo step), so the appended effect lands on a valid statement.
   */
  applyToMasterChunk: (mutate: (fresh: ChunkInfo, wb: Writeback) => void) => void
  /**
   * Mutate the master `all(...)` statements. Unlike `applyToStrip` there is no
   * stable-id chunk to re-find — the master is the whole-doc `all()` scope — so
   * `mutate` gets the live document text + the tagged `Writeback` and computes
   * its own surgical edit (`masterGainEdit`/`masterVizEdit`). No-op without an
   * editor. No cursor-follow: the master isn't a caret-selected track.
   */
  applyToMaster: (mutate: (doc: string, wb: Writeback) => void) => void
  /** open a gesture — edits until `endGesture` coalesce into one undo step */
  beginGesture: () => void
  endGesture: () => void
  /**
   * The id of the strip whose statement contains the editor caret, or null when
   * the caret is outside every track (#639). DERIVED from the cursor — this is
   * the single source of truth for "selected track": moving the caret (typing,
   * clicking code, the timeline/strip jump) re-derives it, so the Mixer
   * selection always matches the editor.
   */
  selectedId: string | null
  /**
   * Select a strip = move the editor caret to that track's statement (#639/#595).
   * The caret move re-derives `selectedId` to this strip, so a click on a strip
   * and a click in its code converge on the same selection.
   */
  selectTrack: (id: string) => void
}

/** the strip array + its source chunks + the master projection, kept together so
 *  they can't drift (all re-derived from one `getValue()` per content change). */
interface Derived {
  strips: StripModel[]
  chunks: ChunkInfo[]
  masterGain: MasterGainState
  masterMuted: boolean
  masterChunk: ChunkInfo
}

/** A placeholder master chunk for a doc with NO audio `all()` line — a lone
 *  synthetic head, so the expand drawer renders an EMPTY effects body (just the
 *  ＋More add-effect affordance). The first add materializes the real line via
 *  `applyToMasterChunk`; `exprRange`/`statementRange` here are inert (the write
 *  path re-derives against the live doc). */
function emptyMasterChunk(doc: string): ChunkInfo {
  const pos = doc.length
  return {
    statementRange: [pos, pos],
    statementText: '',
    exprRange: [pos, pos],
    label: null,
    headFn: null,
    miniRange: null,
    miniString: null,
    miniVia: null,
    miniAnchor: null,
    chain: [{ name: 'x', args: [], range: [pos, pos] }],
    type: 'knobs',
    nested: false,
  }
}

function deriveMasterChunk(doc: string): ChunkInfo {
  const line = detectMasterAudioAll(doc)
  return line ? adaptMasterChunk(doc, line) : emptyMasterChunk(doc)
}

const EMPTY_DERIVED: Derived = {
  strips: [],
  chunks: [],
  masterGain: { value: 1, foreign: false },
  masterMuted: false,
  masterChunk: emptyMasterChunk(''),
}

/**
 * Follow a strip edit in the code view (#595): move the editor caret to the
 * track's statement so the user sees which line their fader/knob/rename landed
 * on. Writeback applies edits with a null cursor-computer (`pushEditOperations`
 * with `() => null`), so the write never moves the caret itself — this is the
 * only thing that does, and a pin survives the next tick untouched.
 *
 * `reveal + focus` runs only when the target statement changed since the last
 * jump OR the editor isn't focused; a continuous drag (many ticks on ONE strip)
 * then re-centres + re-focuses once and leaves the caret pinned, rather than
 * thrashing the scroll/focus every frame. Monaco hides the caret while blurred,
 * so `focus()` is what makes the jump visible. Cursor placement is a courtesy —
 * any failure is swallowed so it can never break the write.
 */
export function jumpCursorToTrack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  trackOffset: number,
  lastJumpRef: React.MutableRefObject<number | null>,
): void {
  try {
    const pos = model.getPositionAt?.(trackOffset)
    if (!pos) return
    const changed = lastJumpRef.current !== trackOffset
    // #2017 — on a touch device a jump never focuses the editor (that would summon
    // the keyboard over the strip being dragged), so "the editor isn't focused" is
    // always true there and cannot be the reason to jump again: only a new target is.
    const focuses = revealTakesFocus()
    if (changed || (focuses && !editor.hasTextFocus?.())) {
      editor.setPosition?.(pos)
      editor.revealLineInCenter?.(pos.lineNumber)
      if (focuses) editor.focus?.()
    }
    lastJumpRef.current = trackOffset
  } catch {
    /* cursor following is a courtesy; never let it break the write */
  }
}

export function useMixerModel(): MixerModel {
  const { editor, editorRef, writerRef: writebackRef } = useActiveWriter()
  const [derived, setDerived] = React.useState<Derived>(EMPTY_DERIVED)
  // The statement offset the cursor was last jumped to (#595). Lets a continuous
  // fader/knob drag (many `applyToStrip` ticks on ONE strip) reveal+focus once,
  // then leave the caret pinned, instead of re-centring + re-focusing per frame.
  const lastJumpRef = React.useRef<number | null>(null)

  // A fresh editor → the next strip edit re-jumps.
  React.useEffect(() => {
    lastJumpRef.current = null
  }, [editor])

  // Re-derive the strip array from the document — on mount and on every content
  // change (incl. our own writes, so the strips read back what they wrote). Pure
  // projection (detectAllChunks → buildStripModels), so it always reflects the
  // live text (invariant V-mixer-1).
  React.useEffect(() => {
    if (!editor) {
      setDerived(EMPTY_DERIVED)
      return
    }
    const rederive = (): void => {
      const model = editor.getModel?.()
      if (!model) {
        setDerived(EMPTY_DERIVED)
        return
      }
      const value = model.getValue()
      const allChunks = detectAllChunks(value)
      const strips = buildStripModels(allChunks, value)
      // Expose the chunks aligned 1:1 with strips by each strip's ABSOLUTE source
      // index. buildStripModels filters out config/transport statements (setcps,
      // samples — #559), so `strips[i]` is NOT `allChunks[i]`; `strips[i].index`
      // is the chunk's true position. Without this, a leading config line shifts
      // every strip's chunk by one and the expand drawer would write to the
      // PREVIOUS track (or onto setcps for the first strip).
      setDerived({
        strips,
        chunks: strips.map((s) => allChunks[s.index]),
        masterGain: readMasterGain(value),
        masterMuted: readMasterMute(value),
        masterChunk: deriveMasterChunk(value),
      })
    }
    rederive()
    const model = editor.getModel?.()
    const sub = model?.onDidChangeContent?.(rederive)
    return () => sub?.dispose?.()
  }, [editor])

  const applyToStrip = React.useCallback(
    (id: string, mutate: (fresh: ChunkInfo, wb: Writeback) => void): void => {
      const ed = editorRef.current
      const wb = writebackRef.current
      if (!ed || !wb) return
      const model = ed.getModel?.()
      if (!model) return
      const doc = model.getValue()
      const chunks = detectAllChunks(doc)
      // Write to the strip's chunk by its ABSOLUTE source index, NOT the strip
      // array position: buildStripModels drops config/transport lines (#559), so
      // the filtered strip index is off-by-one per preceding config line. Using
      // `chunks[idx]` wrote the fader/knob edit onto the PREVIOUS statement —
      // onto `setcps` for the first strip. `strip.index` is the chunk's real
      // position, so this ties every write to the strip's own track.
      const strip = buildStripModels(chunks, doc).find((s) => s.id === id)
      if (!strip) return
      const fresh = chunks[strip.index]
      // The track's statement start — where the cursor follows to (#595). Read
      // BEFORE the mutate: the edit (gain/pan/knob, or the label on a rename) is
      // at or after this offset, so the offset stays valid afterwards.
      const trackOffset = fresh.statementRange[0]
      mutate(fresh, wb)
      jumpCursorToTrack(ed, model, trackOffset, lastJumpRef)
    },
    [],
  )

  // The id-free write funnel (#877). Re-detects the statement at `anchor` against
  // the LIVE model and requires the re-detection to be a FIXPOINT (the chunk found
  // there starts exactly there) — the same contract `useActiveChunk.applyEdit`
  // enforces. A stale anchor finds no statement and the write is dropped; a stale
  // ID, by contrast, silently resolves to a DIFFERENT track (the corruption).
  const applyToStripAt = React.useCallback(
    (anchor: number, mutate: (fresh: ChunkInfo, wb: Writeback, doc: string) => void): void => {
      const ed = editorRef.current
      const wb = writebackRef.current
      if (!ed || !wb) return
      const model = ed.getModel?.()
      if (!model) return
      const doc = model.getValue()
      const fresh = detectAllChunks(doc).find((c) => c.statementRange[0] === anchor)
      if (!fresh) return
      mutate(fresh, wb, doc)
      jumpCursorToTrack(ed, model, anchor, lastJumpRef)
    },
    [],
  )

  const applyToMaster = React.useCallback(
    (mutate: (doc: string, wb: Writeback) => void): void => {
      const ed = editorRef.current
      const wb = writebackRef.current
      if (!ed || !wb) return
      const model = ed.getModel?.()
      if (!model) return
      // The master edit functions (`masterGainEdit`/`masterVizEdit`) compute
      // their own offsets from the whole-doc text, so — unlike a per-strip write
      // — there is no stale chunk to guard; hand them the live value directly.
      mutate(model.getValue(), wb)
    },
    [],
  )

  const applyToMasterChunk = React.useCallback(
    (mutate: (fresh: ChunkInfo, wb: Writeback) => void): void => {
      const ed = editorRef.current
      const wb = writebackRef.current
      if (!ed || !wb) return
      const model = ed.getModel?.()
      if (!model) return
      const doc = model.getValue()
      const line = detectMasterAudioAll(doc)
      if (line) {
        // Re-derive the adapted chunk FRESH (offsets valid after earlier edits in
        // the same gesture), exactly like `applyToStrip`.
        mutate(adaptMasterChunk(doc, line), wb)
        return
      }
      // No audio line yet — a deliberate add gesture first materializes the base
      // `all(x => x)` line, then the effect appends onto it, as ONE undo step.
      const base = masterAudioLineEdit(doc)
      if (!base) return
      openGesture(wb)
      commit(wb, base, 'mixer')
      const next = model.getValue()
      const fresh = detectMasterAudioAll(next)
      if (fresh) mutate(adaptMasterChunk(next, fresh), wb)
      closeGesture(wb)
    },
    [],
  )

  const beginGesture = React.useCallback(() => openGesture(writebackRef.current), [writebackRef])
  const endGesture = React.useCallback(() => closeGesture(writebackRef.current), [writebackRef])

  // #639 — the selected strip is DERIVED from the editor caret: the strip whose
  // statement contains the cursor. This makes the cursor the ONE source of truth
  // for "selected track" — moving the caret (typing, clicking code, the timeline
  // or strip jump) re-derives it, so the Mixer selection always matches the
  // editor (and `selectTrack` below moves the caret, closing the loop both ways).
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  // Read the current strips inside the cursor listener without re-subscribing on
  // every keystroke (the effect re-subscribes only when the editor or the strip
  // array changes, not on cursor moves).
  const stripsRef = React.useRef<StripModel[]>(EMPTY_DERIVED.strips)
  stripsRef.current = derived.strips
  React.useEffect(() => {
    if (!editor) {
      setSelectedId(null)
      return
    }
    const model = editor.getModel?.()
    if (!model) {
      setSelectedId(null)
      return
    }
    const recompute = (): void => {
      try {
        const pos = editor.getPosition?.()
        if (!pos) {
          setSelectedId(null)
          return
        }
        const off = model.getOffsetAt(pos)
        const sel =
          stripsRef.current.find(
            (s) => off >= s.statementRange[0] && off <= s.statementRange[1],
          )?.id ?? null
        // Only re-render the strips when the SELECTED strip changes, not on every
        // intra-track caret move — selection is per-track, not per-character.
        setSelectedId((prev) => (prev === sel ? prev : sel))
      } catch {
        /* selection is a courtesy — never let it throw into render */
      }
    }
    recompute()
    const sub = editor.onDidChangeCursorPosition?.(recompute)
    return () => sub?.dispose?.()
  }, [editor, derived.strips])

  const selectTrack = React.useCallback((id: string): void => {
    const ed = editorRef.current
    if (!ed) return
    const model = ed.getModel?.()
    if (!model) return
    const strip = buildStripModels(detectAllChunks(model.getValue()), model.getValue()).find((s) => s.id === id)
    if (!strip) return
    // Move the caret to the track's statement; the cursor listener above then
    // re-derives `selectedId` to this strip. `lastJumpRef` is shared with the
    // edit-driven follow (#595) so the two never fight to re-centre.
    jumpCursorToTrack(ed, model, strip.statementRange[0], lastJumpRef)
  }, [])

  return {
    strips: derived.strips,
    chunks: derived.chunks,
    applyToStrip,
    applyToStripAt,
    masterGain: derived.masterGain,
    masterMuted: derived.masterMuted,
    masterChunk: derived.masterChunk,
    applyToMaster,
    applyToMasterChunk,
    beginGesture,
    endGesture,
    selectedId,
    selectTrack,
  }
}
