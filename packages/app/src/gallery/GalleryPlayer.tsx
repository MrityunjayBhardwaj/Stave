"use client";

/**
 * Community gallery (#2328) — the page inside the preview frame.
 *
 * The gallery mounts `/gallery-player` in `<iframe sandbox="allow-scripts">`
 * (no `allow-same-origin`), so everything here — this page, the audio engine,
 * and the entry's code it evaluates — runs with an opaque origin. It talks to
 * the gallery only through `postMessage` (see previewProtocol.ts): it takes
 * code in and reports playing / stopped / error out.
 *
 * Sound: a Strudel file plays on its own engine. Whether the gallery page's
 * click lets this frame start audio depends on the browser (#2495, measured
 * with real clicks and a no-click control in each): Chromium and Chrome take a
 * click anywhere above the frame, because the frame carries allow="autoplay"
 * (the autoplay check walks up to the parents for a click); Firefox takes a click
 * on the top page whatever the frame says; WebKit wants a click in this frame
 * itself. With no click anywhere it starts in none of them. So when the audio
 * context won't start, the frame shows its own Play button and says so
 * (NEEDS_CLICK); the gallery then moves focus into this frame, where Enter or
 * Space is that press.
 *
 * Visuals: a Hydra / p5 / GLSL file renders on the main thread inside the
 * frame, fed by nothing (no music is playing in a visual preview). The worker
 * renderer isn't used: it would load its script from Stave's origin, which an
 * opaque-origin frame may not do.
 *
 * #2490 — the frame gets all of the entry's files it can run, not just the one
 * it plays, so a pattern's `.viz("bloom")` draws the entry's own `bloom` visual
 * here, under the music, fed by that pattern's track. Names resolve by the
 * studio's rule (previewRegistry.ts); a name nothing in the entry answers to
 * falls back to Stave's built-in visuals, and one that resolves nowhere is said
 * so in the frame rather than drawing nothing silently.
 *
 * #2489 — a pattern that draws none of its own visuals here gets Stave's
 * built-in piano roll as its picture, fed by its own scheduler, with a line
 * under it naming the file and the bar playing (previewRoll.ts says when it
 * shows and how the bar is counted). It is gone when the run stops or fails.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { NEEDS_CLICK, parseToFrame, type FromFrame, type PreviewFile } from "./previewProtocol";
import { codeErrorFromLog, PREVIEW_ROLL_VIZ, rollLabel, rollShows, songBarsOf, STRUDEL_LOG_EVENT } from "./previewRoll";

type Engine = import("@stave/editor").StrudelEngine;
type Editor = typeof import("@stave/editor");
type Components = Partial<import("@stave/editor").EngineComponents>;
type Mounted = { renderer: { destroy(): void; resume?(): void }; disconnect(): void };
/** #2489 — the roll on show: the file it plays, the song's length in bars if it has one, and the playing cycle. */
type Roll = { path: string; bars: number | null; now: () => number };
type VizSource = import("@stave/editor").VizDescriptor["factory"];
/** The kinds that compile to a visual: every preview kind but a pattern. */
type VizKind = Exclude<PreviewFile["kind"], "strudel">;

const VIZ_SIZE = { w: 640, h: 360 };
/** One of the entry's visual files, compiled the way the app compiles a viz file. */
function compileVisual(editor: Editor, file: PreviewFile, name: string): VizSource {
  return editor.compilePreset({
    id: `gallery-preview:${file.path}`,
    name,
    renderer: file.kind as VizKind,
    code: file.code,
    requires: [],
    createdAt: 0,
    updatedAt: 0,
  }).factory;
}

/** #2490 — visuals one pattern may draw at once in the preview. */
export const MAX_PREVIEW_VISUALS = 4;

/**
 * #2581 — the note the frame shows when a pattern calls for more visuals than
 * the preview draws, so the ones past the limit aren't dropped without a word.
 * `null` at the limit or under it.
 */
export function visualsCappedNote(found: number): string | null {
  if (found <= MAX_PREVIEW_VISUALS) return null;
  return `This pattern calls for ${found} visuals; the preview draws the first ${MAX_PREVIEW_VISUALS}.`;
}

export function GalleryPlayer() {
  const vizRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const vizMountsRef = useRef<Mounted[]>([]);
  const generation = useRef(0);
  // What the current run is doing, so an error the code raises is reported
  // truthfully: before anything plays it IS the outcome ("error"); once it
  // plays (or while it is starting) the sound or picture goes on, so it rides
  // along with "playing" as its message instead of hiding that it plays.
  const run = useRef<{ phase: "idle" | "starting" | "playing"; error?: string }>({ phase: "idle" });
  const [status, setStatus] = useState<FromFrame>({ state: "ready" });
  const [needsClick, setNeedsClick] = useState(false);
  const startRef = useRef<HTMLButtonElement>(null);
  const [showViz, setShowViz] = useState(false);
  // #2490 — `.viz` names the playing pattern calls that resolve to no visual.
  const [missing, setMissing] = useState<string[]>([]);
  // #2581 — how many visuals the playing pattern calls for that resolved, when over the limit.
  const [cappedNote, setCappedNote] = useState<string | null>(null);
  // #2489 — the piano roll drawn when the pattern draws no visual of its own.
  const [roll, setRoll] = useState<Roll | null>(null);
  const rollMountRef = useRef<{ box: HTMLDivElement; mounted: Mounted; stopListening: () => void } | null>(null);
  // #2580 — inside the gallery's preview the page's status line is the one shown
  // (and announced); this frame's own line is for the player opened on its own.
  // Assumed embedded until checked, so the embedded case never flashes a second line.
  const [embedded, setEmbedded] = useState(true);
  useEffect(() => setEmbedded(window.parent !== window), []);

  const post = useCallback((msg: FromFrame) => {
    setStatus(msg);
    // The parent is Stave's own page; address only that origin. (This frame's
    // URL is on Stave's origin even though the frame itself is opaque.)
    if (window.parent !== window) window.parent.postMessage(msg, window.location.origin);
  }, []);

  /** The entry's code raised `message` (an evaluate error, a callback, a timer). */
  const reportError = useCallback(
    (message: string) => {
      const r = run.current;
      if (r.phase === "idle") post({ state: "error", message });
      else if (r.phase === "starting") r.error = r.error ?? message;
      else if (r.error !== message) {
        // a pattern that throws does so on every cycle: say it once
        r.error = message;
        post({ state: "playing", message });
      }
    },
    [post],
  );

  /** #2489 — take the roll down (a failed run keeps no picture of notes that aren't playing). */
  const clearRoll = useCallback(() => {
    const r = rollMountRef.current;
    rollMountRef.current = null;
    setRoll(null);
    if (!r) return;
    r.stopListening();
    vizMountsRef.current = vizMountsRef.current.filter((m) => m !== r.mounted);
    r.mounted.renderer.destroy();
    r.mounted.disconnect();
    r.box.remove();
    if (vizMountsRef.current.length === 0) setShowViz(false);
  }, []);

  /** The run failed before anything played. */
  const failRun = useCallback(
    (message: string) => {
      run.current = { phase: "idle" };
      clearRoll();
      post({ state: "error", message });
    },
    [clearRoll, post],
  );

  /** It plays; say so, with any error the code raised on the way. */
  const nowPlaying = useCallback(() => {
    const err = run.current.error;
    run.current = { phase: "playing", error: err };
    post(err ? { state: "playing", message: err } : { state: "playing" });
  }, [post]);

  const stopAll = useCallback(() => {
    generation.current++;
    run.current = { phase: "idle" };
    setNeedsClick(false);
    try {
      engineRef.current?.stop();
    } catch {
      /* already stopped */
    }
    for (const m of vizMountsRef.current) {
      m.renderer.destroy();
      m.disconnect();
    }
    vizMountsRef.current = [];
    rollMountRef.current?.stopListening();
    rollMountRef.current = null;
    setRoll(null);
    vizRef.current?.replaceChildren();
    setShowViz(false);
    setMissing([]);
    setCappedNote(null);
  }, []);

  const startSound = useCallback(async (mine: number) => {
    const e = engineRef.current;
    if (!e || mine !== generation.current) return;
    const ctx = e.getAudioContext();
    try {
      e.unlockAudio();
      // Without a click it may take (see the top of this file) a browser leaves
      // resume() PENDING, not rejected (observed: "The AudioContext was not
      // allowed to start"), so
      // give it a moment and then go by the context's state.
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
    } catch {
      /* reported below as "needs a click" */
    }
    if (mine !== generation.current) return;
    if (ctx.state !== "running") {
      setNeedsClick(true);
      run.current = { phase: "starting", error: run.current.error };
      post({ state: "stopped", message: NEEDS_CLICK });
      return;
    }
    setNeedsClick(false);
    e.play();
    nowPlaying();
  }, [post, nowPlaying]);

  // #2495 — while this frame asks for its press, the gallery moves focus into it,
  // and Enter or Space there is the press: a key press is a user activation IN
  // this frame. Its Play takes focus too where the browser lets it, but WebKit
  // refuses focus() to a cross-origin frame nobody has pressed yet (observed: it
  // stays on <body>), so the key is listened for on the whole frame.
  useEffect(() => {
    if (!needsClick) return;
    const focusPlay = () => startRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target === startRef.current) return; // the button presses itself
      e.preventDefault();
      void startSound(generation.current);
    };
    focusPlay();
    window.addEventListener("focus", focusPlay);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focus", focusPlay);
      window.removeEventListener("keydown", onKey);
    };
  }, [needsClick, startSound]);

  /**
   * Mount one visual in a box of its own inside the visual area, the box marked
   * with `attr` = `label`. A sketch's error goes to `onError`. Null when this run
   * was replaced meanwhile.
   */
  const mountVisual = useCallback(
    (
      editor: Editor,
      mine: number,
      label: string,
      factory: VizSource,
      components: Components,
      onError: (err: Error) => void,
      attr = "data-gallery-player-visual",
    ): { box: HTMLDivElement; mounted: Mounted } | null => {
      const area = vizRef.current;
      if (!area || mine !== generation.current) return null;
      const box = document.createElement("div");
      box.setAttribute(attr, label);
      box.style.cssText = "position:relative;flex:1 1 0;min-height:0;width:100%;overflow:hidden;";
      area.appendChild(box);
      const mounted = editor.mountVizRenderer(box, factory, components, VIZ_SIZE, onError);
      vizMountsRef.current.push(mounted);
      mounted.renderer.resume?.();
      return { box, mounted };
    },
    [],
  );

  /**
   * #2490 — the visuals the pattern just evaluated calls with `.viz(name)`:
   * each from the entry's own files by the studio's name rule, else one of
   * Stave's built-in visuals, mounted fed by its own track (its scheduler and,
   * when the engine has one, its analyser), as the studio's inline zones are.
   * Names that resolve to nothing are listed in the frame. Resolves to how
   * many it drew.
   */
  const showPatternVisuals = useCallback(
    async (editor: Editor, e: Engine, mine: number, files: PreviewFile[]): Promise<number> => {
      const requests = [...e.getVizRequests()];
      if (requests.length === 0) return 0;
      const { previewRegistry, visualName } = await import("./previewRegistry");
      if (mine !== generation.current) return 0;
      const registry = previewRegistry(files);
      const found: Array<{ trackKey: string; label: string; factory: VizSource }> = [];
      const unresolved: string[] = [];
      for (const [trackKey, vizId] of requests) {
        const file = registry.visualFor(vizId);
        if (file) {
          // A visual that doesn't compile is the code's error, said alongside
          // "playing" as the studio's inline zone would skip it; the music goes on.
          try {
            found.push({ trackKey, label: file.path, factory: compileVisual(editor, file, visualName(file.path)) });
          } catch (err) {
            reportError(err instanceof Error ? err.message : String(err));
          }
          continue;
        }
        const builtIn = editor.resolveDescriptor(vizId, editor.DEFAULT_VIZ_DESCRIPTORS);
        if (builtIn) found.push({ trackKey, label: vizId, factory: builtIn.factory });
        else if (!unresolved.includes(vizId.slice(0, 60))) unresolved.push(vizId.slice(0, 60));
      }
      setMissing(unresolved);
      setCappedNote(visualsCappedNote(found.length));
      if (found.length === 0) return 0;
      setShowViz(true);
      await new Promise((r) => requestAnimationFrame(r));
      const comps = e.components;
      let drawn = 0;
      for (const { trackKey, label, factory } of found.slice(0, MAX_PREVIEW_VISUALS)) {
        const trackAnalyser = comps.audio?.trackAnalysers?.get(trackKey);
        const components: Components = {
          ...comps,
          audio: trackAnalyser && comps.audio ? { ...comps.audio, analyser: trackAnalyser } : comps.audio,
          queryable: {
            scheduler: comps.queryable?.trackSchedulers.get(trackKey) ?? comps.queryable?.scheduler ?? null,
            trackSchedulers: comps.queryable?.trackSchedulers ?? new Map(),
          },
          options: {},
        };
        // A visual that throws while the music plays is the code's error, said
        // alongside "playing"; the sound goes on.
        const onError = (err: Error) => {
          if (mine === generation.current) reportError(err.message);
        };
        if (!mountVisual(editor, mine, label, factory, components, onError)) return drawn;
        drawn++;
      }
      return drawn;
    },
    [mountVisual, reportError],
  );

  /**
   * #2489 — Stave's built-in piano roll, as the picture of a pattern that draws
   * none of its own: fed by the whole pattern's scheduler (every track), as the
   * studio's `.pianoroll()` backdrop is. Its line says which bar plays, out of
   * the song's length when the song has one.
   */
  const showRoll = useCallback(
    async (editor: Editor, e: Engine, mine: number, file: PreviewFile) => {
      const descriptor = editor.DEFAULT_VIZ_DESCRIPTORS.find((d) => d.id === PREVIEW_ROLL_VIZ);
      const comps = e.components;
      const scheduler = comps.queryable?.scheduler ?? null;
      if (!descriptor || !scheduler) return;
      let bars: number | null = null;
      try {
        bars = songBarsOf(editor.songEndOf(file.code));
      } catch {
        /* no reading of its length: count bars without a total */
      }
      setShowViz(true);
      await new Promise((r) => requestAnimationFrame(r));
      if (mine !== generation.current) return;
      // The roll's queries reach the entry's code, and an error that code throws
      // there is the code's error: what Strudel logs while the roll asks is
      // reported, as the engine reports what it logs while the scheduler asks
      // (previewRoll.ts says why the engine's own report can't be relied on here).
      const inRollQuery = { depth: 0 };
      const rollScheduler: typeof scheduler = {
        ...scheduler,
        query: (begin: number, end: number) => {
          inRollQuery.depth++;
          try {
            return scheduler.query(begin, end);
          } finally {
            inRollQuery.depth--;
          }
        },
      };
      const onLog = (event: Event) => {
        if (inRollQuery.depth === 0 || mine !== generation.current) return;
        const message = codeErrorFromLog((event as CustomEvent).detail);
        if (message) reportError(message);
      };
      document.addEventListener(STRUDEL_LOG_EVENT, onLog);
      const stopListening = () => document.removeEventListener(STRUDEL_LOG_EVENT, onLog);
      const components: Components = {
        ...comps,
        queryable: { scheduler: rollScheduler, trackSchedulers: comps.queryable?.trackSchedulers ?? new Map() },
        options: {},
      };
      // A fault in the roll's own drawing is Stave's, not the entry's: the roll
      // goes, quietly, and the music (and every error its code raises) goes on.
      const onError = () => {
        if (mine === generation.current) clearRoll();
      };
      const m = mountVisual(editor, mine, PREVIEW_ROLL_VIZ, descriptor.factory, components, onError, "data-gallery-player-roll");
      if (!m) {
        stopListening();
        return;
      }
      rollMountRef.current = { ...m, stopListening };
      setRoll({ path: file.path, bars, now: () => scheduler.now() });
    },
    [clearRoll, mountVisual, reportError],
  );

  const play = useCallback(
    async (path: string, files: PreviewFile[]) => {
      stopAll();
      const mine = generation.current;
      run.current = { phase: "starting" };
      const file = files.find((f) => f.path === path);
      if (!file) return; // parseToFrame guarantees it
      try {
        const editor = await import("@stave/editor");
        if (mine !== generation.current) return;
        if (file.kind === "strudel") {
          if (!engineRef.current) {
            const e = new editor.StrudelEngine({ sliderScope: "gallery-preview:" });
            e.setRuntimeErrorHandler((err) => reportError(err.message));
            engineRef.current = e;
          }
          const e = engineRef.current;
          await e.init();
          if (mine !== generation.current) return;
          const { error } = await e.evaluate(file.code);
          if (mine !== generation.current) return;
          if (error) {
            failRun(error.message);
            return;
          }
          const drawn = await showPatternVisuals(editor, e, mine, files);
          if (mine !== generation.current) return;
          if (rollShows(drawn)) {
            await showRoll(editor, e, mine, file);
            if (mine !== generation.current) return;
          }
          await startSound(mine);
          return;
        }
        // A visual: compile it the way the app does and mount it here.
        setShowViz(true);
        await new Promise((r) => requestAnimationFrame(r));
        if (mine !== generation.current) return;
        // A sketch that throws while drawing keeps no picture: that is the outcome.
        const ok = mountVisual(editor, mine, file.path, compileVisual(editor, file, `preview.${file.kind}`), {}, (err) => {
          if (mine === generation.current) failRun(err.message);
        });
        if (ok && run.current.phase === "starting") nowPlaying();
      } catch (err) {
        if (mine !== generation.current) return;
        failRun(err instanceof Error ? err.message : String(err));
      }
    },
    [failRun, mountVisual, nowPlaying, reportError, showPatternVisuals, showRoll, startSound, stopAll],
  );

  useEffect(() => {
    // The root layout's start-up screen belongs to the editor; nothing here hides it.
    document.getElementById("stave-preloader")?.remove();
    const onMessage = (event: MessageEvent) => {
      // Only the gallery page that embeds this frame may drive it.
      if (window.parent === window || event.source !== window.parent) return;
      if (event.origin !== window.location.origin) return;
      const msg = parseToFrame(event.data);
      if (!msg) return;
      if ("stop" in msg) {
        stopAll();
        post({ state: "stopped" });
      } else {
        void play(msg.path, msg.files);
      }
    };
    window.addEventListener("message", onMessage);
    // Errors the entry's code throws later (a callback, a timer) are its errors too.
    // The thrown error's own message where the browser gives it (#2343: it does
    // now, the app's scripts being CORS-loaded), not "Uncaught Error: …".
    const onError = (ev: ErrorEvent) =>
      reportError((ev.error instanceof Error && ev.error.message) || ev.message || "The code threw an error.");
    const onRejection = (ev: PromiseRejectionEvent) =>
      reportError(ev.reason instanceof Error ? ev.reason.message : String(ev.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    post({ state: "ready" });
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      stopAll();
    };
  }, [play, post, reportError, stopAll]);

  return (
    <main
      data-gallery-player
      data-state={status.state}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        height: "100vh",
        background: "var(--bg-app, #111)",
        color: "var(--text-secondary, #bbb)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        ref={vizRef}
        data-gallery-player-viz
        style={{
          display: showViz ? "flex" : "none",
          flexDirection: "column",
          flex: "1 1 0",
          minHeight: 0,
          width: "100%",
          position: "relative",
          overflow: "hidden",
        }}
      />
      {roll && status.state === "playing" && <RollLabel roll={roll} />}
      {missing.length > 0 && (
        <div data-gallery-player-missing style={{ padding: "0 12px", textAlign: "center" }}>
          {missing.length === 1
            ? `This pattern calls .viz("${missing[0]}"), and this entry has no visual by that name.`
            : `This pattern calls ${missing.map((m) => `.viz("${m}")`).join(", ")}, and this entry has no visuals by those names.`}
        </div>
      )}
      {cappedNote && (
        <div data-gallery-player-capped style={{ padding: "0 12px", textAlign: "center" }}>
          {cappedNote}
        </div>
      )}
      {needsClick && (
        <button
          ref={startRef}
          data-gallery-player-start
          onClick={() => void startSound(generation.current)}
          style={{
            font: "inherit",
            fontSize: 14,
            padding: "8px 18px",
            borderRadius: 6,
            border: "1px solid var(--accent-strong, #7aa2f7)",
            background: "transparent",
            color: "var(--accent-strong, #7aa2f7)",
            cursor: "pointer",
          }}
        >
          ▶ Play
        </button>
      )}
      {/* #2580 — hidden (and so not announced) when embedded: the gallery page shows and announces it. */}
      <div data-gallery-player-status hidden={embedded}>
        {status.state === "ready" && "Preview ready."}
        {status.state === "playing" && (status.message ? `Playing. The code reported: ${status.message}` : "Playing in the preview.")}
        {status.state === "stopped" && (status.message ?? "Stopped.")}
        {status.state === "error" && `Error: ${status.message ?? "unknown"}`}
      </div>
    </main>
  );
}

/** #2489 — the line under the roll: the file and the bar playing, read from the scheduler ten times a second. */
function RollLabel({ roll }: { roll: Roll }) {
  const read = useCallback(() => {
    let cycle = 0;
    try {
      cycle = roll.now();
    } catch {
      /* not started yet: bar 1 */
    }
    return rollLabel(roll.path, cycle, roll.bars);
  }, [roll]);
  const [text, setText] = useState(read);
  useEffect(() => {
    setText(read());
    const id = setInterval(() => setText(read()), 100);
    return () => clearInterval(id);
  }, [read]);
  return (
    // Over the roll's top-left corner: the gallery page lays its own controls
    // over the bottom of the frame, so a line down there would sit under them.
    <div
      data-gallery-player-roll-label
      style={{
        position: "absolute",
        top: 8,
        left: 10,
        padding: "3px 8px",
        borderRadius: 4,
        background: "rgba(0, 0, 0, 0.55)",
        color: "#e6e6ee",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
}
