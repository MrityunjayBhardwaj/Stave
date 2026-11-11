/**
 * #2487 — what an entry plays, recorded at publish on the author's machine.
 *
 * The gallery never runs anyone's code to draw a card (#2304). So when an author
 * publishes, their own Stave — where the code is theirs and already runs — asks
 * each pattern what it plays and sends the answer as plain data: for each
 * pattern file, its lanes (one per track or sound), every event's start and
 * length (and pitch, when it has one), and its arrangement's named sections. An
 * arranged song is recorded at its full length, a bare loop for one pass (capped
 * at 16 bars). A sample is named, never sent.
 *
 * The record also says which file is the cover and how many patterns and
 * visuals the entry holds, so a card can say "3 patterns · 2 visuals" without
 * opening the entry.
 *
 * `readRecording` is the ONE reader of this shape: the publish route uses it to
 * refuse a malformed or oversized record, and the card and the entry page use it
 * again on what they fetch. It rebuilds the record from known fields only, so
 * nothing else rides along.
 */

export interface RecordedLane {
  /** The track's name (`drums:`), or the sound it plays for an unnamed one (`bd`). */
  name: string;
}

/** [lane index, start cycle, length in cycles, MIDI pitch or null]. */
export type RecordedEvent = [number, number, number, number | null];

/** [start cycle, end cycle, name]. */
export type RecordedSection = [number, number, string];

export interface RecordedPattern {
  /** The file's path in the entry. */
  path: string;
  /** "arranged": the whole song; "loop": one pass of a loop. */
  span: "arranged" | "loop";
  /** How many cycles were recorded (the song's length, or the loop's pass). */
  cycles: number;
  lanes: RecordedLane[];
  events: RecordedEvent[];
  sections: RecordedSection[];
}

export interface GalleryRecording {
  v: 1;
  /** The cover file's path: a pattern (its timeline) or a visual (its captured frame). */
  cover: string | null;
  contents: { patterns: number; visuals: number; other: number };
  files: RecordedPattern[];
}

export const RECORDING_LIMITS = {
  /** Pattern files recorded per entry. */
  files: 12,
  /** Cycles recorded per file (an arrangement longer than this is cut here). */
  cycles: 512,
  /** A loop's pass is capped at 16 bars (#2487). */
  loopCycles: 16,
  lanesPerFile: 16,
  eventsPerFile: 4000,
  sectionsPerFile: 64,
  nameLength: 48,
  pathLength: 512,
  /** The serialized record, at most. */
  bytes: 256 * 1024,
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const count = (v: unknown): number | null => (num(v) && Number.isInteger(v) && v >= 0 && v <= 10_000 ? v : null);
/** Times are kept to 1/1000 of a cycle: enough to draw, and it keeps the record small. */
export const roundCycle = (x: number): number => Math.round(x * 1000) / 1000;

function name(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // no control characters; trimmed and capped
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, RECORDING_LIMITS.nameLength) : null;
}

function readPattern(raw: unknown): RecordedPattern | null {
  if (!isObj(raw)) return null;
  const { path, span, cycles, lanes, events, sections } = raw;
  if (typeof path !== "string" || !path || path.length > RECORDING_LIMITS.pathLength) return null;
  if (span !== "arranged" && span !== "loop") return null;
  if (!num(cycles) || cycles <= 0 || cycles > RECORDING_LIMITS.cycles) return null;
  if (!Array.isArray(lanes) || lanes.length > RECORDING_LIMITS.lanesPerFile) return null;
  if (!Array.isArray(events) || events.length > RECORDING_LIMITS.eventsPerFile) return null;
  if (!Array.isArray(sections) || sections.length > RECORDING_LIMITS.sectionsPerFile) return null;

  const outLanes: RecordedLane[] = [];
  for (const l of lanes) {
    const n = isObj(l) ? name(l.name) : null;
    if (n === null) return null;
    outLanes.push({ name: n });
  }
  const outEvents: RecordedEvent[] = [];
  for (const e of events) {
    if (!Array.isArray(e) || e.length !== 4) return null;
    const [lane, start, len, pitch] = e;
    if (!num(lane) || !Number.isInteger(lane) || lane < 0 || lane >= outLanes.length) return null;
    if (!num(start) || start < 0 || start > cycles) return null;
    if (!num(len) || len < 0 || len > cycles) return null;
    if (pitch !== null && (!num(pitch) || pitch < 0 || pitch > 127)) return null;
    outEvents.push([lane, roundCycle(start), roundCycle(len), pitch === null ? null : Math.round(pitch)]);
  }
  const outSections: RecordedSection[] = [];
  for (const s of sections) {
    if (!Array.isArray(s) || s.length !== 3) return null;
    const [a, b, label] = s;
    const n = name(label);
    if (!num(a) || !num(b) || a < 0 || b <= a || b > cycles || n === null) return null;
    outSections.push([roundCycle(a), roundCycle(b), n]);
  }
  return { path, span, cycles: roundCycle(cycles), lanes: outLanes, events: outEvents, sections: outSections };
}

/**
 * Read a record, or null when it isn't one: any field of the wrong shape, out
 * of range, or over a cap refuses the whole record rather than trimming it.
 */
export function readRecording(raw: unknown): GalleryRecording | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const { cover, contents, files } = raw;
  if (cover !== null && (typeof cover !== "string" || !cover || cover.length > RECORDING_LIMITS.pathLength)) return null;
  if (!isObj(contents)) return null;
  const patterns = count(contents.patterns);
  const visuals = count(contents.visuals);
  const other = count(contents.other);
  if (patterns === null || visuals === null || other === null) return null;
  if (!Array.isArray(files) || files.length > RECORDING_LIMITS.files) return null;
  const out: RecordedPattern[] = [];
  for (const f of files) {
    const p = readPattern(f);
    if (!p) return null;
    out.push(p);
  }
  return { v: 1, cover: cover as string | null, contents: { patterns, visuals, other }, files: out };
}

/** The record as stored and served: JSON bytes, or null when over the size cap. */
export function encodeRecording(rec: GalleryRecording): Uint8Array | null {
  const bytes = new TextEncoder().encode(JSON.stringify(rec));
  return bytes.byteLength <= RECORDING_LIMITS.bytes ? bytes : null;
}

/** The cover's recorded pattern, when the cover is a pattern that was recorded. */
export function coverPattern(rec: GalleryRecording | null): RecordedPattern | null {
  if (!rec?.cover) return null;
  return rec.files.find((f) => f.path === rec.cover) ?? null;
}

/**
 * #2548 — may the entry's preview have something to play, as far as its record
 * says? The record counts files by `fileRole` (galleryModel.ts), whose pattern
 * and visual extensions are exactly the ones `previewKindOf` plays, so a record
 * with no pattern and no visual is an entry whose every file the preview shows
 * as "This file can't be previewed." The entry's kind needs no rule of its own:
 * a music or visual entry is its one file, counted like any other (a Sonic Pi
 * music file counts as "other", and the preview can't play it either). With no
 * record (an entry from before recording, or one not fetched yet) the card can't
 * tell, so it says yes.
 */
export function mayHavePreview(rec: GalleryRecording | null): boolean {
  if (!rec) return true;
  return rec.contents.patterns + rec.contents.visuals > 0;
}

/** "3 patterns · 2 visuals" — what the record says the entry holds. */
export function contentsLine(rec: GalleryRecording | null): string | null {
  if (!rec) return null;
  const { patterns, visuals, other } = rec.contents;
  const part = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? "" : "s"}` : null);
  const line = [part(patterns, "pattern"), part(visuals, "visual"), part(other, "other file")].filter(Boolean).join(" · ");
  return line || null;
}
