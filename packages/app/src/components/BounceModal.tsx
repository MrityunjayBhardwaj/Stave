"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bounceOffers,
  formatDuration,
  maxBounceSeconds,
  maxStemsSeconds,
  type BounceSizing,
} from "./songLength";

/**
 * #1346 — "Bounce to WAV": the first way to get audio out of Stave.
 *
 * #1631 — a bounce RENDERS OFFLINE when the file's engine can, through the
 * same audio graph as playback but faster than the song plays. There is no
 * clock to show, because an offline render reports no progress, and nothing to
 * keep from a Cancel: a cancelled render stops at its next pause and keeps
 * nothing (#1655). So that phase is a plain "Rendering…" line and a Cancel that
 * saves nothing, which reads "Cancelling…" until the render has wound down
 * (#1649).
 *
 * Otherwise it falls back to `LiveRecorder`, which captures the live output in
 * REAL TIME — thirty seconds of audio costs thirty seconds of wall clock. That
 * path keeps the progress bar and a Stop that is not a discard: the recorder
 * resolves with what it captured, so Stop yields a shorter file.
 */

/**
 * Fixed lengths, in seconds. On the live path each is also its own cost.
 *
 * These are the fallback, not the point: they are the only thing on offer for a
 * document whose length cannot be measured (56 of 142 real documents have no
 * measurable period, #1365). The 60s ceiling is gone — it existed only because
 * every option had to be a number someone picked by hand.
 */
const DURATIONS = [8, 16, 30, 60, 120, 300] as const;

export type BounceState =
  | { phase: "choosing" }
  /**
   * #2343 — the file came from the gallery and nobody has agreed to run it: the
   * trust question is up, and nothing renders until it is answered.
   */
  | { phase: "asking" }
  /**
   * #1356 — between Start and the first captured sample. The graph is allowed
   * to fall silent first, because a take started while the previous one is
   * still ringing records both. Usually imperceptible; up to ~1.3s when the
   * user bounces straight after stopping.
   */
  | { phase: "preparing" }
  | { phase: "recording"; seconds: number; elapsed: number }
  /**
   * #1631 — an offline render of `seconds` of audio is under way. There is no
   * elapsed time: the render reports no progress, and it finishes faster than
   * the song would play.
   *
   * #1649 — `cancelling` once Cancel has been pressed. The render stops being
   * fed at its next pause and then ends, so the press is acknowledged at once
   * rather than when the render resolves.
   */
  | {
      phase: "rendering";
      seconds: number;
      cancelling?: boolean;
      /** #1650 — seconds rendered so far; absent until the render first reports. */
      rendered?: number;
      /**
       * #1648 — set when this render is a stems export. `rendered` then counts
       * across every stem, out of `total`.
       */
      stems?: { total: number };
    }
  | { phase: "encoding" };

interface BounceModalProps {
  open: boolean;
  /** Progress state, owned by the caller so the timer survives re-renders. */
  state: BounceState;
  /**
   * What the document says about its own length, or `null` while that is still
   * being measured — which is NOT the same as "it has no length", and renders as
   * the plain seconds picker rather than as a refusal.
   */
  sizing: BounceSizing | null;
  /**
   * #1631 — whether the active file's bounce renders offline. Decides the copy
   * while choosing, which has to say what Start will cost before it is pressed.
   */
  offline: boolean;
  /**
   * #1648 — how many stems the active file would export, and 0 when it cannot
   * export any. Stems render offline only, so the choice is shown only when
   * both hold.
   *
   * #1666 — a COUNT rather than a flag, because the count is what sets the
   * ceiling: a stems export renders the song once per track and holds every
   * result at once, so its cost is seconds x tracks. See `maxStemsSeconds`.
   */
  stemTracks?: number;
  onClose: () => void;
  /** `stems` is true when the user chose one WAV per track (#1648). */
  onStart: (seconds: number, stems: boolean) => void;
  onStop: () => void;
}

export function BounceModal({
  open,
  state,
  sizing,
  offline,
  stemTracks = 0,
  onClose,
  onStart,
  onStop,
}: BounceModalProps) {
  const [selected, setSelected] = useState<number>(DURATIONS[0]);
  // #1648 — Mix or Stems. Reset to Mix each time the dialog opens, so a stems
  // export is always a choice made for this bounce.
  const [stemsChosen, setStemsChosen] = useState(false);
  const canStems = offline && stemTracks > 0;
  const stems = canStems && stemsChosen;
  useEffect(() => {
    if (!open) setStemsChosen(false);
  }, [open]);
  const startBtnRef = useRef<HTMLButtonElement>(null);

  // #1652 — the path sets the ceiling, so an offline render is offered repeats a
  // live take would not be. #1666 — and a stems export, which pays for the
  // length once per track, is offered less than the mix of the same song.
  const { offers, note } = useMemo(
    () => bounceOffers(sizing, offline, stems ? stemTracks : 0),
    [sizing, offline, stems, stemTracks],
  );
  const ceiling = stems ? maxStemsSeconds(stemTracks) : maxBounceSeconds(offline);

  // When the measurement lands, move the default onto the document's own answer
  // — the whole point is that the user should not have to translate bars into
  // seconds. Only while CHOOSING, and only until they touch something: re-running
  // this after a manual pick would fight the user for the selection.
  const tookSongDefault = useRef(false);
  useEffect(() => {
    if (!open) {
      tookSongDefault.current = false;
      return;
    }
    if (tookSongDefault.current || offers.length === 0) return;
    tookSongDefault.current = true;
    setSelected(offers[0].seconds);
  }, [open, offers]);

  // #1666 — choosing Stems can drop the ceiling below what is already selected:
  // the grids below re-draw against the new ceiling, but a pick made before the
  // switch does not, so Start would begin an export the dialog no longer
  // offers. Land on the longest thing still on offer instead of silently
  // keeping the old number.
  useEffect(() => {
    if (!open || selected <= ceiling) return;
    const allowed = [
      ...offers.map((o) => o.seconds),
      ...DURATIONS.filter((d) => d <= ceiling),
    ];
    if (allowed.length > 0) setSelected(Math.max(...allowed));
  }, [open, selected, ceiling, offers]);

  useEffect(() => {
    if (open && state.phase === "choosing") startBtnRef.current?.focus();
  }, [open, state.phase]);

  // Escape closes while choosing, and stops while recording — it must never
  // dismiss the modal mid-take, or the recorder would keep running with its
  // progress invisible and the transport still under its control.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (state.phase === "choosing") onClose();
      else if (
        state.phase === "recording" ||
        state.phase === "preparing" ||
        state.phase === "rendering"
      )
        onStop();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, state.phase, onClose, onStop]);

  const handleStart = useCallback(() => onStart(selected, stems), [onStart, selected, stems]);

  if (!open) return null;

  const recording = state.phase === "recording";
  const pct = recording ? Math.min(100, (state.elapsed / state.seconds) * 100) : 0;
  // ROUNDED, not raw. Under a minute this deliberately reads "13 seconds"
  // rather than "0:13" — natural for the fixed picks, which are whole numbers
  // anyway. But a SONG-derived length is `cycles / cps`, so `selected` is
  // usually a repeating decimal, and interpolating it bare printed
  // "13.333333333333334 seconds". The `>= 60` branch hid this: it formats, so
  // only songs under a minute showed it. One expression serves both the offline
  // and the live sentence (#1631), so they cannot format one length two ways.
  const selectedLabel =
    selected < 60 ? `${Math.round(selected)} seconds` : formatDuration(selected);

  return (
    <div
      style={styles.backdrop}
      // Only a click-out while choosing dismisses — same reasoning as Escape.
      onClick={state.phase === "choosing" ? onClose : undefined}
    >
      <div
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Bounce to WAV"
      >
        <div style={styles.header}>
          <h2 style={styles.title}>Bounce to WAV</h2>
          {state.phase === "choosing" && (
            <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>

        <div style={styles.body}>
          {state.phase === "choosing" && (
            <>
              {offers.length > 0 && (
                <>
                  <div style={styles.sectionLabel}>This song</div>
                  <div style={styles.grid} data-testid="bounce-song-offers">
                    {offers.map((o) => (
                      <button
                        key={o.id}
                        onClick={() => setSelected(o.seconds)}
                        aria-pressed={o.seconds === selected}
                        style={{
                          ...styles.card,
                          ...(o.seconds === selected ? styles.cardSelected : {}),
                        }}
                      >
                        <div style={styles.cardName}>{o.label}</div>
                        <div style={styles.cardSub}>{formatDuration(o.seconds)}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {note && (
                <p style={styles.note} data-testid="bounce-length-note">
                  {note}
                </p>
              )}

              <div style={styles.sectionLabel}>
                {offers.length > 0 ? "Or a fixed length" : "Length"}
              </div>
              <div style={styles.grid}>
                {DURATIONS.filter((d) => d <= ceiling).map((d) => (
                  <button
                    key={d}
                    onClick={() => setSelected(d)}
                    aria-pressed={d === selected}
                    style={{
                      ...styles.card,
                      ...(d === selected ? styles.cardSelected : {}),
                    }}
                  >
                    <div style={styles.cardName}>{d}s</div>
                  </button>
                ))}
              </div>
              {canStems && (
                <>
                  <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Export</div>
                  <div style={styles.grid} data-testid="bounce-export-kind">
                    {[
                      { label: "Mix", value: false },
                      { label: "Stems", value: true },
                    ].map((o) => (
                      <button
                        key={o.label}
                        onClick={() => setStemsChosen(o.value)}
                        aria-pressed={o.value === stems}
                        style={{
                          ...styles.card,
                          ...(o.value === stems ? styles.cardSelected : {}),
                        }}
                      >
                        <div style={styles.cardName}>{o.label}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {stems ? (
                <p style={styles.note}>
                  Exports one WAV per track in a zip, each {selectedLabel} long and
                  lined up with the mix, with the song&apos;s shared effects on every
                  track. Playback stops while it renders.
                </p>
              ) : offline ? (
                <p style={styles.note}>
                  Bouncing renders {selectedLabel} of audio faster than real time,
                  through the same sounds as playback. Playback stops while it
                  renders.
                </p>
              ) : (
                <p style={styles.note}>
                  Bouncing records the live output, so it takes as long as it plays —
                  this one will take {selectedLabel}. Playback starts
                  automatically and stops again when the bounce finishes.
                </p>
              )}
            </>
          )}

          {recording && (
            <>
              <div style={styles.sectionLabel}>
                {/* Both sides go through `formatDuration`, which is what the
                    chooser above already shows. A song's length is `cycles /
                    cps` and is usually a repeating decimal — 40 cycles at 0.55
                    cps is 72.72727272727272 — so an unformatted `state.seconds`
                    put fifteen digits on screen for the whole take, next to a
                    card that said "1:13". */}
                Recording — {formatDuration(state.elapsed)} of{" "}
                {formatDuration(state.seconds)}
              </div>
              <div
                style={styles.track}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={state.seconds}
                aria-valuenow={Math.floor(state.elapsed)}
              >
                <div style={{ ...styles.fill, width: `${pct}%` }} />
              </div>
              <p style={styles.note}>
                Stopping early keeps what has been recorded so far.
              </p>
            </>
          )}

          {state.phase === "rendering" && !state.cancelling && (
            <>
              <div style={styles.sectionLabel}>
                {state.stems
                  ? `Rendering stems — ${formatDuration(state.seconds)} each…`
                  : `Rendering ${formatDuration(state.seconds)} of audio…`}
              </div>
              {/* #1650 — the same bar the live take draws, filled from how far
                  the render has got. Absent until the first report, rather
                  than an empty bar that reads as stuck. */}
              {state.rendered !== undefined && (
                <div
                  style={styles.track}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={state.stems?.total ?? state.seconds}
                  aria-valuenow={Math.floor(state.rendered)}
                >
                  <div
                    style={{
                      ...styles.fill,
                      width: `${Math.min(100, (state.rendered / Math.max(state.stems?.total ?? state.seconds, 1e-9)) * 100)}%`,
                    }}
                  />
                </div>
              )}
              <p style={styles.note}>
                Cancel discards the render — nothing is saved.
              </p>
            </>
          )}

          {state.phase === "rendering" && state.cancelling && (
            <div style={styles.sectionLabel}>Cancelling…</div>
          )}

          {state.phase === "preparing" && (
            <div style={styles.sectionLabel}>Waiting for the audio to settle…</div>
          )}

          {state.phase === "asking" && (
            <div style={styles.sectionLabel} data-bounce-asking>
              Waiting for your answer before running this code…
            </div>
          )}

          {state.phase === "encoding" && (
            <div style={styles.sectionLabel}>Encoding WAV…</div>
          )}
        </div>

        <div style={styles.footer}>
          {state.phase === "choosing" ? (
            <>
              <button style={styles.cancelBtn} onClick={onClose}>
                Cancel
              </button>
              <button ref={startBtnRef} style={styles.primaryBtn} onClick={handleStart}>
                Start Bounce
              </button>
            </>
          ) : (
            <button
              style={styles.cancelBtn}
              onClick={onStop}
              // Live during `preparing` too: aborting before the first sample is
              // well-defined (the recorder sees an already-aborted signal and
              // resolves at once), so the user is never stranded in the settle.
              // #1649 — and once a cancel is under way: a second press has
              // nothing left to do.
              disabled={state.phase === "encoding" || (state.phase === "rendering" && state.cancelling === true)}
            >
              {/* #1631 — a render keeps nothing from a cancel, so it is not
                  called Stop, which on the live path keeps a shorter take. */}
              {state.phase === "rendering" ? "Cancel" : "Stop"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────
// Mirrors TemplateModal so the two read as one chrome.

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "var(--bg-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  modal: {
    width: 420,
    maxWidth: "90vw",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    color: "var(--text-chrome)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    borderBottom: "1px solid var(--border-subtle)",
  },
  title: { margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text-primary)" },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--text-icon)",
    fontSize: 24,
    cursor: "pointer",
    padding: "0 4px",
    lineHeight: 1,
  },
  body: { padding: "16px 20px" },
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-tertiary)",
    marginBottom: 10,
    fontWeight: 600,
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  card: {
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    padding: "12px 0",
    cursor: "pointer",
    color: "var(--text-chrome)",
    transition: "all 0.1s",
  },
  cardSelected: {
    background: "var(--bg-hover)",
    borderColor: "var(--accent)",
    boxShadow: "0 0 0 1px var(--accent)",
  },
  cardName: { fontSize: 14, fontWeight: 600 },
  cardSub: { fontSize: 12, opacity: 0.7, marginTop: 2 },
  note: {
    margin: "14px 0 0",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-tertiary)",
  },
  track: {
    height: 6,
    borderRadius: 3,
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
    overflow: "hidden",
  },
  fill: { height: "100%", background: "var(--accent)", transition: "width 0.2s linear" },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    padding: "12px 20px 16px",
    borderTop: "1px solid var(--border-subtle)",
  },
  cancelBtn: {
    background: "none",
    border: "1px solid var(--border-subtle)",
    borderRadius: 5,
    color: "var(--text-chrome)",
    padding: "7px 14px",
    fontSize: 13,
    cursor: "pointer",
  },
  primaryBtn: {
    background: "var(--accent)",
    border: "1px solid var(--accent)",
    borderRadius: 5,
    color: "#fff",
    padding: "7px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
};
