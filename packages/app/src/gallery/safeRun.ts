/**
 * Community gallery (#2304) — gallery code runs only after the person presses Play.
 *
 * WHAT WOULD OTHERWISE RUN IT. Opening a project (or adding a file) does not
 * start the transport, but the Song timeline evaluates the active Strudel file
 * QUIETLY to draw its pre-play marks whenever that view is on screen
 * (StrudelEditorClient `refreshTimelineMarks` → LiveCodingRuntime
 * `evaluateForTimeline` → `engine.evaluate(code)`). That evaluate executes the
 * file as JavaScript on Stave's origin — exactly what a stranger's code must
 * not do before the person has read it and chosen to run it.
 *
 * So a file that arrived from the gallery is HELD: the quiet evaluate skips it
 * (the timeline falls back to its source-only marks) until that file has been
 * played once. The hold is keyed by project and file and kept in localStorage,
 * so a reload does not lift it either.
 *
 * `beginGalleryImport` covers the window while files are being created — the
 * still-mounted editor sees them arrive before the caller knows their final
 * project/file ids — by holding everything until `endGalleryImport`.
 */

const KEY = "stave.gallery.unplayed";
let importsInFlight = 0;

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function write(set: Set<string>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* storage full / private mode — the in-flight guard still covers the import itself */
  }
}

const keyOf = (projectId: string, fileId: string) => `${projectId}/${fileId}`;

export function beginGalleryImport(): void {
  importsInFlight += 1;
}

export function endGalleryImport(): void {
  importsInFlight = Math.max(0, importsInFlight - 1);
}

/** Hold these files until each is played. */
export function holdGalleryFiles(projectId: string, fileIds: readonly string[]): void {
  const set = read();
  for (const f of fileIds) set.add(keyOf(projectId, f));
  write(set);
}

/** May anything other than Play evaluate this file? */
export function isGalleryHeld(projectId: string, fileId: string): boolean {
  if (importsInFlight > 0) return true;
  return read().has(keyOf(projectId, fileId));
}

/** The person pressed Play on this file: from now on it is theirs to run. */
export function releaseGalleryHold(projectId: string, fileId: string): void {
  const set = read();
  if (set.delete(keyOf(projectId, fileId))) write(set);
}

/** Test seam. */
export function resetGalleryHoldsForTest(): void {
  importsInFlight = 0;
}
