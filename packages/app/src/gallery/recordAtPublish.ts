/**
 * #2487 — record what an entry plays, at publish, on the author's own machine.
 *
 * Each pattern file is evaluated on an engine of its own (never the project's:
 * that would replace the document loaded to play) and asked for its events over
 * its length, read with `songEnd` exactly as the Song timeline reads it: an
 * arrangement's full length, or one pass of a loop capped at 16 bars. Events are
 * grouped into lanes and sections by the Song timeline's own logic
 * (`collectNoteMarks`, `resolveSectionName`), so a card shows the sections the
 * author saw in their timeline, by the names they gave them.
 *
 * Nothing plays: evaluating builds the patterns, and the queries read them.
 *
 * A file that came from someone else's gallery entry and hasn't been played yet
 * is NOT evaluated (the run gate's quiet check, `mayEvaluateQuietly`): publishing
 * must not run a stranger's code the author never chose to run. Such a file is
 * left out of the record, and its card falls back to the plain picture.
 *
 * Recording is best effort. A file that fails to evaluate, or a record over the
 * size cap, is dropped; publishing never fails because of it.
 */
import { StrudelEngine, analyzeSong, parseStrudel, songEnd } from "@stave/editor";
import { collectNoteMarks } from "../components/musicalTimeline/timelineMarks";
import { resolveSectionName } from "../components/musicalTimeline/sectionLabel";
import { mayEvaluateQuietly } from "./runGate";
import { fileRole } from "./galleryModel";
import {
  RECORDING_LIMITS,
  encodeRecording,
  readRecording,
  roundCycle,
  type GalleryRecording,
  type RecordedEvent,
  type RecordedPattern,
  type RecordedSection,
} from "./recording";
import type { GalleryManifest } from "./types";

let engine: StrudelEngine | null = null;

function recordEngine(): StrudelEngine {
  // its sliders apart from the project's and the Library preview's
  if (!engine) engine = new StrudelEngine({ sliderScope: "gallery-record:" });
  return engine;
}

/** Track keys the engine makes up for unnamed tracks (`$:` → `$0`, `d1`): no name a person gave. */
const MADE_UP = /^(\$\d*|d\d+|_?\$?\d+)$/;

/** How many cycles one file is recorded for: the song's length, or a loop's pass. */
async function lengthOf(
  ir: ReturnType<typeof parseStrudel>,
  e: StrudelEngine,
): Promise<{ span: "arranged" | "loop"; cycles: number }> {
  const end = songEnd(ir);
  if (end.kind === "arranged" && end.cycles > 0) {
    return { span: "arranged", cycles: Math.min(Math.ceil(end.cycles), RECORDING_LIMITS.cycles) };
  }
  const cap = RECORDING_LIMITS.loopCycles;
  const a = await analyzeSong(ir, { capCycles: cap, collectFn: (s, t) => e.getTimelineEventsBand(s, t) });
  const pass = a.repeatCycles ?? a.periodCycles;
  return { span: "loop", cycles: pass && pass > 0 ? Math.min(Math.ceil(pass), cap) : cap };
}

/** Record one pattern file, or null when it can't be. */
export async function recordPattern(path: string, code: string): Promise<RecordedPattern | null> {
  const e = recordEngine();
  await e.init();
  const { error } = await e.evaluate(code);
  if (error) return null;
  const ir = parseStrudel(code);
  const { span, cycles } = await lengthOf(ir, e);
  const events = e.getTimelineEventsBand(0, cycles).filter((ev) => ev.begin >= 0 && ev.begin < cycles);
  const marks = collectNoteMarks(events, ir, { originCycle: 0, spanCycles: cycles }, RECORDING_LIMITS.eventsPerFile);

  // One lane per sound within each track (the timeline's own per-voice key,
  // SceneNote.voice), as the mockup draws them: kick, hats, clap, bass, chords.
  // A sound in two tracks is two lanes. First-heard order; the cap keeps the busiest.
  type Lane = { key: string; name: string; notes: { cycle: number; end: number; pitch: number | null }[] };
  const byKey = new Map<string, Lane>();
  for (const [track, notes] of marks.marksByLane) {
    for (const n of notes) {
      const voice = n.voice || (MADE_UP.test(track) ? "" : track) || "notes";
      const key = `${track}\u0000${voice}`;
      let lane = byKey.get(key);
      if (!lane) byKey.set(key, (lane = { key, name: voice, notes: [] }));
      lane.notes.push({ cycle: n.cycle, end: n.end, pitch: n.pitch });
    }
  }
  let kept = [...byKey.values()];
  if (kept.length > RECORDING_LIMITS.lanesPerFile) {
    const busiest = new Set([...kept].sort((x, y) => y.notes.length - x.notes.length).slice(0, RECORDING_LIMITS.lanesPerFile));
    kept = kept.filter((l) => busiest.has(l));
  }
  const lanes = kept.map((l) => ({ name: String(l.name).slice(0, RECORDING_LIMITS.nameLength) || "notes" }));
  const perLane = Math.max(1, Math.floor(RECORDING_LIMITS.eventsPerFile / Math.max(1, kept.length)));
  const out: RecordedEvent[] = [];
  kept.forEach((l, lane) => {
    const notes = l.notes.sort((x, y) => x.cycle - y.cycle);
    // a dense lane keeps notes across its whole length, not just its start
    const step = notes.length > perLane ? notes.length / perLane : 1;
    for (let i = 0; i < notes.length && out.length < RECORDING_LIMITS.eventsPerFile; i += step) {
      const n = notes[Math.floor(i)];
      const start = Math.max(0, Math.min(cycles, n.cycle));
      const len = Math.max(0, Math.min(cycles - start, n.end - n.cycle));
      out.push([lane, roundCycle(start), roundCycle(len), n.pitch == null ? null : Math.max(0, Math.min(127, Math.round(n.pitch)))]);
    }
  });

  // One section per arm placement, merged across lanes; named as the timeline names them.
  const byPlace = new Map<string, { a: number; b: number; arm: number; range: readonly [number, number] | null }>();
  for (const clips of marks.clipsByLane.values()) {
    for (const c of clips) {
      if (c.armIndex < 0) continue;
      const key = `${c.armIndex}:${c.startCycle}`;
      const had = byPlace.get(key);
      if (!had) byPlace.set(key, { a: c.startCycle, b: c.endCycle, arm: c.armIndex, range: c.nameRange });
      else had.b = Math.max(had.b, c.endCycle);
    }
  }
  const sections: RecordedSection[] = [...byPlace.values()]
    .sort((x, y) => x.a - y.a)
    .filter((s) => s.b > s.a && s.a < cycles)
    .slice(0, RECORDING_LIMITS.sectionsPerFile)
    .map((s) => [roundCycle(s.a), roundCycle(Math.min(s.b, cycles)), resolveSectionName(s.arm, s.range, code)]);

  return { path, span, cycles, lanes, events: out, sections };
}

/**
 * The entry's record: every pattern file the author may run quietly (up to the
 * cap), the cover, and what the entry holds — the counts even when no pattern
 * could be recorded. Null when the record would be over the size cap.
 */
export async function recordEntry(
  projectId: string,
  manifest: GalleryManifest,
  cover: string | null,
): Promise<GalleryRecording | null> {
  const contents = { patterns: 0, visuals: 0, other: 0 };
  for (const f of manifest.files) {
    const r = fileRole(f.path);
    if (r === "pattern") contents.patterns += 1;
    else if (r === "visual") contents.visuals += 1;
    else contents.other += 1;
  }
  const patterns = manifest.files.filter((f) => fileRole(f.path) === "pattern");
  // the cover first, so it's recorded even when the cap cuts the rest
  patterns.sort((a, b) => Number(b.path === cover) - Number(a.path === cover));
  const files: RecordedPattern[] = [];
  for (const f of patterns.slice(0, RECORDING_LIMITS.files)) {
    if (!mayEvaluateQuietly(projectId, f.id)) continue;
    try {
      const rec = await recordPattern(f.path, f.content);
      if (rec) files.push(rec);
    } catch (err) {
      console.warn(`[stave] couldn't record ${f.path} for the gallery:`, err);
    }
  }
  const rec = readRecording({ v: 1, cover, contents, files });
  return rec && encodeRecording(rec) ? rec : null;
}
