import { noteToMidi } from './noteToMidi'
import type { IREvent } from '../codeView'
import { declaredOnly, findMatchedEvent } from './NormalizedHap'

export interface HapEvent {
  /** Full Strudel Hap object (optional for non-Strudel engines) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hap?: any
  /** AudioContext.currentTime when note fires */
  audioTime: number
  /** Duration in AudioContext seconds */
  audioDuration: number
  /** Lookahead offset in ms (use for display timing delays) */
  scheduledAheadMs: number
  /** Computed MIDI note number (null for unpitched percussion) */
  midiNote: number | null
  /** Instrument/sample name from hap.value.s */
  s: string | null
  /** From .color() in pattern */
  color: string | null
  /** Source character ranges in the original code string */
  loc: Array<{ start: number; end: number }> | null
  /**
   * Set when the hap's structural loc matches an IR-published node
   * (PV38 clause 2). Absent for runtime-only haps — same semantics as
   * IREvent.irNodeId. Populated by HapStream.emit when a lookup is
   * supplied (Phase 20-06).
   */
  irNodeId?: string
  /**
   * Monotonic evaluate() generation this hap belongs to (#339). Stamped by
   * `emit` from the engine-supplied epoch (see {@link HapStream.setEpoch}).
   * `loc` offsets are only valid against the text of THIS epoch's eval —
   * consumers (useHighlighting) use the change to know when the loc
   * coordinate system reset and stale position anchors must be rebuilt.
   * Absent for engines that don't track eval generations.
   */
  epoch?: number
}

type HapHandler = (event: HapEvent) => void

/**
 * Lightweight event bus fed by StrudelEngine's scheduler onTrigger.
 * All visualizers and the highlight system subscribe here.
 */
export class HapStream {
  private handlers: Set<HapHandler> = new Set()

  // #339 — current evaluate() generation. Stamped onto every event emitted
  // via `emit`, so position-tracking consumers can detect a fresh eval (and
  // therefore a reset loc coordinate system). 0 until the engine sets it.
  private epoch = 0

  on(handler: HapHandler): void {
    this.handlers.add(handler)
  }

  off(handler: HapHandler): void {
    this.handlers.delete(handler)
  }

  /**
   * Set the evaluate() generation stamped onto subsequently-emitted events
   * (#339). Called by the engine at the start of each `evaluate()`.
   */
  setEpoch(epoch: number): void {
    this.epoch = epoch
  }

  /**
   * Called by the engine scheduler for each scheduled Hap.
   * Enriches the raw data and fans it out to all subscribers.
   *
   * Parameters match Strudel's onTrigger signature:
   *   (hap, deadline, duration, cps, t)
   *
   * Optional 6th positional `lookup` (Phase 20-06) — when supplied AND the
   * hap carries a structural loc, the published IR-side match is resolved
   * via `findMatchedEvent` and the matched event's `irNodeId` is populated
   * onto the fan-out HapEvent. PV38 clause 2 onTrigger half. Single-
   * strategy match (P50) — same helper as the queryArc-side enrichment in
   * `normalizeStrudelHap`.
   *
   * Phase 20-07 (T-α-2) — returns the enriched HapEvent so the engine's
   * wrappedOutput hit-check can read `event.irNodeId` in O(1) without
   * re-running findMatchedEvent (P50 — single-strategy match preserved).
   * Additive: 8 existing test callers + 1 production caller currently
   * ignore the void return; widening void → HapEvent does not break them.
   *
   * Optional 7th positional `declaredLocations` (#1621) — the engine's declared
   * spans (`declaredLocationKeys`), the same set `normalizeStrudelHap` filters by
   * (#1619). A single-quoted argument's location is in its own quoted space and
   * comes first, so unfiltered it lit up the wrong characters in the editor and
   * keyed the IR match below on the wrong span (breakpoints, the Inspector pulse).
   * Filtered here, before the event is built, so every subscriber sees one answer.
   * Omitted → unchanged.
   */
  emit(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hap: any,
    deadline: number,
    duration: number,
    cps: number,
    audioCtxCurrentTime: number,
    lookup?: ReadonlyMap<string, IREvent[]>,
    declaredLocations?: ReadonlySet<string>
  ): HapEvent {
    const scheduledAheadMs = (deadline - audioCtxCurrentTime) * 1000
    const audioDuration = duration
    const rawLoc = hap?.context?.locations ?? hap?.context?.loc ?? null
    const loc = Array.isArray(rawLoc) && declaredLocations
      ? declaredOnly(rawLoc, declaredLocations) ?? null
      : rawLoc

    const event: HapEvent = {
      hap,
      audioTime: deadline,
      audioDuration,
      scheduledAheadMs,
      midiNote: noteToMidi(hap?.value?.note ?? hap?.value?.n),
      s: hap?.value?.s ?? null,
      color: hap?.value?.color ?? null,
      loc,
      epoch: this.epoch,
    }

    // PV38 clause 2 — onTrigger-side identity carry. Mirror the
    // `if (id) event.irNodeId = id` discipline at NormalizedHap.ts:124-127:
    // truthy-only assignment preserves the "absent vs present:undefined"
    // distinction (PV37 alignment). NO fallback ladder (P50).
    if (lookup && event.loc && event.loc.length > 0) {
      const begin = Number(hap?.whole?.begin ?? 0)
      const matched = findMatchedEvent(event.loc, begin, lookup)
      if (matched?.irNodeId) event.irNodeId = matched.irNodeId
    }

    this.emitEvent(event)
    return event
  }

  /**
   * Emit a pre-constructed HapEvent directly.
   * Preferred API for non-Strudel engines that don't have raw hap objects.
   */
  emitEvent(event: HapEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event)
      } catch {
        // Prevent one bad subscriber from breaking others
      }
    }
  }

  dispose(): void {
    this.handlers.clear()
  }
}
