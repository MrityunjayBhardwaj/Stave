# Viz renderer architecture

This is the contributor reference for Stave's visualizer system in `packages/editor/src/visualizers`. It describes the engine-agnostic contract every renderer (p5, hydra, GLSL, three.js) satisfies, plus the per-renderer specifics. (three.js, added in #2516, has no per-renderer section here yet; its sketch runtime is described at the top of `renderers/threeSketch.ts`.) Read it before adding a renderer, changing the worker boundary, or debugging a viz that mounts but doesn't paint.

This is an interim seed for the detailed contributor docs tracked in **issue #362**. The `file:line` citations below may drift as the code moves — when the code and this doc disagree, trust the code.

---

## Why a contract at all

Stave renders the same visualizer through **two host paths** (a main-thread renderer and an OffscreenCanvas Web Worker) and **multiple engines** (p5, hydra, GLSL). The only way that stays sane is a written contract: a small set of behaviors every renderer provides, so the per-frame and per-mount machinery (backpressure, fallback, visibility pausing, profiler bridging, GL-context accounting) is written **once**, kind-agnostically, and each new engine slots in by satisfying the contract rather than re-implementing the machinery.

## Two contracts, two threads

There are two interfaces. Keep them distinct.

| Interface | Side | File | Who implements it |
| --- | --- | --- | --- |
| `VizRenderer` | **main thread** | `types.ts:25` | `P5VizRenderer`, `HydraVizRenderer`, `WorkerVizRenderer`, and the decorators (`FallbackVizRenderer`, `TeardownOnPauseRenderer`) |
| `RendererStrategy` | **inside the worker** | `worker/hostP5Worker.ts:70` | the per-kind half of a worker mount — `mountP5`, `mountHydra`, `mountGLSL`, `mountThree` |

`VizRenderer` is the lifecycle the rest of the app drives:

```ts
// types.ts:25
export interface VizRenderer {
  mount(container, components, size, onError): void
  update(components): void   // re-bind live engine data each React render
  resize(w, h): void
  pause(): void
  resume(): void
  destroy(): void
}
```

`RendererStrategy` is the *kind-specific half* of one worker mount — everything else in the worker host is shared scaffolding wrapped around it:

```ts
// hostP5Worker.ts:70
interface RendererStrategy {
  setupDone: () => boolean      // true once the renderer can draw
  draw: () => void              // render exactly ONE frame; may throw
  resizeKind: (w, h, dpr) => void
  teardown: () => void          // belt-and-suspenders instance teardown
  gl?: () => GLLoseCtx | null   // the kind's live WebGL context, or null
}
```

**A new worker renderer is, by definition, a new `RendererStrategy`.** Fill in those five members against the shared host and every kind-agnostic seam below comes for free.

## The host: one worker, one kind, shared scaffolding

`hostVizWorker(scope)` (`hostP5Worker.ts:116`) is the bundler-agnostic worker host. One worker hosts exactly one kind; `mount` branches on `MountMessage.kind` and builds the matching strategy (`hostP5Worker.ts:255`):

```ts
// hostP5Worker.ts:255
const strategy =
  msg.kind === 'hydra'
    ? await mountHydra(msg, feed, rawAnalyser, rawScheduler, dpr)
    : await mountP5(msg, feed, rawAnalyser, rawScheduler, containerSizeRef, dpr)
```

The returned strategy is spread into a `MountState` and the per-frame reader is wired to `applyAndDraw` (`hostP5Worker.ts:273`). From here the host treats the renderer purely through the contract — it never knows whether it's driving p5, hydra, or GLSL.

> **Tier 1 vs Tier 2** — The one place a kind's *nature* leaks into the host is the canvas tier. **Tier 1**: the engine accepts the transferred `OffscreenCanvas` and renders into it directly, no blit (hydra `new Hydra({ canvas })` at `hostP5Worker.ts:419`; GLSL raw WebGL2; p5 now adopts it too). **Tier 2**: the engine makes its *own* canvases and `draw()` blits the output onto the presenting canvas with `transferFromImageBitmap(src.transferToImageBitmap())` (`hostP5Worker.ts:359`) — only the legacy/fallback p5 path. Tier is a property of the engine, not a new seam — both tiers satisfy the same `draw()` contract.

## The mount lifecycle — one choke point, two seams

On the main thread a viz attaches to the DOM at **two** seams, with no shared mount path between them:

1. **`mountVizRenderer`** — the picker (`useVizRenderer`/`VizPanel`), the backdrop (`compiledVizProvider`), and the crop preview (`CropPopup`).
2. **`viewZones`** — the inline `.viz()` Monaco zones.

The per-mount concerns that must attach to **every** renderer regardless of seam live in one function, `attachVizLifecycle` (`attachVizLifecycle.ts:34`):

```ts
// attachVizLifecycle.ts:42
try {
  renderer.mount(container, components, size, onError)
} catch (e) {
  if (opts.onMountError) opts.onMountError(e) // viewZones swallows; one bad zone ≠ all dead
  else throw e                                // mountVizRenderer's contract: propagate
}
// visibility pausing wires even after a swallowed mount error
return registerVizVisibility(renderer, container, opts.teardownMs ? { teardownMs } : undefined)
```

Both seams route through here: `mountVizRenderer.ts:32` calls it then adds a `ResizeObserver` (its container is CSS-sized); `viewZones` calls it directly and adds its Monaco-layout reflow, teardown-wrapper, crop, and decorations.

> **Per-mount concerns wire BOTH seams** — A per-mount concern wired into only one seam is **silently dead on the other**. If you add a concern that must attach to every mounted renderer (a new gauge, a new lifecycle hook), it goes in `attachVizLifecycle`, not at a call site. Concerns that genuinely *diverge* by seam (resize: `ResizeObserver` vs Monaco-layout reflow; the inline crop wrapper) correctly stay at the call site — the module boundary is the **shared subset**, not the union.

## The signal feed — one clock, 1:1 cadence

The worker draws **exactly one frame per signal frame it receives**. There is a single clock — and as of the shared frame pump it is *one* clock for **all** worker viz, not one per renderer: the single `requestAnimationFrame` loop in the `vizFramePump` singleton (`vizFramePump.ts:107`). Each `WorkerVizRenderer` no longer runs its own loop — `start()` just **registers** it with the pump (`WorkerVizRenderer.ts:387`); the pump drives each registered renderer's `pumpTick(ts, cache)` (`WorkerVizRenderer.ts:402`) once per tick, which samples the live feed and writes a frame to the worker. Cadence cannot drift because the worker never has its own loop — p5 is set to `noLoop()` (`hostP5Worker.ts:327`), hydra to `autoLoop:false` (`hostP5Worker.ts:425`), and GLSL likewise draws only when called.

```
vizFramePump — ONE rAF for ALL worker viz        each registered WorkerVizRenderer
──────────────────────────────────────           (per pumpTick, in registry order)
tick(ts)
  vizGovernor.observeFrame(ts)   // once
  cache = new FrameSampleCache() // once/tick      worker
  for r of registered:                             ──────────────────────────────
    r.pumpTick(ts, cache) ─────► gates (backpressure + maxFps + governor.mayProduce)
                                 sample(cache) ─ analyser read + scheduler query,
                                                 deduped across viz by the shared cache
                                 writeFrame(frame) ─► applyAndDraw(frame)
                                   frameAck ◄────────── (backpressure)
                                   feed.applyFrame(frame)  // bus tick
                                   refresh raw shims
                                   if setupDone && !paused:
                                     s.draw()   ← the ONLY kind-specific call
```

Inside the worker, `applyAndDraw` (`hostP5Worker.ts:492`) is the shared per-frame body. It does everything **except** the actual draw, which is the one line of contract:

```ts
// hostP5Worker.ts:507  — shared: one bus tick + refresh shims
s.feed.applyFrame(frame)
s.rawAnalyser.set(master)
s.rawScheduler.set(frame.rawScheduler)
if (!s.setupDone() || s.paused) return   // hostP5Worker.ts:513 — contract gate
// hostP5Worker.ts:516
s.draw()                                 // kind-specific; the only line that differs
```

> **The bus is ticked ONCE, by the feed** — `feed.applyFrame` owns the single per-frame bus tick. A renderer's `draw()` must **not** tick the bus again — `mountHydra`'s `draw()` calls `hydra.tick()` for a shader frame but explicitly does *not* re-tick the bus (`hostP5Worker.ts:474`). Double-ticking desyncs the named-signal values (`sig.fft`, `sig.kick`, …) from the audio. Read your audio from the already-refreshed shims; draw; return.

## Global produce-loop coordination — the pump and the governor

The per-renderer seams run *inside* one viz. Two **main-thread singletons** coordinate the produce loop **across all** worker viz at once. Neither is a renderer concern — a `RendererStrategy` is oblivious to both — but they shape the cadence that drives every `pumpTick`. Both are transparent no-ops in the common case and engage only under their respective pressure.

### The frame pump — shared cadence + a shared sampler

`vizFramePump` (`vizFramePump.ts`) owns the single rAF (above). Its second job is to **collapse duplicated sampling**. Each renderer used to read the analyser bytes and run the wide `scheduler.query` itself every frame — so N viz reading the *same* master analyser ran N identical reads. The pump builds **one `FrameSampleCache` per tick** (`vizFramePump.ts:115`) and passes it to every `pumpTick`; the sampler routes its reads through it (`signalSampler.ts:221`), so a read keyed by an analyser **object identity** runs once and each consumer gets a transfer-safe slice (`frameSampleCache.ts:48`). Scheduler queries dedupe the same way, by `(scheduler, window)` (`frameSampleCache.ts:70`).

> **Why a per-tick cache, not a fanned-out frame** — The obvious design (sample once, send one `SignalFrame` to all N workers) is **impossible**: `frameTransferables` *detaches* the byte buffers on transfer, so only the first `writeFrame` would get real bytes; and inline zones bind **per-track** (`viewZones.ts:341`), so each viz's scheduler / bumps / seq are genuinely its own. So the shared unit is the *read*, not the *frame*: each renderer still builds its own frame (byte-identical reactivity), and only the expensive shared read is deduped. The win is **regime-scoped** — it fires only when viz sample on the *same* tick, which heavy (backpressure-paced) viz rarely do, so the cache mostly helps the **many-light-viz** case (measured: reads/frame 11→5, scheduler trig/s 5.0→8.5 at N=8). A/B with `localStorage['stave.viz.pump']='0'`.

> **Dedupe is not the whole cost — the wide query only runs for kinds that read it** — The cache makes N viz pay for *one* wide `scheduler.query` (now−4 to now+2 cycles) per tick, but that one query walks the whole song, so its cost grows with the song, not the viz count. With a dense song (a 39-track, 24-bar song at 120 bpm) and one three.js background it was **16.2 s of 20.6 s** on the main thread during Play (#2561). The query only exists to feed `stave.scheduler`, which only **p5** and **hydra** sketches are handed. So each `WorkerVizRenderer` builds its sampler with `kindReadsRawScheduler(kind)` (`renderers/WorkerVizRenderer.ts`): p5, hydra, three.js (since #2570) and GLSL (since #2571, as the `uNotes` texture — see [Upcoming notes](#upcoming-notes--unotes-and-stavenotei)) → on. With the rolling window, turning three.js on cost ~0.12 s per 20 s of the main thread on a dense song (interleaved A/B, no change in frame rate). The narrow active-at-now queries that `sig` and the `u*` uniforms read still run for every kind.

> **The wide window rolls instead of re-querying** — For p5/hydra the window is kept by `RollingHapWindow` (`worker/rollingHapWindow.ts`, #2563): one full query when the window starts (or after a re-evaluate, a jump backwards, or a jump past the window), then only the new slice at the front, fetched half a cycle ahead, keeping notes whose onset is in the slice and dropping notes that end behind the window. Every Strudel query pays a fixed cost to walk the whole pattern tree however short its span, which is why the slice is prefetched rather than taken per frame. On the same dense song with a p5 scope or piano roll background: 314 / 46 long tasks in ~20 s of Play before, 0 after; main rAF p90 back to the no-viz baseline. Event `begin`/`end` are the note's whole span, so slices stitch exactly; window edges are floats that Strudel snaps to Fractions, so edges compare with a 1e-6 tolerance (see the file's header).

> **"What's playing now" is re-queried only when it can change** — `sig` and the `u*` uniforms read the active-at-now haps (`query(now, now + ε)`) for the combined pattern and **every track**: ~2,400 Strudel queries a second with 40 tracks, each paying the fixed tree walk. That answer only changes when a note starts (`begin − ε`) or ends (`end`), so `ActiveNowCache` (`worker/activeNowCache.ts`, #2567) keeps each scheduler's upcoming notes in a `RollingHapWindow` and runs the real now-query only when `now` reaches the next start or end it knows of (or the window's fetched edge), reusing that exact answer until then. The answer is always a real query's output, so fragments and duplicates match a per-frame query. Measured on the same song: time in the sampler 3.3 → 0.7 s of ~20.6 s with a three.js background, 4.2 → 0.9 s with scope.p5.

### The GPU-budget governor — degrade under jank

Per-viz backpressure bounds each viz to its *own* worker's draw rate, but N viz each pacing independently still **sum** to total GPU saturation — 5 heavy GLSL viz drove the compositor to ~95% dropped frames, janking the whole editor while the main thread sat *idle* (GPU-bound, not main-bound). `vizGovernor` (`vizGovernor.ts`) is the global frame-budget coordinator. Every `pumpTick` feeds it the rAF cadence (`observeFrame`, `vizGovernor.ts:168`), from which it derives a `stress` 0..1, and gates each viz's produce (`mayProduce`, `vizGovernor.ts:188`) with three levers that scale with stress:

1. **Adaptive fps floor** — raise each viz's minimum frame gap (catches even one heavy viz).
2. **Round-robin concurrency** — spread which viz may produce on each frame, so N heavy viz don't all hit the GPU on the same one.
3. **Resolution drop** — under sustained stress shrink each worker's backing store (`resolutionScale`, `vizGovernor.ts:217`; the renderer re-posts a scaled `resize`, `WorkerVizRenderer.ts:287`) — the fill-bound lever the fps throttle can't reach.

> **The governor is a no-op until frames actually drop** — At `stress === 0` (1–2 light viz) `mayProduce` always returns true, the gap is 0, resolution is full — so the governor cannot regress steady-state behavior; it engages **only** once frames drop. It's the "Adaptive performance" settings toggle (default on, persisted under `stave.viz.governor`). Known limit: `stress` is derived from the main-thread rAF, which stays nominal under *moderate* compositor saturation, so the levers under-engage there until rAF itself degrades — blend in a GPU-load proxy to sharpen it. Orthogonal to the pump: the governor cuts **GPU** load (heavy viz); the pump cuts **main-thread** sample cost (many light viz).

**Verified by** `viz-scroll-jank-governor.spec.ts` (governor ON drops fewer compositor frames than OFF under 5 heavy GLSL viz) and `viz-shared-pump-observe.spec.ts` (the shared cache recovers scheduler headroom under many light viz).

## The kind-agnostic seams

These are the behaviors the shared host applies to **every** strategy. A new renderer gets all of them for free *if* it honors the contract. Each is a thing to verify when you add a kind.

### 1. GL-context accounting and release

The worker reports its live WebGL contexts so the main thread can drive a `viz.glctx` gauge, and it **explicitly loses** the context on teardown so a pooled warm worker doesn't retain it toward Chrome's ~16-context cap.

This is the entire reason `gl?()` exists on the contract. After the first successful frame the host calls `accountGL` (`hostP5Worker.ts:528`), which reads `strategy.gl()`, grabs the `WEBGL_lose_context` extension, and posts `glctx+` (`hostP5Worker.ts:176`). On `destroy`, `releaseGL` (`hostP5Worker.ts:190`) calls `loseContext()` (`hostP5Worker.ts:196`). p5 returns its WEBGL `drawingContext` (`hostP5Worker.ts:350`); hydra re-gets the presenting canvas's `webgl2`/`webgl` context (`hostP5Worker.ts:455`); a 2D sketch returns a context whose `getExtension` yields null and is simply not accounted.

**Verified by** `hydra-path-coverage.spec.ts` (the raw-WebGL `gl()` accessor) and `phase-b-verify.spec.ts`.

### 2. The draw-cost profiler bridge

The default viz path is the worker, whose bundle never imported the main `perf` profiler — so `s.draw()` cost was a profiler blind spot. The host times each draw and piggybacks the duration onto the **next** `frameAck`; the main side records it as the `viz.worker.draw` section.

```ts
// hostP5Worker.ts:514  — time the draw
const drawT0 = performance.now()
s.draw()
lastDrawMs = performance.now() - drawT0      // hostP5Worker.ts:523
// hostP5Worker.ts:502  — the NEXT ack carries it (sent on receipt, before this draw)
scope.postMessage({ type: 'frameAck', drawMs: lastDrawMs })
```

Main side (`WorkerVizRenderer.ts:201`): `if (typeof d.drawMs === 'number') perf.record('viz.worker.draw', d.drawMs)`. Because the timing wraps the *contract's* `draw()` and not any kind-specific internals, it is automatically kind-agnostic — `s.draw()` for GLSL is timed exactly the same.

> **Per-thread metrics are invisible until bridged** — A metric measured on one thread does not appear in the other thread's snapshot until something explicitly carries it across. This per-thread-invisibility family has recurred for the worker draw cost, worker errors, and config. Any *new* worker-side number you care about needs its own bridge; the existing `drawMs` piggyback covers draw cost for any kind.

**Verified by** `viz-worker-draw-section.spec.ts` (the section populates from a live worker) and `hydra-path-coverage.spec.ts` (kind-agnostic `s.draw()` timing on hydra).

### 3. Live config marshal

The worker runs its **own** `vizConfig` singleton (the worker bundle can't share the main module instance). So the main thread marshals a **subset** of config across the boundary, applied with **merge** (never reset), at mount and on every later change:

```ts
// vizConfig.ts:353 — only these keys cross the boundary
export const WORKER_VIZ_CONFIG_KEYS = ['hydraAudioBins', 'density'] as const
```

At mount the subset ships in the `MountMessage` (`WorkerVizRenderer.ts:254`, `pickWorkerVizConfig()`), and the worker applies it *before* building the sketch (`hostP5Worker.ts:245`) so the first frame already sees the user's settings. A later quality/LOD change re-ships via a `config` message (`WorkerVizRenderer.ts:261`) and the worker **merges** it onto its singleton (`hostP5Worker.ts:232` → `updateVizConfig`, `vizConfig.ts:321`) — no remount.

> **Merge, never reset** — `updateVizConfig` takes a *partial* patch and merges. An incremental `{ density }` patch must not wipe a prior `hydraAudioBins`. If a renderer adds a config key it reads in the worker, that key must be added to `WORKER_VIZ_CONFIG_KEYS` or the worker silently runs on the bundle default. `maxFps`/`maxDpr` are deliberately *excluded*: the main `WorkerVizRenderer` paces and sizes, so the worker never needs them.

**Verified by** `viz-density-lod.spec.ts` (the live `density` marshal moves the cost curve with no remount) and `hydra-path-coverage.spec.ts` (`hydraAudioBins` read from the marshalled config).

### 4. Backpressure — bounded frames in flight

The main rAF can fire at 120fps while a heavy-WebGL worker draws at ~20fps. Without a bound the surplus backlogs in the worker's message queue and it renders seconds-stale data (looks "static"). The fix is a small cap on unacked frames:

```ts
// WorkerVizRenderer.ts:66
const MAX_FRAMES_IN_FLIGHT = 2
```

The worker acks **every** received frame on receipt (`hostP5Worker.ts:502`), even a pre-setup frame that doesn't draw — otherwise the bounded pipeline deadlocks before p5's async setup completes. The main side only produces while `inFlight < MAX_FRAMES_IN_FLIGHT` (`WorkerVizRenderer.ts:434`), so the worker's queue stays ~1 frame deep and it always draws the freshest sampled frame.

> **Note:** The fps cap is downstream of backpressure. Because production is gated by acks, the worker's *effective* frame rate is its true draw rate, not the display rate or the `maxFps` cap. A renderer doesn't implement backpressure — it just has to `draw()` once per `applyAndDraw` and let the ack flow.

### 5. Startup fallback to the main thread

A worker that throws at import/compile/first-draw, or hangs, must not leave a blank pane. `FallbackVizRenderer` wraps the worker renderer with a startup probation:

- mount the worker, arm `whenReady` + an 8s timer (`FallbackVizRenderer.ts:36`).
- first successful worker frame posts `ready` (`hostP5Worker.ts:526`) → HEALTHY; clear the timer. Later (user-sketch) errors surface normally — they do **not** trigger fallback.
- a fatal error *before* `ready`, or the timeout → tear down the worker attempt, clear the container, mount the proven main-thread renderer with the same components/size (`FallbackVizRenderer.ts:102`).

This is why the contract's first successful `draw()` must post `ready` (`hostP5Worker.ts:525`) — it is the liveness signal the probation waits on. A renderer that can't reach a first frame correctly degrades to its main-thread twin. (Both factories wire this: `makeP5Renderer.ts:48`, `makeHydraRenderer.ts:32`.)

### 6. Visibility pausing and off-screen teardown

A viz that's scrolled off-screen, in a collapsed pane, or in a hidden tab runs its whole pipeline for output nobody sees. `registerVizVisibility` (`vizVisibility.ts:98`) pauses a renderer when it's **not** (on-screen AND tab-visible) and resumes on return — firing only on a state transition (`vizVisibility.ts:66`). `pause()` stops the main sample loop and tells the worker (`WorkerVizRenderer.ts:297`); the worker just sets `paused` (`hostP5Worker.ts:221`) and the `applyAndDraw` gate (`hostP5Worker.ts:513`) skips the draw.

> **Pause HOLDS the worker; only destroy reclaims it** — `pause()` halts the draw loop but **holds** the worker + GL context + ~100MB. For a zone left off-screen a long time that's pure waste, so `TeardownOnPauseRenderer` (`TeardownOnPauseRenderer.ts:106`) escalates a sustained *off-screen* pause into a real `destroy()` and transparently re-creates the inner renderer on return (`TeardownOnPauseRenderer.ts:114`). The timer is **off-screen-only** — a tab-hidden-but-on-screen viz pauses without tearing down (`vizVisibility.ts:54`). Opt-in per seam via `teardownMs` (only the inline path passes it).

**Verified by** `phase-c-pause-observe.spec.ts` (the `viz.worker.sample` count freezes while paused, both off-screen and tab-hidden) and `high-n-headroom.spec.ts` (the memory/GL-context ceiling that motivates the teardown).

### 7. The selection gate

Whether the worker path is used at all is one shared decision (`makeP5Renderer.ts:36`), used by every kind's factory so they choose identically:

```ts
// makeP5Renderer.ts:36
export function shouldUseWorkerRenderer(): boolean {
  return (
    getVizConfig().workerRenderer &&            // flag on
    getVizWorkerFactory() !== null &&           // app registered a worker factory
    detectWorkerVizCapabilities().transport !== 'main-thread'  // browser can offload
  )
}
```

A new worker renderer's factory calls the same gate and wraps the worker renderer in `FallbackVizRenderer` when it passes, else builds the main-thread renderer directly. There is no kind-specific force-to-main.

## What a new renderer must provide

To add a renderer kind to the worker host, provide a `RendererStrategy` (`hostP5Worker.ts:70`) whose members satisfy:

1. **`setupDone()`** — return true once a frame can be drawn (sync engines return `true` immediately, as hydra does at `hostP5Worker.ts:452`; async engines flip it when ready, as p5 does at `hostP5Worker.ts:331`).
2. **`draw()`** — render **exactly one** frame from the already-refreshed shims. Read audio from `rawAnalyser` / the named-signal bus; do **not** tick the bus. May throw — the host catches, re-emits to the main log, and suppresses `ready`. This host catch is necessary but **not sufficient** — see [Error-surfacing is a per-runtime obligation](#error-surfacing-is-a-per-runtime-obligation).
3. **`resizeKind(w, h, dpr)`** — apply a new size to the renderer and the presenting canvas. Tier-1 sizes the transferred canvas directly; Tier-2 sizes its blit target.
4. **`teardown()`** — neutralize the instance so a destroy mid-flight can't paint.
5. **`gl?()`** — return the live WebGL context (or null) so the host can account and lose it.
6. **Which raw feeds the kind hands its sketches** — this is not a strategy member, but it decides what the main thread pays every frame for your kind. The shared sampler runs on the **main thread** (the one that schedules the music), so every feed it prepares is per-frame main-thread work whether or not your sketches can read it. If your kind does **not** expose `stave.scheduler`, add it as `false` to `kindReadsRawScheduler` (`renderers/WorkerVizRenderer.ts`) — otherwise every frame walks the whole song for nothing (#2561). Then measure: long tasks and main rAF p90 during Play with a dense song, with and without your viz; the two should match.

Provide a `mountX` that builds the strategy, add `kind: 'x'` to `MountMessage`, and a `makeXRenderer` mirroring `makeHydraRenderer` (`makeHydraRenderer.ts:31`). Everything in [The kind-agnostic seams](#the-kind-agnostic-seams) then applies automatically.

> **Note:** Adding a kind also means threading it through the scattered language↔renderer sites (file type, Monaco lang, preview provider, example seed). The easily-missed one is the **named-viz registration filter** — miss it and the file silently just doesn't resolve, no error.

### Error-surfacing is a per-runtime obligation

A user-authored sketch error (a typo, an undeclared symbol, a wrong API) **must** reach the main Console (a `runtime`-tagged `emitLog` entry → Console panel + a squiggle where a line is available), not only the devtools console. A blank viz with no in-app feedback is the worst authoring experience, and it's why the host wraps `draw()` at all.

But the host's `draw()` catch is **necessary, not sufficient** — each runtime *swallows* user errors by a different mechanism, at a different point. A single shared hook can't cover them; each kind needs its own, verified by observation:

| Runtime | What the user error is | How it's swallowed | Where Stave surfaces it |
| --- | --- | --- | --- |
| **p5** | a `draw()` / `setup()` throw (runtime) | p5Compiler's lifecycle try/catch → worker-local `engineLog` | `subscribeLog` → `vizlog` → main `emitLog` |
| **hydra** | a reactive-fn throw (runtime) | hydra-synth's per-uniform try/catch → `console.warn` + default | patch the worker `console.warn`, re-emit via `vizlog`, **with the editor line** |
| **GLSL** | a shader compile/link failure (**mount-time**) | throws → fallback → main `GLSLVizRenderer` `console.error` | `emitLog` at the terminal compile catch, **with the editor line** |

All three now surface **with a source line**, so the Console error lights an editor squiggle. The line comes from a different place each time, mapped back through that runtime's wrapper: p5 and hydra parse the thrown Error's stack (`parseStackLocation` − the `new Function` header offset; hydra's frame is the V8 *eval-wrapper* shape, `eval at compileHydraCode (…), <anonymous>:L:C`), GLSL parses its compiler info-log `0:N` (− the shader preamble). When you add a fourth kind, ask **how does *this* runtime hide a user mistake**, surface it at that point, and map its line through its own wrapper — a clean sketch must surface nothing (no over-capture) and a broken one must surface its own error end-to-end *with a line*. Gates: `worker-draw-error.spec.ts` (p5), `hydra-path-coverage.spec.ts`, `glsl-path-coverage.spec.ts`.

## Validated by the GLSL renderer

The contract above was written **before** the GLSL renderer existed — as a spec, to be tested. The test: implement the *simplest possible* kind (single-pass GLSL/ShaderToy — raw WebGL2, fullscreen triangle + fragment shader, Tier-1 direct-to-canvas, zero library) against the contract and see whether it slots in with **no new shared seam**. It did:

- **All five `RendererStrategy` members + all seven kind-agnostic seams were satisfied with zero change to the shared host.** GLSL's `gl()` is the most trivial of the three (the raw context it created); `setupDone()` is synchronous; and because a GPU `draw()` runs no per-frame user JS, the draw-error seam has nothing to catch.
- **The audio-feed seam — flagged as the most likely place to need generalizing — held.** `mountGLSL` reads the **same** already-refreshed `rawAnalyser` hydra reads and uploads it to an `iChannel0` texture *internally* (`hostP5Worker.ts:517`). The kind-agnostic `AudioByteSource` interface (`glslCore.ts:32`) covered it; no host change.
- **The one new thing was kind-specific, not shared.** GLSL added **pattern-event uniforms** (`uKick`, `uSnare`, …) — turning named-signal-bus values into shader uniforms. This lives **entirely inside the strategy's `draw()`** (`readGLSLEvents`, `glslEvents.ts:21`), exactly like p5's blit or hydra's `s.a.fft` fill. A *kind-specific marshal*, not a new shared-host seam — sourced from data the host already prepares (the ticked `feed.bus`). Contract confirmed, not amended.

---

## Renderer: p5.js

p5 is the **hardest** kind: it makes its own canvases, needs a DOM shim to run in a worker at all, and its `draw()` can throw user code.

### Canvas tier — Tier A direct render

p5 renders **directly into the transferred display canvas** (same as hydra/GLSL) — no blit, no per-frame clear. The catch: p5 v2's `#_setup` **always** creates an internal default `createCanvas(100, 100, P2D)` *before* the user's `setup()` runs, so the FIRST `createElement('canvas')` is a throwaway, **not** the display canvas. The host wraps `createCanvas`: call #1 (the default) keeps a fresh worker-local canvas; call #2 (the user's main `createCanvas`) gets `wrapCanvas(msg.canvas)` injected as the renderer's `elt` (`Renderer{2D,3D}` does `this.canvas = elt || createElement`), so p5 adopts the on-screen `OffscreenCanvas` as its main canvas (`hostP5Worker.ts`, the `directCanvas` adopter). `createGraphics()` goes through `new p5.Graphics` (not `createCanvas`), so its buffers stay separate worker-local surfaces.

Because the canvas is never transferred out, it **persists** frame-to-frame: a `draw()` that reads it back (`getImageData`/`loadPixels`/`get()`) or skips a full `background()` (trails/feedback) behaves exactly as on the main thread. The old per-frame blit survives only as a fallback for a sketch that never calls `createCanvas` (only the 100×100 default exists → nothing adopted `msg.canvas`), and behind the `localStorage['stave.viz.p5direct']='0'` escape hatch.

> **Main-canvas readback + trails now work worker == main** — This used to be the **transfer-clear limitation**: `transferToImageBitmap()` is destructive — it moved the bitmap *out* of p5's render canvas and left it cleared, so readback/trails went **silently blank** in the worker. Tier A removes it at the root: p5 owns the persistent display canvas, so readback and skip-`background()` trails just work. Proven by `viz-worker-p5-direct.spec.ts` (readback/trail/WEBGL/createGraphics, worker == main, compositor pixels) and the flipped `viz-worker-readback.spec.ts` (the worker arm now PAINTS).

### The worker DOM shim

p5 v2 **can** render WEBGL to an `OffscreenCanvas` in a worker — given a small, fixed DOM shim installed **before** the import (`hostP5Worker.ts:293`, `installWorkerDomShim`). The load-bearing conditions:

1. **shim before import** — `installWorkerDomShim` runs before `await import('p5')` (`hostP5Worker.ts:293`).
2. **`disableFriendlyErrors = true`** — p5's FES reads `location`/`document.lang` at import; disabling it sidesteps the i18n path (`hostP5Worker.ts:296`).
3. **a fresh wrapped `OffscreenCanvas` per `createElement('canvas')`** (`hostP5Worker.ts`, `makeCanvasEl`) — used for the throwaway default + every `createGraphics()` buffer; the user's main `createCanvas` instead adopts the transferred display canvas.

The shim also defines `HTMLCanvasElement`/`localStorage`/`document.fonts` globals p5 references (`createGraphics`, `storeItem`/`getItem`, `loadFont`) — bare references that otherwise throw `ReferenceError`/`TypeError` every frame off-main.

> **A library's worker-DOM shim is BUILD-specific** — The shim surface a prebuilt/minified POC needs can differ from the **bundled prod build** — the Next-bundled p5 re-runs i18next FES code that reads `location.search` / `documentElement.lang` at import. Harden the shim against the build that actually ships, not the POC min. The `@stave/editor/worker` subpath + DI + `app new Worker(new URL(...))` wiring exists for exactly this reason.

The shim also degrades **`save()` / `saveCanvas()` / `saveGif()`** to a clean no-op: p5's `saveCanvas` calls `htmlCanvas.toBlob(cb)` (an `OffscreenCanvas` only has `convertToBlob`) then `createElement('a').click()`. The shim bridges `wrapCanvas.toBlob`→`convertToBlob` and gives the anchor a no-op `click()`, so save() no longer throws `toBlob is not a function` — a worker can't trigger a browser download, so it silently skips. Gate: `viz-worker-save.spec.ts`.

### The audio + signal feed

The compiler reads `stave.analyser` / `stave.scheduler` off ref cells (`hostP5Worker.ts:304`) — the **same** contract `P5VizRenderer` uses on the main thread, so the sketch can't tell it's in a worker. The named-signal `sig.*` bus is built with `buildStaveUniforms(feed.bus)` (`hostP5Worker.ts:300`); the bus is ticked once by `feed.applyFrame`, and `onTick`/`__tick` is a no-op so the sketch never double-ticks. Raw `hapStream` access isn't marshalled → `null`.

### Draw cadence — host-driven `redraw()`, p5 on `noLoop()`

After the user's `setup()` runs, the host wraps it to call `p.noLoop()` (`hostP5Worker.ts:330`) so p5's auto-loop is off and **we** drive one `inst.redraw()` per frame (`hostP5Worker.ts:355`) — 1:1 with the host's signal frame. `setupDone()` flips `true` only after that wrapped setup runs (`hostP5Worker.ts:334`), so the contract gate holds frames until p5's async setup completes.

### The density LOD lever

For CPU-tessellated line meshes, frame cost is **linear in segment count** and almost nothing else — p5 builds quad geometry per thick-line segment on the CPU. That makes `sig.density` the one effective quality lever (a sketch reads `sig.density` to scale its segment/grid count). It crosses the worker boundary in the marshalled config subset (`density` ∈ `WORKER_VIZ_CONFIG_KEYS`, `vizConfig.ts:353`), applied with **merge** at mount and on every quality change — no remount.

> **Resolution doesn't help line meshes; density does** — Lower resolution / smaller canvas has *no effect* on a CPU-tessellation-bound line mesh — that cost is CPU, not pixels (the inverse of hydra's GPU-fill case). `density` does move `viz.worker.draw` because it changes how many segments p5 tessellates (`viz-density-lod.spec.ts`).

### The five strategy members for p5

| Member | p5 implementation | Where |
| --- | --- | --- |
| `setupDone()` | `true` after the wrapped `setup()` runs (async) | `hostP5Worker.ts:350` |
| `draw()` | `inst.redraw()` then blit the render canvas → presenting canvas (legacy path) | `hostP5Worker.ts:354` |
| `resizeKind(w,h,dpr)` | resize the presenting canvas (×dpr) + `inst.resizeCanvas(w,h)` | `hostP5Worker.ts:367` |
| `teardown()` | neutralize p5's async `#_setup` chain so a destroy mid-flight can't paint | `hostP5Worker.ts:374` |
| `gl?()` | `inst.drawingContext` — WEBGL context, or a 2D context whose `getExtension` yields null (not accounted) | `hostP5Worker.ts:353` |

### Gotcha — a user `draw()` throw is double-swallowed

A `draw()` typo in the worker (e.g. `stave.fft.length` — wrong namespace) gives a silent blank canvas: no console error, no diag. The obvious hypothesis ("the host's `try { s.draw() } catch` reports it") is wrong **twice**:

1. **Upstream catch beats the host catch.** `p5Compiler` wraps each user lifecycle hook in its *own* try/catch that reports to `engineLog` and swallows the throw — so it never reaches the host's `s.draw()` catch. (And p5's `redraw()` is `async`, so even unwrapped the throw is a rejected promise the *synchronous* host catch can't see.)
2. **A module singleton doesn't cross the worker boundary.** That wrap reported to `engineLog` — but `engineLog` is a module-level pub/sub, and the **worker bundle has its own instance**, disconnected from the main `engineLog` that feeds the Console. "It's reported" was true *in the worker*, invisible on main.

> **The fix: re-emit across the boundary, and split the channels** — The worker subscribes to its local `engineLog` and posts each error across to the main `emitLog` (`vizlog`). The channels are separate: **fatal/mount** errors → `diag`→`onError`→fallback (tear the worker down); **runtime** draw/setup errors → `vizlog`→main `emitLog` (surface, do **not** fall back — a post-`ready` user typo must not kill the worker). Verified by `worker-draw-error.spec.ts` (one error surfaced, no fallback). p5 was the *original* of the error-surfacing triad — hydra (library-swallowed) and GLSL (mount-time compile) caught up.

**Verified by** `worker-draw-error.spec.ts` (user-throw surfacing), `viz-density-lod.spec.ts` (density moves the cost curve, no remount), and the p5 worker-path coverage gates.

---

## Renderer: Hydra

How a `hydra-synth` instance fills in the five `RendererStrategy` members and where its quirks bite.

### Canvas tier — Tier-1 direct

Hydra **accepts the transferred `OffscreenCanvas`** and renders into it directly, no blit. `mountHydra` constructs the synth with `{ canvas: msg.canvas }` (`hostP5Worker.ts:423`) after sizing the presenting canvas to CSS px (`hostP5Worker.ts:420`) — it does **not** dpr-scale, matching the main-thread `HydraVizRenderer`. Because it's the worker's presenting surface, the GL context hydra (regl) creates is exactly the one the host accounts.

The instance is configured for worker life (`hostP5Worker.ts:423`):

- `detectAudio: false` — no Meyda / `getUserMedia` / `AudioContext` in the worker (we feed `s.a.fft` ourselves);
- `makeGlobal: false` — generators live on `hydra.synth`, not the global scope;
- `autoLoop: false` — **we** drive `tick()` once per frame (1:1);
- `enableStreamCapture: false` — an `OffscreenCanvas` has no `captureStream`.

> **The DOM shim is smaller than p5's** — `hydra-synth` touches `window` at module-eval (`mouseListen`), so a 2-part shim (a `window = self` alias + a thin `document`) is installed *before* the import (`hostP5Worker.ts:405`, `installWorkerHydraShim`). That's far less than p5's shim — hydra needs `window`/`document` to exist, not a full canvas-element factory, because it renders into the canvas we hand it rather than creating its own.

### The audio feed — `s.a.fft[]` from the master analyser

A hydra sketch reads audio via `a.fft[i]`. With `detectAudio:false` there's no analyser inside hydra, so the strategy's `draw()` fills `s.a.fft[]` itself each frame from the master analyser bytes (`hostP5Worker.ts:462`), mirroring the main-thread `pumpAudio`. The byte buffer is downsampled to `getVizConfig().hydraAudioBins` bins (`hostP5Worker.ts:470`), normalized to `0..1`, into a scratch buffer allocated once (`hostP5Worker.ts:453`). The bin count comes across the worker boundary in the marshalled config subset (`hydraAudioBins` ∈ `WORKER_VIZ_CONFIG_KEYS`).

The named-signal **bus** (`sig.*` + per-track access) is built into the hydra bag at mount (`hostP5Worker.ts:411`, `buildHydraStaveBag(feed.bus)`); the bus is ticked once per frame by `feed.applyFrame`, so `draw()` must **not** tick it again (`hostP5Worker.ts:478`).

### Draw cadence — host-driven `tick()`

`draw()` is one shader frame: fill `s.a.fft`, then `hydra.tick(performance.now())` (`hostP5Worker.ts:479`). There is no internal loop (`autoLoop:false`), so cadence is exactly the host's 1:1 contract.

### The five strategy members for Hydra

| Member | Hydra implementation | Where |
| --- | --- | --- |
| `setupDone()` | `true` immediately — the user pattern ran synchronously at mount | `hostP5Worker.ts:456` |
| `draw()` | refill `s.a.fft`, `hydra.tick()` — one shader frame | `hostP5Worker.ts:462` |
| `resizeKind(w,h)` | resize the transferred canvas + `hydra.setResolution(w,h)` | `hostP5Worker.ts:481` |
| `teardown()` | `hydra.synth.hush()` | `hostP5Worker.ts:486` |
| `gl?()` | re-get `webgl2`/`webgl` from the presenting canvas (regl owns it) | `hostP5Worker.ts:459` |

> **Built-in hydra sketches are NOT worker-routed** — The worker compiles a hydra *code string* (`compileHydraCode(msg.code)`, `hostP5Worker.ts:450`). Built-in hydra sketches that ship as **closures** can't be serialized across the worker boundary, so they're deferred to the main-thread path for now. A `.hydra` *file* (a string) routes through the worker fine.

### Gotcha 1 — hydra swallows user errors *inside the library*

A hydra reactive arrow that throws (e.g. `.rotate(() => { throw … })`) does **not** reach the host's draw catch on its own, because `hydra-synth` wraps every reactive-fn uniform evaluation in its own try/catch (`format-arguments.js:82`: `catch (e) { console.warn('ERROR', e); return input.default }`). The throw is caught *inside hydra*, logged to `console.warn`, and the uniform falls back to its default — so it never propagates out of `hydra.tick()`, never reaches the host's shared `s.draw()` catch, never re-emits via `vizlog`. The host catch only fires for **engine-level** throws (regl / GL / context-lost).

**The fix:** rather than fight the library, Stave patches the worker's `console.warn` once — while a hydra sketch is live (`currentRuntimeRef.kind === 'hydra'`), it recognises hydra's two user-error markers (`'ERROR'` → error, `'function does not return a number'` → warn), re-emits them through the same deduped `postVizLog` → `vizlog` → main `emitLog` path a p5 typo uses, then always delegates to the real `console.warn`. Gated on kind + the exact marker, so p5/other warns and hydra/regl internals pass through untouched. The error appears in the Console **including the source line**: the thrown Error's stack points into the `new Function` body (`at … eval at compileHydraCode (…), <anonymous>:L:C`), which `parseStackLocation` maps back through the 2-line header (`getHydraLineOffset`) to the editor line. (The V8 *eval-wrapper* frame is a distinct stack shape the shared `parseStackLocation` learned for this.)

> **Before asserting 'X surfaces an error,' check who swallows it first** — The original draw-error-surfacing comment *implied* parity across kinds — an inference observation disproved (a probe showed hydra's `engineLog` errors === 0). The detection rule that found the real gap: grep the runtime library's arg/uniform eval for a try/catch before claiming an error surfaces. `hydra-path-coverage.spec.ts` now **asserts the fix**: a clean sketch surfaces 0 (no over-capture), a throwing reactive fn surfaces ≥1 carrying its thrown text end-to-end. (A throw on **frame 1** never reaches `ready` → that's the *fallback* path, different again.)

### Gotcha 2 — resolution doesn't move `viz.worker.draw`

Dropping inline-viz resolution 1024→256 (16× fewer fragments) does **not** change a hydra viz's `viz.worker.draw` p95 — it stays ~0.06–0.13 ms at both. Because hydra is Tier-1, `hydra.tick()` only **dispatches** GPU work (issues draw calls and returns); the per-fragment fill runs **async on the GPU**. The profiler times the CPU wall-time of `s.draw()` — the dispatch — which is fragment-count-independent.

> **Don't mirror the p5 density assertion onto hydra** — Contrast p5's line meshes, where the cost is CPU-side JS tessellation, so `density` *does* move `viz.worker.draw`. Hydra is the opposite class — GPU-fill-bound. To gauge hydra fill cost, measure the worker's actual frame **rate** under saturation, not the dispatch section. Verified flat across res in `hydra-path-coverage.spec.ts`.

**Verified by** `hydra-path-coverage.spec.ts` (the worker `gl()` accessor, kind-agnostic `s.draw()` timing, the error re-surfacing, the flat-cost) and `hydra-visual-gate.spec.ts` (the worker canvas actually paints, audio-reactive).

---

## Renderer: GLSL

The **simplest possible** instance of the contract: raw WebGL2, a fullscreen triangle, one fragment shader, **zero library**, Tier-1 direct-to-canvas. It was built to *test* the contract — if the simplest kind slots into every seam with no new shared machinery, the abstraction is genuinely engine-agnostic (it does — see [Validated by the GLSL renderer](#validated-by-the-glsl-renderer)). It is also the **performance floor**: no CPU tessellation (unlike p5), no library overhead (unlike hydra) — just GPU fill.

### One core, two hosts

Both host paths drive a single shared pipeline, `GLSLProgram` in `renderers/glslCore.ts` (`glslCore.ts:116`). Only the canvas type and the audio source differ:

| Host | Canvas | Audio source | File |
| --- | --- | --- | --- |
| **Worker** (default) | the transferred `OffscreenCanvas` | `rawAnalyser` shim | `hostP5Worker.ts:497` (`mountGLSL`) |
| **Main thread** (fallback) | a `<canvas>` it creates | a Web Audio `AnalyserNode` | `GLSLVizRenderer.ts:32` |

The two audio sources are structurally identical — both expose `AudioByteSource` (`glslCore.ts:32`: `frequencyBinCount` + `getByteFrequencyData` + `getByteTimeDomainData`) — so the core feeds from either with **no branch**. That shared interface is the audio-feed seam the contract was tested on, and it needed no generalizing. The main-thread factory chooses between them per mount with the same gate the other kinds use (`makeGLSLRenderer.ts:32`, `shouldUseWorkerRenderer()`), wrapping the worker renderer in a `FallbackVizRenderer`.

### The pipeline — a fullscreen triangle + one fragment shader

There is no geometry to manage. A single triangle covers the clip volume using `gl_VertexID` for its three positions, so the core needs **no VBO and no attributes** (`glslShaderSource.ts:31`). The whole draw is one `gl.drawArrays(TRIANGLES, 0, 3)` (`glslCore.ts:236`) with a bound (empty) VAO — WebGL2 core requires a VAO even with no attributes (`glslCore.ts:168`).

The user controls only the **fragment** shader. There is no transpile — the program source is plain string composition (`buildGLSLFragmentSource`, `glslShaderSource.ts:82`), which is also why a `.glsl` sketch crosses to the worker as a plain transferable string (the same property that lets p5/hydra *source* cross — `MountMessage.code`), with none of the closure-serialization problem built-in hydra sketches have.

`buildGLSLFragmentSource` supports two shapes, auto-detected from the comment-stripped source (`glslShaderSource.ts:83`):

- **ShaderToy** — the user writes only `void mainImage(out vec4 fragColor, in vec2 fragCoord)`; Stave owns `main()` and the fragment output (`glslShaderSource.ts:92`).
- **Raw GLSL** — the user writes their own `void main()` and `out`; Stave prepends only version, precision, and uniforms, stripping a user `#version` so ours stays canonical first (`glslShaderSource.ts:96`).

> **Ambiguity and emptiness are friendly errors, not GLSL errors** — Both-present (`mainImage` *and* `main`) and neither-present are caught with a human message *before* compilation (`glslShaderSource.ts:87`, `glslShaderSource.ts:101`) — not a cryptic duplicate-symbol or undefined-`main` link error. Detection runs on a comment-blanked copy (`stripComments`, `glslShaderSource.ts:64`) so a `// uses mainImage` line can't fool it.

### The audio feed — `iChannel0`, the ShaderToy convention

The master analyser is uploaded each frame to a single-channel `R8` texture, 512×2, bound as `iChannel0` (`glslCore.ts:71` sizes; `glslCore.ts:179` allocates; `glslCore.ts:209` uploads with `texSubImage2D`): **row 0** (`y ≈ 0.0`) = FFT magnitude, **row 1** (`y ≈ 1.0`) = waveform — matching ShaderToy's convention, so an off-the-shelf shader reads `texture(iChannel0, vec2(uv.x, 0.0)).x` unchanged. The analyser buffer (1024 bins / 2048 samples) is box-averaged onto the 512-texel rows by `resampleByteRow` (`glslCore.ts:92`) into scratch buffers allocated **once** (`glslCore.ts:127`). The other v1 uniforms are `iResolution`, `iTime`, and `iMouse` (vec4, zero in the worker) (`glslShaderSource.ts:45`).

### The event feed — `u*` uniforms (the kind-specific marshal)

This is the one seam GLSL adds. Beyond the FFT in `iChannel0`, a shader can react to **pattern events** — per-drum envelope levels + master DSP — through `float` uniforms (`glslShaderSource.ts:49`):

```glsl
uniform float uKick, uSnare, uHat, uOpenHat, uClap, uRim, uTom, uVelocity;
uniform float uRms, uBass, uMid, uTreble;
```

These are read from the named-signal bus once per frame by `readGLSLEvents` (`glslEvents.ts:21`) — the **same** `bus.envValue()` / `bus.master()` API that `hydraStaveBag` and the p5 `buildStaveUniforms` path use, so a kick is a kick in every engine. The values are set with `uniform1f` only for uniforms the shader actually references; GLSL strips unused uniforms, so their location is `null` and the set is a cheap no-op (`glslCore.ts:162`, `glslCore.ts:232`).

> **Audio feed: no new seam. Event feed: a kind-specific marshal** — The contract predicted exactly this split. The **audio** feed reused the existing kind-agnostic source — `mountGLSL` reads the same already-refreshed `rawAnalyser` hydra reads and uploads it to a texture *internally* (`hostP5Worker.ts:517`). No host change. The **event** feed is genuinely kind-specific — turning bus signals into shader uniforms is GLSL's analog of p5's blit: it lives entirely inside the strategy's `draw()`. Both feeds are sourced from data the host already prepares (`rawAnalyser` + the ticked `feed.bus`); neither required a new *shared* seam.

### Upcoming notes — `uNotes` and `staveNote(i)`

A shader has no per-frame JavaScript, so it can't call `stave.scheduler.query()` like p5, hydra and three.js sketches (#2571). It gets the same window of notes (now−4 … now+2 cycles) as a float texture instead:

```glsl
uniform highp sampler2D uNotes;  // texture unit 1; read through staveNote(i)
uniform int   uNoteCount;        // notes in the texture (≤ STAVE_MAX_NOTES = 256)
uniform float uNow;              // scheduler now, in cycles
uniform float uCps;              // cycles per second
struct StaveNote { float begin; float end; float midi; float gain; float velocity; int track; };
StaveNote staveNote(int i);      // 0 <= i < uNoteCount, sorted by begin
```

The field names are the JS haps' (`summariseRawHap`). Times are absolute cycles; `midi` is −1 for a note with no pitch (a drum sample); `track` is the index `staveTrack(i)` uses (the note's track key in the bus's `tracks`, read from the `stave-track:` tag the combined scheduler's haps carry — `IREvent.trackKey`), or −1. The texture is RGBA32F, 256×2, `NEAREST`: row 0 = (begin, end, midi, gain), row 1 = (velocity, track, 0, 0). Over the cap, the 256 notes nearest to now are kept, then sorted by begin, and the sketch logs one warning.

The packing is a pure module, `renderers/glslNotes.ts` (`GLSLNoteFeed`). It repacks only when `RollingHapWindow.version` moves (the window's answer changed) or the track list changes, and `glslCore` re-uploads the texture only when the feed's own version moves — not every frame. The worker reads the frame's `rawScheduler` (`events`, `version`, `cps`); the main-thread fallback (`GLSLVizRenderer`) keeps its own `RollingHapWindow` over the live scheduler. Both skip it for a shader that references none of the four uniforms (`GLSLProgram.readsNotes`). The names are reserved like the rest of the preamble: redeclaring one is a GLSL compile error.

### Draw cadence — one frame per signal frame

The worker draws only when the host calls `draw()` — no internal loop. Inside `mountGLSL`'s `draw()` (`hostP5Worker.ts:516`), the audio shim is already refreshed and the bus already ticked by `applyAndDraw` (`hostP5Worker.ts:545`), so the strategy just reads and renders:

```ts
// hostP5Worker.ts:524 — read the already-prepared feeds; render one frame
const timeMs = (globalThis.performance?.now?.() ?? 0) - startMs
program.draw(
  rawAnalyser,                                  // → iChannel0 texture (audio)
  { width: msg.canvas.width, height: msg.canvas.height, timeMs },
  readGLSLEvents(feed.bus),                      // → u* uniforms (events)
)
```

On the main thread the loop is owned by `GLSLVizRenderer` and mirrors `HydraVizRenderer`: a single `requestAnimationFrame` that ticks the bus **once** per frame (`GLSLVizRenderer.ts:110`) then reads events and draws, so `pause()` (cancel the rAF) truly halts rendering.

### The five strategy members for GLSL

| Member | GLSL implementation | Where |
| --- | --- | --- |
| `setupDone()` | `true` immediately — compiled+linked *synchronously* at mount | `hostP5Worker.ts:512` |
| `draw()` | upload audio texture, set uniforms, draw 3 verts — **no per-frame user JS** | `hostP5Worker.ts:516` → `glslCore.ts:192` |
| `resizeKind(w,h)` | resize the transferred canvas directly (Tier-1; `maxDpr` is 1 so backing == CSS) | `hostP5Worker.ts:531` |
| `teardown()` | `program.dispose()` — delete program, VAO, texture | `hostP5Worker.ts:535` → `glslCore.ts:240` |
| `gl?()` | re-get the WebGL2 context — **the easiest of all three** (the context we created; no search) | `hostP5Worker.ts:515` |

> **GLSL's draw can't throw — but its compile error is the user error, and it surfaces** — Two seams are trivially satisfied by GLSL's nature: `setupDone()` is synchronous (compile/link at mount, no async-readiness dance), and `draw()` runs a GPU shader with **no per-frame user JavaScript**, so the *runtime* draw-error seam has nothing to catch (`glslCore.ts:18`). But that moves the user error to **mount time**: a shader that won't compile/link throws (`glslCore.ts:85`, `glslCore.ts:155`) → caught by the host → `onError` → `FallbackVizRenderer` degrades to main, where the same shader throws again. That terminal catch in `GLSLVizRenderer` is where it surfaces: `emitLog({ runtime: 'glsl', … })` to the main Console, and — because a GLSL info log carries a `0:N` line — it maps that line back through the wrapper preamble (`glslFragmentErrorUserLine`) to the user's **editor line**. All three runtimes light a squiggle.

### GL-context release

Because GLSL owns its `WebGLRenderingContext` directly, both paths release it explicitly on teardown rather than waiting for GC: the worker's `gl()` accessor feeds the host's `accountGL`/`releaseGL` (`hostP5Worker.ts:515`), and the main-thread renderer calls `WEBGL_lose_context.loseContext()` in `destroy()` (`GLSLVizRenderer.ts:173`). This keeps a pooled warm worker from retaining a context toward Chrome's ~16-context cap.

### Built-in presets

Four bundled shaders (`builtinGLSLCode.ts`), registered in `defaultDescriptors.ts`:

| Preset | What it shows | Reads |
| --- | --- | --- |
| `glsl` | audio-reactive plasma + waveform line | `iChannel0` (FFT + wave) |
| `spectrum:glsl` | FFT spectrum bars — the clearest "is audio reaching the shader?" | `iChannel0` row 0 |
| `creation` | "Creation" by Silexars/Danguafer, ported audio-reactive | `iChannel0` (bass/treble) |
| `pulse` | red flash on kick, blue rings on snare, white rim on hat | `u*` events |

`pulse` is the clearest "events, not just FFT" reference — it reads **no** `iChannel0`, only `uKick`/`uSnare`/`uHat`.

**Verified by** `glsl-path-coverage.spec.ts` — a GLSL viz live in the *worker* (`viz.worker > 0 && viz.glsl === 0`) exercising each seam: `glctx` accounting, `viz.worker.draw` timing, fallback on a broken shader, a 5-frame visual-distinct gate, raw `void main()` mode, and a **pure-`uKick`** shader (no `iTime`/`iChannel0`) proven distinct under `bd*4` (events reach the GPU). Plus `glsl-creation-4up.spec.ts` — four concurrent audio-reactive GLSL worker viz, all painting.
