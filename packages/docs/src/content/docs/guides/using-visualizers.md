---
title: Using visualizers
description: Attach a visual to your music, tune its quality and resolution, let off-screen viz pause to save battery, and fix a blank or laggy canvas.
---

Stave can draw a live visual that reacts to your music — a spectrum, a shader, a
piano roll, or your own sketch. This guide covers attaching one and tuning it. For
writing a *fast* sketch, see [Writing fast viz sketches](/guides/viz-performance/).

## Attach a visual with `.viz()`

Add `.viz('name')` to any pattern. The visual appears inline, right under the
pattern, and lights up as that pattern plays:

```js
sound("bd sd bd sd").viz('spectrum')   // a built-in spectrum
sound("bd*4").viz('creation')          // a GPU shader
note("c e g b").viz('pianoroll')       // a piano roll of the notes
```

The name matches a built-in visual or any of your own viz files
(case-insensitive, ignoring spaces / dashes / underscores — so `Piano Roll.p5`
matches `.viz('pianoroll')`). Each runtime has its own page:
[p5.js](/runtimes/p5/), [Hydra](/runtimes/hydra/),
[GLSL / ShaderToy](/runtimes/glsl/).

Only the pattern you attach to drives the visual, so two patterns can carry two
different visuals at once.

## Quality and resolution

Open **File › Editor Settings...** and find the **Visualization** section. Two
controls trade smoothness for detail:

- **Quality** — **High**, **Balanced**, or **Performance**. This scales both
  the render resolution *and*, for sketches that support it, their drawing density
  (how much detail they draw). Drop to **Performance** if visuals stutter or the
  fans spin up; it's the one knob that helps every viz type.
- **Custom resolution** (marked **Advanced**, under Quality) — overrides the
  preset's render resolution: 256, 512, 768 or 1024 px, or a custom value.
  Higher is crisper but costs more **fill**.
  This helps shader- and fill-heavy visuals; it makes little difference to
  line-drawing sketches (those are limited by how many lines they draw, not
  pixels — that's what *quality*'s density does).

The resolution is independent of the on-screen size — a visual renders at the
chosen resolution and stretches to fit its panel, keeping its shape.

## Save battery: off-screen pause

A visual you can't see isn't worth spending power on, so Stave **pauses** any
visual that scrolls off-screen, sits in a collapsed panel, or is in a hidden
browser tab — and resumes it the moment it's visible again. It comes back exactly
where it left off; you don't need to do anything.

For a visual left off-screen a long time, the **Off-screen viz teardown** setting
(under **Performance**, on by default) goes further and *frees its memory and GPU context* after ~60s,
re-creating it when you scroll back. Turn it off if you'd rather visuals stay
instantly resident at the cost of more memory.

<aside>
Audio keeps playing while a tab is in the background — but only while the tab is
**making sound**. A long fully-silent stretch in a hidden tab can let the browser
throttle timing; keep the tab audible (or foreground) across silent sections.
</aside>

## Troubleshooting

**The canvas is blank.**
- If it's a custom sketch, check the **Console** panel — Stave surfaces sketch
  errors there for every visual type:
  - **p5** — a typo in `draw()` / `setup()` shows up (with the line).
  - **Hydra** — if a reactive function (`() => …`) throws, the message appears
    **with the line** (and that value defaults, so the rest keeps running).
  - **GLSL** — a shader that won't compile shows its error **with the line number**
    and falls back to a safe path; jump to that line, fix it, re-evaluate.
- Make sure the pattern is actually playing — a visual attached to a stopped or
  silent pattern has nothing to react to.
- For a standalone preview (a viz file opened in its own tab, not attached via
  `.viz()`), `stave.scheduler` / `stave.analyser` are empty by design — guard with
  `if (stave.scheduler) { … }`.

**It lags or stutters.**
- Set **Quality** to **Performance**.
- Lower **Custom resolution** if it's a shader or fill-heavy visual.
- If it's a line-mesh sketch, the fix is drawing *fewer segments* — see
  [Writing fast viz sketches](/guides/viz-performance/).
- Watch the audio: if playback gets choppy when a visual is on screen, that visual
  is too heavy for your machine — drop quality until audio is steady again.

**It feels low-fps but audio is fine.** That's usually intended — an off-screen or
background visual is paused, and on-screen ones are paced to their true draw rate.
Open the **performance overlay** (`Alt+P`) to see real frame timing.

**Check what's costing what.** `Alt+P` opens the performance overlay: frame p95,
long-tasks, and the per-visual draw cost. It's the honest source of truth when a
visual feels slow.
