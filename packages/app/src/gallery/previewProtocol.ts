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
 *   gallery → frame   { play: true, code, kind }   play this code
 *                     { stop: true }               stop
 *   frame → gallery   { state: "ready" }           listening (sent once, on load)
 *                     { state: "playing" | "stopped" | "error", message? }
 *
 * Anything else — an extra key, a wrong type, oversized code — is ignored, so
 * the code inside the frame (which can post to its parent too) can't make the
 * gallery do more than show one of those states. Who SENT a message is checked
 * by the caller (`event.source` is the frame, or the parent window): these
 * functions only judge shape.
 */

/** What the code is: a Strudel pattern (sound) or one of the visual languages. */
export type PreviewKind = "strudel" | "hydra" | "p5" | "glsl" | "three";
export const PREVIEW_KINDS: readonly PreviewKind[] = ["strudel", "hydra", "p5", "glsl", "three"];

export type PreviewState = "ready" | "playing" | "stopped" | "error";
const STATES: readonly PreviewState[] = ["ready", "playing", "stopped", "error"];

/** Larger than any gallery file the publish route accepts; anything bigger isn't ours. */
export const MAX_PREVIEW_CODE = 512 * 1024;
const MAX_MESSAGE = 500;

/**
 * #2495 — the "stopped" message the frame sends when its sound won't start
 * until someone presses Play inside it (WebKit asks for a click in the frame
 * itself; Chromium and Firefox take the gallery page's click). The gallery then
 * moves focus to that Play. Code in the frame can send it too: all it gets is
 * focus moved onto its own frame, once per preview.
 */
export const NEEDS_CLICK = "Press Play in the preview to hear it.";

export type ToFrame = { play: true; code: string; kind: PreviewKind } | { stop: true };
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

/** The frame's check on a message from the gallery. `null` = ignore it. */
export function parseToFrame(data: unknown): ToFrame | null {
  if (!isPlainObject(data)) return null;
  if (hasExactly(data, ["stop"]) && data.stop === true) return { stop: true };
  if (
    hasExactly(data, ["play", "code", "kind"]) &&
    data.play === true &&
    typeof data.code === "string" &&
    data.code.length <= MAX_PREVIEW_CODE &&
    PREVIEW_KINDS.includes(data.kind as PreviewKind)
  ) {
    return { play: true, code: data.code, kind: data.kind as PreviewKind };
  }
  return null;
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
