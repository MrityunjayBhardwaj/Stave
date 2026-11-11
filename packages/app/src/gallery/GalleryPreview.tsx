"use client";

/**
 * Community gallery (#2328) — the Preview button on an entry, and the sandboxed
 * frame it plays the entry's code in.
 *
 * The frame is `<iframe sandbox="allow-scripts">` with NO `allow-same-origin`:
 * the code gets an opaque origin, so it can't read this browser's projects,
 * keys or cookies, and Stave's API refuses what it sends (its Origin is
 * `null`). The code goes in by `postMessage`; only "ready / playing / stopped /
 * error" comes back, from that frame and in that shape (previewProtocol.ts).
 *
 * #2343 — the code in the frame can still navigate the frame itself (a sandbox
 * without `allow-top-navigation` keeps it off the page, not off its own box), so
 * something else could appear where the preview was: a page that looks like a
 * sign-in, say. The player never reloads itself, and the code only goes in once
 * the player has loaded, so any load of the frame after that is the code taking
 * it somewhere else: the preview is closed and says so.
 *
 * #2374 — the app's `frame-src` policy (next.config.ts) refuses a navigation to
 * another site before anything from it shows, a page that never finishes loading
 * included. In Chromium and WebKit the refusal still fires this frame's load, so
 * the preview closes as above; in a browser where it doesn't, the player just
 * stays up. Code can still draw whatever it likes inside its own page.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { NEEDS_CLICK, parseFromFrame, type FromFrame, type PreviewKind } from "./previewProtocol";

export const PLAYER_PATH = "/gallery-player";
const LOAD_SLOW_MS = 15_000;
export const NAVIGATED_AWAY =
  "The preview was closed: its code tried to open another page in the preview's place.";

/** #2491 — what the entry page's file rows can do with the one preview. */
export interface GalleryPreviewHandle {
  /** Play, or stop when playing — the big button's press. */
  toggle(): void;
}

export interface GalleryPreviewProps {
  code: string;
  kind: PreviewKind;
  fileKey: string;
  /** Start playing as soon as this file is shown (a file row's play button chose it). */
  autoStart?: boolean;
  /** Playing or not — so the file row that started it can show Stop. */
  onPlayingChange?: (playing: boolean) => void;
  /** #2488 — what the stage shows before it plays: the file's recorded timeline, when there is one. */
  idle?: React.ReactNode;
}

/**
 * #2491 — the preview leads the entry page: a large stage with the play button
 * and the sealed-frame note on it. One preview, so one sound at a time: a file
 * row's play button switches the file it holds.
 */
export const GalleryPreview = forwardRef<GalleryPreviewHandle, GalleryPreviewProps>(function GalleryPreview(
  { code, kind, fileKey, autoStart = false, onPlayingChange, idle },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<FromFrame | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const wantPlay = useRef(false);
  // The frame's own load and its "ready", both needed before code goes in; and
  // whether code has gone in (after which a load is a navigation).
  const frameLoaded = useRef(false);
  const frameReady = useRef(false);
  const codeSent = useRef(false);
  // #2547 — this page has just asked the frame to play and is waiting for its
  // answer. Only that answer may move focus into the frame: the frame runs the
  // entry's own code, which can post any message it likes at any time.
  const awaitingStart = useRef(false);

  const send = useCallback((msg: unknown) => {
    // The frame's origin is opaque, so no origin can name it: "*" is the only
    // target that reaches it. What goes in is the entry's own (public) code.
    frameRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  /** Ask the frame to play this code; its next answer is the one focus may follow. */
  const askToPlay = useCallback(() => {
    codeSent.current = true;
    awaitingStart.current = true;
    send({ play: true, code, kind });
  }, [send, code, kind]);

  /** Play, once the player has both loaded and said it is listening. */
  const playWhenLoaded = useCallback(() => {
    if (!wantPlay.current || !frameLoaded.current || !frameReady.current) return;
    wantPlay.current = false;
    askToPlay();
  }, [askToPlay]);

  // A different file (or entry) closes the preview rather than playing the old code —
  // and, when a file row asked for it, opens a fresh one for the new file.
  const autoStartRef = useRef(autoStart);
  autoStartRef.current = autoStart;
  useEffect(() => {
    if (autoStartRef.current) {
      wantPlay.current = true;
      setStatus({ state: "stopped", message: "Loading the preview…" });
      setOpen(false);
      // A new frame for the new code: close, then open on the next frame.
      const t = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(t);
    }
    setOpen(false);
    setStatus(null);
    wantPlay.current = false;
  }, [fileKey]);

  // A fresh frame each time the preview opens.
  useEffect(() => {
    if (!open) return;
    frameLoaded.current = false;
    frameReady.current = false;
    codeSent.current = false;
    awaitingStart.current = false;
  }, [open]);

  const onFrameLoad = () => {
    if (codeSent.current) {
      setOpen(false);
      setStatus({ state: "stopped", message: NAVIGATED_AWAY });
      wantPlay.current = false;
      return;
    }
    frameLoaded.current = true;
    playWhenLoaded();
  };

  useEffect(() => {
    if (!open) return;
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      // A sandboxed frame without allow-same-origin always reports "null".
      if (event.origin !== "null") return;
      const msg = parseFromFrame(event.data);
      if (!msg) return;
      if (msg.state === "ready") {
        frameReady.current = true;
        playWhenLoaded();
        return;
      }
      // #2495 — the frame needs a press of its own (WebKit doesn't take this
      // page's click): put focus on the frame, where Enter or Space is that press
      // (GalleryPlayer listens for it) and its Play is the obvious click.
      // #2547 — but only as the answer to this page's own request to play: the
      // first message after it, whatever it says, ends the wait. A NEEDS_CLICK
      // the code posts by itself (unasked, or after it already answered) moves
      // nothing, so it can't pull your keys out of the search box.
      const answer = awaitingStart.current;
      awaitingStart.current = false;
      if (answer && msg.state === "stopped" && msg.message === NEEDS_CLICK) frame.focus();
      setStatus(msg);
    };
    window.addEventListener("message", onMessage);
    // A frame that is slow to say it's ready (or never does: its scripts didn't
    // load) shouldn't leave a bare "Loading…" up. It still plays if it gets there.
    const timer = window.setTimeout(() => {
      if (!wantPlay.current) return;
      setStatus({
        state: "stopped",
        // `next dev` refuses the scripts of an opaque-origin frame and its client
        // never starts there (observed, #2328); a production build serves it.
        message:
          process.env.NODE_ENV === "development"
            ? "Previews don't load on the development server — try a production build (next build && next start)."
            : "The preview is taking a while to load…",
      });
    }, LOAD_SLOW_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [open, playWhenLoaded]);

  const playing = status?.state === "playing";
  const playingChange = useRef(onPlayingChange);
  playingChange.current = onPlayingChange;
  useEffect(() => playingChange.current?.(playing), [playing]);
  const onPreview = () => {
    if (!open) {
      wantPlay.current = true;
      setStatus({ state: "stopped", message: "Loading the preview…" });
      setOpen(true);
      return;
    }
    if (playing) send({ stop: true });
    else askToPlay();
  };

  useImperativeHandle(ref, () => ({ toggle: onPreview }));

  const statusText =
    status?.state === "playing"
      ? status.message
        ? `Playing in a sealed preview. The code reported an error: ${status.message}`
        : "Playing in a sealed preview."
      : status?.state === "stopped"
        ? (status.message ?? "Stopped.")
        : status?.state === "error"
          ? `The code reported an error: ${status.message ?? "unknown"}`
          : "Plays in a sealed frame. It can't reach your projects or account.";

  return (
    <div className={kind === "strudel" ? "sg-stage sg-stage-sound" : "sg-stage"} data-gallery-preview={fileKey}>
      {open ? (
        <iframe
          ref={frameRef}
          className="sg-stage-frame"
          title="Gallery preview"
          src={PLAYER_PATH}
          sandbox="allow-scripts"
          allow="autoplay"
          onLoad={onFrameLoad}
          data-gallery-preview-frame
        />
      ) : (
        (idle ?? (
          <div className="sg-stage-idle" aria-hidden="true">
            <span>{kind === "strudel" ? "Pattern" : "Visual"}</span>
          </div>
        ))
      )}
      <div className="sg-stage-bar">
        <button
          className="sg-bigplay"
          data-gallery-preview-button
          aria-label={playing ? "Stop preview" : "Preview"}
          title={playing ? "Stop preview" : "Preview"}
          onClick={onPreview}
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>
          )}
        </button>
        <span className="sg-sealed" data-gallery-preview-state={status?.state ?? "closed"}>
          {!status && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          )}
          {statusText}
        </span>
        {open && (
          <button
            className="sg-stage-close"
            onClick={() => {
              setOpen(false);
              setStatus(null);
            }}
          >
            Close preview
          </button>
        )}
      </div>
    </div>
  );
});
