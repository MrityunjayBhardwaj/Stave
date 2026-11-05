"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  VizPresetStore,
  compilePreset,
  mountVizRenderer,
  workspaceAudioBus,
  setZoneCropOverride,
  getZoneCropOverride,
  getFile,
  getActiveProjectId,
  rendererForLanguage,
  type AudioSourceRef,
  type CropRegion,
  type EngineComponents,
  type VizPreset,
  type VizRenderer,
} from "@stave/editor";
import { showToast } from "../dialogs/host";
import { mayEvaluate } from "../gallery/runGate";

/**
 * CropAdapter — everything about a given crop session that differs
 * between inline-zone crops and backdrop crops. The popup's render
 * body (preview, drag-handles, Save/Reset buttons) is identical for
 * every mode; adapters supply the mode-specific plumbing.
 *
 * - `title`: header text, e.g. "Crop — pianoroll" or "Crop — Backdrop".
 * - `loadPreset`: async, returns the VizPreset to compile for preview.
 * - `sourceRef`: which audio publisher to subscribe to.
 * - `narrowComponents`: inline narrows by trackKey; backdrop passes
 *   through. Receives the bag from workspaceAudioBus payload; returns
 *   what to hand to `mountVizRenderer`.
 * - `initialCrop`: where to start (per-instance override or saved).
 * - `saveCrop` / `clearCrop`: persistence.
 */
export interface CropAdapter {
  title: string;
  loadPreset: () => Promise<VizPreset | null>;
  sourceRef: AudioSourceRef;
  narrowComponents: (
    bag: Partial<EngineComponents>,
  ) => Partial<EngineComponents>;
  initialCrop: CropRegion;
  saveCrop: (crop: CropRegion) => void;
  clearCrop: () => void;
  onSaved?: () => void;
  onCleared?: () => void;
  /** If set, the viz renders at this size (matching the real container)
   *  and is CSS-scaled down to fit the preview area. Preserves the
   *  exact layout the user sees in the editor. */
  renderSize?: { w: number; h: number };
}

/**
 * Inline adapter — matches the classic behavior: per-zone override
 * keyed by (fileId, trackKey), narrows EngineComponents to the
 * named track's analyser / scheduler / hapStream before preview.
 */
export function createInlineCropAdapter(opts: {
  vizId: string;
  presetId: string;
  fileId: string;
  trackKey: string;
}): CropAdapter {
  const { vizId, presetId, fileId, trackKey } = opts;
  return {
    title: `Crop — ${vizId}`,
    loadPreset: () => VizPresetStore.get(presetId).then((p) => p ?? null),
    sourceRef: { kind: "file", fileId },
    narrowComponents: (components) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = components as any;
      const audioCtx = c.audio?.audioCtx;
      const trackAnalyser = c.audio?.trackAnalysers?.get(trackKey);
      const trackStream = c.inlineViz?.trackStreams?.get(trackKey);
      const trackScheduler =
        c.queryable?.trackSchedulers?.get(trackKey) ?? null;
      const zoneAudio = trackAnalyser && audioCtx
        ? { analyser: trackAnalyser, audioCtx, trackAnalysers: c.audio?.trackAnalysers }
        : c.audio;
      return {
        ...c,
        ...(trackStream ? { streaming: { hapStream: trackStream } } : {}),
        audio: zoneAudio,
        queryable: {
          scheduler: trackScheduler,
          trackSchedulers: c.queryable?.trackSchedulers ?? new Map(),
        },
      };
    },
    initialCrop: getZoneCropOverride(fileId, trackKey) ?? {
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    },
    saveCrop: (crop) => {
      const hash = document.querySelector(`[data-viz-zone-track="${trackKey}"]`)?.getAttribute('data-viz-zone-hash') ?? undefined;
      setZoneCropOverride(fileId, trackKey, crop, vizId, hash);
      showToast(`Crop saved for "${vizId}"`, "info");
    },
    clearCrop: () => {
      setZoneCropOverride(fileId, trackKey, null);
      showToast(`Crop cleared for "${vizId}"`, "info");
    },
  };
}

/**
 * Backdrop adapter — REPORTS the crop, does not store it (#1435). No audio
 * narrowing: backdrop uses the whole components bag so the sketch sees the
 * same scheduler / analyser the live backdrop does. Preset is synthesized
 * from the viz file's current content (live-reload applies after close).
 *
 * The adapter used to write `ProjectMeta.backgroundCrop` itself — one crop per
 * project — so a rect cut for one sketch rode onto the next backdrop pinned,
 * while the toast below named the file it was saved "for". The write now goes
 * through `persist`, and the caller keys it by the viz FILE, which is what the
 * toast has claimed all along.
 */
export function createBackdropCropAdapter(opts: {
  fileId: string;
  initialCrop: CropRegion | null;
  /** Store (or, with `null`, forget) this file's crop. Owned by the caller. */
  persist: (crop: CropRegion | null) => void;
  renderSize?: { w: number; h: number };
}): CropAdapter {
  const { fileId, initialCrop, persist, renderSize } = opts;
  const displayName = (() => {
    const f = getFile(fileId);
    if (!f) return "Backdrop";
    const parts = f.path.split("/");
    return parts[parts.length - 1].replace(/\.[^.]+$/, "");
  })();
  return {
    title: `Crop — Backdrop: ${displayName}`,
    loadPreset: async () => {
      const file = getFile(fileId);
      if (!file) return null;
      // #2344 — the crop preview runs the file's code; a gallery file nobody has
      // agreed to run shows the placeholder instead.
      const projectId = getActiveProjectId();
      if (projectId && !mayEvaluate(projectId, fileId)) return null;
      const renderer: VizPreset["renderer"] =
        rendererForLanguage(file.language) ?? "p5";
      return {
        id: file.id,
        name: file.path,
        renderer,
        code: file.content,
        requires: [],
        createdAt: 0,
        updatedAt: 0,
      };
    },
    sourceRef: { kind: "default" },
    narrowComponents: (components) => components,
    initialCrop: initialCrop ?? { x: 0, y: 0, w: 1, h: 1 },
    renderSize,
    saveCrop: (crop) => {
      persist(crop);
      showToast(`Backdrop crop saved for "${displayName}"`, "info");
    },
    clearCrop: () => {
      persist(null);
      showToast(`Backdrop crop cleared for "${displayName}"`, "info");
    },
  };
}

/**
 * Props — either the classic inline shape (backward-compatible) or
 * an explicit adapter for non-inline modes (backdrop). Unknown in
 * the adapter path: `vizId` / `presetId` / `fileId` / `trackKey`
 * are all encapsulated by the adapter.
 */
type CropPopupProps =
  | {
      vizId: string;
      presetId: string;
      fileId: string;
      trackKey: string;
      renderSize?: { w: number; h: number };
      onClose: () => void;
    }
  | {
      adapter: CropAdapter;
      onClose: () => void;
    };

const PREVIEW_W = 640;
const PREVIEW_H = 400;

export function CropPopup(props: CropPopupProps) {
  // Classic inline callers (vizId + presetId + fileId + trackKey)
  // are still supported — we build an inline adapter from their
  // props. Backdrop callers pass `adapter` directly. Adapter must
  // be stable across renders so the mount-effect doesn't thrash;
  // inline callers' props are stable for the lifetime of the popup,
  // so a useMemo on the relevant keys keeps the adapter ref stable.
  const adapter = useMemo<CropAdapter>(() => {
    if ("adapter" in props) return props.adapter;
    const a = createInlineCropAdapter({
      vizId: props.vizId,
      presetId: props.presetId,
      fileId: props.fileId,
      trackKey: props.trackKey,
    });
    if (props.renderSize) a.renderSize = props.renderSize;
    return a;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    "adapter" in props ? props.adapter : null,
    "adapter" in props ? null : props.vizId,
    "adapter" in props ? null : props.presetId,
    "adapter" in props ? null : props.fileId,
    "adapter" in props ? null : props.trackKey,
  ]);

  const onClose = props.onClose;

  // When renderSize is set, the preview area preserves that aspect
  // ratio. Fit it within the max preview bounds (PREVIEW_W × PREVIEW_H).
  const renderW = adapter.renderSize?.w ?? PREVIEW_W;
  const renderH = adapter.renderSize?.h ?? PREVIEW_H;
  const aspect = renderW / renderH;
  const previewW = aspect >= PREVIEW_W / PREVIEW_H
    ? PREVIEW_W
    : Math.round(PREVIEW_H * aspect);
  const previewH = aspect >= PREVIEW_W / PREVIEW_H
    ? Math.round(PREVIEW_W / aspect)
    : PREVIEW_H;
  const canvasScaleX = previewW / renderW;
  const canvasScaleY = previewH / renderH;

  const [preset, setPreset] = useState<VizPreset | null>(null);
  const [crop, setCrop] = useState<CropRegion>(() => adapter.initialCrop);
  const [dragging, setDragging] = useState<
    | { kind: "move"; startX: number; startY: number; origCrop: CropRegion }
    | { kind: "resize"; edge: string; startX: number; startY: number; origCrop: CropRegion }
    | null
  >(null);
  // Proximity-gated handles — the handle closest to the cursor (within
  // PROXIMITY_PX) is "active": visually filled and pointer-events
  // enabled. All others are inert and invisible so dragging in empty
  // space doesn't accidentally catch an invisible edge strip. During
  // a drag, the active edge is locked to the dragging one; cursor
  // wandering doesn't hand the drag off to another handle.
  const [nearEdge, setNearEdge] = useState<string | null>(null);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<{ renderer: VizRenderer; disconnect: () => void } | null>(null);

  // Load preset via the adapter. The inline adapter reads from
  // VizPresetStore; the backdrop adapter synthesises a preset from
  // the workspace file's current content. Either way, `setPreset`
  // unblocks the mount effect below.
  useEffect(() => {
    let cancelled = false;
    adapter.loadPreset().then((p) => {
      if (!cancelled && p) setPreset(p);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  // Mount the live viz renderer once the preset is loaded
  useEffect(() => {
    if (!preset || !canvasContainerRef.current) return;

    let descriptor;
    try {
      descriptor = compilePreset(preset);
    } catch {
      return; // compile error — show placeholder only
    }

    // Subscribe fires synchronously with the current payload (if
    // any). Capture it, then mount once with either the real
    // components or empty fallback — so the viz always renders with
    // the same inputs the live editor sees.
    const container = canvasContainerRef.current!;
    let initialComponents: Partial<EngineComponents> = {};
    const unsub = workspaceAudioBus.subscribe(adapter.sourceRef, (payload) => {
      if (!payload) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialComponents = (payload.engineComponents ?? payload ?? {}) as Partial<EngineComponents>;
    });

    // If the adapter specifies a renderSize, render the viz at those
    // dimensions (matching the real container) — the CSS transform on
    // the canvas container scales it down to the preview area.
    const renderW = adapter.renderSize?.w ?? PREVIEW_W;
    const renderH = adapter.renderSize?.h ?? PREVIEW_H;
    const narrowed = adapter.narrowComponents(initialComponents);
    rendererRef.current = mountVizRenderer(
      container,
      descriptor.factory,
      narrowed,
      { w: renderW, h: renderH },
      console.error,
    );
    rendererRef.current.renderer.resume?.();

    return () => {
      unsub();
      if (rendererRef.current) {
        rendererRef.current.renderer.destroy();
        rendererRef.current.disconnect();
        rendererRef.current = null;
      }
    };
  }, [preset, adapter]);

  const handleSave = useCallback(() => {
    adapter.saveCrop(crop);
    onClose();
  }, [adapter, crop, onClose]);

  const handleReset = useCallback(() => {
    adapter.clearCrop();
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
  }, [adapter]);

  // Drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, kind: "move" | "resize", edge = "") => {
      e.preventDefault();
      e.stopPropagation();
      setDragging({ kind, edge, startX: e.clientX, startY: e.clientY, origCrop: { ...crop } } as any);
    },
    [crop],
  );

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragging.startX) / previewW;
      const dy = (e.clientY - dragging.startY) / previewH;
      const orig = dragging.origCrop;

      if (dragging.kind === "move") {
        setCrop({
          x: Math.max(0, Math.min(1 - orig.w, orig.x + dx)),
          y: Math.max(0, Math.min(1 - orig.h, orig.y + dy)),
          w: orig.w,
          h: orig.h,
        });
      } else if (dragging.kind === "resize") {
        const edge = (dragging as any).edge as string;
        const isCorner = edge.length === 2;
        const freeMode = e.ctrlKey || e.metaKey;
        let { x, y, w, h } = orig;

        if (isCorner && !freeMode) {
          // Aspect-ratio-locked corner drag. Use the axis with
          // the larger delta to drive, compute the other from the
          // original aspect ratio.
          const aspect = orig.w / orig.h;
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          let dw: number, dh: number;
          if (absDx >= absDy) {
            dw = dx; dh = dx / aspect;
          } else {
            dh = dy; dw = dy * aspect;
          }
          // Flip sign for west/north edges (shrink = positive delta).
          const signW = edge.includes("w") ? -1 : 1;
          const signH = edge.includes("n") ? -1 : 1;
          w = Math.max(0.05, orig.w + signW * dw);
          h = Math.max(0.05, orig.h + signH * dh);
          // Keep aspect ratio exact after clamping.
          if (w / h !== aspect) {
            if (absDx >= absDy) h = w / aspect;
            else w = h * aspect;
          }
          if (edge.includes("w")) x = orig.x + orig.w - w;
          if (edge.includes("n")) y = orig.y + orig.h - h;
          // Clamp to bounds.
          x = Math.max(0, x); y = Math.max(0, y);
          w = Math.min(w, 1 - x); h = Math.min(h, 1 - y);
        } else {
          // Free resize — edges or Ctrl/Cmd-held corners.
          if (edge.includes("e")) w = Math.max(0.05, Math.min(1 - x, w + dx));
          if (edge.includes("w")) { x = Math.max(0, Math.min(x + w - 0.05, x + dx)); w = orig.x + orig.w - x; }
          if (edge.includes("s")) h = Math.max(0.05, Math.min(1 - y, h + dy));
          if (edge.includes("n")) { y = Math.max(0, Math.min(y + h - 0.05, y + dy)); h = orig.y + orig.h - y; }
        }
        setCrop({ x, y, w, h });
      }
    };
    const handleUp = () => setDragging(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (!preset) return null;

  const visorStyle: React.CSSProperties = {
    position: "absolute",
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.w * 100}%`,
    height: `${crop.h * 100}%`,
    border: "2px solid var(--accent-strong, #7c7cff)",
    boxSizing: "border-box",
    cursor: "move",
    background: "transparent",
    zIndex: 2,
  };

  const dimStyle = (area: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    background: "rgba(0,0,0,0.55)",
    pointerEvents: "none",
    zIndex: 1,
    ...area,
  });

  // Which edge is "armed" for interaction right now — either the
  // one under active drag or the nearest one within proximity. Drag
  // wins to keep the grip stable while the cursor moves.
  const armedEdge =
    dragging?.kind === "resize" ? dragging.edge : nearEdge;

  const edgeHandle = (
    edge: string,
    base: React.CSSProperties,
    shape: "corner" | "edge",
  ): React.ReactElement => {
    const active = armedEdge === edge;
    const visual: React.CSSProperties = active
      ? shape === "corner"
        ? {
            background: "var(--accent-strong, #7c7cff)",
            borderRadius: "50%",
            boxShadow: "0 0 0 2px rgba(124, 124, 255, 0.25)",
          }
        : {
            background: "var(--accent-strong, #7c7cff)",
            borderRadius: 2,
            opacity: 0.85,
          }
      : {
          background: "transparent",
          border: "none",
        };
    return (
      <div
        key={edge}
        data-testid={`crop-handle-${edge}`}
        data-handle-active={active ? "true" : "false"}
        style={{
          position: "absolute",
          zIndex: 3,
          pointerEvents: active ? "auto" : "none",
          ...base,
          ...visual,
        }}
        onMouseDown={(e) => handleMouseDown(e, "resize", edge)}
      />
    );
  };

  /**
   * Compute the closest handle to the cursor, within PROXIMITY_PX.
   * Returns null if nothing is near. Used by the preview container's
   * `onMouseMove` to arm the right handle while the user explores
   * the edge. Coords are in container pixels (0..previewW/H).
   */
  const proximityEdge = (px: number, py: number): string | null => {
    const PROXIMITY_PX = 22;
    // Corners first (point targets, higher precedence).
    const corners: Array<[string, number, number]> = [
      ["nw", crop.x * previewW, crop.y * previewH],
      ["ne", (crop.x + crop.w) * previewW, crop.y * previewH],
      ["sw", crop.x * previewW, (crop.y + crop.h) * previewH],
      ["se", (crop.x + crop.w) * previewW, (crop.y + crop.h) * previewH],
    ];
    let best: { edge: string; d: number } | null = null;
    for (const [edge, cx, cy] of corners) {
      const dx = px - cx;
      const dy = py - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= PROXIMITY_PX && (!best || d < best.d)) {
        best = { edge, d };
      }
    }
    if (best) return best.edge;

    // Edges — distance to segment midpoints (approx; segment is 80%
    // of the side centred on the midpoint, so the midpoint distance
    // is a reasonable proxy for the user's "I'm near this edge"
    // intent).
    const edges: Array<[string, number, number]> = [
      ["n", (crop.x + crop.w / 2) * previewW, crop.y * previewH],
      ["s", (crop.x + crop.w / 2) * previewW, (crop.y + crop.h) * previewH],
      ["w", crop.x * previewW, (crop.y + crop.h / 2) * previewH],
      ["e", (crop.x + crop.w) * previewW, (crop.y + crop.h / 2) * previewH],
    ];
    for (const [edge, ex, ey] of edges) {
      let d: number;
      if (edge === "n" || edge === "s") {
        const outsideX =
          px < (crop.x + 0.1 * crop.w) * previewW ||
          px > (crop.x + 0.9 * crop.w) * previewW;
        if (outsideX) continue;
        d = Math.abs(py - ey);
      } else {
        const outsideY =
          py < (crop.y + 0.1 * crop.h) * previewH ||
          py > (crop.y + 0.9 * crop.h) * previewH;
        if (outsideY) continue;
        d = Math.abs(px - ex);
      }
      if (d <= PROXIMITY_PX && (!best || d < best.d)) {
        best = { edge, d };
      }
    }
    return best?.edge ?? null;
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.title}>{adapter.title}</div>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={styles.body}>
          <div
            onMouseMove={(e) => {
              // Skip proximity updates while dragging — armedEdge is
              // pinned to the drag's edge for stability.
              if (dragging) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const px = e.clientX - rect.left;
              const py = e.clientY - rect.top;
              const next = proximityEdge(px, py);
              if (next !== nearEdge) setNearEdge(next);
            }}
            onMouseLeave={() => {
              if (!dragging) setNearEdge(null);
            }}
            style={{
              position: "relative",
              width: previewW,
              height: previewH,
              background: "var(--bg-input, #0f0f1e)",
              borderRadius: 4,
              overflow: "hidden",
              border: "1px solid var(--border-strong, #3a3a5a)",
            }}
          >
            {/* Live viz canvas — rendered at renderSize, CSS-scaled
                down to the preview area so the layout matches exactly
                what the user sees in the editor. */}
            <div
              ref={canvasContainerRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: renderW,
                height: renderH,
                transform: adapter.renderSize
                  ? `scale(${canvasScaleX}, ${canvasScaleY})`
                  : undefined,
                transformOrigin: "top left",
                overflow: "hidden",
              }}
            />

            {/* Dim areas outside crop */}
            <div style={dimStyle({ top: 0, left: 0, right: 0, height: `${crop.y * 100}%` })} />
            <div style={dimStyle({ bottom: 0, left: 0, right: 0, height: `${Math.max(0, (1 - crop.y - crop.h)) * 100}%` })} />
            <div style={dimStyle({ top: `${crop.y * 100}%`, left: 0, width: `${crop.x * 100}%`, height: `${crop.h * 100}%` })} />
            <div style={dimStyle({ top: `${crop.y * 100}%`, right: 0, width: `${Math.max(0, (1 - crop.x - crop.w)) * 100}%`, height: `${crop.h * 100}%` })} />

            {/* Crop visor */}
            <div
              style={visorStyle}
              onMouseDown={(e) => handleMouseDown(e, "move")}
            >
              {/* Corners: 10×10 dots, only active/visible when the
                  cursor is within proximity (~22px). Offset by -5
                  so they sit astride the corner visually. */}
              {edgeHandle("nw", { top: -5, left: -5, width: 10, height: 10, cursor: "nw-resize" }, "corner")}
              {edgeHandle("ne", { top: -5, right: -5, width: 10, height: 10, cursor: "ne-resize" }, "corner")}
              {edgeHandle("sw", { bottom: -5, left: -5, width: 10, height: 10, cursor: "sw-resize" }, "corner")}
              {edgeHandle("se", { bottom: -5, right: -5, width: 10, height: 10, cursor: "se-resize" }, "corner")}
              {/* Edges: 4px-thick strips, same proximity rule. */}
              {edgeHandle("n", { top: -2, left: "10%", right: "10%", height: 4, cursor: "n-resize" }, "edge")}
              {edgeHandle("s", { bottom: -2, left: "10%", right: "10%", height: 4, cursor: "s-resize" }, "edge")}
              {edgeHandle("w", { left: -2, top: "10%", bottom: "10%", width: 4, cursor: "w-resize" }, "edge")}
              {edgeHandle("e", { right: -2, top: "10%", bottom: "10%", width: 4, cursor: "e-resize" }, "edge")}
            </div>
          </div>

          <div style={styles.info}>
            <span>x: {(crop.x * 100).toFixed(0)}%</span>
            <span>y: {(crop.y * 100).toFixed(0)}%</span>
            <span>w: {(crop.w * 100).toFixed(0)}%</span>
            <span>h: {(crop.h * 100).toFixed(0)}%</span>
          </div>
        </div>

        <div style={styles.footer}>
          <button style={styles.resetBtn} onClick={handleReset}>Reset</button>
          <button style={styles.saveBtn} onClick={handleSave}>Save Crop</button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed", inset: 0, background: "var(--bg-overlay)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 25000, fontFamily: "system-ui, -apple-system, sans-serif",
  },
  modal: {
    background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
    borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    display: "flex", flexDirection: "column", maxWidth: "95vw", maxHeight: "95vh",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)",
  },
  title: { color: "var(--text-primary)", fontSize: 14, fontWeight: 600 },
  closeBtn: {
    background: "none", border: "none", color: "var(--text-icon)",
    fontSize: 22, cursor: "pointer", padding: "0 4px", lineHeight: 1,
  },
  body: {
    padding: 16, display: "flex", flexDirection: "column", gap: 12,
    alignItems: "center",
  },
  info: {
    display: "flex", gap: 16, fontSize: 11, color: "var(--text-tertiary)",
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
  },
  footer: {
    display: "flex", justifyContent: "flex-end", gap: 8,
    padding: "12px 16px", borderTop: "1px solid var(--border-subtle)",
  },
  resetBtn: {
    background: "none", border: "1px solid var(--border-strong)",
    borderRadius: 4, color: "var(--text-chrome)", padding: "6px 14px",
    fontSize: 12, cursor: "pointer", fontFamily: "inherit",
  },
  saveBtn: {
    background: "var(--accent)", border: "1px solid var(--accent)",
    borderRadius: 4, color: "#fff", padding: "6px 14px",
    fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 500,
  },
};
