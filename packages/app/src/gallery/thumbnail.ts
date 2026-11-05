/**
 * Community gallery (#2305) — one frame of the author's running viz, as a small
 * image for the gallery card.
 *
 * Read from the page the author is looking at, never by running anyone's code:
 * the canvas a viz is drawing into right now (a preview tab, the backdrop, or an
 * inline viz under the code) is copied once, shrunk to ~480px wide and encoded.
 *
 * WebGL canvases are made without `preserveDrawingBuffer`, so outside the frame
 * they were drawn in they can read back empty. The copy is taken in an animation
 * frame (after the renderer's own callback has drawn), and a frame that comes back
 * all transparent or all black is treated as "no thumbnail" rather than uploaded.
 */
import { MAX_THUMBNAIL_BYTES } from "./types";

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
): Promise<Blob | null> {
  for (const width of WIDTHS) {
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

/**
 * One frame of `canvas` as a gallery thumbnail. Tries a few frames, because the
 * first can land before the viz has drawn.
 */
export async function captureThumbnail(canvas: HTMLCanvasElement, attempts = 4): Promise<CaptureResult> {
  for (let i = 0; i < attempts; i++) {
    await nextFrame();
    let frame: HTMLCanvasElement;
    try {
      frame = scaledCopy(canvas, THUMBNAIL_WIDTH);
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
    const blob = await encodeUnderLimit(frame);
    if (!blob) return { ok: false, reason: "The frame was too large to keep as a thumbnail." };
    return { ok: true, thumbnail: { dataUrl: await blobToDataUrl(blob), bytes: blob.size, type: blob.type } };
  }
  return { ok: false, reason: "The running viz read back blank, so there's no thumbnail." };
}

/**
 * A thumbnail from whatever viz is running, or why there isn't one. The largest
 * viz on screen goes first; if it reads back blank (a WebGL canvas, or one that
 * hasn't drawn yet), the next one is tried.
 */
export async function captureLiveVizThumbnail(root: ParentNode = document): Promise<CaptureResult> {
  const canvases = findLiveVizCanvases(root);
  if (!canvases.length) return { ok: false, reason: "No viz is running, so there's no thumbnail." };
  let last: CaptureResult = { ok: false, reason: "No viz is running, so there's no thumbnail." };
  for (const canvas of canvases) {
    last = await captureThumbnail(canvas);
    if (last.ok) return last;
  }
  return last;
}
