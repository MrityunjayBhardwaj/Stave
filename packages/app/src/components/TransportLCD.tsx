"use client";

import React, { useEffect, useRef } from "react";
import { perf } from "@stave/editor";
import { useRulerUnits, toggleRulerUnits } from "../state/rulerUnits";
import { useDisplayMeter } from "../state/displayMeter";
import { healthClass, healthBars, audioHealthReading, type AudioHealthSample } from "./transportLcdHealth";
import { positionAsDrawn } from "./musicalTimeline/songAxis";
import { readDrawnSongFrame } from "../state/drawnSongFrame";
import { transportReadout } from "./transportReadout";

/**
 * TransportLCD (#857) — a backlit hardware-style readout for the menubar's
 * centered slot: transport state, cycle position, tempo, and frame health.
 *
 * Data comes from the accessors the timeline already reads (`getSongPosition`/
 * `getCps` on the active runtime) plus `isPlaying`. The fast-changing numbers
 * (position, tempo, FPS) are written straight to DOM refs on a rAF loop so the
 * menubar never re-renders per frame; only the slow state (isPlaying, mode)
 * flows through React.
 *
 * The health meter is layered and honest about what it can see:
 *  - Profiler ON (perf overlay / setting): reads the canonical `perf.snapshot()`
 *    — worst live viz-frame fps + slowFrames + longtasks — the same instrument
 *    PerfOverlay uses, which reflects the actual viz render cadence, not just a
 *    bare main-thread rAF.
 *  - Profiler OFF (default): the rAF cadence, plus an always-on `longtask`
 *    observer so a real main-thread stall pulls the meter to amber/red even when
 *    the smoothed fps still looks fine.
 *  - GPU/compositor strain while the profiler is OFF isn't main-thread-measurable
 *    here (see the perf catalogue) and stays out of scope — not silently green.
 *
 * The position is the SONG position, the clock the timeline's playhead reads,
 * wrapped over the span the timeline draws, with a pass number beside it
 * (#1725). It used to read the scheduler's clock, which counts cycles since
 * Play and does not move on a seek: a click on the ruler moved the playhead
 * and the audio, and this number carried on from where it was.
 *
 * Display mode reuses the app-wide Ruler-units preference — CYCLES shows
 * `CYC 042.3 · 0.50 CPS`, BARS shows `BAR 011.3.1 · 120 BPM` — and clicking
 * the screen flips it, keeping the LCD and the timeline ruler in agreement.
 *
 * The screen palette is fixed dark in both themes: a backlit display reads as
 * a screen, not a themed card. The bezel/labels ride the chrome tokens.
 */

interface TransportLCDProps {
  readonly isPlaying: boolean;
  /**
   * The song position (#1725): the scheduler's clock less the seek offset,
   * folded into a loop range. `null` when stopped, so the readout dashes.
   */
  readonly getSongPosition: () => number | null;
  readonly getCps: () => number | null;
  /**
   * The active runtime's running counts of late notes and audio underruns, or
   * null (#1348). Read on the health tick, like the FPS meter.
   */
  readonly getAudioHealth?: () => { lateNotes: number; underruns: number | null } | null;
  /**
   * The active file's last evaluation error, or null (#1348). The transport
   * dot says whether the scheduler runs; this says whether the code did.
   */
  readonly evalError?: string | null;
  /** The eval lamp was pressed. */
  readonly onEvalLamp?: () => void;
}

const STYLE_ID = "stave-transport-lcd-styles";

function ensureLcdStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .stave-lcd {
      position: relative; display: flex; align-items: stretch; height: 22px;
      border-radius: 4px; padding: 0 2px; overflow: hidden; cursor: pointer;
      font-family: var(--font-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace);
      background: linear-gradient(180deg, #0a0a1a, #05050e);
      border: 1px solid #01010a;
      box-shadow: inset 0 1px 0 rgba(160,168,255,0.06),
                  inset 0 0 12px rgba(80,90,200,0.14),
                  0 0 0 1px rgba(120,124,255,0.10), 0 1px 2px rgba(0,0,0,0.6);
    }
    .stave-lcd:focus-visible { outline: 2px solid #7c7cff; outline-offset: 2px; }
    .stave-lcd::after {
      content: ""; position: absolute; inset: 0; border-radius: 4px; pointer-events: none;
      background: repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,0,0,0.16) 3px);
      mix-blend-mode: multiply; opacity: .5;
    }
    .stave-lcd-seg { display: flex; align-items: center; gap: 5px; padding: 0 8px; height: 100%; }
    .stave-lcd-seg + .stave-lcd-seg { box-shadow: inset 1px 0 0 rgba(120,124,255,0.10); }
    .stave-lcd-label { font-size: 8px; letter-spacing: 0.14em; color: #6f6fa0; text-transform: uppercase; line-height: 1; }
    .stave-lcd-dot { width: 7px; height: 7px; border-radius: 50%; background: #6f6fa0; flex: none; transition: background .15s, box-shadow .15s; }
    .stave-lcd.run .stave-lcd-dot { background: #6bff8c; box-shadow: 0 0 6px rgba(107,255,140,0.55); animation: stave-lcd-pulse 1.05s ease-in-out infinite; }
    @keyframes stave-lcd-pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
    .stave-lcd-state { font-size: 8px; letter-spacing: 0.16em; color: #6f6fa0; text-transform: uppercase; }
    .stave-lcd.run .stave-lcd-state { color: #6bff8c; }
    .stave-lcd-readout { position: relative; display: inline-grid; }
    .stave-lcd-readout > span { grid-area: 1 / 1; font-variant-numeric: tabular-nums; letter-spacing: 0.06em; font-size: 13px; font-weight: 600; white-space: pre; }
    .stave-lcd-ghost { color: rgba(150,158,255,0.10); }
    .stave-lcd-live { color: #bcc2ff; text-shadow: 0 0 6px rgba(150,158,255,0.55), 0 0 1px rgba(190,196,255,0.9); }
    .stave-lcd-tempo { font-variant-numeric: tabular-nums; font-size: 12px; font-weight: 600; color: #9aa0e6; text-shadow: 0 0 5px rgba(140,148,230,0.4); letter-spacing: .04em; }
    .stave-lcd-fps { display: flex; align-items: center; gap: 6px; }
    .stave-lcd-bars { display: flex; align-items: flex-end; gap: 1.5px; height: 11px; }
    .stave-lcd-bars i { width: 2.5px; background: #6f6fa0; border-radius: 1px; opacity: .3; }
    .stave-lcd-bars i.on { opacity: 1; }
    .stave-lcd-fps.good .stave-lcd-bars i.on { background: #6bff8c; box-shadow: 0 0 4px rgba(107,255,140,.55); }
    .stave-lcd-fps.warn .stave-lcd-bars i.on { background: #ffcf7a; box-shadow: 0 0 4px rgba(255,207,122,.5); }
    .stave-lcd-fps.crit .stave-lcd-bars i.on { background: #ff8080; box-shadow: 0 0 4px rgba(255,128,128,.5); }
    .stave-lcd-fpsnum { font-variant-numeric: tabular-nums; font-size: 11px; font-weight: 600; color: #9aa0e6; }
    .stave-lcd-audio { font-variant-numeric: tabular-nums; font-size: 10px; font-weight: 600; letter-spacing: .06em; color: #6f6fa0; white-space: pre; }
    .stave-lcd-audio[data-stave-audio-health="late"] { color: #ffcf7a; }
    .stave-lcd-audio[data-stave-audio-health="glitch"] { color: #ff8080; }
    .stave-lcd-lamp {
      display: flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; margin-right: 4px;
      border-radius: 4px; cursor: pointer; color: inherit;
      font-family: var(--font-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace);
      background: linear-gradient(180deg, #0a0a1a, #05050e);
      border: 1px solid #01010a;
      box-shadow: inset 0 1px 0 rgba(160,168,255,0.06), 0 0 0 1px rgba(120,124,255,0.10), 0 1px 2px rgba(0,0,0,0.6);
    }
    .stave-lcd-lamp:focus-visible { outline: 2px solid #7c7cff; outline-offset: 2px; }
    .stave-lcd-lamp .stave-lcd-state { font-size: 8px; }
    .stave-lcd-lamp.err .stave-lcd-dot { background: #ff8080; box-shadow: 0 0 6px rgba(255,128,128,0.6); }
    .stave-lcd-lamp.err .stave-lcd-state { color: #ff8080; }
    @media (prefers-reduced-motion: reduce) { .stave-lcd.run .stave-lcd-dot { animation: none; } }
  `;
  document.head.appendChild(style);
}

const DASH = "—";

export function TransportLCD({
  isPlaying,
  getSongPosition,
  getCps,
  getAudioHealth,
  evalError = null,
  onEvalLamp,
}: TransportLCDProps): React.ReactElement {
  const units = useRulerUnits();
  const cycleMode = units === "cycles";
  const meter = useDisplayMeter();

  // Keep the fast-path accessors and the current mode in refs so the rAF loop
  // (mounted once) always reads the latest without restarting per render.
  const getSongPositionRef = useRef(getSongPosition);
  const getCpsRef = useRef(getCps);
  const cycleModeRef = useRef(cycleMode);
  // The meter rides a ref for the same reason the mode does: the rAF loop is
  // mounted once and must read the CURRENT value, not the one captured when it
  // started, or the readout keeps counting in whatever meter was set at mount.
  const meterRef = useRef(meter);
  getSongPositionRef.current = getSongPosition;
  getCpsRef.current = getCps;
  const getAudioHealthRef = useRef(getAudioHealth);
  getAudioHealthRef.current = getAudioHealth;
  const audioRef = useRef<HTMLSpanElement>(null);
  cycleModeRef.current = cycleMode;
  meterRef.current = meter;

  const posRef = useRef<HTMLSpanElement>(null);
  const passRef = useRef<HTMLSpanElement>(null);
  const tempoRef = useRef<HTMLSpanElement>(null);
  const fpsWrapRef = useRef<HTMLDivElement>(null);
  const fpsNumRef = useRef<HTMLSpanElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureLcdStyles();
    let raf = 0;
    let last = performance.now();
    let fps = 60;
    let posAcc = 0;
    let healthAcc = 0;
    const audioHistory: AudioHealthSample[] = []; // #1348 — the audio cell's window
    let prevLtCount = 0; // profiler longtask counter, diffed per health tick
    let ownLtAt = -Infinity; // last main-thread stall we saw (profiler-OFF path)
    let ownLtMs = 0;

    // Always-on main-thread stall detector for when the profiler is off. Guarded:
    // 'longtask' isn't observable in Safari / jsdom — the meter then just rides
    // the rAF cadence, no worse than before.
    let ltObs: PerformanceObserver | null = null;
    try {
      if (typeof PerformanceObserver !== "undefined") {
        ltObs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            ownLtAt = performance.now();
            ownLtMs = e.duration;
          }
        });
        ltObs.observe({ entryTypes: ["longtask"] });
      }
    } catch {
      ltObs = null;
    }

    const tick = (now: number): void => {
      const dt = Math.max(0.001, (now - last) / 1000);
      last = now;
      // Smoothed rAF cadence — the fallback health signal when the profiler is off.
      fps += (1 / dt - fps) * 0.1;

      // Position / tempo — smooth (~12.5Hz) so the counter reads like a display.
      posAcc += dt;
      if (posAcc >= 0.08) {
        posAcc = 0;
        const cps = getCpsRef.current();
        // #1725 — the same frame and the same wrap the playhead is drawn with.
        const pos = positionAsDrawn(getSongPositionRef.current(), readDrawnSongFrame());
        // the text is worked out in one place, shared with the phone's top bar (#2001)
        const r = transportReadout(pos, cps, cycleModeRef.current, meterRef.current);
        if (posRef.current) posRef.current.textContent = r.position;
        if (passRef.current) passRef.current.textContent = r.pass;
        if (tempoRef.current) tempoRef.current.textContent = r.tempo;
      }

      // Health — coarser (~4Hz). Reuses the canonical profiler when it's on
      // (worst live viz-frame fps + slowFrames + longtasks), else the rAF cadence
      // dragged down by any recent main-thread stall.
      healthAcc += dt;
      if (healthAcc >= 0.25) {
        healthAcc = 0;
        let shownFps: number;
        let slow = false;
        let stallMs = 0;

        if (perf.enabled) {
          const snap = perf.snapshot();
          const frameFps = Object.values(snap.frames)
            .map((f) => f.fps)
            .filter((v) => v > 0);
          // The slowest live viz is what the eye actually reads as jank.
          shownFps = frameFps.length ? Math.min(...frameFps) : fps;
          slow = Object.values(snap.frames).some((f) => f.slowFrames > 0);
          if (snap.longtasks.count > prevLtCount) stallMs = snap.longtasks.maxMs;
          prevLtCount = snap.longtasks.count;
        } else {
          shownFps = fps;
          if (now - ownLtAt < 1200) stallMs = ownLtMs;
        }

        // #1348 — audio: late notes and underruns in the last few seconds.
        // Nothing to show until there is trouble; it never claims a load
        // percentage the browser does not give.
        const audio = getAudioHealthRef.current?.() ?? null;
        const el = audioRef.current;
        if (el) {
          const r = audio
            ? audioHealthReading(audioHistory, { at: now, ...audio })
            : { cls: "ok" as const, late: 0, glitches: 0 };
          const text = r.cls === "glitch" ? `GLITCH ${r.glitches}` : r.cls === "late" ? `LATE ${r.late}` : "OK";
          if (el.textContent !== text) el.textContent = text;
          if (el.dataset.staveAudioHealth !== r.cls) {
            el.dataset.staveAudioHealth = r.cls;
            el.title =
              r.cls === "glitch"
                ? `The audio output glitched ${r.glitches} time(s) in the last few seconds: the audio thread could not keep up.`
                : r.cls === "late"
                  ? `${r.late} note(s) in the last few seconds arrived too late to play: the page was too busy.`
                  : "No dropped notes or audio glitches in the last few seconds.";
          }
        }

        const shown = Math.max(1, Math.round(shownFps));
        if (fpsNumRef.current) fpsNumRef.current.textContent = String(Math.min(shown, 120));
        const cls = healthClass(shown, slow, stallMs);
        if (fpsWrapRef.current) fpsWrapRef.current.className = `stave-lcd-fps ${cls}`;
        const lit = healthBars(cls, shown);
        if (barsRef.current) {
          const bars = barsRef.current.children;
          for (let i = 0; i < bars.length; i++) {
            (bars[i] as HTMLElement).classList.toggle("on", i < lit);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ltObs?.disconnect();
    };
  }, []);

  return (
    <>
    {/* #1348 — the eval lamp. A SIBLING of the readout, not a segment of it:
        the readout is itself a button (it switches cycles/bars), and a button
        inside a button is invalid and read inconsistently.
        It claims only what it knows. With no error it is a neutral `EVAL`
        that opens the Console — never a green tick before anything has run.
        When the last evaluation failed it turns red and names the error, and
        pressing it jumps to the error as its toast would. */}
    <button
      type="button"
      className={`stave-lcd-lamp${evalError ? " err" : ""}`}
      data-stave-eval-lamp={evalError ? "error" : "ok"}
      title={evalError ?? "No evaluation errors"}
      aria-label={
        evalError
          ? // the error is a sentence now (#2177), and may end in its own `.` or `?`
            `Evaluation failed: ${/[.?!]$/.test(evalError) ? evalError : `${evalError}.`} Show the error`
          : "No evaluation errors. Open the Console"
      }
      onClick={onEvalLamp}
    >
      <span className="stave-lcd-dot" />
      <span className="stave-lcd-state">{evalError ? "\u2716 ERR" : "EVAL"}</span>
    </button>
    <div
      className={`stave-lcd${isPlaying ? " run" : ""}`}
      role="button"
      tabIndex={0}
      data-stave-transport-lcd
      aria-label="Transport display — click to switch between cycle and bar display"
      onClick={toggleRulerUnits}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleRulerUnits();
        }
      }}
    >
      <div className="stave-lcd-seg">
        <span className="stave-lcd-dot" />
        <span className="stave-lcd-state">{isPlaying ? "PLAY" : "STOP"}</span>
      </div>
      <div className="stave-lcd-seg">
        <span className="stave-lcd-label">{cycleMode ? "CYC" : "BAR"}</span>
        <span className="stave-lcd-readout">
          <span className="stave-lcd-ghost">{cycleMode ? "888.8" : "888.8.8"}</span>
          <span className="stave-lcd-live" ref={posRef} data-stave-lcd-pos>
            {cycleMode ? "000.0" : "000.0.0"}
          </span>
        </span>
      </div>
      {/* #1725 — which time through the song. A dash when there is no drawn
          loop to count (stopped, no timeline open, or a song with no end). */}
      <div
        className="stave-lcd-seg"
        title="Which time through the song this is: the position beside it wraps to the start with the playhead"
      >
        <span className="stave-lcd-tempo" ref={passRef} data-stave-lcd-pass>
          {DASH}
        </span>
        <span className="stave-lcd-label">PASS</span>
      </div>
      <div className="stave-lcd-seg">
        <span className="stave-lcd-tempo" ref={tempoRef} data-stave-lcd-tempo>
          {DASH}
        </span>
        <span className="stave-lcd-label">{cycleMode ? "CPS" : "BPM"}</span>
      </div>
      <div className="stave-lcd-seg">
        <div className="stave-lcd-fps good" ref={fpsWrapRef}>
          <div className="stave-lcd-bars" ref={barsRef}>
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ height: `${5 + i * 1.5}px` }} />
            ))}
          </div>
          <span className="stave-lcd-fpsnum" ref={fpsNumRef}>
            60
          </span>
        </div>
        <span className="stave-lcd-label">FPS</span>
      </div>
      <div className="stave-lcd-seg">
        <span
          className="stave-lcd-audio"
          ref={audioRef}
          data-stave-audio-health="ok"
          title="No dropped notes or audio glitches in the last few seconds."
        >
          OK
        </span>
        <span className="stave-lcd-label">AUDIO</span>
      </div>
    </div>
    </>
  );
}
