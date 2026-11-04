"use client";

/**
 * Community gallery (#2300) — mounts the overlay and connects it to the app:
 * the `stave.view.gallery` command, a `#gallery=<id>` link on load, and the two
 * ways an entry lands in Stave (a new project, or one file in this project).
 *
 * Kept out of StaveApp so the app shell gains one element and one menu action.
 */
import React, { useCallback, useEffect, useState } from "react";
import { getActiveProjectId, type ProjectMeta, type WorkspaceFile } from "@stave/editor";
import { GalleryOverlay } from "./GalleryOverlay";
import { readGalleryFragment, fileToAdd } from "./galleryModel";
import { beginGalleryImport, endGalleryImport, holdGalleryFiles } from "./safeRun";
import type { GalleryEntry, GalleryManifest } from "./types";
import { applyShareManifest, clearShareFragment } from "../shareProject";
import { createFileWithContent, extensionToLanguage } from "../lib/newFile";
import { registerCommand } from "../commands/registry";
import { showToast } from "../dialogs/host";

const OPEN_EVENT = "stave:open-gallery";

/** Open the gallery overlay (the menu item; anything else that wants it). */
export function openGallery(entryId?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: entryId ?? null }));
}

export interface GalleryHostProps {
  /** StaveApp's guard: true (and it has said why) when the open project can't be left. */
  unsavedBlocksLeaving: () => boolean;
  /**
   * Run `load` (which creates a project and fills the file store) as a project
   * switch: the editor is unmounted while the store changes underneath it, then
   * the new project becomes the app's active one. Same shape as File → New.
   */
  openProject: (load: () => Promise<ProjectMeta>) => Promise<ProjectMeta>;
}

const RUN_HINT = "Nothing has run yet — press Play when you're ready.";

export function GalleryHost({ unsavedBlocksLeaving, openProject }: GalleryHostProps) {
  const [open, setOpen] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);

  const show = useCallback((id: string | null) => {
    setEntryId(id);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => show(((e as CustomEvent).detail as string | null) ?? null);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [show]);

  useEffect(
    () =>
      registerCommand({
        id: "stave.view.gallery",
        title: "Community Gallery",
        category: "View",
        description: "Browse projects, music and visuals other people made, and what you published.",
        run: () => show(null),
      }),
    [show],
  );

  // A `#gallery=<id>` link: open on that entry, then take the fragment off the
  // URL so a refresh doesn't reopen it. On load, and when the link is pasted
  // into a tab that already has Stave open (only the fragment changes, so the
  // page doesn't reload — just `hashchange`).
  useEffect(() => {
    const check = () => {
      const hash = window.location.hash || "";
      if (!hash.startsWith("#gallery=")) return;
      const id = readGalleryFragment(hash);
      clearShareFragment();
      if (id) show(id);
      else showToast("That gallery link isn't valid — copy the whole link and try again.", "error");
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [show]);

  const openAsProject = useCallback(
    async (entry: GalleryEntry, manifest: GalleryManifest): Promise<boolean> => {
      if (unsavedBlocksLeaving()) return false;
      // Held from the first file created, before the project id is known (safeRun.ts).
      beginGalleryImport();
      try {
        await openProject(async () => {
          const meta = await applyShareManifest({ ...manifest, project: { ...manifest.project, name: entry.title } });
          holdGalleryFiles(meta.id, manifest.files.map((f) => f.id));
          return meta;
        });
      } finally {
        endGalleryImport();
      }
      showToast(`Opened "${entry.title}" as a new project. ${RUN_HINT}`, "info", 6000);
      return true;
    },
    [unsavedBlocksLeaving, openProject],
  );

  const addToProject = useCallback(async (entry: GalleryEntry, manifest: GalleryManifest): Promise<boolean> => {
    const f = fileToAdd(manifest);
    if (!f) {
      showToast("This entry has no file to add.", "error");
      return false;
    }
    const language = (extensionToLanguage(f.ext) ?? f.language) as WorkspaceFile["language"];
    let created: WorkspaceFile;
    beginGalleryImport();
    try {
      created = createFileWithContent(f.path, f.content, language);
      const projectId = getActiveProjectId();
      if (projectId) holdGalleryFiles(projectId, [created.id]);
    } finally {
      endGalleryImport();
    }
    showToast(`Added "${entry.title}" as ${created.path}. ${RUN_HINT}`, "info", 6000);
    return true;
  }, []);

  return (
    <GalleryOverlay
      open={open}
      initialEntryId={entryId}
      onClose={() => {
        setOpen(false);
        setEntryId(null);
      }}
      onOpenAsProject={openAsProject}
      onAddToProject={addToProject}
    />
  );
}
