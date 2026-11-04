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
// Declared up here because the test seam below clears it (#2328's trust step).
const asking = new Map<string, Promise<boolean>>();

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
  asking.clear();
}

/*
 * #2328 — the TRUST STEP, beside the hold. The hold above stops anything but
 * Play from running a gallery file; this asks before that first Play does.
 * Running code in the workspace gives it everything the person has in Stave on
 * this browser, so the first Play of an imported file says so and names who
 * wrote it. Confirmed once per file (kept in localStorage, keyed like the hold,
 * so a reload doesn't ask again for a file already trusted, nor forget one
 * that isn't); Cancel leaves the file unrun and still held.
 */

const TRUST_KEY = "stave.gallery.untrusted";

function readUntrusted(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TRUST_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, a] of Object.entries(v)) if (typeof a === "string") out[k] = a;
    return out;
  } catch {
    return {};
  }
}

function writeUntrusted(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(TRUST_KEY, JSON.stringify(map));
  } catch {
    /* storage full / private mode — the file then plays without asking, as before #2328 */
  }
}

/** These files came from `author` in the gallery: ask before each one first runs. */
export function markGalleryFilesUntrusted(projectId: string, fileIds: readonly string[], author: string): void {
  const map = readUntrusted();
  for (const f of fileIds) map[keyOf(projectId, f)] = author;
  writeUntrusted(map);
}

/** Who wrote this file, if it came from the gallery and hasn't been confirmed yet; else `null`. */
export function galleryAuthorToConfirm(projectId: string, fileId: string): string | null {
  return readUntrusted()[keyOf(projectId, fileId)] ?? null;
}

/** The person confirmed: from now on this file is theirs like any other. */
export function trustGalleryFile(projectId: string, fileId: string): void {
  const map = readUntrusted();
  const k = keyOf(projectId, fileId);
  if (k in map) {
    delete map[k];
    writeUntrusted(map);
  }
}

/** What the confirm says (#2328's wording). */
export function galleryTrustMessage(author: string): { title: string; description: string; confirmLabel: string } {
  const who = author.trim() || "someone else";
  return {
    title: "Run code from the gallery?",
    description:
      `This code was written by ${who}. Running it in your workspace gives it the same access you have ` +
      `to Stave on this browser: your projects and your account. Preview it in the gallery first if you're unsure.`,
    confirmLabel: "Run it",
  };
}

/**
 * May Play run this file now? Resolves true straight away for a file that
 * isn't waiting on the trust step; otherwise asks once (`confirm`, given the
 * author) and remembers a yes. A second Play while the question is open asks
 * nothing and resolves false (the first one plays it if the answer is yes). A
 * no leaves the file untrusted, so the next Play asks again.
 */
export async function confirmGalleryRun(
  projectId: string,
  fileId: string,
  confirm: (author: string) => Promise<boolean>,
): Promise<boolean> {
  const author = galleryAuthorToConfirm(projectId, fileId);
  if (author === null) return true;
  const k = keyOf(projectId, fileId);
  const pending = asking.get(k);
  if (pending) return pending.then(() => false);
  const p = confirm(author)
    .then((ok) => {
      if (ok) trustGalleryFile(projectId, fileId);
      return ok;
    })
    .finally(() => asking.delete(k));
  asking.set(k, p);
  return p;
}
