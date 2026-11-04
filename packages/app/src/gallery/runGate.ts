/**
 * #2342 — ONE GATE IN FRONT OF EVERY EVALUATE OF PROJECT CODE.
 *
 * A file imported from the gallery is held (#2304) and waits on the trust step
 * (#2328) — but those only guarded Play and the timeline's quiet evaluate.
 * Bounce to WAV and the stems export evaluate the file too (LiveCodingRuntime
 * `renderLoadedDocument` → `engine.evaluate`), and they asked nothing.
 *
 * Every runtime the app makes for a project file gets its engine from ONE
 * door (StrudelEditorClient `getOrCreateRuntime` → `provider.createEngine()`),
 * and every runtime path that runs code — play, the timeline's evaluate, the
 * offline bounce, the stems, the live capture, seek, loop, live mode — ends in
 * that engine's `evaluate`. So the gate sits there:
 *
 *  - `guardProjectEngine` wraps the engine's `evaluate`. It runs the code only
 *    when the file may run without asking (`mayEvaluate`), and otherwise
 *    refuses with `GalleryRunRefused` WITHOUT running anything. Fail-closed:
 *    a new path that forgets to ask cannot run imported code; it gets the
 *    refusal.
 *  - `askBeforeRunning` is the question, for the places a person asked for
 *    the code to run (Play, Bounce, stems, a seek on the ruler). Same wording
 *    and the same remembered answer as #2328's Play. A yes trusts the file and
 *    lifts its hold, after which the guard lets it through; Cancel changes
 *    nothing, so the guard keeps refusing.
 *  - Background work (the timeline's quiet evaluate) never asks. It checks
 *    `mayEvaluateQuietly` and stays held, as before.
 *
 * The bypass test (`__tests__/runGateBypass.test.ts`) lists every evaluate in
 * the app's source and fails when a new one is not accounted for.
 */

import {
  confirmGalleryRun,
  galleryAuthorToConfirm,
  galleryTrustMessage,
  isGalleryHeld,
  isGalleryHeldStored,
  releaseGalleryHold,
} from "./safeRun";

/** The engine refused to run a gallery file nobody has agreed to run yet. */
export class GalleryRunRefused extends Error {
  constructor() {
    super("This file came from the gallery and hasn't been run yet. Press Play to choose whether to run it.");
    this.name = "GalleryRunRefused";
  }
}

/** The person was asked and chose Cancel. Not a failure: nothing ran, nothing was made. */
export class GalleryRunDeclined extends Error {
  constructor() {
    super("Cancelled: the gallery code was not run.");
    this.name = "GalleryRunDeclined";
  }
}

export function isGalleryRunDeclined(err: unknown): boolean {
  return err instanceof GalleryRunDeclined || (err as { name?: unknown } | null)?.name === "GalleryRunDeclined";
}

/**
 * May this file's code be evaluated now without asking anyone? False while it
 * waits on the trust step or is still held. (An import still in flight is the
 * quiet path's concern: `mayEvaluateQuietly`.)
 */
export function mayEvaluate(projectId: string, fileId: string): boolean {
  return galleryAuthorToConfirm(projectId, fileId) === null && !isGalleryHeldStored(projectId, fileId);
}

/** May background work (the timeline's quiet evaluate) run this file? Never asks. */
export function mayEvaluateQuietly(projectId: string, fileId: string): boolean {
  return galleryAuthorToConfirm(projectId, fileId) === null && !isGalleryHeld(projectId, fileId);
}

/** How the question is put to the person; resolves true for "Run it". */
export type AskToRun = (message: ReturnType<typeof galleryTrustMessage>) => Promise<boolean>;

/**
 * Someone asked for this file's code to run (Play, Bounce, stems, a seek).
 * Resolves true at once for a file that may run; for a gallery file still
 * waiting on the trust step, asks once (#2328's question and memory). A yes,
 * or a held file with nothing to confirm, lifts the hold so the engine guard
 * lets the evaluate through.
 */
export async function askBeforeRunning(projectId: string, fileId: string, ask: AskToRun): Promise<boolean> {
  if (mayEvaluate(projectId, fileId)) return true;
  const ok = await confirmGalleryRun(projectId, fileId, (author) => ask(galleryTrustMessage(author)));
  if (ok) releaseGalleryHold(projectId, fileId);
  return ok;
}

/** `askBeforeRunning`, then `run` — or `GalleryRunDeclined` with nothing run. */
export async function runAfterAsking<T>(
  projectId: string,
  fileId: string,
  ask: AskToRun,
  run: () => Promise<T>,
): Promise<T> {
  if (!(await askBeforeRunning(projectId, fileId, ask))) throw new GalleryRunDeclined();
  return run();
}

const GUARDED = Symbol.for("stave.gallery.runGate.guarded");

type Evaluating = { evaluate(code: string): Promise<{ error?: Error }> };

/**
 * Put the gate in front of `engine.evaluate`. `ids` is read at each evaluate,
 * so it names the file's project as it is then. Idempotent.
 */
export function guardProjectEngine<E extends Evaluating>(
  engine: E,
  ids: () => { projectId: string; fileId: string },
): E {
  const marked = engine as E & { [GUARDED]?: true };
  if (marked[GUARDED]) return engine;
  const evaluate = engine.evaluate.bind(engine);
  marked.evaluate = async (code: string) => {
    const { projectId, fileId } = ids();
    if (!mayEvaluate(projectId, fileId)) return { error: new GalleryRunRefused() };
    return evaluate(code);
  };
  marked[GUARDED] = true;
  return engine;
}

export function isGuardedEngine(engine: unknown): boolean {
  return !!engine && (engine as { [GUARDED]?: true })[GUARDED] === true;
}
