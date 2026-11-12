"use client";

/**
 * #2488 — a recorded pattern drawn as a timeline: one lane per track, each event
 * a bar at its time and length, the arrangement's sections across the top, a bar
 * ruler underneath. Drawn from the record made at publish (recording.ts), never
 * by running anything.
 *
 * `compact` is the entry page's file-row strip: no labels, no ruler. A loop's
 * single pass is repeated across the picture (at least four bars) so a one-bar
 * loop doesn't draw as a lone sliver; a song is drawn once, whole.
 */
import React, { useEffect, useRef } from "react";
import type { RecordedPattern } from "./recording";

export const LANE_COLOURS = ["#8a8aff", "#7fd6c2", "#ffb37a", "#b7a2ff", "#f59ac0", "#9fd47a", "#7ac8f5", "#f5d77a"];

/** How many cycles the picture spans: the song, or a loop repeated to fill at least four bars. */
export function drawnCycles(rec: Pick<RecordedPattern, "span" | "cycles">): { cycles: number; repeats: number } {
  if (rec.span === "arranged") return { cycles: rec.cycles, repeats: 1 };
  const repeats = Math.max(1, Math.ceil(4 / rec.cycles));
  return { cycles: rec.cycles * repeats, repeats };
}

function paint(canvas: HTMLCanvasElement, rec: RecordedPattern, compact: boolean): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = compact ? "#141430" : "#101022";
  g.fillRect(0, 0, w, h);

  const { cycles, repeats } = drawnCycles(rec);
  const sections = rec.span === "arranged" && !compact ? rec.sections : [];
  const lanes = Math.max(1, rec.lanes.length);
  const padX = compact ? 4 : w * 0.05;
  const top = compact ? 3 : sections.length ? h * 0.24 : h * 0.18;
  const bot = compact ? 3 : h * 0.12;
  const lw = w - padX * 2;
  const lh = (h - top - bot) / lanes;
  const sx = lw / cycles;

  sections.forEach(([a, b, label], k) => {
    const x0 = padX + a * sx;
    const x1 = padX + b * sx;
    g.fillStyle = k % 2 ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.065)";
    g.fillRect(x0, top - 4, x1 - x0, h - top - bot + 8);
    g.fillStyle = "#9a9ab8";
    g.font = "500 9.5px system-ui, -apple-system, sans-serif";
    if (x1 - x0 > g.measureText(label).width + 8) g.fillText(label, x0 + 4, top - 9);
  });

  for (let r = 0; r < repeats; r++) {
    const offset = r * rec.cycles;
    for (const [lane, start, len] of rec.events) {
      g.fillStyle = LANE_COLOURS[lane % LANE_COLOURS.length];
      g.globalAlpha = 0.85;
      const x = padX + (start + offset) * sx;
      const y = top + lane * lh + lh * 0.2;
      g.fillRect(x, y, Math.max(1.2, len * sx - 0.8), Math.max(1, lh * 0.6));
    }
  }
  g.globalAlpha = 1;

  if (!compact) {
    g.fillStyle = "rgba(255,255,255,.18)";
    const every = cycles > 32 ? 8 : cycles > 16 ? 4 : 1;
    for (let b = 0; b <= cycles; b += every) g.fillRect(padX + b * sx, h - bot + 4, 1, 4);
  }
}

export function RecordingTimeline({
  rec,
  compact = false,
  className,
}: {
  rec: RecordedPattern;
  compact?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    paint(canvas, rec, compact);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => paint(canvas, rec, compact));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [rec, compact]);
  return (
    <canvas
      ref={ref}
      className={className}
      data-gallery-timeline={rec.path}
      data-gallery-timeline-events={rec.events.length}
      aria-hidden="true"
    />
  );
}

/** "32 bars" for a song, "8-bar loop" for a loop. */
export function lengthLabel(rec: Pick<RecordedPattern, "span" | "cycles">): string {
  const n = Math.round(rec.cycles * 100) / 100;
  return rec.span === "arranged" ? `${n} ${n === 1 ? "bar" : "bars"}` : `${n}-bar loop`;
}
