/**
 * Viz thumbnail placeholder (#836) — the fallback tile a viz row shows when a
 * package has no baked frame (see {@link ./vizLibrary} `VizLibItem.thumbnail`).
 *
 * A baked thumbnail is always preferred; this is the graceful degrade so a
 * package without one (e.g. a future user-authored viz) still reads as an
 * intentional visual, not an empty box. It's a self-contained inline-SVG
 * `data:` URI — no network, no GPU, CSP-safe — a diagonal gradient tinted by the
 * renderer kind, with a per-name hue jitter so two same-renderer packages don't
 * look identical.
 */

import type { VizLibItem } from "./vizLibrary";

/** Base hue per renderer: GLSL violet, P5 green, Hydra magenta. */
const RENDERER_BASE_HUE: Record<VizLibItem["renderer"], number> = {
  glsl: 268,
  p5: 150,
  hydra: 322,
  three: 205,
};

/** Deterministic small hash of a string → used to jitter the hue per package. */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * A renderer-hued placeholder tile for a viz package as an SVG `data:` URI.
 * Pure and deterministic (same item → same URI), so it's stable across renders
 * and unit-testable without a DOM.
 */
export function vizThumbnailPlaceholder(item: VizLibItem): string {
  const base = RENDERER_BASE_HUE[item.renderer] ?? 210;
  const jitter = (hashCode(item.name) % 44) - 22; // ±22°
  const h = ((base + jitter) % 360 + 360) % 360;
  const h2 = (h + 40) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h} 68% 56%)"/>` +
    `<stop offset="1" stop-color="hsl(${h2} 60% 30%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="28" height="28" rx="5" fill="url(#g)"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
