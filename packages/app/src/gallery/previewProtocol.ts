/**
 * Community gallery (#2328) — the messages between the gallery and its preview
 * frame, and the checks each side runs on what it receives.
 *
 * The preview frame (`/gallery-player`) is an `<iframe sandbox="allow-scripts">`
 * with no `allow-same-origin`, so the code it plays has an opaque origin: no
 * cookies, no IndexedDB or localStorage of Stave's, and the gallery API refuses
 * it. The only way in or out is `postMessage`, and these are the only shapes
 * either side acts on:
 *
 *   gallery → frame   { play: true, path, files }  play the file at `path`, with
 *                                                  the entry's other files beside it
 *                     { stop: true }               stop (the frame still honours it; the
 *                                                  gallery's own Stop removes the frame
 *                                                  instead, #2579, so code that ignores it
 *                                                  or lies about it can't keep playing)
 *   frame → gallery   { state: "ready" }           listening (sent once, on load)
 *                     { state: "playing" | "stopped" | "error", message? }
 *
 * #2490 — `files` is every file of the entry the preview can run, each
 * `{ path, kind, code }`, so a pattern that calls `.viz("bloom")` finds the
 * entry's own `bloom` visual inside the frame (previewRegistry.ts). The list is
 * checked as strictly as the rest: at most MAX_PREVIEW_FILES files, each path a
 * plain relative path (no `..`, no leading `/`, no control characters) and
 * unique, each kind a known one, each file's code at most MAX_PREVIEW_CODE and
 * all of them together at most MAX_PREVIEW_TOTAL; `path` must name one of them.
 * The old one-file message `{ play, code, kind }` is not that shape, so it is
 * ignored too.
 *
 * Anything else — an extra key, a wrong type, oversized code — is ignored, so
 * the code inside the frame (which can post to its parent too) can't make the
 * gallery do more than show one of those states. Who SENT a message is checked
 * by the caller (`event.source` is the frame, or the parent window): these
 * functions only judge shape.
 */

import { MAX_MANIFEST_BYTES } from "./types";

/** What the code is: a Strudel pattern (sound) or one of the visual languages. */
export type PreviewKind = "strudel" | "hydra" | "p5" | "glsl" | "three";
export const PREVIEW_KINDS: readonly PreviewKind[] = ["strudel", "hydra", "p5", "glsl", "three"];

export type PreviewState = "ready" | "playing" | "stopped" | "error";
const STATES: readonly PreviewState[] = ["ready", "playing", "stopped", "error"];

/** Larger than any gallery file the publish route accepts; anything bigger isn't ours. */
export const MAX_PREVIEW_CODE = 512 * 1024;
const MAX_MESSAGE = 500;
/** #2490 — files in one play message: more than a published project holds in practice. */
export const MAX_PREVIEW_FILES = 32;
/** #2490 — all the files' code together: no more than a whole published manifest. */
export const MAX_PREVIEW_TOTAL = MAX_MANIFEST_BYTES;
/** #2490 — a file's path, at most (the same cap the publish-time record puts on paths). */
export const MAX_PREVIEW_PATH = 512;

/**
 * #2495 — the "stopped" message the frame sends when its sound won't start
 * until someone presses Play inside it (WebKit asks for a click in the frame
 * itself; Chromium and Firefox take the gallery page's click). The gallery then
 * moves focus to that Play. Code in the frame can send it too, so the gallery
 * acts on it only as the first answer to its own request to play (#2547): sent
 * at any other time, it moves nothing.
 */
export const NEEDS_CLICK = "Press Play in the preview to hear it.";

/** #2490 — one of the entry's files, as the frame gets it. */
export interface PreviewFile {
  path: string;
  kind: PreviewKind;
  code: string;
}

export type ToFrame = { play: true; path: string; files: PreviewFile[] } | { stop: true };
export type FromFrame = { state: PreviewState; message?: string };

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function hasExactly(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

/**
 * #2490 — a path the frame accepts: a plain relative path of named segments.
 * Nothing in the frame reads files by path, but a path is shown and matched by
 * name, so one that could mean somewhere else (`../x`, `/x`, `a//b`, a backslash) or
 * hide characters isn't a file of the entry.
 */
export function isPreviewPath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > MAX_PREVIEW_PATH) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

function readPreviewFile(raw: unknown): PreviewFile | null {
  if (!isPlainObject(raw) || !hasExactly(raw, ["path", "kind", "code"])) return null;
  const { path, kind, code } = raw;
  if (!isPreviewPath(path)) return null;
  if (!PREVIEW_KINDS.includes(kind as PreviewKind)) return null;
  if (typeof code !== "string" || code.length > MAX_PREVIEW_CODE) return null;
  return { path, kind: kind as PreviewKind, code };
}

/** The frame's check on a message from the gallery. `null` = ignore it. */
export function parseToFrame(data: unknown): ToFrame | null {
  if (!isPlainObject(data)) return null;
  if (hasExactly(data, ["stop"]) && data.stop === true) return { stop: true };
  if (!hasExactly(data, ["play", "path", "files"]) || data.play !== true) return null;
  const { path, files } = data;
  if (!isPreviewPath(path)) return null;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_PREVIEW_FILES) return null;
  const out: PreviewFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const raw of files) {
    const f = readPreviewFile(raw);
    if (!f || seen.has(f.path)) return null;
    total += f.code.length;
    if (total > MAX_PREVIEW_TOTAL) return null;
    seen.add(f.path);
    out.push(f);
  }
  if (!seen.has(path)) return null;
  return { play: true, path, files: out };
}

/**
 * #2490 — the play message for one of an entry's files: that file first, then
 * every other file of the entry the preview can run, in the entry's order, as
 * many as fit the caps above. Built only from the entry's own manifest (the
 * caller passes it). `null` when the chosen file itself can't go (no preview, a
 * path or size the frame would refuse): the frame would ignore that message.
 */
export function previewPlayFor(
  manifestFiles: ReadonlyArray<{ path: string; language?: string; content: string }>,
  path: string,
): { play: true; path: string; files: PreviewFile[] } | null {
  const asPreview = (f: { path: string; language?: string; content: string }): PreviewFile | null => {
    const kind = previewKindOf(f);
    if (!kind || !isPreviewPath(f.path) || f.content.length > MAX_PREVIEW_CODE) return null;
    return { path: f.path, kind, code: f.content };
  };
  const chosen = manifestFiles.find((f) => f.path === path);
  const first = chosen ? asPreview(chosen) : null;
  if (!first || first.code.length > MAX_PREVIEW_TOTAL) return null;
  const files = [first];
  const seen = new Set([first.path]);
  let total = first.code.length;
  for (const f of manifestFiles) {
    if (files.length >= MAX_PREVIEW_FILES) break;
    if (seen.has(f.path)) continue;
    const p = asPreview(f);
    if (!p || total + p.code.length > MAX_PREVIEW_TOTAL) continue;
    seen.add(p.path);
    total += p.code.length;
    files.push(p);
  }
  return { play: true, path: first.path, files };
}

/** The gallery's check on a message from the frame. `null` = ignore it. */
export function parseFromFrame(data: unknown): FromFrame | null {
  if (!isPlainObject(data)) return null;
  if (!STATES.includes(data.state as PreviewState)) return null;
  const state = data.state as PreviewState;
  if (hasExactly(data, ["state"])) return { state };
  if (hasExactly(data, ["state", "message"]) && typeof data.message === "string") {
    return { state, message: data.message.slice(0, MAX_MESSAGE) };
  }
  return null;
}

/**
 * Which preview a gallery file gets, from its extension (the same names as
 * `extensionToLanguage`), then its stored language; `null` = no preview (Sonic
 * Pi, Markdown, anything unknown).
 */
export function previewKindOf(file: { path: string; language?: string }): PreviewKind | null {
  const base = file.path.split("/").pop() ?? "";
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  const byExt: Record<string, PreviewKind> = {
    strudel: "strudel",
    hydra: "hydra",
    hy: "hydra",
    p5: "p5",
    p5js: "p5",
    js: "p5",
    glsl: "glsl",
    frag: "glsl",
    shader: "glsl",
    three: "three",
  };
  if (byExt[ext]) return byExt[ext];
  const byLang: Record<string, PreviewKind> = { strudel: "strudel", hydra: "hydra", p5js: "p5", p5: "p5", glsl: "glsl", three: "three" };
  return byLang[(file.language ?? "").toLowerCase()] ?? null;
}
