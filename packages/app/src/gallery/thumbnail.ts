/**
 * Community gallery (#2305) — one frame of the author's running viz, as a small
 * image for the gallery card.
 *
 * Read from the page the author is looking at, never by running anyone's code:
 * the canvas a viz is drawing into right now (a preview tab, the backdrop, or an
 * inline viz under the code) is copied once, shrunk to ~480px wide and encoded.
 * #2610 — observed in Chromium: an inline three.js zone's canvas (drawn in the
 * worker) copies with `drawImage` like the backdrop's, with its true colours.
 *
 * WebGL canvases are made without `preserveDrawingBuffer`, so outside the frame
 * they were drawn in they can read back empty. The copy is taken in an animation
 * frame (after the renderer's own callback has drawn), and a frame that comes back
 * all transparent or all black is treated as "no thumbnail" rather than uploaded.
 */
import { MAX_THUMBNAIL_BYTES } from "./types";
import { RECORDING_LIMITS, type RecordedFrame } from "./recording";
import { fileRole } from "./galleryModel";
import { findVizFileByName, type NamedVizFile } from "../visualizers/vizFileLookup";

export const THUMBNAIL_WIDTH = 480;

/** Where a running viz's canvas lives in the app. */
const LIVE_VIZ_SELECTORS = [
  '[data-testid^="compiled-viz-mount-"] canvas', // a preview tab, or the backdrop
  "[data-viz-zone] canvas", // an inline viz under the code
  '[data-testid="viz-panel"] canvas',
];

/** Visible canvases a viz is drawing into, largest first. Empty when no viz is on screen. */
export function findLiveVizCanvases(root: ParentNode = document): HTMLCanvasElement[] {
  const found: Array<{ el: HTMLCanvasElement; area: number }> = [];
  for (const el of root.querySelectorAll<HTMLCanvasElement>(LIVE_VIZ_SELECTORS.join(","))) {
    if (!el.isConnected || el.width === 0 || el.height === 0) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > 0) found.push({ el, area });
  }
  return found.sort((a, b) => b.area - a.area).map((f) => f.el);
}

/** The largest visible canvas a viz is drawing into, or null when no viz is on screen. */
export function findLiveVizCanvas(root: ParentNode = document): HTMLCanvasElement | null {
  return findLiveVizCanvases(root)[0] ?? null;
}

/**
 * True when no pixel shows anything: every pixel is transparent or black. That is
 * what a WebGL canvas read outside its frame gives back, and what a viz that
 * hasn't drawn yet looks like.
 */
export function isBlankFrame(rgba: Uint8ClampedArray, threshold = 8): boolean {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < threshold) continue;
    if (rgba[i] > threshold || rgba[i + 1] > threshold || rgba[i + 2] > threshold) return false;
  }
  return true;
}

export type EncodeFn = (canvas: HTMLCanvasElement, type: string, quality?: number) => Promise<Blob | null>;

const toBlob: EncodeFn = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("couldn't read the image"));
    r.readAsDataURL(blob);
  });
}

function scaledCopy(source: CanvasImageSource & { width: number; height: number }, width: number): HTMLCanvasElement {
  const w = Math.max(1, Math.min(width, source.width));
  const h = Math.max(1, Math.round((source.height / source.width) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(source, 0, 0, w, h);
  return c;
}

const WIDTHS = [THUMBNAIL_WIDTH, 360, 240];
const QUALITIES = [0.82, 0.65, 0.5, 0.35];

/**
 * Encode `frame` as webp (png where the browser can't write webp) small enough for
 * the gallery: lower the quality first, then the size. Null when nothing fits.
 */
export async function encodeUnderLimit(
  frame: HTMLCanvasElement,
  maxBytes = MAX_THUMBNAIL_BYTES,
  encode: EncodeFn = toBlob,
  widths: readonly number[] = WIDTHS,
): Promise<Blob | null> {
  for (const width of widths) {
    const c = width >= frame.width ? frame : scaledCopy(frame, width);
    for (const q of QUALITIES) {
      const blob = await encode(c, "image/webp", q);
      if (!blob) break;
      // A browser that can't write webp hands back png, which has no quality: one try per size.
      if (blob.type !== "image/webp") {
        if (blob.size <= maxBytes) return blob;
        break;
      }
      if (blob.size <= maxBytes) return blob;
    }
  }
  return null;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export interface CapturedThumbnail {
  dataUrl: string;
  bytes: number;
  type: string;
}

/** Why there is no thumbnail, in words for the dialog. */
export type CaptureResult =
  | { ok: true; thumbnail: CapturedThumbnail }
  | { ok: false; reason: string };

/** How big a capture is: the cover picture's size, or a row's small still (#2590). */
export interface CaptureSize {
  width: number;
  maxBytes: number;
  /** The widths tried, largest first, when the frame is over `maxBytes`. */
  widths: readonly number[];
}

const COVER_SIZE: CaptureSize = { width: THUMBNAIL_WIDTH, maxBytes: MAX_THUMBNAIL_BYTES, widths: WIDTHS };

/** #2590 — a visual's still on its row in "In this project": small, and small in bytes. */
export const FRAME_SIZE: CaptureSize = {
  width: RECORDING_LIMITS.frameWidth,
  maxBytes: RECORDING_LIMITS.frameBytes,
  widths: [RECORDING_LIMITS.frameWidth, 120],
};

/**
 * One frame of `canvas` as a gallery thumbnail. Tries a few frames, because the
 * first can land before the viz has drawn.
 */
export async function captureThumbnail(
  canvas: HTMLCanvasElement,
  attempts = 4,
  size: CaptureSize = COVER_SIZE,
): Promise<CaptureResult> {
  for (let i = 0; i < attempts; i++) {
    await nextFrame();
    let frame: HTMLCanvasElement;
    try {
      frame = scaledCopy(canvas, size.width);
    } catch {
      return { ok: false, reason: "The running viz couldn't be copied." };
    }
    let pixels: Uint8ClampedArray;
    try {
      pixels = frame.getContext("2d")!.getImageData(0, 0, frame.width, frame.height).data;
    } catch {
      return { ok: false, reason: "The running viz couldn't be read." };
    }
    if (isBlankFrame(pixels)) continue;
    const blob = await encodeUnderLimit(frame, size.maxBytes, toBlob, size.widths);
    if (!blob) return { ok: false, reason: "The frame was too large to keep as a thumbnail." };
    return { ok: true, thumbnail: { dataUrl: await blobToDataUrl(blob), bytes: blob.size, type: blob.type } };
  }
  return { ok: false, reason: "The running viz read back blank, so there's no thumbnail." };
}

/**
 * A thumbnail from whatever viz is running, or why there isn't one. The largest
 * viz on screen goes first; if it reads back blank (a WebGL canvas, or one that
 * hasn't drawn yet), the next one is tried. Canvases in `skip` were tried already.
 */
export async function captureLiveVizThumbnail(
  root: ParentNode = document,
  take: (canvas: HTMLCanvasElement) => Promise<CaptureResult> = (c) => captureThumbnail(c),
  skip: ReadonlySet<HTMLCanvasElement> = new Set(),
): Promise<CaptureResult> {
  const canvases = findLiveVizCanvases(root).filter((c) => !skip.has(c));
  let last: CaptureResult = { ok: false, reason: "No viz is running, so there's no thumbnail." };
  for (const canvas of canvases) {
    last = await take(canvas);
    if (last.ok) return last;
  }
  return last;
}

/** A file of the project as the name rule reads it: its id, path and language. */
export interface ProjectFile {
  id: string;
  path: string;
  language: string;
}

/**
 * #2610 — where each visual file of `files` is drawing on screen right now, by
 * file id: its preview tab or the backdrop (`compiled-viz-mount-<file id>`), and
 * every inline viz under the code whose `.viz("name")` resolves to it.
 *
 * An inline zone carries only the name it was called by (`data-viz-zone-id`).
 * The name is matched by the studio's own rule (`findVizFileByName`, the one the
 * renderer registers a project's visuals under and the zone's ✎ button opens),
 * so a zone counts for exactly the file it is drawing. A name no file answers to
 * is one of the visuals Stave ships, and belongs to no file of the project.
 */
export function findVisualMounts(files: ReadonlyArray<ProjectFile>, root: ParentNode = document): Map<string, Element[]> {
  const out = new Map<string, Element[]>();
  const add = (id: string, el: Element) => {
    const list = out.get(id);
    if (list) list.push(el);
    else out.set(id, [el]);
  };
  for (const el of root.querySelectorAll('[data-testid^="compiled-viz-mount-"]')) {
    add(el.getAttribute("data-testid")!.slice("compiled-viz-mount-".length), el);
  }
  // A language the rule doesn't know is no visual (`isVizLanguage`), so the
  // manifest's plain string is safe to read as the workspace's language.
  const named = files as ReadonlyArray<ProjectFile & NamedVizFile>;
  for (const el of root.querySelectorAll("[data-viz-zone][data-viz-zone-id]")) {
    const f = findVizFileByName(named, el.getAttribute("data-viz-zone-id")!);
    if (f) add(f.id, el);
  }
  return out;
}

/** The visible canvases inside a visual's mounts, largest first. */
function canvasesIn(mounts: readonly Element[] | undefined): HTMLCanvasElement[] {
  if (!mounts) return [];
  const all = mounts.flatMap((m) => findLiveVizCanvases(m).filter((c) => m.contains(c)));
  return all.sort((a, b) => area(b) - area(a));
}

function area(c: HTMLCanvasElement): number {
  const r = c.getBoundingClientRect();
  return r.width * r.height;
}

/** "The running viz read back blank, …" → "the running viz read back blank, …", to follow a colon. */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The dialog's picture, and a plain word about where it came from when that isn't the cover. */
export type CoverCapture = CaptureResult & { note?: string };

/**
 * #2610 — the dialog's picture. When the chosen cover is a visual that is
 * drawing on screen (a tab, the backdrop, or inline under the code), the picture
 * is a frame of THAT visual, not of whichever canvas is largest.
 *
 * When it can't be taken from the cover, the picture falls back to the largest
 * visual on screen, as before, and `note` says why in words for the dialog: the
 * cover isn't on screen, or it is but couldn't be read.
 */
export async function captureCoverThumbnail(
  files: ReadonlyArray<ProjectFile>,
  coverId: string | null,
  root: ParentNode = document,
  take: (canvas: HTMLCanvasElement) => Promise<CaptureResult> = (c) => captureThumbnail(c),
): Promise<CoverCapture> {
  const cover = coverId ? files.find((f) => f.id === coverId) : undefined;
  if (!cover || fileRole(cover.path) !== "visual") return captureLiveVizThumbnail(root, take);

  const own = canvasesIn(findVisualMounts(files, root).get(cover.id));
  let failed: string | null = null;
  for (const canvas of own) {
    const got = await take(canvas);
    if (got.ok) return got;
    failed = got.reason;
  }
  const why = failed
    ? `${cover.path} is on screen, but its frame couldn't be taken: ${lower(failed)}`
    : `${cover.path} isn't drawing on screen right now.`;
  const rest = await captureLiveVizThumbnail(root, take, new Set(own));
  if (rest.ok) return { ...rest, note: `${why} This picture is of another visual that is.` };
  return { ok: false, reason: failed ? why : `${why} Play it, or open its tab, to take its picture.` };
}

/** #2610 — a visual that was drawing on screen but whose still couldn't be taken, and why. */
export interface MissedStill {
  path: string;
  reason: string;
}

/**
 * #2590 — a small still of each visual file that is running in the author's
 * studio right now, for its row in the entry's "In this project".
 *
 * Read the same way as the cover picture: wherever the visual is drawing — its
 * preview tab, the backdrop, or (#2610) inline under the code — the canvas there
 * is copied once. Nothing is run to take it: a visual that isn't on screen gets
 * no still, and its row stays as it is. At most `RECORDING_LIMITS.frames`.
 *
 * A visual that IS on screen but couldn't be copied is listed in `missed`, so
 * the dialog can say so rather than leave its row quietly without one.
 */
export async function captureVisualFrames(
  files: ReadonlyArray<ProjectFile>,
  root: ParentNode = document,
  take: (canvas: HTMLCanvasElement) => Promise<CaptureResult> = (c) => captureThumbnail(c, 4, FRAME_SIZE),
): Promise<{ frames: RecordedFrame[]; missed: MissedStill[] }> {
  const mounts = findVisualMounts(files, root);
  const frames: RecordedFrame[] = [];
  const missed: MissedStill[] = [];
  for (const f of files) {
    if (frames.length >= RECORDING_LIMITS.frames) break;
    if (fileRole(f.path) !== "visual" || frames.some((x) => x.path === f.path)) continue;
    let failed: string | null = null;
    let kept = false;
    for (const canvas of canvasesIn(mounts.get(f.id))) {
      const got = await take(canvas);
      if (got.ok) {
        frames.push({ path: f.path, image: got.thumbnail.dataUrl });
        kept = true;
        break;
      }
      failed = got.reason;
    }
    if (!kept && failed) missed.push({ path: f.path, reason: failed });
  }
  return { frames, missed };
}
