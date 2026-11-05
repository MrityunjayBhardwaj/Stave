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
 * Sound: a Strudel file plays on its own engine. A browser lets a frame start
 * audio only after a click IN that frame (the click on the gallery's Preview
 * button activates the gallery, not the frame), so when the audio context
 * won't start, the frame shows its own Play button and says so.
 *
 * Visuals: a Hydra / p5 / GLSL file renders on the main thread inside the
 * frame, fed by nothing (no music is playing in a visual preview). The worker
 * renderer isn't used: it would load its script from Stave's origin, which an
 * opaque-origin frame may not do.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { parseToFrame, type FromFrame, type PreviewKind } from "./previewProtocol";

type Engine = import("@stave/editor").StrudelEngine;
type Mounted = { renderer: { destroy(): void; resume?(): void }; disconnect(): void };

const VIZ_SIZE = { w: 640, h: 360 };

export function GalleryPlayer() {
  const vizRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const vizMountRef = useRef<Mounted | null>(null);
  const generation = useRef(0);
  // What the current run is doing, so an error the code raises is reported
  // truthfully: before anything plays it IS the outcome ("error"); once it
  // plays (or while it is starting) the sound or picture goes on, so it rides
  // along with "playing" as its message instead of hiding that it plays.
  const run = useRef<{ phase: "idle" | "starting" | "playing"; error?: string }>({ phase: "idle" });
  const [status, setStatus] = useState<FromFrame>({ state: "ready" });
  const [needsClick, setNeedsClick] = useState(false);
  const [showViz, setShowViz] = useState(false);

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

  /** The run failed before anything played. */
  const failRun = useCallback(
    (message: string) => {
      run.current = { phase: "idle" };
      post({ state: "error", message });
    },
    [post],
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
    if (vizMountRef.current) {
      vizMountRef.current.renderer.destroy();
      vizMountRef.current.disconnect();
      vizMountRef.current = null;
    }
    setShowViz(false);
  }, []);

  const startSound = useCallback(async (mine: number) => {
    const e = engineRef.current;
    if (!e || mine !== generation.current) return;
    const ctx = e.getAudioContext();
    try {
      e.unlockAudio();
      // Without a click in this frame Chrome leaves resume() PENDING, not
      // rejected (observed: "The AudioContext was not allowed to start"), so
      // give it a moment and then go by the context's state.
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
    } catch {
      /* reported below as "needs a click" */
    }
    if (mine !== generation.current) return;
    if (ctx.state !== "running") {
      setNeedsClick(true);
      run.current = { phase: "starting", error: run.current.error };
      post({ state: "stopped", message: "Press Play in the preview to hear it." });
      return;
    }
    setNeedsClick(false);
    e.play();
    nowPlaying();
  }, [post, nowPlaying]);

  const play = useCallback(
    async (code: string, kind: PreviewKind) => {
      stopAll();
      const mine = generation.current;
      run.current = { phase: "starting" };
      try {
        const editor = await import("@stave/editor");
        if (mine !== generation.current) return;
        if (kind === "strudel") {
          if (!engineRef.current) {
            const e = new editor.StrudelEngine({ sliderScope: "gallery-preview:" });
            e.setRuntimeErrorHandler((err) => reportError(err.message));
            engineRef.current = e;
          }
          const e = engineRef.current;
          await e.init();
          if (mine !== generation.current) return;
          const { error } = await e.evaluate(code);
          if (mine !== generation.current) return;
          if (error) {
            failRun(error.message);
            return;
          }
          await startSound(mine);
          return;
        }
        // A visual: compile it the way the app does and mount it here.
        setShowViz(true);
        await new Promise((r) => requestAnimationFrame(r));
        const container = vizRef.current;
        if (!container || mine !== generation.current) return;
        const descriptor = editor.compilePreset({
          id: "gallery-preview",
          name: `preview.${kind}`,
          renderer: kind,
          code,
          requires: [],
          createdAt: 0,
          updatedAt: 0,
        });
        // A sketch that throws while drawing keeps no picture: that is the outcome.
        const mounted = editor.mountVizRenderer(container, descriptor.factory, {}, VIZ_SIZE, (err) => {
          if (mine === generation.current) failRun(err.message);
        });
        vizMountRef.current = mounted;
        mounted.renderer.resume?.();
        if (run.current.phase === "starting") nowPlaying();
      } catch (err) {
        if (mine !== generation.current) return;
        failRun(err instanceof Error ? err.message : String(err));
      }
    },
    [failRun, nowPlaying, startSound, stopAll],
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
        void play(msg.code, msg.kind);
      }
    };
    window.addEventListener("message", onMessage);
    // Errors the entry's code throws later (a callback, a timer) are its errors too.
    const onError = (ev: ErrorEvent) => reportError(ev.message || "The code threw an error.");
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
        minHeight: "100vh",
        background: "var(--bg-app, #111)",
        color: "var(--text-secondary, #bbb)",
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 12,
        overflow: "hidden",
      }}
    >
      <div
        ref={vizRef}
        data-gallery-player-viz
        style={{
          display: showViz ? "block" : "none",
          width: "100%",
          height: "calc(100vh - 34px)",
          position: "relative",
          overflow: "hidden",
        }}
      />
      {needsClick && (
        <button
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
      <div data-gallery-player-status>
        {status.state === "ready" && "Preview ready."}
        {status.state === "playing" && (status.message ? `Playing. The code reported: ${status.message}` : "Playing in the preview.")}
        {status.state === "stopped" && (status.message ?? "Stopped.")}
        {status.state === "error" && `Error: ${status.message ?? "unknown"}`}
      </div>
    </main>
  );
}
