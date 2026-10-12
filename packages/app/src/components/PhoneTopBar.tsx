"use client";

import React, { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { useRulerUnits } from "../state/rulerUnits";
import { useDisplayMeter } from "../state/displayMeter";
import { positionAsDrawn } from "./musicalTimeline/songAxis";
import { readDrawnSongFrame } from "../state/drawnSongFrame";
import { transportReadout } from "./transportReadout";

/**
 * The phone's top bar (#2001): the four things a hand needs while the code is on
 * screen, each at least 44 px tall — the drawer, which file this is and where the song
 * has got to, whether the last evaluation worked, and Play.
 *
 * The desktop's menu bar puts eleven controls in a 28 px strip; on a 390 px screen
 * most of them are off its right edge and the rest are too small to hit. Everything
 * that strip holds and this one does not — the menus, the full readout, the frame-rate
 * and audio lamps, the time signature — is in the drawer.
 *
 * PLAY IS PRESSED HERE, NOT ASKED FOR. `onPlay` must reach the runtime before anything
 * waits: a phone browser starts audio only for what runs inside the tap (#1987).
 */

const TOUCH = 44;

interface PhoneTopBarProps {
  readonly fileName: string | null;
  readonly isPlaying: boolean;
  /** false when the tab in front has nothing to play (a markdown file, no file) */
  readonly canPlay: boolean;
  readonly onPlay: () => void;
  readonly onStop: () => void;
  readonly onOpenDrawer: () => void;
  readonly getSongPosition: () => number | null;
  readonly getCps: () => number | null;
  readonly evalError: string | null;
  readonly onEvalLamp: () => void;
}

export function PhoneTopBar({
  fileName,
  isPlaying,
  canPlay,
  onPlay,
  onStop,
  onOpenDrawer,
  getSongPosition,
  getCps,
  evalError,
  onEvalLamp,
}: PhoneTopBarProps) {
  const cycleMode = useRulerUnits() === "cycles";
  const meter = useDisplayMeter();

  // the readout is written straight to the DOM a few times a second, as the desktop's
  // is, so the shell does not re-render to move a number
  const lineRef = useRef<HTMLSpanElement>(null);
  const live = useRef({ getSongPosition, getCps, cycleMode, meter });
  live.current = { getSongPosition, getCps, cycleMode, meter };
  useEffect(() => {
    const write = (): void => {
      const { getSongPosition: pos, getCps: cps, cycleMode: inCycle, meter: m } = live.current;
      const r = transportReadout(positionAsDrawn(pos(), readDrawnSongFrame()), cps(), inCycle, m);
      const text = `${r.positionLabel} ${r.position} · ${r.tempo} ${r.tempoLabel}`;
      if (lineRef.current && lineRef.current.textContent !== text) lineRef.current.textContent = text;
    };
    write();
    const id = window.setInterval(write, 100);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div style={styles.bar} data-phone-top-bar>
      <button type="button" style={styles.square} aria-label="Open project and menus" data-phone-top="drawer" onClick={onOpenDrawer}>
        <Icon name="menu" size="20px" />
      </button>

      <div style={styles.title}>
        <span style={styles.file} data-phone-top="file">
          {fileName ?? "No file open"}
        </span>
        <span style={styles.line} ref={lineRef} data-phone-top="readout" />
      </div>

      <button
        type="button"
        style={styles.square}
        data-phone-top="lamp"
        data-stave-eval-lamp={evalError ? "error" : "ok"}
        aria-label={evalError ? `Evaluation failed: ${evalError}. Show the error` : "No evaluation errors. Open the Console"}
        onClick={onEvalLamp}
      >
        <span style={{ ...styles.dot, ...(evalError ? styles.dotErr : {}) }} />
      </button>

      <button
        type="button"
        style={{ ...styles.play, ...(isPlaying ? styles.playOn : {}), ...(canPlay ? {} : styles.playOff) }}
        data-phone-top="play"
        aria-label={isPlaying ? "Stop" : "Play"}
        disabled={!canPlay}
        onClick={isPlaying ? onStop : onPlay}
      >
        <Icon name={isPlaying ? "debug-stop" : "play"} size="18px" />
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flex: "none",
    minHeight: TOUCH + 4,
    boxSizing: "border-box",
    // a notch at the top, or at either side when the phone is turned
    paddingTop: "env(safe-area-inset-top)",
    paddingLeft: "max(2px, env(safe-area-inset-left))",
    paddingRight: "max(6px, env(safe-area-inset-right))",
    background: "var(--bg-chrome)",
    borderBottom: "1px solid var(--border-subtle)",
    color: "var(--text-chrome)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  square: {
    width: TOUCH,
    height: TOUCH,
    flex: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    color: "var(--text-chrome)",
    cursor: "pointer",
  },
  title: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 2,
    padding: "0 4px",
  },
  file: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  line: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    fontFamily: 'var(--font-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace)',
    color: "var(--text-secondary)",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "var(--text-muted)",
  },
  dotErr: {
    background: "#ff8080",
    boxShadow: "0 0 6px rgba(255,128,128,0.6)",
  },
  play: {
    width: 56,
    height: TOUCH,
    flex: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    border: "none",
    background: "var(--accent, #7c7cff)",
    color: "#fff",
    cursor: "pointer",
  },
  playOn: {
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
  },
  playOff: {
    opacity: 0.4,
    cursor: "default",
  },
};
