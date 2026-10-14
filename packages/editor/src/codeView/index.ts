/**
 * codeView — the one entry to the code↔view area (#1878, part of #1869).
 *
 * Everything that turns code into something a view draws, or a gesture back
 * into code, lives in this directory. This file is its only door: code outside
 * `codeView/` imports from here and from nowhere deeper.
 *
 * It starts as exactly the names the rest of the editor already used, so adding
 * it changes no behaviour. A name is added here when a view needs it; a view
 * never reaches past this file to get it.
 *
 * The three headings below are a reading guide, not a rule the compiler checks.
 *
 * FIVE FILES DO NOT COME THROUGH HERE, on purpose. They sit in the engine's
 * runtime import graph (StrudelEngine → bareCapture → mixer/stripModel →
 * mixer/gain → writeback → workspace/editorRegistry). This file loads the whole
 * area, mini-notation parser included, and the engine's graph must not: with any
 * of them imported from here, `StrudelEngine.test.ts` dies at load. They import
 * the one file they need, and are named exceptions of the boundary test (#1879).
 */

// ── read ── the finished models a view draws, and the facts read off the code
export { readChainMethod, playingCall, readNumberCall, stringLiteralBody } from './chainMethod'
export { writtenCps, writtenBpm } from './tempo'
// The four names Strudel registers one tempo setter under — the block scanner and the
// editor's tokenizer read this one list (#1927, #1954).
export { TEMPO_SETTERS } from './ir/statementHeads'
export {
  detectAllChunks,
  detectChunk,
  parseTopLevel,
  docParses,
  isChunkFresh,
  classifyChunk,
  collectChain,
  toArg,
} from './chunkDetect'
export type { ChunkInfo, ChainCall, ChainArg, ChunkType } from './chunkDetect'
export {
  IR,
  toStrudel,
  patternToJSON,
  patternFromJSON,
  PATTERN_IR_SCHEMA_VERSION,
  structuralWalk,
  aggregateLaneItems,
  wholeWalkWindow,
  rootStackArms,
  armSourceSpan,
  analyzeSong,
  analyzeEvents,
  accumulateLanes,
  cycleFingerprints,
  detectPeriod,
  computeSections,
  laneKeyOf,
  analyzeWindow,
  accumulateLanesInWindow,
  computeSectionsInWindow,
  songExtent,
  signalDimensionsOf,
  parseMini,
  parseStrudel,
  classifyLiteralRhs,
  signalAutomations,
  signalCarryingParamKeys,
  signalTimeAt,
  shapeAlternatives,
  crossClassShapes,
  steppedAutomations,
  stepIndexAtCycle,
  fixedParameters,
  songPeriodOf,
  arrangedRepeatCycles,
  songEnd,
  songEndOf,
  parseStrudelStages,
  buildStrudelPasses,
  runPasses,
} from './ir'
export type {
  PlayParams,
  LaneSkeleton,
  LaneItem,
  WalkWindow,
  SongAnalysis,
  DisplaySpan,
  LaneActivity,
  SongSection,
  AnalyzeSongOptions,
  WindowAnalysis,
  AnalyzeWindowOptions,
  SignalDimensions,
  SongExtent,
  SignalAutomation,
  SignalKind,
  SignalSpans,
  UnboundedSignalKind,
  SteppedAutomation,
  SteppedStep,
  SectionWindow,
  TimeStep,
  TimeWarp,
  FixedParameter,
  StepCountEdit,
  LanePeriod,
  ShapeSwap,
  NamedStage,
  NamedPass,
  Pass,
} from './ir'
export type { IREvent, SourceLocation } from './ir/IREvent'
export type { IRPattern } from './ir/IRPattern'
export type { PatternIR } from './ir/PatternIR'
export { splitMuteMarker, labelAtOffset, sectionNameAt } from './ir/trackId'
export {
  detectMasterAll,
  detectMasterAudioAll,
  adaptMasterChunk,
  readMasterGain,
  readMasterMute,
  readMasterViz,
  MASTER_UNITY_GAIN,
} from './mixer/masterEdit'
export type { MasterAll, MasterGainState } from './mixer/masterEdit'
export {
  statementOffsetForSource,
  otherTrackNames,
  buildStripModels,
  stripContainingOffset,
} from './mixer/stripModel'
export type { StripModel } from './mixer/stripModel'
export { isValidTrackLabel } from './mixer/writeStrip'
export type { StepLane, ResizeMode } from './notation'
export {
  columnCount,
  columnOverlap,
  headColumn,
  rollContentRange,
  sequentialColumnGroups,
  tailColumn,
  isCellOn,
  laneCoverage,
  lookOnlyLine,
} from './notation/model'
export type {
  LookOnly,
  StepGridModel,
  PianoRollModel,
  RollNote,
  ParseResult,
  ColumnOverlap,
  ChunkGain,
  GainWrite,
  AltSource,
  NotationSource,
} from './notation/model'
export { parseStepGrid, parsePianoRoll, bracketedBarRegions } from './notation/parse'
export { pitchToMidi, midiToPitch, isBlackKey, noteDisplayName, cLabel } from './notation/pitch'
export {
  rollSlotState,
  freeZoneScale,
  RESOLUTION_PRESETS,
  stepSlotState,
  stepResolutionEffect,
  rollResolutionEffect,
  NO_RESOLUTION_EFFECT,
} from './notation/resolution'
export type { GridResolutionEffect, SlotState } from './notation/resolution'
export { UNREFINED, documentSteps, absorbViewScale } from './notation/viewResolution'
export type { ViewScale } from './notation/viewResolution'
export { patternKind, isStepChunk, isRollChunk } from './patternKind'
export type { PatternKind } from './patternKind'
// which grid a chunk opens in, whether its lanes are a chord chart, and a lane's drum
// name: what a step lane's written tokens mean (#1941, moved in from visualEdit/panels)
export { routeSurface, chunkSurface, opensStepGrid, opensPianoRoll, rollShape } from './surface/surfaceRoute'
export type { Surface } from './surface/surfaceRoute'
export { chordLanes } from './surface/chordLanes'
export { sampleVoice } from './surface/drumVoices'
export { trackIdentity, TRACK_PALETTE_32 } from './trackColor'

// ── ops ── model → model (or code → edits); offered exactly when the writer can write the result
export {
  detectArrangeAt,
  detectAllArrangeCalls,
  detectBarePattern,
  setWeight,
  reorderArm,
  insertArm,
  insertSilenceArm,
  renameSection as renameArrangeSection,
  countSectionArms as countArrangeSectionArms,
  removeArm,
  silenceArm,
  wrapBare,
  materializeBareDelete,
  materializeBareSplit,
  splitArm,
  setArmPattern,
  listSectionParts as listArrangeSectionParts,
} from './arrange'
export type { ArrangeCall, ArrangeArmRange, ArrangeMode } from './arrange'
export { planSoundAssignment, cyclesToPlayThrough } from './assign/soundAssign'
export { planVizAssignment } from './assign/vizAssign'
export { assignmentEdit } from './assign/soundAssign'
export { captionEdit, shapeEdit, shapeOptions, rateEditable } from './automation/captionEdit'
export { gridWriteEdits, readChunkGain, gainUnchanged } from './notation/gainEdit'
export {
  stepGridCodec,
  pianoRollCodec,
  gainWritable,
  slotPress,
  slotPressCost,
  reconcileGrid,
  gridWritePlan,
} from './notation/gridCodec'
export type { NotationCodec, ResolutionOps, GridCodec, SlotPress } from './notation/gridCodec'
export type { CaptionFieldKind } from './automation/captionEdit'
export {
  merge,
  transpose,
  timestretch,
  filter,
  scaleGain,
  stepValueEdit,
  stepTextEdit,
  fixedToStepsEdit,
  stepCountEdit,
  previewRepeat,
  previewShapeSwap,
} from './ir'
export { masterGainEdit, masterMuteEdit, masterVizEdit, masterAudioLineEdit } from './mixer/masterEdit'
export { renameEdit, gainEdit, panEdit, muteEdit, reconcileSoloMutes, soloMuteEdits } from './mixer/writeStrip'
export type { SoloStripFacts } from './mixer/writeStrip'
export {
  knobEdit,
  knobRangeEdit,
  knobRangeResetEdit,
  toggleCallEdit,
  removeNamedCall,
  setStringCall,
} from './chainEdit'
export type { ChainArgRef } from './chainEdit'
export {
  readRegion,
  readRegionControl,
  regionTrimEdit,
  MIN_REGION_SPAN,
  MULTI_VOICE_HEADS,
} from './regionTrim'
export type { RegionControl, RegionTrimRefusal, RegionTrimResult } from './regionTrim'
export { resizeGrid, resizeRoll } from './notation'
export { addLane, removeLane } from './notation/lane'
export { appendEmptyBars, duplicateBar, lengthenOffers, appendBarsOffer } from './notation/lengthen'
export type { LengthenResult, LengthenOffers } from './notation/lengthen'
export { applyRollGain, applyStepGain } from './notation/parse'
export { drawnLayout, drawnAt, lcmOf } from './notation/perBar'
export {
  placeNote,
  moveNote,
  pasteNote,
  removeNote,
  resizableNotes,
  resizeNote,
  viewPlacesNotes,
  canResizeCell,
  canToggleCell,
  resizeCell,
  toggleCell,
} from './notation/place'
export {
  quantizePianoRollTo,
  collapsePianoRollToDocument,
  quantizeStepGridTo,
  collapseStepGridToDocument,
} from './notation/resolution'
export {
  serializeStepGrid,
  serializePianoRoll,
  serializeRollGain,
  serializeStepGain,
} from './notation/serialize'
export {
  detectPickControlAt,
  detectAllPickControls,
  setWeight as pickSetWeight,
  splitArm as pickSplitArm,
  removeArm as pickRemoveArm,
  silenceArm as pickSilenceArm,
  reorderArm as pickReorderArm,
  insertArm as pickInsertArm,
  insertSilenceArm as pickInsertSilenceArm,
  duplicateArm as pickDuplicateArm,
  renameSection as pickRenameSection,
  countSectionArms as pickCountSectionArms,
  setArmHead as pickSetArmHead,
  listSectionParts as pickListSectionParts,
} from './pickControl'
export type { PickControl, PickControlArm, PickMethod, PickSectionEntry } from './pickControl'

// ── commit ── an op's edits, through the one writer
// the writer is a TYPE outside this area: built by `createWriter`, driven only by the
// functions here (#1914)
export type { Writeback } from './writeback'
export { formatNumber, normalizeEdits, applyEdits, commit, commitToEditor, commitToFile, createWriter, openGesture, closeGesture, isCommitting } from './writeback'
export type { WriteSource, OffsetEdit, CommitOutcome, WriteOutcome, WriteRefusal } from './writeback'
