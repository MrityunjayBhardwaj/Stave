---
title: Writing fast viz sketches
description: How to keep p5/hydra visualizers smooth — grounded in measured Stave profiler data, not folklore.
---

By default Stave renders each visualizer in an **OffscreenCanvas Web Worker**,
off the main thread — so a heavy `draw()` no longer starves the audio scheduler.
But the cost doesn't vanish: a slow sketch still drops its own frames, and on a
browser that can't offload (or when the worker path is off) the visualizer falls
back to the **main thread**, where a heavy `draw()` *can* starve the scheduler
and put audio timing at risk. Either way, the segment budget below is what keeps
a sketch smooth. This guide is the short, *measured* version. Every number here
came from the Stave profiler (`Alt+P`) and the cost-curve matrix harness — not
from intuition.

## What Stave handles for you (and what it can't)

The runtime now degrades **gracefully** under load, so a momentarily heavy scene
doesn't have to mean a janky editor or dropped audio. Three protections run
automatically:

- **Adaptive performance** (on by default — *Settings › Performance › Adaptive performance*).
  When frames actually start dropping, Stave's GPU-budget governor throttles each
  visualizer's rate, round-robins which ones draw on a given frame, and — under
  sustained pressure — drops their render resolution. It's a **no-op until things
  actually jank**, so a smooth 1–2 viz scene is untouched. This protects the
  *editor's* smoothness when many heavy viz saturate the GPU.
- **Quality mode** (*Settings › Visualization › Quality*: High / Balanced / Performance) lets
  you trade fidelity for headroom up front — it scales both render resolution
  **and** sketch density (segment count), the only lever that helps the
  CPU-tessellation line meshes below.
- **Shared sampling.** Many *light* visualizers no longer each re-read the audio
  analyser on the main thread — they share one read per frame, which keeps the
  audio scheduler healthy when you stack a lot of small viz.

What none of these can do is make a **single** sketch that draws too much per frame
cheap — the governor can only thin an already-overloaded scene, and quality mode
trades away fidelity. For a sketch that's heavy on its own, the segment budget below
is still the rule. Think of it as: *write to the budget; let Adaptive performance
catch the overflow.*

## The one rule that matters: count your line segments

For a sketch that draws a wireframe / mesh / many strokes, frame cost is
**linear in the number of line segments drawn per frame**, and almost nothing
else. Measured on a WEBGL terrain (`segments = rows·(cols−1) + cols·(rows−1)`):

| segments / frame | frame p95 | fps | scheduler |
| ---: | ---: | ---: | --- |
| 9 850 | 99 ms | 11 | starved (trig/s 8.4 → 5.8) |
| 4 900 | 54 ms | 20 | recovering |
| 2 920 | 37 ms | 28 | **healthy (trig/s 8.4, 0 long-tasks)** |
| 1 450 | 22 ms | 47 | healthy |

Rule of thumb: `frame_ms ≈ 9 + 0.0092 × segments`. **Keep a single instance
under ~3 000 segments** and it stops blocking audio. Halve your history depth or
column count and you halve the cost — directly.

p5 builds quad geometry for every thick-line segment **on the CPU** before
sending it to the GPU. That CPU tessellation is the cost. It scales with how
many segments you draw, full stop.

## What does NOT help (measured — don't waste time on these)

These are intuitive "optimizations" that the profiler shows do **nothing** (or
backfire) for CPU-tessellation-bound line meshes:

- **Batching `beginShape(LINES)`** to cut draw calls — *regresses* ~10%. The cost
  is per-segment, not per-call; batching to `LINES` doubles your segment count.
- **Retained `p5.Geometry`** — no help if the mesh changes every frame (e.g. a
  scrolling waveform). p5 re-tessellates a changed geometry each frame anyway.
- **Thinner `strokeWeight`** — p5 has no cheap thin-line path; even sub-1px lines
  tessellate to quads.
- **Lower resolution / smaller canvas** — *no effect at all* for line meshes.
  This cost is CPU, not pixels/fragments. (Resolution only helps fill-heavy or
  shader-heavy sketches.)
- **`POINTS` instead of lines** — *worse*, not better.

The only sketch-level lever is **drawing fewer segments**.

## Practical checklist

1. **Decimate.** Cap history length and grid density. A 50×30 mesh reads almost
   identically to 100×50 but costs a third as much. Draw only the rows *or* the
   columns of a grid, not both, when one direction carries the shape.
2. **Reuse buffers — never allocate in `draw()`.** Hoist analyser buffers to
   module scope and re-allocate only when the size changes:
   ```js
   let _wave = null
   function draw() {
     if (stave.analyser) {
       const n = stave.analyser.frequencyBinCount
       if (!_wave || _wave.length !== n) _wave = new Float32Array(n)
       stave.analyser.getFloatTimeDomainData(_wave)
       // …use _wave…
     }
   }
   ```
   (This is GC hygiene — the profiler shows the per-frame buffer cost itself is
   tiny, but it's the right habit and it's how the built-in `scope`/`fscope`/
   `spectrum` sketches are written. The *frame* cost lives in the drawing, above.)
3. **Read the analyser once per frame.** Don't call `getFloatTimeDomainData`
   twice — read into one buffer and share the result.
4. **Measure, don't guess.** Open the overlay with **`Alt+P`**. Watch
   **frame p95** and **long-tasks**, not mean fps (a uniformly-slow sketch shows
   0 dropped frames but still janks). If **`trig/s`** falls as you add viz, your
   sketch is choking the audio scheduler — decimate until it recovers.

## Where the work runs, and why the budget still holds

Audio DSP already runs off-thread (Web Audio / AudioWorklet). The renderer now
runs in an **OffscreenCanvas worker** by default, so viz `draw()` no longer
shares the main thread with the scheduler — that's the big win. Two reasons the
segment budget still matters:

- **Fallback.** On a browser that can't offload (no OffscreenCanvas /
  `transferControlToOffscreen`), or with the worker path disabled, the visualizer
  runs on the **main thread** — and there the scheduler tolerates jank only up to
  its look-ahead margin, so a `draw()` that blocks longer drops audio events.
- **The cost doesn't disappear off-thread.** A worker sketch over budget simply
  drops its own frames (under backpressure the worker's effective rate *is* its
  draw rate). The profiler bridges that cost back as the `viz.worker.draw`
  section — so `Alt+P` shows it whether the sketch runs on the worker or the main
  thread.

Decimate to the budget and the sketch is smooth on both paths.
