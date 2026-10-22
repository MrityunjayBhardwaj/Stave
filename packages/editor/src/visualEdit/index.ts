/**
 * Visual-editing spine — public surface.
 *
 * The shared, durable layer the musician-facing write-back panels
 * (Mixer / Sequencer / Piano Roll / Arrangement) sit on:
 *  - `chunkDetect` — cursor → editable pieces of the statement (pure).
 *  - `writeback` — surgical, origin-tagged, single-undo Monaco edits.
 *  - `notation` — mini-notation ↔ grid/roll models (round-trip-faithful).
 *
 * Panels live in `@stave/app` (alongside MusicalTimeline) and import from
 * here via `@stave/editor`.
 */
export {
  detectChunk,
  detectAllChunks,
  parseTopLevel,
  docParses,
  isChunkFresh,
  classifyChunk,
} from '../codeView'
export type { ChunkInfo, ChainCall, ChainArg, ChunkType } from '../codeView'

export { type Writeback, formatNumber, normalizeEdits, applyEdits } from '../codeView'
export type { WriteSource, OffsetEdit } from '../codeView'

export {
  detectArrangeAt,
  detectAllArrangeCalls,
  detectBarePattern,
  setWeight,
  reorderArm,
  insertArm,
  insertSilenceArm,
  renameArrangeSection,
  countArrangeSectionArms,
  removeArm,
  silenceArm,
  wrapBare,
  materializeBareDelete,
  materializeBareSplit,
  splitArm,
  setArmPattern,
  listArrangeSectionParts,
} from '../codeView'
export type { ArrangeCall, ArrangeArmRange, ArrangeMode } from '../codeView'

// #463 Stage 2 — pick* section-clip write-back. Same op names as `arrange`
// (setWeight/splitArm/…), so they're re-exported aliased as `pick*`.
export { detectPickControlAt, detectAllPickControls } from '../codeView'
export type { PickControl, PickControlArm, PickMethod, PickSectionEntry } from '../codeView'
export {
  pickSetWeight,
  pickSplitArm,
  pickRemoveArm,
  pickSilenceArm,
  pickReorderArm,
  pickInsertArm,
  pickInsertSilenceArm,
  pickDuplicateArm,
  pickRenameSection,
  pickCountSectionArms,
  pickSetArmHead,
  pickListSectionParts,
} from '../codeView'

export {
  parseStepGrid,
  parsePianoRoll,
  serializeStepGrid,
  serializePianoRoll,
  pitchToMidi,
  midiToPitch,
  isBlackKey,
  placeNote,
  resizeGrid,
  resizeRoll,
} from '../codeView'
export type {
  StepGridModel,
  StepLane,
  PianoRollModel,
  RollNote,
  ParseResult,
  ResizeMode,
} from '../codeView'

export { VisualEditStandby } from './panels/VisualEditStandby'
export type { VisualEditStandbyProps } from './panels/VisualEditStandby'
export { Mixer } from './panels/Mixer'
export { SequencerGrid } from './panels/SequencerGrid'
export { PianoRollGrid } from './panels/PianoRollGrid'
// #1801 — the grids' keys, for the host's command registry.
export {
  GRID_SCOPE,
  GRID_GESTURE,
  GRID_GESTURES,
  GRID_SCOPE_LABEL,
  setGridKeyMatcher,
  runGridGesture,
} from './panels/gridGestures'
export type { GridScope, GridGestureId, GridGestureDef, GridKeyMatcher } from './panels/gridGestures'
export { PatternPanel } from './panels/PatternPanel'
export { patternKind, isStepChunk, isRollChunk } from '../codeView'
export type { PatternKind } from '../codeView'
// #1240 — the CONTENT-aware router. Kept out of `patternKind` so that module
// stays free of the notation parser (see both files' headers).
export { chunkSurface, routeSurface, type Surface } from '../codeView'
export { useActiveChunk } from './panels/useActiveChunk'
export type { ActiveChunk } from './panels/useActiveChunk'
export { useGridModel } from './panels/useGridModel'
export type { GridModel, GridModelOptions } from './panels/useGridModel'
export { Knob } from './panels/Knob'
export type { KnobProps } from './panels/Knob'
export { knobRangeFor, hasKnownKnobRange } from './panels/knobRanges'
export type { KnobRange } from './panels/knobRanges'
export {
  VISUAL_EDIT_TABS,
  PATTERN_TAB_ID,
  MIXER_CONSOLE_TAB_ID,
  SEQUENCER_TAB_ID,
  MIXER_TAB_ID,
  PIANO_ROLL_TAB_ID,
} from './panels/tabs'
export type { VisualEditTabDef } from './panels/tabs'
