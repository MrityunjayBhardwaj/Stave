/**
 * Notation — mini-notation ↔ grid/roll models for the write-back panels.
 * The round-trip-faithful core the Sequencer and Piano Roll sit on.
 */
export type {
  StepGridModel,
  StepLane,
  PianoRollModel,
  RollNote,
  ParseResult,
  GainWrite,
} from './model'
export { parseStepGrid, parsePianoRoll, parseGainMini, applyStepGain, applyRollGain } from './parse'
export {
  serializeStepGrid,
  serializePianoRoll,
  serializeStepGain,
  serializeRollGain,
} from './serialize'
export { pitchToMidi, midiToPitch, isBlackKey } from './pitch'
export { placeNote } from './place'
export { resizeGrid, resizeRoll, type ResizeMode } from './resize'
