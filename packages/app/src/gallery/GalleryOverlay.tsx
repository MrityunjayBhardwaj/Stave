"use client";

/**
 * Community gallery overlay (#2300) — the full-screen container around
 * GalleryView (#2472): the backdrop, Esc and the × close it, and it closes once
 * an entry has been opened or Publish yours is pressed.
 *
 * Each open is a fresh open (`store.open`): the list is fetched again and the
 * Back stack starts from the link's view, if any. The store is made per mount
 * of the overlay unless one is passed in, so what carries from one open to the
 * next (the chosen list tab, the search) is what the overlay's own state
 * carried before.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GalleryEntry, GalleryEntryResponse } from "./types";
import type { GalleryLinkTarget } from "./galleryModel";
import { getDialog } from "../dialogs/host";
import { createGalleryStore, type GalleryStore } from "./galleryStore";
import { GalleryView } from "./GalleryView";

export interface GalleryOverlayProps {
  open: boolean;
  /** Open straight on this entry (a `#gallery=<id>` link). */
  initialEntryId: string | null;
  /**
   * #2314 / #2315 — open straight on an entry, a profile or a collection
   * (`#gallery-author=<id>`, `#gallery-collection=<id>`). Wins over initialEntryId.
   */
  initialView?: GalleryLinkTarget | null;
  onClose: () => void;
  /** Resolve true when the entry was opened (the overlay then closes). */
  onOpenAsProject: (entry: GalleryEntry, manifest: GalleryEntryResponse["manifest"]) => Promise<boolean>;
  onAddToProject: (entry: GalleryEntry, manifest: GalleryEntryResponse["manifest"]) => Promise<boolean>;
  /** #2312 — open the Publish dialog from the gallery's header; absent where there's nowhere to publish. */
  onPublish?: () => void;
  /** Where you are in the gallery; by default one store per mount of the overlay. */
  store?: GalleryStore;
}

export function GalleryOverlay({
  open,
  initialEntryId,
  initialView,
  onClose,
  onOpenAsProject,
  onAddToProject,
  onPublish,
  store: given,
}: GalleryOverlayProps) {
  const [own] = useState(createGalleryStore);
  const store = given ?? own;
  // Read by the Esc handler without re-subscribing it on every open.
  const reportingRef = useRef(false);

  const initialKind = initialView?.kind ?? null;
  const initialId = initialView?.id ?? null;
  // Each open: fresh list, the link's view if any, and the local shares. A layout
  // effect, so the fresh open lands before the view's own mount effects: a view
  // drawn for a new open must not put back the scroll of the last one.
  useLayoutEffect(() => {
    if (!open) return;
    const first: GalleryLinkTarget | null =
      initialKind && initialId
        ? ({ kind: initialKind, id: initialId } as GalleryLinkTarget)
        : initialEntryId
          ? { kind: "entry", id: initialEntryId }
          : null;
    store.open(first);
  }, [open, initialEntryId, initialKind, initialId, store]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A confirm / prompt / the report dialog on top owns Esc.
      if (e.key !== "Escape" || getDialog() || reportingRef.current) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sg-backdrop" data-gallery="overlay" onClick={onClose}>
      <style>{CSS}</style>
      <div
        className="sg-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Community Gallery"
        onClick={(e) => e.stopPropagation()}
      >
        <GalleryView
          store={store}
          onClose={onClose}
          onOpenAsProject={onOpenAsProject}
          onAddToProject={onAddToProject}
          onOpened={onClose}
          onPublish={
            onPublish &&
            (() => {
              onClose();
              onPublish();
            })
          }
          onReportOpenChange={(o) => {
            reportingRef.current = o;
          }}
        />
      </div>
    </div>
  );
}

const CSS = `
.sg-backdrop { position: fixed; inset: 0; background: var(--bg-overlay, rgba(0,0,0,.55)); display: flex; align-items: center; justify-content: center; z-index: 10000; font-family: system-ui, -apple-system, sans-serif; }
.sg-modal { width: min(1040px, 94vw); height: min(760px, 88vh); background: var(--bg-elevated); border: 1px solid var(--border-strong); border-radius: 10px; display: flex; flex-direction: column; color: var(--text-chrome); box-shadow: 0 20px 60px rgba(0,0,0,.45); overflow: hidden; }
@media (max-width: 640px) {
  .sg-modal { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; border: none; }
}
`;
