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
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { parseFromFrame, type FromFrame, type PreviewKind } from "./previewProtocol";

export const PLAYER_PATH = "/gallery-player";
const LOAD_SLOW_MS = 15_000;

export function GalleryPreview({ code, kind, fileKey }: { code: string; kind: PreviewKind; fileKey: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<FromFrame | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const wantPlay = useRef(false);

  const send = useCallback((msg: unknown) => {
    // The frame's origin is opaque, so no origin can name it: "*" is the only
    // target that reaches it. What goes in is the entry's own (public) code.
    frameRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  // A different file (or entry) closes the preview rather than playing the old code.
  useEffect(() => {
    setOpen(false);
    setStatus(null);
    wantPlay.current = false;
  }, [fileKey]);

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
        if (wantPlay.current) send({ play: true, code, kind });
        wantPlay.current = false;
        return;
      }
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
  }, [open, code, kind, send]);

  const playing = status?.state === "playing";
  const onPreview = () => {
    if (!open) {
      wantPlay.current = true;
      setStatus({ state: "stopped", message: "Loading the preview…" });
      setOpen(true);
      return;
    }
    if (playing) send({ stop: true });
    else send({ play: true, code, kind });
  };

  return (
    <div className="sg-sandbox" data-gallery-preview={fileKey}>
      <div className="sg-sandbox-bar">
        <button className="sg-btn" data-gallery-preview-button onClick={onPreview}>
          {playing ? "Stop preview" : "Preview"}
        </button>
        {open && (
          <button
            className="sg-btn sg-quiet"
            onClick={() => {
              setOpen(false);
              setStatus(null);
            }}
          >
            Close preview
          </button>
        )}
        <span className="sg-sandbox-status" data-gallery-preview-state={status?.state ?? "closed"}>
          {status?.state === "playing" &&
            (status.message
              ? `Playing in a sealed preview. The code reported an error: ${status.message}`
              : "Playing in a sealed preview.")}
          {status?.state === "stopped" && (status.message ?? "Stopped.")}
          {status?.state === "error" && `The code reported an error: ${status.message ?? "unknown"}`}
          {!status && "Plays in a sealed frame that can't reach your projects or account."}
        </span>
      </div>
      {open && (
        <iframe
          ref={frameRef}
          className="sg-sandbox-frame"
          // sound needs only a status line (and room for a Play button); a picture needs room
          style={kind === "strudel" ? { height: 96 } : undefined}
          title="Gallery preview"
          src={PLAYER_PATH}
          sandbox="allow-scripts"
          allow="autoplay"
          data-gallery-preview-frame
        />
      )}
    </div>
  );
}
