"use client";

import {
  analyzeSong,
  getIRSnapshot,
  signalDimensionsOf,
  subscribeIRSnapshot,
  type IRSnapshot,
  type SongAnalysis,
} from "@stave/editor";

import { createSongCollector, type SongCollectorAccessors } from "../components/musicalTimeline/songCollector";
import { songFrameOf } from "../components/musicalTimeline/songFrame";
import {
  loadTimelineCamera,
  subscribeTimelineCamera,
  type TimelineCamera,
} from "../components/musicalTimeline/timelineCameraPersistence";
import { publishSongFrame } from "./drawnSongFrame";
import { getSongCycleLimit, subscribeSongCycleLimit } from "./songCycleLimit";

/**
 * The whole-song analysis of the current document (#385), run whether or not
 * the Song timeline is drawn (#1726).
 *
 * It used to run inside the timeline, which the bottom drawer unmounts when
 * closed. The transport display needs the song's length to wrap the song
 * position to it (#1725), so with the drawer closed it showed the unwrapped
 * position and no pass. Now the app starts this once; the timeline reads the
 * result instead of computing its own, so there is still one analysis per
 * document, and the display gets the frame the timeline would draw.
 *
 * Every new IR snapshot (a re-evaluation) starts a new analysis and aborts the
 * one in flight, so a fast edit cadence cannot pile up overlapping budgeted
 * collections. The previous result stays readable until the new one lands, as
 * it always did in the timeline: an analysis is best-effort. Unless the snapshot
 * is another FILE's: that song's length says nothing about this one, so the
 * result is withdrawn at once.
 */

let current: SongAnalysis | null = null;
let currentIr: IRSnapshot["ir"] | null = null;
/** The user's resized bare-loop span (#662), from the timeline's camera. */
let bareSpan: number | null = null;
const listeners = new Set<() => void>();

const bareSpanOf = (camera: TimelineCamera | null): number | null =>
  typeof camera?.bareSpan === "number" && Number.isFinite(camera.bareSpan) ? camera.bareSpan : null;

/** The frame the timeline would draw for this document at its first page. */
function publishFrame(): void {
  publishSongFrame(songFrameOf(current, currentIr, bareSpan));
}

function set(analysis: SongAnalysis | null, ir: IRSnapshot["ir"] | null): void {
  current = analysis;
  currentIr = ir;
  publishFrame();
  for (const listener of listeners) listener();
}

/** The latest analysis, or `null` when there is none (no document, or none yet). */
export function readSongAnalysis(): SongAnalysis | null {
  return current;
}

/** Called after every change to the analysis. Returns the unsubscribe. */
export function subscribeSongAnalysis(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Analyze every IR snapshot as it is published, until the returned function is
 * called. `accessors` are read at each run, so they may be latest-value closures.
 */
export function startSongAnalysis(accessors: SongCollectorAccessors): () => void {
  let inFlight: { aborted: boolean } | null = null;
  let source: string | null = null;

  const run = (snapshot: IRSnapshot | null): void => {
    if (inFlight) inFlight.aborted = true;
    inFlight = null;
    const ir = snapshot?.ir ?? null;
    const nextSource = snapshot?.source ?? null;
    if (!ir || nextSource !== source) {
      source = nextSource;
      if (current != null) set(null, null);
      if (!ir) return;
    }
    // #980 — queryArc-backed collector: eval haps for the whole song, remapped
    // to the timeline's lane keys (see `songCollector.ts` for why a copy of the
    // band rule would drift).
    const { collectFn, hasUnheardTrack } = createSongCollector(ir, accessors);
    const signal = { aborted: false };
    inFlight = signal;
    // #1465 — what the SOURCE says is continuously modulated. Read here because
    // only the caller holds the IR; the rule that uses it is `displayPeriodRule`.
    // #2109 — the user's limit on how far to look, not the analysis's own 256.
    analyzeSong(ir, {
      signal,
      collectFn,
      hasUnheardTrack,
      signals: signalDimensionsOf(ir),
      capCycles: getSongCycleLimit(),
    })
      .then((result) => {
        if (!signal.aborted) set(result, ir);
      })
      .catch(() => {
        /* analysis is best-effort; leave the prior result in place */
      });
  };

  // #1774 — the bare-loop span as the user last set it: read once, then kept up
  // to date as the timeline saves its camera, so a resize made just before the
  // drawer closes still frames the song.
  bareSpan = bareSpanOf(loadTimelineCamera());
  const unsubscribeCamera = subscribeTimelineCamera((camera) => {
    const next = bareSpanOf(camera);
    if (next === bareSpan) return;
    bareSpan = next;
    publishFrame();
  });
  const unsubscribe = subscribeIRSnapshot(run);
  // #2109 — a new limit changes the answer for the SAME document, so re-run it
  // now rather than waiting for the next evaluation.
  const unsubscribeLimit = subscribeSongCycleLimit(() => run(getIRSnapshot()));
  // Trap NEW-4: a snapshot published before we subscribed is picked up here.
  run(getIRSnapshot());
  return () => {
    unsubscribeCamera();
    unsubscribeLimit();
    unsubscribe();
    if (inFlight) inFlight.aborted = true;
    inFlight = null;
    set(null, null);
  };
}
