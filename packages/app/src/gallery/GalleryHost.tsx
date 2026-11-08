"use client";

/**
 * Community gallery (#2300) — connects the gallery to the app: the
 * `stave.view.gallery` command, a `#gallery=<id>` link on load, and the two
 * ways an entry lands in Stave (a new project, or one file in this project).
 *
 * #2473 — on a desktop every way in opens (or focuses) the one gallery tab in
 * the workspace, on the view asked for; on a phone it opens the full-screen
 * overlay, as before (#2470: phones keep it until #1989). Both draw the same
 * GalleryView over the page's one store (galleryTab.tsx).
 *
 * Kept out of StaveApp so the app shell gains one element and one menu action.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getActiveProjectId,
  isPhone,
  type AppTabState,
  type ProjectMeta,
  type WorkspaceFile,
  type WorkspaceShellHandle,
} from "@stave/editor";
import { GalleryOverlay } from "./GalleryOverlay";
import { GALLERY_APP_KEY, galleryTabStore, openGalleryStore, placeOf, type GalleryPlace } from "./galleryTab";
import { claimIntoAccount } from "./client";
import { runClaimOnce } from "./claimRun";
import { useGallerySession } from "./session";
import { readGalleryLink, fileToAdd, type GalleryLinkTarget } from "./galleryModel";
import { beginGalleryImport, endGalleryImport, holdGalleryFiles, markGalleryFilesUntrusted } from "./safeRun";
import type { GalleryEntry, GalleryManifest } from "./types";
import { applyShareManifest, clearShareFragment } from "../shareProject";
import { createFileWithContent, extensionToLanguage } from "../lib/newFile";
import { registerCommand } from "../commands/registry";
import { showToast } from "../dialogs/host";

const OPEN_EVENT = "stave:open-gallery";

/**
 * Open the gallery (the menu item; anything else that wants it) — on an entry
 * id, or (#2314 / #2315) on a profile or collection. A tab on a desktop, the
 * overlay on a phone.
 */
export function openGallery(target?: string | GalleryLinkTarget): void {
  const view: GalleryLinkTarget | null = typeof target === "string" ? { kind: "entry", id: target } : (target ?? null);
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: view }));
}

export interface GalleryEntryActionsInput {
  /** StaveApp's guard: true (and it has said why) when the open project can't be left. */
  unsavedBlocksLeaving: () => boolean;
  /**
   * Run `load` (which creates a project and fills the file store) as a project
   * switch: the editor is unmounted while the store changes underneath it, then
   * the new project becomes the app's active one. Same shape as File → New.
   */
  openProject: (load: () => Promise<ProjectMeta>) => Promise<ProjectMeta>;
}

/** The two ways an entry lands in Stave; each resolves true when it did. */
export interface GalleryEntryActions {
  openAsProject: (entry: GalleryEntry, manifest: GalleryManifest) => Promise<boolean>;
  addToProject: (entry: GalleryEntry, manifest: GalleryManifest) => Promise<boolean>;
}

export interface GalleryHostProps {
  /** From `useGalleryEntryActions` — the tab body (StaveApp draws it) uses the same pair. */
  actions: GalleryEntryActions;
  /** The workspace shell: where the gallery tab opens on a desktop. */
  shellRef: React.RefObject<WorkspaceShellHandle | null>;
  /** #2312 — the gallery's "Publish yours" button opens the Publish dialog. */
  onPublish?: () => void;
}

const RUN_HINT = "Nothing has run yet — press Play when you're ready.";

/** A gallery place as the shell stores it (plain JSON). */
export function placeTabState(place: GalleryPlace): AppTabState {
  return JSON.parse(JSON.stringify(place)) as AppTabState;
}

export function GalleryHost({ actions, shellRef, onPublish }: GalleryHostProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<GalleryLinkTarget | null>(null);

  const show = useCallback(
    (target: GalleryLinkTarget | null) => {
      const shell = shellRef.current;
      if (isPhone() || !shell) {
        setView(target);
        setOpen(true);
        return;
      }
      // A real open: fetch again, start from the view asked for, then show the tab there.
      openGalleryStore(galleryTabStore, target);
      shell.openAppTab(GALLERY_APP_KEY, { state: placeTabState(placeOf(galleryTabStore.getState())) });
    },
    [shellRef],
  );

  useEffect(() => {
    const onOpen = (e: Event) => show(((e as CustomEvent).detail as GalleryLinkTarget | null) ?? null);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [show]);

  // #2320 — once signed in, bring what this browser published before into the account.
  const session = useGallerySession();
  const accountAuthorId = session.status === "ready" ? (session.session.user?.authorId ?? null) : null;
  useEffect(() => {
    if (!accountAuthorId) return;
    void runClaimOnce(accountAuthorId, {
      claim: claimIntoAccount,
      toast: (text, kind) => showToast(text, kind, 7000),
    });
  }, [accountAuthorId]);

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

  // A `#gallery=<id>` link (or #2314 `#gallery-author=<id>`, #2315
  // `#gallery-collection=<id>`): open on it, then take the fragment off the URL
  // so a refresh doesn't reopen it. On load, and when the link is pasted into a
  // tab that already has Stave open (only the fragment changes, so the page
  // doesn't reload — just `hashchange`).
  useEffect(() => {
    const check = () => {
      const target = readGalleryLink(window.location.hash || "");
      if (!target) return;
      clearShareFragment();
      if (target !== "invalid") show(target);
      else showToast("That gallery link isn't valid — copy the whole link and try again.", "error");
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [show]);

  return (
    <GalleryOverlay
      open={open}
      initialEntryId={null}
      initialView={view}
      store={galleryTabStore}
      onClose={() => {
        setOpen(false);
        setView(null);
      }}
      onOpenAsProject={actions.openAsProject}
      onAddToProject={actions.addToProject}
      onPublish={onPublish}
    />
  );
}

/** Open as new project / Add to this project, for the tab and the overlay alike. */
export function useGalleryEntryActions({ unsavedBlocksLeaving, openProject }: GalleryEntryActionsInput): GalleryEntryActions {
  const openAsProject = useCallback(
    async (entry: GalleryEntry, manifest: GalleryManifest): Promise<boolean> => {
      if (unsavedBlocksLeaving()) return false;
      // Held from the first file created, before the project id is known (safeRun.ts).
      beginGalleryImport();
      try {
        await openProject(async () => {
          const meta = await applyShareManifest({ ...manifest, project: { ...manifest.project, name: entry.title } });
          holdGalleryFiles(meta.id, manifest.files.map((f) => f.id));
          // #2328 — and the first Play of each asks first, naming who wrote it.
          markGalleryFilesUntrusted(meta.id, manifest.files.map((f) => f.id), entry.authorName);
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
      if (projectId) {
        holdGalleryFiles(projectId, [created.id]);
        markGalleryFilesUntrusted(projectId, [created.id], entry.authorName);
      }
    } finally {
      endGalleryImport();
    }
    showToast(`Added "${entry.title}" as ${created.path}. ${RUN_HINT}`, "info", 6000);
    return true;
  }, []);

  return useMemo(() => ({ openAsProject, addToProject }), [openAsProject, addToProject]);
}
