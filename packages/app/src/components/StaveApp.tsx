"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProject,
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  touchProject,
  getStorageStatus,
  switchProject,
  resetFileStore,
  setActiveHistoryFile,
  setFileHistoryTarget,
  HistoryPanel,
  undo,
  redo,
  canUndo,
  canRedo,
  subscribeToUndoState,
  codeEditorForFocus,
  codeUndoForFocus,
  dropLegacyBackgroundCrop,
  type CropRegion,
  type ProjectMeta,
  type WorkspaceShellHandle,
  type HapStream,
  type IREvent,
  type BreakpointStore,
  type TrackEnvelopeAccess,
} from "@stave/editor";
import { createTrackEnvelopeRelay } from "../audio/trackEnvelopeRelay";
import { TEMPLATES, seedProjectFromTemplate } from "../templates";
import { exportProjectAsZip } from "../exportProject";
import { StorageFullNotice } from "./StorageFullNotice";
import { buildStemsArchive, stemDisplayName } from "../stemsArchive";
import { importProjectFromZip } from "../importProject";
import { recentProjectEntries } from "../recentProjects";
import { StartScreen } from "./StartScreen";
import appPackage from "../../package.json";
import { readStartConditions, setStartScreenWanted, showsStartScreen, startScreenWanted } from "../startScreen";
import {
  buildShareUrl,
  buildShortShareUrl,
  loadIncomingShare,
  applyShareManifest,
  readIncomingShare,
  clearShareFragment,
} from "../shareProject";
import { MenuBar } from "./MenuBar";
import { buildMenus, type MenuActions } from "./menuModel";
import { PhoneTopBar } from "./PhoneTopBar";
import { PhoneDrawer, PHONE_MENU_TAB } from "./PhoneDrawer";
import { TransportLCD } from "./TransportLCD";
import { TimeSignatureControl } from "./TimeSignatureControl";
import { FileTree, type FileTreeHandle } from "./FileTree";
import { TemplateModal } from "./TemplateModal";
import { ProjectSwitcherModal } from "./ProjectSwitcherModal";
import {
  bumpEditorFontSize,
  toggleEditorMinimap,
  cycleEditorTheme,
  applyPersistedTheme,
  applyPersistedUiIconSize,
  applyPersistedInlineVizActionSize,
  applyPersistedVizQuality,
  errorPositionNow,
} from "@stave/editor";
import { SettingsModal, type SettingsTab } from "./settings/SettingsModal";
import { CropPopup, createBackdropCropAdapter } from "./CropPopup";
import {
  loadBackdropCrops,
  withBackdropCrop,
} from "./backdropCropStore";
import { DialogHost } from "./DialogHost";
import { showPrompt, showToast, showConfirm } from "../dialogs/host";
import { CommandPalette, type PaletteRow } from "./CommandPalette";
import { WorkspaceSearchView, type WorkspaceSearchViewHandle } from "./WorkspaceSearchView";
import { ActivityBar } from "./ActivityBar";
import { SidePanel } from "./SidePanel";
import { consoleBadge } from "../lib/unreadLog";
import { ConsolePanel } from "./ConsolePanel";
import { IRInspectorPanel } from "./IRInspectorPanel";
import { registerCommand } from "../commands/registry";
import { installKeybindingDispatcher } from "../commands/keybindings";
// #1801 — registers the piano roll / sequencer keys as scoped commands.
import "../commands/gridCommands";
import { registerPanel } from "../panels/registry";
import { AssetLibraryPanel } from "../assetLibrary/AssetLibraryPanel";
import { registerAssetProvider, notifyAssetProvidersChanged } from "../assetLibrary/registry";
import { createSoundsProvider } from "../assetLibrary/soundsProvider";
import type { AssetProvider } from "../assetLibrary/types";
import {
  listWorkspaceFiles,
  subscribeToFileList,
  subscribeLog,
  installEngineLogMarkers,
  installGlobalErrorCatch,
  seedWorkspaceFile,
  setContent,
  revealLineInFile,
} from "@stave/editor";
import StrudelEditorClient, { type BounceHandle } from "./StrudelEditorClient";
import { BounceModal, type BounceState } from "./BounceModal";
import type { BounceSizing } from "./songLength";
import { DocsSearchPalette } from "./DocsSearchPalette";
import { isPerfOverlayToggle } from "./perfToggleKey";
import { MusicalTimeline } from "./MusicalTimeline";
import { startSongAnalysis } from "../state/songAnalysis";
import { applyStoredTakesPhoneAudio } from "../state/takesPhoneAudio";
import {
  registerBottomPanelTab,
  readPersistedOpen,
  readPersistedActiveTabId,
  setCurrentCycleAccessor,
  setSoundCatalogAccessor,
  notifySoundCatalogChanged,
  groupSoundCatalog,
  setDrumKitAccessor,
  groupDrumKits,
  banksFromDrumMachineManifest,
  type SoundMapDict,
  type DrumMachineManifest,
} from "@stave/editor";
import {
  applyPersistedPerfEnabled,
  togglePerfEnabled,
  applyPersistedAdaptivePerf,
} from "@stave/editor";
import { getLogHistory } from "@stave/editor";
import { SilentCaptureError, describeSkipped } from "@stave/editor";
import { resolveAsset, startAudition, startClipPreview } from "@stave/editor";
// #1504 — the project's asset records back the library's "sample" provider.
import { cyclesToPlayThrough, listAssetRecords, subscribeToAssets } from "@stave/editor";
// #1785 — this tab's presence, seen by another tab's sound collection.
import { holdTabPresence } from "@stave/editor";
// #1786 — remove one of your sounds, and see what each one takes.
import {
  collectUnusedSounds,
  listAssets,
  removeAssetRecord,
  unregisterAsset,
} from "@stave/editor";
import { removedButFailedMessage, removedMessage } from "../assetLibrary/freeSpaceMessages";
import { isVizLanguage, languageForRenderer } from "@stave/editor";
import { mountVizPreview } from "@stave/editor";
import { getFile } from "@stave/editor";
import { usePhone, isPhone, usePhoneLayout, startVisibleArea } from "@stave/editor";
import { createSamplesProvider } from "../assetLibrary/samplesProvider";
import { createVizProvider } from "../assetLibrary/vizProvider";
import { createSnippetsProvider } from "../assetLibrary/snippetsProvider";
import { playSnippet, checkSnippet, previewNotesPlayed } from "../assetLibrary/snippetPreview";
import { createFileWithContent } from "../lib/newFile";
import { planVizLibFiles, VIZ_LIB_ROOT, type VizLibItem } from "../assetLibrary/vizLibrary";
import { PerfOverlay } from "./PerfOverlay";
import { PROJECT_FILE_ACCEPT } from "../projectFile";

interface StaveAppProps {
  initialProject: ProjectMeta;
}

/**
 * StaveApp — top-level layout.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │ MenuBar (File, Edit, View, Help)               │
 *   ├──────────┬─────────────────────────────────────┤
 *   │          │                                     │
 *   │ FileTree │ StrudelEditorClient (WorkspaceShell)│
 *   │          │                                     │
 *   └──────────┴─────────────────────────────────────┘
 *
 * Project actions (new/open/rename/export) are in the File menu.
 * The sidebar is a file tree for the CURRENT project only.
 * Switching projects remounts StrudelEditorClient via key={activeProject.id}.
 */
/**
 * How long the silent-bounce toast stays clickable (#1410). The default 4s is
 * tuned for "here is what happened"; this one carries a DECISION, and a choice
 * that vanishes before it is read is not a choice. Long enough to notice and
 * act, short enough that an ignored offer still goes away on its own.
 */
const SILENT_BOUNCE_TOAST_MS = 20_000;

/** #2019 — the app's own version, shown on the start screen. */
const APP_VERSION: string = appPackage.version;

function safeFileName(name: string, fallback: string): string {
  return name.replace(/[^a-z0-9_-]+/gi, "_") || fallback;
}

/**
 * Hand a finished WAV to the browser as a download (#1410).
 *
 * Extracted when the silent-bounce path became the SECOND caller — before that
 * it was rightly inline. Both routes save the same way now, so a take kept
 * deliberately is byte-for-byte the file a successful bounce would have written,
 * and neither route can drift into naming or revoking differently.
 */
function saveWavBlob(blob: Blob, projectName: string): void {
  saveBlob(blob, `${safeFileName(projectName, "stave-bounce")}.wav`);
}

/** #1648 — shared by the WAV and the stems zip. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick so the download stream can start (matches
  // exportProjectAsZip).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Where Undo/Redo act, shown under them in Settings → Keyboard Shortcuts (#1800). */
const UNDO_WHERE =
  "In the piano roll, sequencer or Song timeline: that code edit. In the code editor: its own history. Elsewhere: file changes."

export function StaveApp({ initialProject }: StaveAppProps) {
  const [activeProject, setActiveProject] = useState<ProjectMeta>(initialProject);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  // activePanelId drives which registered side-panel is visible. null =
  // activity bar only, no panel. 'explorer' is the legacy file-tree view.
  //
  // On a phone (#2000) the panels are not beside the editor but in a drawer over it,
  // and this same state says which one the drawer shows — null = drawer closed, which
  // is how a phone starts. One state for both, so everything below that opens a panel
  // by name (the eval lamp, File History, the sound picker) opens the drawer on it.
  const phone = usePhone();
  // #2003 — sideways, a phone gets a view switch in its top bar and a shorter drawer
  const phoneSideways = usePhoneLayout() === "sideways";
  // #2004 — follow the on-screen keyboard: the editor package writes the height still
  // showing onto the document root, and the shell (page.tsx) is that tall. A plain
  // function, not a hook: an app component must not call the editor's hooks.
  useEffect(() => {
    startVisibleArea();
  }, []);
  // #2015 — whether Play takes the phone's audio is a setting; the engine reads it on
  // every Play, so it needs the stored choice before the first one.
  useEffect(() => {
    applyStoredTakesPhoneAudio();
  }, []);
  // #2007 — the page-level rules for a phone (no page scroll, no double-tap zoom) are
  // CSS on the document root, switched by this one attribute.
  useEffect(() => {
    const root = document.documentElement;
    if (phone) root.setAttribute("data-stave-phone", "");
    else root.removeAttribute("data-stave-phone");
    return () => root.removeAttribute("data-stave-phone");
  }, [phone]);
  const [activePanelId, setActivePanelId] = useState<string | null>(() => (isPhone() ? null : "explorer"));
  // The drawer's Menu tab is the drawer's own, not a panel: it has no rail button and
  // must not be left selected for a rail that cannot show it.
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false);
  // which panel the drawer opens on: the one it was last showing
  const lastPanelRef = useRef("explorer");
  if (activePanelId !== null) lastPanelRef.current = activePanelId;
  const openPhoneDrawer = useCallback(() => {
    setPhoneMenuOpen(false);
    setActivePanelId(lastPanelRef.current);
  }, []);
  const closePhoneDrawer = useCallback(() => {
    setPhoneMenuOpen(false);
    setActivePanelId(null);
  }, []);
  const sidebarCollapsed = activePanelId === null;
  const setSidebarCollapsed = useCallback((updater: boolean | ((c: boolean) => boolean)) => {
    setActivePanelId((current) => {
      const collapsed = current === null;
      const next = typeof updater === "function" ? updater(collapsed) : updater;
      return next ? null : (current ?? "explorer");
    });
  }, []);
  const [switching, setSwitching] = useState(false);
  // #1787 — the storage notice opens the Library on your own sounds, where
  // each shows its size. A counter, so each request remounts the panel onto
  // that chip even when the Library is already open on another.
  const [libraryOpenedFor, setLibraryOpenedFor] = useState(0);
  // #2062 — the project's own audio as Library rows, read by the Sounds provider
  const ownAudioRef = useRef<AssetProvider | null>(null);
  const openLibraryAtYourSounds = useCallback(() => {
    setLibraryOpenedFor((n) => n + 1);
    setActivePanelId("library");
  }, []);

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  // #2019 — the start screen. Decided ONCE, when the app first mounts (which is
  // after the last project has loaded): it greets an arrival and never appears
  // mid-session on its own. A share link has its own question to ask instead.
  const [startScreenOpen, setStartScreenOpen] = useState(() =>
    showsStartScreen(readStartConditions(readIncomingShare() != null)),
  );
  const [startScreenAtStart, setStartScreenAtStart] = useState(startScreenWanted);
  const [switcherModalOpen, setSwitcherModalOpen] = useState(false);
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  // Unified settings window (#739) — one shell, two tabs. `settingsTab`
  // decides which surface opens; both File-menu items reuse it.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [docsSearchOpen, setDocsSearchOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("settings");
  const [cropTarget, setCropTarget] = useState<
    | { mode: "inline"; vizId: string; presetId: string; fileId: string; trackKey: string; renderSize?: { w: number; h: number } }
    | { mode: "backdrop"; adapter: import("./CropPopup").CropAdapter }
    | null
  >(null);

  // Apply persisted theme on first mount so the user's choice survives
  // reloads. Runs once — later theme changes go through toggleEditorTheme.
  useEffect(() => {
    applyPersistedTheme();
    applyPersistedUiIconSize();
    applyPersistedInlineVizActionSize();
    applyPersistedVizQuality();
  }, []);

  // Monaco marker bridge — engineLog entries that carry a `source` +
  // `line` become inline squiggles on the matching file's model,
  // cleared whenever `emitFixed` fires for the same (runtime, source).
  // Idempotent — installs on first mount; no-op thereafter.
  useEffect(() => {
    installEngineLogMarkers();
  }, []);

  // Tell other tabs this one is open (#1785). A collection in another tab
  // refuses to run while this lock is held: this tab's memory may name sounds
  // its saved document does not yet.
  useEffect(() => {
    void holdTabPresence();
  }, []);

  // Global error floor — catches any throw / rejected promise that
  // escaped the per-runtime bridges. The bridges still enrich known
  // error shapes with friendly messages and source attribution; this
  // is the guarantee that even unknown-shape errors become visible
  // instead of vanishing.
  useEffect(() => {
    installGlobalErrorCatch();
  }, []);

  // Show a log entry where it came from: open the Console and, when the entry
  // carries a source location, open that file and jump the editor to the line.
  // `entry.line` is the single source of truth — the engine attaches it only
  // when it's RELIABLE (a real source offset, or a parser syntax error's
  // offset-free "(line:col)", or a stack position mapped back through the
  // transpiler's source map, #2175), and leaves it absent when it can't be
  // known, so those errors just open the Console without a mis-jump. `source`
  // is a workspace path OR a bare fileId
  // (StrudelEditorClient uses `path ?? fileId`), so resolve both. The editor may
  // need a tick to mount if the file wasn't already open — retry a few times.
  // Shared by an error toast, the control bar's eval lamp (#1348) and a Console
  // row (#2182), so they cannot come to disagree about where an error is.
  // #2184 — an entry whose squiggle is still in the editor goes to where that
  // squiggle is now, so code typed above it since the run doesn't send you to
  // the old line.
  const revealLogEntry = useCallback((entry: { id?: string; source?: string; line?: number }) => {
    setActivePanelId("console");
    const { source } = entry;
    const line = (entry.id ? errorPositionNow(entry.id)?.line : undefined) ?? entry.line;
    if (!source || line == null) return;
    const files = listWorkspaceFiles();
    const file =
      files.find((f) => f.path === source) ??
      files.find((f) => f.id === source);
    if (!file) return;
    // Open/focus the tab (no-op focus if already active), then reveal.
    shellRef.current?.openOrFocusFile(file.id);
    let tries = 0;
    const reveal = () => {
      if (revealLineInFile(file.id, line) || tries++ >= 8) return;
      setTimeout(reveal, 60);
    };
    reveal();
  }, []);

  // Toast bridge — every new error-level engineLog entry also surfaces
  // as a transient toast so the user notices even when the Console panel
  // isn't open. Warnings get no toast (noisier to toast every warn, and
  // live coders warn themselves a lot). The toast auto-dismisses in ~4s;
  // what persists is the Console entry and the unread badge on the
  // Console's activity-bar button, which counts errors AND warnings and
  // is the only standing surface a warning has.
  useEffect(() => {
    return subscribeLog((entry) => {
      if (!entry) return;
      if (entry.level !== "error") return;
      // #2186 — a mistake found beside the run's error: that error has its toast.
      if (entry.alongside) return;
      // #2170 — "try" only names a symbol; a hint's example or link has no name.
      const text = entry.suggestion?.name
        ? `${entry.message} → try \`${entry.suggestion.name}\``
        : entry.message;
      // Clicking the toast body shows the entry where it came from.
      showToast(text, "error", 4000, () => revealLogEntry(entry));
    });
  }, []);

  const [zenMode, setZenMode] = useState(false);
  const searchViewRef = useRef<WorkspaceSearchViewHandle | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const fileTreeRef = useRef<FileTreeHandle | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{
    tabId: string;
    fileId: string | null;
    x: number;
    y: number;
  } | null>(null);

  // Mirror of the active group's backdrop fileId so the file-tree can
  // render "Set as Background" vs. "Clear Background" in the context
  // menu without subscribing to every shell state change. Updated by
  // handleSetAsBackground below — the single write site — and read
  // into the FileTree prop. Survives tab switches because the shell
  // stores it on group state, not on the active tab.
  const [backgroundFileId, setBackgroundFileId] = useState<string | null>(
    null,
  );
  // Backdrop crops, keyed by viz FILE id (#1435). A crop is cut for one
  // sketch's aspect ratio, so it belongs to that file; the project-global slot
  // it replaced applied whatever rect was last saved to whatever backdrop was
  // pinned next. Loaded per project from localStorage, written through the crop
  // popup's `persist` seam.
  const [backdropCrops, setBackdropCrops] = useState<
    ReadonlyMap<string, CropRegion>
  >(() => new Map());
  // A pre-#1435 project's project-global crop, held until we know which file was
  // actually wearing it — the backdrop FILE is restored per tab by
  // StrudelEditorClient, so at project-load time there is nothing to key it to
  // yet. Carried over by the effect below, then drained.
  //
  // ⚠ STATE, NOT A REF, and that is the whole correctness of the migration. The
  // legacy crop is read from IDB (async) while the backdrop file comes from
  // localStorage (sync), so the file NORMALLY lands first. A ref set inside the
  // IDB `.then()` re-renders nothing, so the carry-over effect below would never
  // re-run and the crop would be silently dropped — which is exactly what the
  // browser arm caught.
  const [legacyCrop, setLegacyCrop] = useState<CropRegion | null>(null);

  // File-list revision counter — bumps whenever the workspace
  // file list mutates (add / remove / rename). Read by the MenuBar's
  // backdrop dropdown so it sees fresh viz files without us having
  // to lift the entire file list into React state.
  const [fileListRev, setFileListRev] = useState(0);
  useEffect(
    () => subscribeToFileList(() => setFileListRev((n) => n + 1)),
    [],
  );

  const handleExportProject = useCallback(() => {
    exportProjectAsZip(activeProject).catch((err) => {
      console.error("[stave] export failed:", err);
      showToast("Export failed — see console for details.", "error");
    });
  }, [activeProject]);

  /**
   * #1779 — opening another project discards the open one's in-memory
   * document, and while storage is full that is the ONLY copy of the edits the
   * disk refused. Refuse the switch and say why, rather than lose them.
   */
  const unsavedBlocksLeaving = useCallback((): boolean => {
    if (!getStorageStatus().documentUnsaved) return false;
    showToast(
      "Storage is full and this project has unsaved changes — export it or free space and Try again first.",
      "error",
      6000,
    );
    return true;
  }, []);

  const handleImportZip = useCallback(async (file: File) => {
    if (unsavedBlocksLeaving()) return;
    try {
      const meta = await importProjectFromZip(file);
      const list = await listProjects();
      setProjects(list);
      setActiveProject(meta);
      // A sound the disk had no room for is skipped inside the import, which
      // otherwise read "Imported" over a project missing parts (#1779).
      const full = getStorageStatus().fullSince !== null;
      showToast(
        full
          ? `Imported ${meta.name} — but storage is full, so parts of it were not saved`
          : `Imported ${meta.name}`,
        full ? "error" : "info",
      );
    } catch (err) {
      console.error("[stave] import failed:", err);
      showToast(
        `Import failed — ${(err as Error).message ?? "see console"}`,
        "error",
      );
    }
  }, []);

  const triggerImportPicker = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleShareProject = useCallback(async () => {
    if (!activeProject) return;
    try {
      // #2248 — the short link first; the long one carries the project itself and
      // needs no store, so it is the fallback when the store can't take it.
      let url: string;
      let note = "";
      try {
        url = await buildShortShareUrl(activeProject);
      } catch (err) {
        console.warn("[stave] short share link unavailable:", err);
        url = await buildShareUrl(activeProject);
        note = " A short link wasn't available, so this is the long one.";
      }
      await navigator.clipboard.writeText(url);
      showToast(`Share link copied (${url.length.toLocaleString()} chars).${note}`, "info");
    } catch (err) {
      console.error("[stave] share failed:", err);
      showToast(
        `Share failed — ${(err as Error).message ?? "see console"}`,
        "error",
      );
    }
  }, [activeProject]);

  // On-mount: if we landed with #share= or a short /s/<id> link, decode and offer to import.
  // Runs once per session — the fragment is cleared either way so a
  // refresh doesn't re-prompt.
  const sharePromptHandledRef = useRef(false);
  useEffect(() => {
    if (sharePromptHandledRef.current) return;
    sharePromptHandledRef.current = true;
    const incoming = readIncomingShare();
    if (!incoming) return;
    void (async () => {
      try {
        const manifest = await loadIncomingShare(incoming);
        const ok = await showConfirm({
          title: "Import shared project?",
          description: `Import "${manifest.project.name}" as a new project? It contains ${manifest.files.length} file(s).`,
          confirmLabel: "Import",
        });
        clearShareFragment();
        if (!ok) return;
        if (unsavedBlocksLeaving()) return;
        const meta = await applyShareManifest(manifest);
        const list = await listProjects();
        setProjects(list);
        setActiveProject(meta);
        showToast(`Imported ${meta.name}`, "info");
      } catch (err) {
        console.error("[stave] share import failed:", err);
        showToast(
          `Couldn't import shared project — ${(err as Error).message ?? "malformed link"}`,
          "error",
        );
        clearShareFragment();
      }
    })();
  }, []);

  // Esc exits zen mode. Registered at window level because there's no
  // chrome to click when zen is on; the only way out is the keyboard.
  useEffect(() => {
    if (!zenMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setZenMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zenMode]);

  // Drive the browser's Fullscreen API alongside zen mode so the URL
  // bar / tab strip / window chrome all disappear. Browsers require a
  // user gesture to enter fullscreen, which this effect inherits because
  // zenMode is only ever flipped by a click or shortcut. If the user
  // exits fullscreen via the browser's own affordance (F11, Esc on
  // some browsers), keep the React state in sync via fullscreenchange.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const fsEl = () => document.fullscreenElement;
    if (zenMode && !fsEl()) {
      // Best-effort — Safari throws if the gesture isn't trusted.
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (!zenMode && fsEl()) {
      void document.exitFullscreen?.().catch(() => {});
    }
    const sync = () => {
      if (!fsEl() && zenMode) setZenMode(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [zenMode]);

  // Subscribe to the structural undo manager so Edit menu items can
  // enable/disable reactively.
  useEffect(() => {
    const update = () => setUndoState({ canUndo: canUndo(), canRedo: canRedo() });
    update();
    return subscribeToUndoState(update);
  }, [activeProject.id]);

  // Open the Version History side panel — now backed by the project commit
  // store (HistoryPanel), not the retired legacy snapshotStore.
  const openSnapshotPanel = useCallback(() => {
    setActivePanelId("snapshots");
  }, []);

  // Global keybinding dispatcher — matches chords against registered
  // commands. Commands register in a later effect once all handlers
  // exist (some handlers close over state defined below this point).
  useEffect(() => installKeybindingDispatcher(), []);

  // Perf profiler (#228): restore the persisted overlay state on load, and bind
  // Alt+P to toggle it (low-collision; the overlay also has a Settings row +
  // window.__stavePerf hook). The profiler is inert when disabled.
  useEffect(() => {
    applyPersistedPerfEnabled();
    // Adaptive performance (the viz GPU-budget governor, P122/PV91) — restore the
    // persisted preference (ON by default) so the governor's live gate agrees.
    applyPersistedAdaptivePerf();
    // Alt+P toggles the perf overlay. The match lives in `isPerfOverlayToggle`
    // (#1423) — it used to test `e.key === "p"`, which on macOS is never true,
    // because Option composes: Option+p produces `π`. The rule is a pure
    // predicate now so it can be pinned without mounting this component.
    const onKey = (e: KeyboardEvent) => {
      if (isPerfOverlayToggle(e)) {
        e.preventDefault();
        togglePerfEnabled();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // (Legacy 60s auto-snapshot retired — the project commit store + its
  //  idle/eval/unload driver, wired in StrudelEditorClient, is now the single
  //  history system. See HistoryPanel in the Version History side panel.)

  // Bidirectional sync between FileTree ↔ WorkspaceShell.
  //
  // - `shellRef` — imperative handle into the shell. FileTree clicks call
  //   shellRef.current.openOrFocusFile(fileId) to open/focus a tab.
  // - `activeFileId` — the currently-active tab's fileId (null if no tab
  //   active or active tab has no fileId). Updated by the shell via
  //   onActiveTabChange. Passed to FileTree so it highlights the active
  //   file in the tree.
  const shellRef = useRef<WorkspaceShellHandle | null>(null);
  // #1346 — the File menu's "Bounce to WAV" needs the LIVE audio graph, which
  // lives in StrudelEditorClient's runtime map. Same shape as `shellRef`: we
  // own the ref, the child attaches the handle.
  const bounceRef = useRef<BounceHandle | null>(null);
  const [bounceOpen, setBounceOpen] = useState(false);
  const [bounceState, setBounceState] = useState<BounceState>({ phase: "choosing" });
  // #1631 — whether the active file's bounce renders offline. Read when the
  // modal opens, so its copy says what Start will cost before it is pressed.
  const [bounceOffline, setBounceOffline] = useState(false);
  /**
   * #1648/#1666 — how many stems the active file would export, 0 when it cannot.
   * Read with `bounceOffline`; the count is what sets the length stems are
   * offered, because the export costs its length once per track.
   */
  const [bounceStemTracks, setBounceStemTracks] = useState(0);
  /** What the active document says about its length; `null` until measured. */
  const [bounceSizing, setBounceSizing] = useState<BounceSizing | null>(null);
  /** Supersedes an in-flight measurement when the modal is reopened. */
  const bounceSizingToken = useRef(0);
  // Held outside state: aborting must work from the Stop handler without
  // waiting for a render, and the ticker must be clearable from two places.
  const bounceAbortRef = useRef<AbortController | null>(null);
  const bounceTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * #1346 — run a bounce and hand the user a .wav.
   *
   * The capture taps the live master output, so this is real-time by nature:
   * the modal shows a progress bar driven from here (the duration is known up
   * front, so no engine-side progress channel is needed) and a Stop that
   * aborts. Stop is not a discard — the recorder resolves with what it has, so
   * the user still gets a shorter file.
   */
  const finishBounceUi = useCallback(() => {
    if (bounceTickRef.current) {
      clearInterval(bounceTickRef.current);
      bounceTickRef.current = null;
    }
    bounceAbortRef.current = null;
    setBounceOpen(false);
    setBounceState({ phase: "choosing" });
  }, []);

  const handleBounceStart = useCallback((seconds: number, stems = false) => {
    const handle = bounceRef.current;
    if (!handle) {
      showToast("Open a pattern file before bouncing.", "error");
      setBounceOpen(false);
      return;
    }
    const controller = new AbortController();
    bounceAbortRef.current = controller;

    // #1648 — one WAV per track, in one zip. Offline only: the dialog offers it
    // only when the active file renders offline.
    if (stems) {
      setBounceState({ phase: "rendering", seconds, stems: { total: 0 } });
      void handle
        .bounceStems(seconds, controller.signal, (rendered, total) => {
          setBounceState((prev) =>
            prev.phase === "rendering" ? { ...prev, rendered, stems: { total } } : prev,
          );
        })
        .then(async (result) => {
          if (controller.signal.aborted) {
            showToast("Bounce cancelled — nothing was saved.", "info");
            return;
          }
          if (!result) {
            showToast("This file cannot export stems.", "error");
            return;
          }
          setBounceState({ phase: "encoding" });
          const archive = await buildStemsArchive(result, (e) => e instanceof SilentCaptureError);
          for (const f of archive.failed) console.error(`[stave] stem ${f.fileName} failed:`, f.error);
          if (archive.included.length === 0) {
            showToast("No track made a sound in this length, so there are no stems to save.", "error");
            return;
          }
          saveBlob(archive.zip, `${safeFileName(activeProject.name, "stave-bounce")}-stems.zip`);
          const left = [...archive.silent, ...archive.failed.map((f) => f.fileName)].map(stemDisplayName);
          const skipped = result.reduce((n, st) => n + st.skipped.reduce((m, k) => m + k.count, 0), 0);
          const notes: string[] = [];
          if (left.length > 0) notes.push(`no file for ${left.join(", ")} (${archive.failed.length > 0 ? "silent or failed" : "silent in this length"})`);
          if (skipped > 0) notes.push(`${skipped} ${skipped === 1 ? "sound" : "sounds"} could not play`);
          showToast(
            notes.length === 0
              ? `Stems saved — ${archive.included.length} ${archive.included.length === 1 ? "track" : "tracks"}.`
              : `Stems saved — ${archive.included.length} ${archive.included.length === 1 ? "track" : "tracks"}; ${notes.join("; ")}.`,
            notes.length === 0 ? "info" : "error",
            notes.length === 0 ? undefined : SILENT_BOUNCE_TOAST_MS,
          );
        })
        .catch((err: unknown) => {
          console.error("[stave] stems export failed:", err);
          showToast("Stems export failed — see console for details.", "error");
        })
        .finally(finishBounceUi);
      return;
    }
    // #1631 — an offline render has no capture to wait for and no clock to
    // show: it reports no progress and finishes faster than the song plays.
    // #1356 — a live take lets the graph fall silent before it starts playing,
    // so Start is not the first captured sample. Show that, and start the
    // clock on `onCaptureStart`, or the bar would run ahead of the audio and
    // sit at 100% while the take was still finishing.
    const offline = handle.bouncesOffline();
    setBounceState(offline ? { phase: "rendering", seconds } : { phase: "preparing" });

    const beginTicking = () => {
      setBounceState({ phase: "recording", seconds, elapsed: 0 });
      const startedAt = Date.now();
      bounceTickRef.current = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000;
        setBounceState((prev) =>
          prev.phase === "recording" ? { ...prev, elapsed } : prev,
        );
      }, 200);
    };

    // #1650 — a render reports how far it has got at each of its pauses. A
    // cancelled render keeps reporting while it winds down; the bar is hidden
    // then, so the value is kept but not shown.
    const onRenderProgress = (rendered: number) => {
      setBounceState((prev) =>
        prev.phase === "rendering" ? { ...prev, rendered } : prev,
      );
    };

    void handle
      .bounce(seconds, controller.signal, beginTicking, onRenderProgress)
      .then((result) => {
        if (bounceTickRef.current) {
          clearInterval(bounceTickRef.current);
          bounceTickRef.current = null;
        }
        // #1631 — Cancel pressed during an offline render. The render stops at
        // its next pause and keeps nothing (#1655), rather than saving a partial
        // song as though the user had let it run. (A live Stop still keeps its
        // shorter take.)
        // Decided by the path the bounce REPORTS, not the `offline` predicted at
        // Start: those are two reads, and a live take discarded on a stale
        // prediction loses exactly what Stop promises to keep. A null after an
        // abort is a render that was refused before it began.
        if (controller.signal.aborted && (result === null || result.offline)) {
          showToast("Bounce cancelled — nothing was saved.", "info");
          return;
        }
        if (!result) {
          showToast("This file has no audio engine to bounce.", "error");
          return;
        }
        setBounceState({ phase: "encoding" });
        saveWavBlob(result.blob, activeProject.name);
        // #1631 — a render that could not play some sounds still saves, and
        // says which. Error level on purpose: the file is missing part of the
        // song, and an "info" toast would let that pass unnoticed.
        if (result.skipped.length > 0) {
          const left = result.skipped.reduce((n, s) => n + s.count, 0);
          showToast(
            `Bounce saved, but ${left} ${left === 1 ? "sound" : "sounds"} could not play: ${describeSkipped(result.skipped)}`,
            "error",
            SILENT_BOUNCE_TOAST_MS,
          );
          return;
        }
        showToast(
          controller.signal.aborted
            ? "Bounce stopped early — saved what was recorded."
            : "Bounce saved.",
          "info",
        );
      })
      .catch((err: unknown) => {
        console.error("[stave] bounce failed:", err);
        // #1402 — a bounce that recorded nothing used to download a valid,
        // full-length WAV of silence and call it a success. The capture
        // boundary refuses that now, and this is the one failure worth naming
        // in the toast rather than filing under "see console": the user has a
        // file they can act on if we tell them what was missing.
        // ⚠ The wording names the SYMPTOM, not a cause. Two different things
        // land here — a transport that never started, and a document that
        // evaluates fine but makes no sound (`silence`, or an all-drums
        // document through the offline renderer, #1353). Observed with the
        // latter, which is why it does not say "nothing was playing".
        // #1410 — a document that is MEANT to be silent had no way past the
        // guard. It still refuses by default, but the refused take rides on the
        // error (already encoded when the check fires), so keeping it is one
        // click rather than a re-record. Deliberately NOT a checkbox in the
        // Bounce modal: 4 documents in 142 are silent, and a setting would ask
        // every user to answer a question before they know it applies to them.
        if (err instanceof SilentCaptureError) {
          showToast(
            "Bounce produced no sound — check that the pattern evaluates and actually plays something. Click to save it anyway.",
            "error",
            SILENT_BOUNCE_TOAST_MS,
            () => {
              saveWavBlob(err.refused, activeProject.name);
              showToast("Silent bounce saved.", "info");
            },
          );
          return;
        }
        showToast("Bounce failed — see console for details.", "error");
      })
      .finally(finishBounceUi);
  }, [activeProject, finishBounceUi]);

  const handleBounceStop = useCallback(() => {
    bounceAbortRef.current?.abort();
    // #1649 — a render keeps going until its next pause, so say the press was
    // heard now. A live take needs no such state: its Stop resolves at once.
    setBounceState((prev) =>
      prev.phase === "rendering" ? { ...prev, cancelling: true } : prev,
    );
  }, []);

  const openBounceModal = useCallback(() => {
    setBounceState({ phase: "choosing" });
    setBounceOffline(bounceRef.current?.bouncesOffline() ?? false);
    setBounceStemTracks(bounceRef.current?.stemTracks() ?? 0);
    setBounceOpen(true);
    // Measure asynchronously and let the modal open immediately (#1365). The
    // analysis walks a growing horizon and can take a moment; blocking the modal
    // on it would make Bounce feel broken for the documents it cannot size
    // anyway. `null` renders as the plain seconds picker, so a slow or failed
    // measurement costs the user nothing they had before.
    setBounceSizing(null);
    const token = ++bounceSizingToken.current;
    const handle = bounceRef.current;
    if (!handle) return;
    handle
      .songSizing()
      .then((s) => {
        // A later open (or a tab switch that re-opened the modal) supersedes
        // this one; without the token an older, slower measurement could land
        // last and size the bounce by the wrong document.
        if (token === bounceSizingToken.current) setBounceSizing(s);
      })
      .catch(() => {
        /* sizing is best-effort — the seconds picker still works */
      });
  }, []);

  // A bounce holds the transport and an AbortController; unmounting mid-take
  // would leave both running with nothing listening.
  useEffect(() => () => {
    bounceAbortRef.current?.abort();
    if (bounceTickRef.current) clearInterval(bounceTickRef.current);
  }, []);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  // Mirror of the active tab's runtime, narrowed to what the chrome actually
  // reads. It used to also carry `bpm` and `error` for the status bar; with the
  // bar gone (#1368) the Transport LCD is the only consumer and it takes tempo
  // from `getCps`, so keeping those fields would be state nobody looks at.
  const [activeRuntime, setActiveRuntime] = useState<{ isPlaying: boolean; isPlayPending: boolean; error: string | null } | null>(null);

  // Tell the history service which file is focused so the History panel's
  // File scope targets it (Phase G, #197).
  useEffect(() => {
    setActiveHistoryFile(activeFileId);
  }, [activeFileId]);

  /**
   * Promote a viz file to the active group's backdrop, or clear with
   * `null`. The shell's `setBackgroundFile` mutates group state and
   * fires `onBackgroundFileChange`, which StrudelEditorClient records
   * against the active tab (#347 per-tab map — the source of truth for
   * persistence). We only mirror the new value into React state here so
   * the FileTree menu label (Set ↔ Clear) and crop/reveal handlers
   * update without a second round-trip. (#371 — the old project-global
   * `setProjectBackgroundFileId` persist was removed; per-tab is SoT.)
   */
  const handleSetAsBackground = useCallback((fileId: string | null) => {
    shellRef.current?.setBackgroundFile?.(fileId);
    setBackgroundFileId(fileId);
  }, []);

  // E2E-only hook (Phase 21 T5-C/D): seed a custom viz workspace FILE and pin
  // it as the backdrop directly. Production pins the backdrop by mapping a
  // non-underscore code method (`.scope()`/`.pianoroll()`) to a project viz
  // file's basename — only the methods in STRUDEL_VIZ_METHODS are installed,
  // so a one-off custom backdrop sketch can't be reached by code alone. T5
  // proves the BACKDROP surface reads `sig.tracks`/`sig.track(id).color` (T4's
  // compiledVizProvider threading), NOT the method→file mapping, so shortcut
  // only the pin. Guarded on `__STAVE_E2E__`. Uses the SAME `seedWorkspaceFile`
  // + `setBackgroundFile` the production restore/pin paths use.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Defense-in-depth: never install the E2E hooks in a production build —
    // `process.env.NODE_ENV` is statically replaced so the body dead-code-
    // eliminates. The `__STAVE_E2E__` flag is the runtime gate for dev/test.
    if (process.env.NODE_ENV === "production") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(window as any).__STAVE_E2E__) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__staveSeedAndPinBackdrop = (
      id: string,
      name: string,
      renderer: "p5" | "hydra" | "glsl",
      code: string,
    ): boolean => {
      const lang = languageForRenderer(renderer);
      seedWorkspaceFile(id, `preset/viz/${name}.${renderer}`, code, lang, {
        presetId: id,
      });
      handleSetAsBackground(id);
      return true;
    };
    // #257 — expose the engine log so e2e can observe worker viz runtime errors
    // re-emitted into the main engineLog (Console/issues panel).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__staveGetLog = () => getLogHistory();
    // #2165 — run a Library sketch on the preview engine and report its error,
    // event count and the sounds it names (library-snippets.spec checks them all).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__staveCheckSnippet = (code: string, cycles?: number) => checkSnippet(code, cycles);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__staveSnippetNotesPlayed = () => previewNotesPlayed();
    // Override an EXISTING workspace viz file's code (e.g. the bundled
    // `preset/viz/spectrum.p5`) so a real non-underscore method (`.spectrum()`)
    // pins it through the production code-driven backdrop path — which is the
    // ONLY path that associates the running audio source with the backdrop
    // PreviewView. A directly-pinned ad-hoc file gets a null audioSource, so
    // T5-C/D drive the real method instead. Returns the file id that was
    // overridden, or null if no workspace file with that basename exists.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__staveOverrideVizFile = (
      basename: string,
      code: string,
    ): string | null => {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const target = norm(basename);
      const f = listWorkspaceFiles().find(
        (wf) =>
          isVizLanguage(wf.language) &&
          norm(wf.path.split("/").pop()!.replace(/\.[^.]+$/, "")) === target,
      );
      if (!f) return null;
      setContent(f.id, code);
      return f.id;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__staveBackgroundFileId = (): string | null =>
      backgroundFileId;
  });

  /**
   * Code-driven backdrop — CODE IS THE SOURCE OF TRUTH. Fires on every
   * Strudel eval with the code's current backdrop viz, or `null` when the
   * code has no non-underscore viz method:
   *   - renderer id ("scope", "pianoroll", …) → pin the matching viz file
   *   - null → clear the backdrop (removing `.scope()` un-pins it; this also
   *     overrides a manually-picked backdrop on the next eval, by design)
   *
   * The backdrop is file-keyed, so we map the renderer id to a project viz
   * FILE by NORMALIZED basename (lowercase, alphanumerics only) — `Piano
   * Roll.p5` matches "pianoroll", `scope.p5` matches "scope". p5js wins over
   * hydra. No-ops when nothing changes (idempotent — no churn in live mode)
   * or when the project has no matching viz file (leaves the backdrop as-is
   * rather than clearing, so a typo'd viz name doesn't blank the screen).
   */
  const handleCodeBackdropChange = useCallback(
    (vizId: string | null) => {
      // #350a — code is a TRANSIENT OVERRIDE on the ACTIVE pane, not the manual
      // sticky. `null` drops the override so the user's manual sticky (if any)
      // shows again — previously this WIPED the sticky ("removing .scope()
      // un-pins"), now superseded by the #350 per-pane precedence model
      // (override ?? sticky). The shell call is idempotent, so no churn in live.
      if (vizId === null) {
        shellRef.current?.setBackgroundOverride?.(null);
        return;
      }
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const target = norm(vizId);
      const matches = listWorkspaceFiles().filter(
        (f) =>
          isVizLanguage(f.language) &&
          norm(f.path.split("/").pop()!.replace(/\.[^.]+$/, "")) === target,
      );
      if (matches.length === 0) return; // no viz file — leave the override as-is
      const fileId =
        matches.find((f) => f.language === "p5js")?.id ?? matches[0].id;
      shellRef.current?.setBackgroundOverride?.(fileId);
    },
    [],
  );

  // Restore this project's backdrop CROPS when the active project changes. The
  // backdrop *file* itself is restored per-tab by StrudelEditorClient (#347
  // `tabBackdrops` → `setBackgroundFile` on the active-tab sync), which is the
  // source of truth — so this effect does not read/push `backgroundFileId`
  // (#371 retired the project-global slot, which used to double-restore and
  // fight the per-tab path on reload). Crops are per viz file (#1435) and live
  // in localStorage beside that per-tab map; plain React state consumed by the
  // shell wrapper render, so no shell handle / rAF gating is needed.
  //
  // The IDB read alongside it is the ONE-TIME migration off the old
  // project-global slot. It is deliberately not dropped on the floor: silently
  // ignoring a stored crop resets someone's framing with no error to notice.
  useEffect(() => {
    let cancelled = false;
    const projectId = activeProject.id;
    setBackdropCrops(loadBackdropCrops(projectId));
    setLegacyCrop(null);
    getProject(projectId)
      .then((meta) => {
        if (cancelled) return;
        setLegacyCrop(meta?.backgroundCrop ? { ...meta.backgroundCrop } : null);
      })
      .catch((err) =>
        console.warn("[stave] legacy backdrop crop read failed:", err),
      );
    return () => {
      cancelled = true;
    };
  }, [activeProject.id]);

  /**
   * #1435 migration — hand the old project-global crop to the file that was
   * actually wearing it, once that file is known.
   *
   * Ordering is why this is its own effect: `backgroundFileId` arrives after
   * the project loads (per-tab restore, above), so the crop cannot be keyed at
   * read time. The FIRST backdrop to resolve is the one that was on screen when
   * the crop was saved, so it inherits it — the user sees exactly what they saw
   * before the upgrade. Then the legacy slot is drained, so the rect can never
   * travel onto a second sketch, which is the whole defect being fixed.
   *
   * An existing per-file entry always wins: a crop the user set AFTER upgrading
   * must not be overwritten by the ghost of one they set before.
   */
  useEffect(() => {
    if (!legacyCrop || !backgroundFileId) return;
    const projectId = activeProject.id;
    setLegacyCrop(null);
    if (!backdropCrops.has(backgroundFileId)) {
      setBackdropCrops(
        withBackdropCrop(projectId, backdropCrops, backgroundFileId, legacyCrop),
      );
    }
    dropLegacyBackgroundCrop(projectId).catch((err) =>
      console.warn("[stave] legacy backdrop crop drain failed:", err),
    );
  }, [activeProject.id, backgroundFileId, backdropCrops, legacyCrop]);

  /** The crop for whatever backdrop is actually showing, or null for full-rect. */
  const backgroundCrop = backgroundFileId
    ? backdropCrops.get(backgroundFileId) ?? null
    : null;

  /** Store (or forget) the ACTIVE backdrop file's crop — the popup's `persist`. */
  const persistBackdropCrop = useCallback(
    (fileId: string, crop: CropRegion | null) => {
      setBackdropCrops((prev) =>
        withBackdropCrop(activeProject.id, prev, fileId, crop),
      );
    },
    [activeProject.id],
  );

  // Phase 20-01 PR-B (DB-01) — refs hold the latest runtime accessors
  // so the registered MusicalTimeline element never re-registers when
  // the active runtime swaps. Drawer-open + active-tab read through
  // localStorage on every accessor invocation; the rAF loop downstream
  // gates the cost of those reads (DB-08).
  const getCycleRef = useRef<() => number | null>(() => null);
  const getCpsRef = useRef<() => number | null>(() => null);
  const getAudioHealthRef = useRef<() => { lateNotes: number; underruns: number | null } | null>(() => null);
  // Phase 20-06 (PV38, PK13 step 7+8) — closure-bound accessor onto the
  // active runtime's HapStream for the MusicalTimeline subscriber.
  const getHapStreamRef = useRef<() => HapStream | null>(() => null);
  // #861 — closure-bound accessor onto the active runtime's evaluated timeline
  // events, for the full-song timeline's eval-backed DISPLAY marks. Same
  // ref-closure shape as getHapStreamRef; default returns [] until a runtime
  // attaches (non-Strudel runtimes never populate it).
  const getTimelineEventsRef = useRef<(cycles: number) => IREvent[]>(() => []);
  // #1197 — the same events over a BAND rather than a prefix from zero, so the
  // song analysis stops re-querying the whole prefix on every horizon slice.
  // Same ref-closure shape and same default as the prefix accessor above.
  const getTimelineEventsBandRef = useRef<(startCycle: number, endCycle: number) => IREvent[]>(
    () => [],
  );
  // #1107 — the registered track ids behind those events. The song analysis
  // needs both to tell "this track has not played yet" from "there is no such
  // track"; default `[]` makes no claim, which is right for a runtime that has
  // not attached or is not Strudel.
  const getSongTrackIdsRef = useRef<() => string[]>(() => []);
  // #1731 — the active runtime's synth-track renders, relayed so the Timeline
  // (registered once) keeps hearing from whichever runtime is active.
  const trackEnvelopeRelay = useMemo(() => createTrackEnvelopeRelay(), []);
  // #384/#385 — transport seek accessors for the full-song timeline. Same
  // ref-closure shape as getCycleRef so the registered element never
  // re-registers when the active runtime swaps. getSongPosition is the
  // transport-offset-aware clock; onSeek drives runtime.seekTo. Defaults
  // are no-ops so non-Strudel runtimes (DemoEngine, SonicPi) are well-typed.
  const getSongPositionRef = useRef<() => number | null>(() => null);
  const onSeekRef = useRef<(cycle: number) => void>(() => {});
  // #394 — on-demand IR snapshot capture so the full-song view can populate
  // the instant it opens (cold eval publishes its snapshot ~2.5s late). No-op
  // default until a runtime attaches.
  const onRequestSnapshotRef = useRef<() => void>(() => {});
  // Phase 20-07 wave γ (R-2) — Inspector accessors. Live alongside
  // getHapStreamRef. Each ref holds a closure that reads through the
  // active runtime; default returns null/false so renders before the
  // runtime is attached are well-typed. The IRInspectorPanel reads the
  // refs each render via wrapping arrow closures (mirrors 20-06's
  // `getHapStream={() => getHapStreamRef.current()}` shape).
  const getBreakpointStoreRef = useRef<() => BreakpointStore | null>(() => null);
  const getIsPausedRef = useRef<() => boolean>(() => false);
  const onResumeRef = useRef<() => void>(() => {});
  // Listener bus — IRInspectorPanel + Monaco command both subscribe to
  // pause-state transitions through this. Default is "subscribe and
  // immediately unsubscribe" so the panel's useEffect cleanup is safe.
  const onPauseChangedRef = useRef<(cb: (paused: boolean) => void) => () => void>(
    () => () => {},
  );

  const handleRuntimeStateChange = useCallback(
    (
      s:
        | {
            isPlaying: boolean;
            isPlayPending?: boolean;
            bpm?: number;
            error: string | null;
            getCycle?: () => number | null;
            getCps?: () => number | null;
            getAudioHealth?: () => { lateNotes: number; underruns: number | null } | null;
            getHapStream?: () => HapStream | null;
            // #861 — evaluated timeline events for the eval-backed DISPLAY marks.
            getTimelineEvents?: (cycles: number) => IREvent[];
            // #1197 — the same events over a band rather than a prefix.
            getTimelineEventsBand?: (startCycle: number, endCycle: number) => IREvent[];
            // #1107 — registered track ids behind those events.
            getSongTrackIds?: () => string[];
            // #1731 — synth-track renders for the Song timeline.
            fileId?: string;
            trackEnvelopes?: TrackEnvelopeAccess;
            // #384/#385 — transport seek accessors (Strudel only).
            getSongPosition?: () => number | null;
            onSeek?: (cycle: number) => void;
            onRequestSnapshot?: () => void;
            // Phase 20-07 wave γ (R-2) — debugger accessors. Optional
            // because non-Strudel runtimes (DemoEngine, SonicPi) skip
            // them; the default no-op refs survive a null assignment.
            getBreakpointStore?: () => BreakpointStore | null;
            getIsPaused?: () => boolean;
            onResume?: () => void;
            onPauseChanged?: (cb: (paused: boolean) => void) => () => void;
          }
        | null,
    ) => {
      // Always update the accessor refs first — even when the status
      // payload didn't change shape, the underlying runtime may have
      // swapped (active tab changed). When `s` is null, swap in
      // no-op accessors so the rAF loop reads `null` and goes idle.
      getCycleRef.current = s?.getCycle ?? (() => null);
      getCpsRef.current = s?.getCps ?? (() => null);
      getAudioHealthRef.current = s?.getAudioHealth ?? (() => null);
      getHapStreamRef.current = s?.getHapStream ?? (() => null);
      getTimelineEventsRef.current = s?.getTimelineEvents ?? (() => []);
      getTimelineEventsBandRef.current = s?.getTimelineEventsBand ?? (() => []);
      getSongTrackIdsRef.current = s?.getSongTrackIds ?? (() => []);
      trackEnvelopeRelay.attach(s?.fileId ?? null, s?.trackEnvelopes ?? null);
      getSongPositionRef.current = s?.getSongPosition ?? (() => null);
      onSeekRef.current = s?.onSeek ?? (() => {});
      onRequestSnapshotRef.current = s?.onRequestSnapshot ?? (() => {});
      // Phase 20-07 wave γ (R-2) — Inspector accessor refs. When `s` is
      // null (runtime detached / non-Strudel tab), the no-op defaults
      // mean IRInspectorPanel renders without breakpoint / pulse / Resume
      // affordances (the legacy 20-04 + 19-08 surface).
      getBreakpointStoreRef.current = s?.getBreakpointStore ?? (() => null);
      getIsPausedRef.current = s?.getIsPaused ?? (() => false);
      onResumeRef.current = s?.onResume ?? (() => {});
      onPauseChangedRef.current = s?.onPauseChanged ?? (() => () => {});
      setActiveRuntime((prev) => {
        if (!s) return prev === null ? prev : null;
        const error = s.error ?? null;
        const isPlayPending = s.isPlayPending ?? false;
        if (
          prev &&
          prev.isPlaying === s.isPlaying &&
          prev.isPlayPending === isPlayPending &&
          prev.error === error
        ) return prev; // skip re-render
        return { isPlaying: s.isPlaying, isPlayPending, error };
      });
    },
    [trackEnvelopeRelay],
  );

  // Phase 20-01 PR-B (DA-05 idempotent replace) — register the real
  // MusicalTimeline content once on mount. PR-A's seedTabs registered
  // a placeholder at editor-bundle load; this useEffect runs after the
  // app mounts and replaces it. Re-registration on every active-tab
  // change would race the BottomPanel subscriber and cause flicker;
  // ref pattern keeps the registered element identity stable.
  useEffect(() => {
    registerBottomPanelTab({
      id: "musical-timeline",
      title: "Timeline",
      content: (
        <MusicalTimeline
          getCycle={() => getCycleRef.current()}
          getCps={() => getCpsRef.current()}
          getHapStream={() => getHapStreamRef.current()}
          getTimelineEvents={(cycles) => getTimelineEventsRef.current(cycles)}
          getTimelineEventsBand={(startCycle, endCycle) =>
            getTimelineEventsBandRef.current(startCycle, endCycle)
          }
          getSongTrackIds={() => getSongTrackIdsRef.current()}
          trackEnvelopes={trackEnvelopeRelay.access}
          getSongPosition={() => getSongPositionRef.current()}
          onSeek={(cycle) => onSeekRef.current(cycle)}
          onRequestSnapshot={() => onRequestSnapshotRef.current()}
          getDrawerOpen={() => readPersistedOpen()}
          getActiveTabId={() => readPersistedActiveTabId()}
        />
      ),
    });
    // No unregister — the tab lives for the lifetime of the app. PR-A's
    // placeholder seed is benign even after a hot reload because the
    // registry's idempotent semantics (DA-05) make re-registration a
    // no-fanfare swap.
  }, [trackEnvelopeRelay]); // stable for the app's life: registers once

  // #1726 — the whole-song analysis runs here, not inside the Song timeline:
  // the drawer unmounts the timeline when closed, and the transport display
  // still needs the song's length to wrap the position to it. The timeline
  // reads the same result. The accessors are the ones the timeline is given.
  useEffect(
    () =>
      startSongAnalysis({
        getTimelineEvents: (cycles) => getTimelineEventsRef.current(cycles),
        getTimelineEventsBand: (startCycle, endCycle) =>
          getTimelineEventsBandRef.current(startCycle, endCycle),
        getSongTrackIds: () => getSongTrackIdsRef.current(),
      }),
    [],
  );

  // #391 — expose the live transport cycle to the editor-seeded visual panels
  // (Sequencer / Piano Roll) so they can highlight the playing step. The panels
  // run their own rAF against this accessor.
  //
  // #1725 — it is the SONG position, the clock the Song timeline's playhead
  // reads (gated on isPlaying like `getCycle`), not `getCycle`. The scheduler's
  // raw clock counts since Play and ignores a seek, so after a click on the
  // ruler the grid lit the step the song WOULD be on had nobody scrubbed.
  // Unwrapped on purpose: the step is `cycle mod bars` of the pattern, and the
  // pattern is queried at exactly this cycle.
  useEffect(() => {
    setCurrentCycleAccessor(() => getSongPositionRef.current());
    return () => setCurrentCycleAccessor(null);
  }, []);

  // #514 / PV141 #6 — expose the live instrument registry (superdough's
  // `soundMap`) to the editor-seeded Mixer picker. The app owns superdough; the
  // panel reads the grouped catalog through `useSoundCatalog` and falls back to
  // the curated list until this is available. The soundMap grows async as CDN
  // samples load, so we poll and notify while the count is still changing, then
  // stop once it settles (the store's own subscribe API isn't contractual).
  useEffect(() => {
    const readDict = (): SoundMapDict | null =>
      (globalThis as unknown as { soundMap?: { get?: () => SoundMapDict } })
        .soundMap?.get?.() ?? null;
    setSoundCatalogAccessor(() => groupSoundCatalog(readDict()));
    // #820 — the Asset Library's Sounds provider reads the SAME live soundMap
    // (the raw superset, drums included — unlike the melodic groupSoundCatalog),
    // previews via the shared sustained audition, and inserts through the
    // editor's cursor writer. Registered here so it shares this warm-up/poll.
    const unregSounds = registerAssetProvider(
      createSoundsProvider({
        readDict,
        startPreview: (sound) => startAudition(sound),
        onInsert: (sound) => {
          // #2226 — a `.sound()` that is a pattern of several is not replaced: say why
          const refused = shellRef.current?.assignSoundToCursor(sound);
          if (refused) showToast(refused, "info", 6000);
        },
        // #2062 — your audio is listed with the sounds, as yours
        ownAudio: () => ownAudioRef.current?.list() ?? [],
      }),
    );
    let lastCount = -1;
    let stable = 0;
    let ticks = 0;
    // Ceiling so we never poll forever if the engine never initializes (eager
    // warm-up failed AND the user never pressed Play). ~2 min at 1.5s cadence.
    const MAX_TICKS = 80;
    const tick = () => {
      ticks += 1;
      const dict = readDict();
      const count = dict ? Object.keys(dict).length : 0;
      if (count !== lastCount) {
        lastCount = count;
        stable = 0;
        notifySoundCatalogChanged();
        notifyAssetProvidersChanged();
      } else if (count > 0) {
        // Only settle once we actually have a live list. A count stuck at 0
        // means the engine hasn't inited yet (init is lazy — first Play or the
        // eager warm-up in StrudelEditorClient) — keep polling so a later init
        // refreshes the picker instead of leaving it on the curated fallback
        // (#813). The old `else` incremented here even at 0, so a slow/late
        // init would find the poll already dead and never repopulate.
        stable += 1;
      }
    };
    const id = window.setInterval(() => {
      tick();
      // Stop once a real (non-zero) list has settled, or give up at the ceiling.
      if ((lastCount > 0 && stable >= 4) || ticks >= MAX_TICKS) {
        window.clearInterval(id);
      }
    }, 1500);
    tick();
    return () => {
      window.clearInterval(id);
      setSoundCatalogAccessor(null);
      unregSounds();
    };
  }, []);

  // #834 — Asset Library Viz provider: a curated shelf of non-default viz
  // *packages* you ADD to the workspace (not the bundled default presets). The
  // `+` on a row materialises the package under `viz_lib/<Name>/` and registers
  // its primary file as a named viz so `.viz("<Name>")` resolves immediately.
  useEffect(() => {
    const addVizPackage = (item: VizLibItem): void => {
      const planned = planVizLibFiles(item);
      // Idempotent: `seedWorkspaceFile` returns the persisted file for a known
      // id without overwriting, so a second "add" of the same package is a
      // no-op on already-present files.
      let created = false;
      for (const pf of planned) {
        const existed = getFile(pf.workspaceId) !== undefined;
        seedWorkspaceFile(pf.workspaceId, pf.path, pf.content, pf.language);
        if (!existed) created = true;
      }
      // The added file(s) register as named viz via StrudelEditorClient's
      // file-list subscription (#834), so `.viz("<Name>")` resolves without a
      // reload — the registration lives on the proven `registerAllVizFiles`
      // path, not duplicated here.
      showToast(
        created
          ? `Added ${item.name} → ${VIZ_LIB_ROOT}/${item.name}/. Use .viz("${item.name}").`
          : `${item.name} is already in your workspace.`,
        "info",
      );
    };

    const unregViz = registerAssetProvider(
      createVizProvider({
        onAdd: addVizPackage,
        // Live hover preview (#838): render the card's real shader in the viz
        // worker, muted, driven by the demo drum-pattern feed. Worker-only —
        // returns null where unsupported so the card keeps its static tile.
        mountPreview: (container, spec, size) =>
          mountVizPreview(container, spec, size, (e) =>
            console.error("[viz preview]", spec.name, e),
          ),
      }),
    );
    return unregViz;
  }, []);

  // #2165 — the built-in Strudel sketches. Preview plays one on an engine of
  // its own (the project's stays as it is); `+` adds it to the project as a new
  // file under `snippets/`, which opens it: StrudelEditorClient opens every file
  // added to the project. (Opening it here as well gave it two tabs.)
  useEffect(() => {
    return registerAssetProvider(
      createSnippetsProvider({
        startPreview: (snippet) => playSnippet(snippet.code),
        onInsert: (snippet) => {
          const file = createFileWithContent(`snippets/${snippet.id}.strudel`, snippet.code, "strudel");
          showToast(`Added ${snippet.name} → ${file.path}. Press play to hear it.`, "info");
        },
      }),
    );
  }, []);

  // #1504 — the project's own audio in the library. `AssetType` has declared
  // "sample" and `AssetSource` has declared "user" since the library shipped,
  // both with nothing behind them; recorded takes are exactly that category.
  //
  // `list()` reads the records live, so a new take needs no re-registration —
  // only a notify, which `RecordTakeButton` fires. The subscription here covers
  // the OTHER writers (rename, remove, and a project switch bringing a
  // different set of takes), which the button knows nothing about.
  //
  // #1786 — each row shows its stored size and can be removed. Sizes come from
  // the byte store, which the provider cannot read synchronously, so they are
  // held here by content hash and re-read whenever the records change.
  useEffect(() => {
    let alive = true;
    const sizes = new Map<string, number>();
    const refreshSizes = async () => {
      try {
        const rows = await listAssets();
        if (!alive) return;
        sizes.clear();
        for (const row of rows) sizes.set(row.hash, row.size);
        notifyAssetProvidersChanged();
      } catch {
        /* sizes are a hint; a store that can't be read shows none */
      }
    };
    const onRemove = async (record: { id: string; name: string }) => {
      const ok = await showConfirm({
        title: `Remove "${record.name}"?`,
        description:
          // Observed: a pattern still playing it goes silent AND reports the
          // sound missing on every note, as for any unknown name.
          `It leaves this project. Code that plays s("${record.name}") goes silent and reports it missing. ` +
          "Its audio is deleted too, unless another sound or project still uses it.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      removeAssetRecord(record.id);
      unregisterAsset(record.name);
      try {
        const result = await collectUnusedSounds();
        showToast(
          removedMessage(record.name, result),
          result.kind === "could-not-check" || result.kind === "refused" ? "error" : "info",
        );
      } catch (err) {
        console.error("[stave] freeing a removed sound's space failed:", err);
        showToast(removedButFailedMessage(record.name), "error");
      }
      await refreshSizes();
    };
    // #2062 — not registered as a type of its own: the Sounds provider lists these
    // rows (Sounds → User). Published here, then the Library is told to re-list.
    ownAudioRef.current = (
      createSamplesProvider({
        readRecords: () => listAssetRecords(),
        // #2059 — a recording previews once, start to end, not as a re-triggered
        // 0.22 s note (that is `startAudition`, right for the built-in Sounds).
        startPreview: async (name) => {
          const record = listAssetRecords().find((r) => r.name === name);
          const url = record ? await resolveAsset(record.blobHash) : null;
          return url ? startClipPreview(url) : undefined;
        },
        // #2070 — a clip longer than a cycle plays through before it starts again:
        // its length in cycles at the tempo playing now (Strudel's 0.5 before any).
        onInsert: (name) => {
          const record = listAssetRecords().find((r) => r.name === name);
          const slow = cyclesToPlayThrough(record?.duration, getCpsRef.current() ?? 0.5);
          const refused = shellRef.current?.assignSoundToCursor(name, slow ? { slow } : undefined);
          if (refused) showToast(refused, "info", 6000);
        },
        sizeOf: (hash) => sizes.get(hash),
        onRemove,
      })
    );
    notifyAssetProvidersChanged();
    const unreg = () => {
      ownAudioRef.current = null;
      notifyAssetProvidersChanged();
    };
    void refreshSizes();
    const unsub = subscribeToAssets(() => {
      notifyAssetProvidersChanged();
      void refreshSizes();
    });
    return () => {
      alive = false;
      unsub();
      unreg();
    };
  }, []);

  // #515 / PV141 #6 — enumerate live drum banks for the Mixer's Kit picker.
  // Banks load from the tidal-drum-machines manifest (its keys are
  // `Bank_voice`), which the engine also fetches at boot (StrudelEngine.ts:365),
  // so this is usually an HTTP-cache hit. We fetch once, derive the distinct
  // bank names, and register the kit reader; until it resolves (or on any fetch
  // error) the picker falls back to the curated DRUM_KITS.
  useEffect(() => {
    // Same CDN base as StrudelEngine.ts:365 — kept in sync by grep if it moves.
    const MANIFEST_URL = "https://strudel.b-cdn.net/tidal-drum-machines.json";
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(MANIFEST_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const manifest = (await res.json()) as DrumMachineManifest;
        if (cancelled) return;
        const banks = banksFromDrumMachineManifest(manifest);
        // setDrumKitAccessor recomputes + notifies subscribers internally; the
        // manifest is static so one set is enough (no polling, unlike soundMap).
        setDrumKitAccessor(() => groupDrumKits(banks));
      } catch (e) {
        console.warn(
          "[StaveApp] drum-machine manifest fetch failed; Kit picker using curated list.",
          e,
        );
      }
    })();
    return () => {
      cancelled = true;
      setDrumKitAccessor(null);
    };
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (err) {
      // The registry open is bounded now (#687) and can reject when IDB is
      // blocked/unavailable. Keep the current list rather than clobbering it —
      // the sidebar degrades to whatever we last had instead of hanging.
      console.warn("[stave] project list refresh failed:", err);
    }
  }, []);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  // ── Project operations ──────────────────────────────────────────────

  const doSwitchProject = useCallback(async (id: string) => {
    if (id === activeProject.id || switching) return;
    if (unsavedBlocksLeaving()) return;
    setSwitching(true);
    try {
      resetFileStore();
      await switchProject(id);
      await touchProject(id);
      const list = await listProjects();
      const selected = list.find((p) => p.id === id);
      if (selected) {
        setActiveProject(selected);
        setProjects(list);
      }
    } catch (err) {
      // switchProject / touchProject / listProjects each open IDB, now bounded
      // (#687). A blocked store rejects instead of hanging the switch — surface
      // it and leave the user on the current project rather than a stuck UI.
      console.warn("[stave] project switch failed:", err);
      showToast("Couldn't switch project — storage is unavailable", "error");
    } finally {
      setSwitching(false);
    }
  }, [activeProject.id, switching]);

  const handleCreateProject = useCallback(async (name: string, templateId: string) => {
    setTemplateModalOpen(false);
    if (unsavedBlocksLeaving()) return;
    setSwitching(true);
    try {
      const meta = await createProject(name);
      resetFileStore();
      await switchProject(meta.id);
      await touchProject(meta.id);
      // Seed template files into the new Y.Doc
      seedProjectFromTemplate(templateId, meta.id);
      setActiveProject(meta);
      await refreshProjects();
    } finally {
      setSwitching(false);
    }
  }, [refreshProjects]);

  const handleRenameActiveProject = useCallback(async () => {
    const newName = await showPrompt({
      title: "Rename project",
      initialValue: activeProject.name,
      placeholder: "Project name",
      confirmLabel: "Rename",
    });
    if (!newName || !newName.trim() || newName === activeProject.name) return;
    await renameProject(activeProject.id, newName.trim());
    const list = await listProjects();
    const updated = list.find((p) => p.id === activeProject.id);
    if (updated) setActiveProject(updated);
    setProjects(list);
  }, [activeProject]);

  const handleRenameProjectFromSwitcher = useCallback(async (id: string) => {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return;
    const newName = await showPrompt({
      title: "Rename project",
      initialValue: proj.name,
      placeholder: "Project name",
      confirmLabel: "Rename",
    });
    if (!newName || !newName.trim() || newName === proj.name) return;
    await renameProject(id, newName.trim());
    const list = await listProjects();
    if (id === activeProject.id) {
      const updated = list.find((p) => p.id === id);
      if (updated) setActiveProject(updated);
    }
    setProjects(list);
  }, [projects, activeProject.id]);

  const handleDeleteProjectFromSwitcher = useCallback(async (id: string) => {
    if (projects.length <= 1) return;
    // Deleting the OPEN project opens another one, which drops the only copy
    // of any edits the disk refused (#1779).
    if (id === activeProject.id && unsavedBlocksLeaving()) return;
    await deleteProject(id);
    if (id === activeProject.id) {
      const remaining = projects.filter((p) => p.id !== id);
      const next = remaining[0];
      if (next) {
        resetFileStore();
        await switchProject(next.id);
        await touchProject(next.id);
        setActiveProject(next);
      }
    }
    await refreshProjects();
  }, [activeProject.id, projects, refreshProjects, unsavedBlocksLeaving]);

  // ── Tab ↔ Tree sync ─────────────────────────────────────────────────

  const handleOpenFile = useCallback((fileId: string, intent?: { preview?: boolean }) => {
    // Ask the shell to open or focus the editor tab for this file. Tree
    // single-click passes preview: true so the tab is a transient preview
    // slot; double-click promotes it. Command-palette Quick Open defaults
    // to preview off (pinned) since the user explicitly picked the file.
    shellRef.current?.openOrFocusFile(fileId, intent);
  }, []);

  // Register every app-level action as a command. Commands are the
  // single source of truth for menu items, palette entries, and
  // keybindings. Re-registers when dependencies change so closures
  // capture fresh handlers.
  useEffect(() => {
    const unregs: Array<() => void> = [];
    unregs.push(registerCommand({
      id: "stave.palette.open",
      title: "Show All Commands",
      category: "View",
      keybinding: "mod+shift+p",
      run: () => setPaletteOpen(true),
    }));
    unregs.push(registerCommand({
      id: "stave.docs.search",
      title: "Search Documentation",
      category: "Help",
      description: "Fuzzy-search the 900+ docs entries across all runtimes.",
      keybinding: "mod+shift+d",
      run: () => setDocsSearchOpen(true),
    }));
    unregs.push(registerCommand({
      id: "stave.project.new",
      title: "New Project...",
      category: "File",
      keybinding: "mod+n",
      run: () => setTemplateModalOpen(true),
    }));
    unregs.push(registerCommand({
      id: "stave.project.open",
      title: "Open Project...",
      category: "File",
      keybinding: "mod+o",
      run: () => setSwitcherModalOpen(true),
    }));
    unregs.push(registerCommand({
      id: "stave.project.rename",
      title: "Rename Project...",
      category: "File",
      run: () => handleRenameActiveProject(),
    }));
    unregs.push(registerCommand({
      id: "stave.project.export",
      title: "Export Project as .stave",
      category: "File",
      run: () => handleExportProject(),
    }));
    unregs.push(registerCommand({
      id: "stave.audio.bounce",
      title: "Bounce to WAV...",
      category: "File",
      description: "Record the live output to a .wav file. Real-time.",
      when: () => bounceRef.current?.canBounce() ?? false,
      run: () => { openBounceModal(); },
    }));
    unregs.push(registerCommand({
      id: "stave.project.import",
      title: "Open Project File...",
      category: "File",
      run: () => triggerImportPicker(),
    }));
    unregs.push(registerCommand({
      id: "stave.project.versionHistory",
      title: "Version History",
      category: "File",
      run: () => { openSnapshotPanel(); },
    }));
    unregs.push(registerCommand({
      id: "stave.edit.undo",
      title: "Undo",
      category: "Edit",
      keybinding: "mod+z",
      where: UNDO_WHERE,
      // #1800 — a panel that edits code undoes in that code's history; only
      // elsewhere does ⌘Z undo file changes.
      when: () => !!codeEditorForFocus(document.activeElement) || canUndo(),
      run: () => { if (!codeUndoForFocus(document.activeElement, "undo")) undo(); },
    }));
    unregs.push(registerCommand({
      id: "stave.edit.redo",
      title: "Redo",
      category: "Edit",
      keybinding: "mod+shift+z",
      where: UNDO_WHERE,
      when: () => !!codeEditorForFocus(document.activeElement) || canRedo(),
      run: () => { if (!codeUndoForFocus(document.activeElement, "redo")) redo(); },
    }));
    unregs.push(registerCommand({
      id: "stave.view.toggleSidebar",
      title: "Toggle Sidebar",
      category: "View",
      keybinding: "mod+b",
      run: () => setSidebarCollapsed((c) => !c),
    }));
    unregs.push(registerCommand({
      id: "stave.view.zen",
      title: "Toggle Zen / Perform Mode",
      category: "View",
      description: "Hide the activity bar and side panel, and go full screen. Esc to exit.",
      keybinding: "mod+alt+z",
      run: () => setZenMode((z) => !z),
    }));
    unregs.push(registerCommand({
      id: "stave.view.fontUp",
      title: "Increase Editor Font Size",
      category: "View",
      keybinding: "mod+=",
      run: () => bumpEditorFontSize(1),
    }));
    unregs.push(registerCommand({
      id: "stave.view.fontDown",
      title: "Decrease Editor Font Size",
      category: "View",
      keybinding: "mod+-",
      run: () => bumpEditorFontSize(-1),
    }));
    unregs.push(registerCommand({
      id: "stave.view.toggleMinimap",
      title: "Toggle Minimap",
      category: "View",
      run: () => toggleEditorMinimap(),
    }));
    unregs.push(registerCommand({
      id: "stave.view.cycleTheme",
      title: "Cycle Theme (Dark → Light → System)",
      category: "View",
      run: () => { cycleEditorTheme(); },
    }));
    unregs.push(registerCommand({
      id: "stave.view.splitRight",
      title: "Split Editor Right",
      category: "View",
      keybinding: "mod+\\",
      run: () => { shellRef.current?.splitActiveGroup?.("east"); },
    }));
    unregs.push(registerCommand({
      id: "stave.view.splitDown",
      title: "Split Editor Down",
      category: "View",
      keybinding: "mod+shift+\\",
      run: () => { shellRef.current?.splitActiveGroup?.("south"); },
    }));
    unregs.push(registerCommand({
      id: "stave.file.share",
      title: "Copy Share Link",
      category: "File",
      description: "Copy a URL that imports this project on another machine.",
      run: () => { void handleShareProject(); },
    }));
    unregs.push(registerCommand({
      id: "stave.view.shortcuts",
      title: "Keyboard Shortcuts",
      category: "View",
      description: "List every command that has a shortcut.",
      keybinding: "mod+/",
      run: () => { setSettingsTab("keys"); setSettingsOpen(true); },
    }));
    unregs.push(registerCommand({
      id: "stave.quickOpen",
      title: "Quick Open File",
      category: "Go",
      keybinding: "mod+p",
      run: () => setQuickOpenOpen(true),
    }));
    unregs.push(registerCommand({
      id: "stave.workspaceSearch",
      title: "Search in Files",
      category: "Find",
      keybinding: "mod+shift+f",
      run: () => {
        setActivePanelId("search");
        // Defer focus until after the panel mounts / remounts.
        setTimeout(() => searchViewRef.current?.focus(), 50);
      },
    }));
    // Activity-bar panel registry — the panel body itself is rendered
    // by StaveApp via activePanelId; registering here just gives the
    // activity bar a button for it. The `render` callback is a stub
    // that the dispatcher currently ignores in favour of inline JSX
    // below — kept for future extension (external panel contributors).
    unregs.push(registerPanel({
      id: "explorer",
      title: "Explorer",
      icon: "files",
      order: 10,
      render: () => null,
    }));
    unregs.push(registerPanel({
      id: "search",
      title: "Search",
      icon: "search",
      order: 20,
      render: () => null,
    }));
    unregs.push(registerPanel({
      id: "snapshots",
      title: "Version History",
      icon: "history",
      order: 30,
      render: () => null,
    }));
    unregs.push(registerPanel({
      id: "library",
      title: "Library",
      icon: "library",
      order: 40,
      render: () => null,
    }));
    // Asset Library providers register alongside the live-catalog lifecycle
    // they depend on: the Sounds provider is wired in the soundMap poll effect
    // (it reuses the same warm-up/poll), not here.
    unregs.push(registerPanel({
      id: "console",
      title: "Console",
      icon: "terminal",
      order: 50,
      render: () => null,
      // Errors and warnings since this panel was last opened. Errors also
      // raise a toast (below); warnings have no other persistent surface.
      badge: consoleBadge,
    }));
    // IR debugger (IR Inspector) — hidden from the left activity bar until the
    // full breakpoint-driven music debugger flow lands (re-enable: #680). The panel, its
    // render block below (`activePanelId === "ir-inspector"`), the engine
    // capture, and the breakpoint wiring are all intentionally KEPT intact;
    // only this tab registration is disabled so nothing surfaces in the UI.
    // `activePanelId` is not persisted and can only reach "ir-inspector" via
    // this (now-absent) tab button, so the render block is safely dormant.
    // To restore: un-comment the registerPanel call below.
    // unregs.push(registerPanel({
    //   id: "ir-inspector",
    //   title: "IR Inspector",
    //   icon: "inspect",
    //   order: 60,
    //   render: () => null,
    // }));
    return () => { for (const u of unregs) u(); };
  }, [activeProject, handleRenameActiveProject, openSnapshotPanel, handleShareProject, handleExportProject]);

  // Build file rows for QuickOpen — memoised so mount of the palette
  // has a stable array. Rebuilt when the file list changes.
  const quickOpenRows: PaletteRow[] = useMemo(() => {
    if (!quickOpenOpen) return [];
    return listWorkspaceFiles()
      .filter((f) => !f.path.endsWith("/.keep"))
      .map((f) => {
        const name = f.path.split("/").pop() ?? f.path;
        const folder = f.path.includes("/")
          ? f.path.slice(0, f.path.lastIndexOf("/"))
          : "";
        return {
          id: `file:${f.id}`,
          title: name,
          description: folder || undefined,
          run: () => handleOpenFile(f.id),
        };
      });
  }, [quickOpenOpen, handleOpenFile]);

  // #347 — backdrop crop/reveal, shared by the menubar bg-popover AND the
  // pattern-bar "set bg" popover (StrudelEditorClient). Both act on the active
  // pane's resolved backdrop (`backgroundFileId`).
  const handleRevealBackdrop = () => {
    if (backgroundFileId) handleOpenFile(backgroundFileId);
  };
  const handleCropBackdrop = () => {
    if (!backgroundFileId) return;
    // Read the actual backdrop container size so the crop preview renders at
    // the same dimensions as the live viz.
    const bgEl = document.querySelector("[data-workspace-background]");
    const rect = bgEl?.getBoundingClientRect();
    const renderSize =
      rect && rect.width > 0
        ? { w: Math.round(rect.width), h: Math.round(rect.height) }
        : undefined;
    setCropTarget({
      mode: "backdrop",
      adapter: createBackdropCropAdapter({
        fileId: backgroundFileId,
        initialCrop: backgroundCrop,
        persist: (c) => persistBackdropCrop(backgroundFileId, c),
        renderSize,
      }),
    });
  };

  // What a panel holds — the same element whether it sits in the desktop's side panel
  // or in the phone's drawer (#2000).
  const openFileFromPanel = (fileId: string, intent?: { preview?: boolean }) => {
    handleOpenFile(fileId, intent);
    // on a phone the drawer is over the editor: picking a file is asking to see it
    if (phone) closePhoneDrawer();
  };
  const renderPanel = (id: string) => (
    <>
        {id === "explorer" && (
          <FileTree
            ref={fileTreeRef}
            projectName={activeProject.name}
            onOpenFile={openFileFromPanel}
            activeFileId={activeFileId}
            onImportZipProject={handleImportZip}
            onFileHistory={(fileId) => {
              setFileHistoryTarget(fileId);
              setActivePanelId("snapshots");
            }}
          />
        )}
        {id === "search" && (
          <div style={styles.panelRoot} data-sidebar>
            <div style={styles.panelHeader}>SEARCH</div>
            <WorkspaceSearchView
              ref={searchViewRef}
              compact
              onOpenFile={(fileId) => openFileFromPanel(fileId, { preview: true })}
            />
          </div>
        )}
        {id === "snapshots" && (
          <div style={styles.panelRoot} data-sidebar>
            <div style={styles.panelHeader}>VERSION HISTORY</div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <HistoryPanel
                onOpenHistoryTab={(req) => {
                shellRef.current?.openHistoryTab(req);
                // as with a file: the tab it opened is under the drawer
                if (phone) closePhoneDrawer();
              }}
              />
            </div>
          </div>
        )}
        {id === "library" && (
          <AssetLibraryPanel
            key={libraryOpenedFor}
            initialType={libraryOpenedFor > 0 ? "sound" : undefined}
            initialSource={libraryOpenedFor > 0 ? "user" : undefined}
          />
        )}
        {id === "console" && <ConsolePanel onReveal={revealLogEntry} />}
        {id === "ir-inspector" && (
          <IRInspectorPanel
            getHapStream={() => getHapStreamRef.current()}
            getBreakpointStore={() => getBreakpointStoreRef.current()}
            getIsPaused={() => getIsPausedRef.current()}
            onResume={() => onResumeRef.current()}
            onPauseChanged={(cb) => onPauseChangedRef.current(cb)}
          />
        )}
    </>
  );

  // The menus' actions (#2000): one object, drawn by the desktop's menu bar and by the
  // phone's drawer.
  const menuActions: MenuActions = {
    onOpenEditorSettings: () => { setSettingsTab("settings"); setSettingsOpen(true); },
    onOpenShortcuts: () => { setSettingsTab("keys"); setSettingsOpen(true); },
    onNewProject: () => setTemplateModalOpen(true),
    onOpenProject: () => setSwitcherModalOpen(true),
    recentProjects: recentProjectEntries(projects, activeProject.id),
    onOpenRecent: doSwitchProject,
    onOpenStartScreen: () => setStartScreenOpen(true),
    onRenameProject: handleRenameActiveProject,
    onExportProject: () => {
      exportProjectAsZip(activeProject).catch((err) => {
        console.error("[stave] export failed:", err);
        showToast("Export failed — see console for details.", "error");
      });
    },
    onImportProject: triggerImportPicker,
    onBounceToWav: openBounceModal,
    canBounceToWav: () => bounceRef.current?.canBounce() ?? false,
    onShareProject: handleShareProject,
    onVersionHistory: openSnapshotPanel,
    onToggleSidebar: () => setSidebarCollapsed((c) => !c),
    sidebarCollapsed,
    onToggleZenMode: () => setZenMode((z) => !z),
    zenMode,
    onUndo: () => { undo(); },
    onRedo: () => { redo(); },
    canUndo: undoState.canUndo,
    canRedo: undoState.canRedo,
  };
  // #1348 — the eval lamp: the active file's last evaluation. Pressing it does what
  // pressing that error's toast does, even after the toast is gone; with no error it
  // opens the Console.
  const onEvalLamp = () => {
    const latest = activeRuntime?.error
      ? [...getLogHistory()].reverse().find((e) => e.level === "error")
      : undefined;
    if (latest) revealLogEntry(latest);
    else setActivePanelId("console");
  };
  // Transport LCD (#857) — same accessors the MusicalTimeline reads. The position is
  // the SONG position the playhead reads (#1725): the raw `getCycle` counts since Play
  // and ignores a seek.
  const transport = {
    isPlaying: activeRuntime?.isPlaying ?? false,
    isPlayPending: activeRuntime?.isPlayPending ?? false,
    getSongPosition: () => getSongPositionRef.current(),
    getCps: () => getCpsRef.current(),
    getAudioHealth: () => getAudioHealthRef.current(),
    evalError: activeRuntime?.error ?? null,
    onEvalLamp,
  };
  const activeFile = activeFileId ? getFile(activeFileId) : undefined;

  return (
    <div style={styles.root}>
      {/* The document's one top-level heading (#889). It is visually hidden: the
          brand is drawn by the MenuBar, and with the Transport LCD on by default
          (#857) that brand is not rendered at all. Before this, the ONLY <h1> in
          the product lived on the boot splash (EditorWrapper) and vanished the
          moment the editor mounted — so a screen reader landing on Stave found a
          document with no heading. Keep it here, in the shell, where it cannot be
          swapped out by a setting. */}
      <h1 style={styles.srOnly}>Stave</h1>
      {phone ? (
        <PhoneTopBar
          fileName={activeFile ? (activeFile.path.split("/").pop() ?? activeFile.path) : null}
          onOpenDrawer={openPhoneDrawer}
          sideways={phoneSideways}
          getSongPosition={transport.getSongPosition}
          getCps={transport.getCps}
        />
      ) : (
        // Backdrop selection moved to the per-tab pattern-bar dropdown (#347);
        // the menubar no longer owns it.
        <MenuBar projectName={activeProject.name} {...menuActions} {...transport} />
      )}
      {phone && (
        <PhoneDrawer
          openOn={activePanelId === null ? null : phoneMenuOpen ? PHONE_MENU_TAB : activePanelId}
          projectName={activeProject.name}
          onSelect={(id) => {
            if (id === PHONE_MENU_TAB) {
              setPhoneMenuOpen(true);
              return;
            }
            setPhoneMenuOpen(false);
            // as on the rail: History opened here shows the PROJECT, not one file
            if (id === "snapshots") setFileHistoryTarget(null);
            setActivePanelId(id);
          }}
          onClose={closePhoneDrawer}
          sideways={phoneSideways}
          renderPanel={renderPanel}
          menus={buildMenus(menuActions)}
          readout={
            <>
              <TransportLCD {...transport} />
              <TimeSignatureControl />
            </>
          }
        />
      )}

      <div style={styles.main} data-stave-main-backdrop={backgroundFileId ? "on" : "off"}>
        {!phone && !zenMode && (
          <ActivityBar
            activePanelId={activePanelId}
            onSelect={(id) => {
              // Opening Version History from the rail shows the PROJECT graph;
              // the per-file focus is only entered via the "File History" action.
              if (id === "snapshots") setFileHistoryTarget(null);
              setActivePanelId(id);
            }}
          />
        )}
        {/* One owner for the left region's width (#1367) — switching tabs
            swaps only the content; the width, handle, drag-to-collapse and
            persistence stay put. */}
        {!phone && !zenMode && activePanelId !== null && (
          <SidePanel onCollapse={() => setActivePanelId(null)}>{renderPanel(activePanelId)}</SidePanel>
        )}
        <div style={styles.editorArea}>
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            {switching ? (
              <div style={styles.switchingOverlay}>Loading project...</div>
            ) : (
              <StrudelEditorClient
                key={activeProject.id}
                projectId={activeProject.id}
                shellRef={shellRef}
                bounceRef={bounceRef}
                onActiveFileChange={setActiveFileId}
                onActiveRuntimeStateChange={handleRuntimeStateChange}
                onCodeBackdropChange={handleCodeBackdropChange}
                // #347 — pattern-bar "set bg" popover reuses the same crop /
                // reveal handlers as the menubar bg-popover.
                onCropBackdrop={handleCropBackdrop}
                onRevealBackdrop={handleRevealBackdrop}
                // #350a — mirror the RESOLVED backdrop (code override ?? sticky)
                // so the menubar indicator / popover reflect what's actually
                // showing, including a code-driven `.scope()`. NOT persisted here
                // (code overrides are transient — persistence stays on the manual
                // path); the shell ref-guards this so steady code never churns it.
                onActiveBackdropChange={(fileId) => setBackgroundFileId(fileId)}
                backgroundCrop={backgroundCrop}
                // Mirror every manual sticky into local state for the
                // crop/reveal handlers + file-tree label. Persistence is
                // owned per-tab by StrudelEditorClient's recorder, which
                // wraps this same callback (#347); #371 removed the old
                // project-global `setProjectBackgroundFileId` write here.
                onBackgroundFileChange={(_groupId, fileId) => {
                  setBackgroundFileId(fileId);
                }}
                onTabContextMenu={(tab, x, y) => {
                  const fileId =
                    tab.kind === "editor" || tab.kind === "preview"
                      ? tab.fileId
                      : null;
                  setTabContextMenu({ tabId: tab.id, fileId, x, y });
                }}
                onEditViz={(vizId) => {
                  // Resolve viz name to a workspace file — fuzzy match
                  // (strip spaces, lowercase) so "pianoroll" matches "Piano Roll.p5".
                  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, "");
                  const target = norm(vizId);
                  const allFiles = listWorkspaceFiles();
                  for (const f of allFiles) {
                    const baseName = f.path.replace(/\.[^.]+$/, "");
                    const lastSeg = baseName.split("/").pop() ?? "";
                    if (norm(lastSeg) === target || norm(baseName) === target) {
                      handleOpenFile(f.id);
                      setActivePanelId("explorer");
                      setTimeout(() => fileTreeRef.current?.revealFile(f.id), 50);
                      return;
                    }
                  }
                  showToast(`Viz file "${vizId}" not found in workspace`, "error");
                }}
                onCropViz={(vizId, presetId, trackKey) => {
                  const fileId = activeFileId ?? listWorkspaceFiles().find(f => f.language === 'strudel' || f.language === 'sonicpi')?.id ?? null;
                  if (!fileId) {
                    showToast("Open an editor file before cropping", "error");
                    return;
                  }
                  // If presetId is null (async preset lookup hasn't completed),
                  // resolve by searching workspace files for a matching viz name.
                  // A base name can exist for both renderers (scope.p5 +
                  // scope.hydra), so prefer the renderer the vizId implies
                  // (bare = p5, ":hydra" suffix = hydra) — a name-only match
                  // would point the crop at the wrong viz.
                  let resolvedPresetId = presetId;
                  if (!resolvedPresetId) {
                    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_:]/g, "");
                    // vizId may carry a renderer qualifier (`name:hydra` /
                    // `name:glsl`) mirroring registerAllVizFiles; a bare name
                    // defaults to the p5 renderer (p5 wins on basename collision).
                    const qual = /:(hydra|glsl)$/i.exec(vizId)?.[1]?.toLowerCase();
                    const wantLang = qual === "hydra" ? "hydra" : qual === "glsl" ? "glsl" : "p5js";
                    const target = norm(vizId.replace(/:(hydra|glsl)$/i, ""));
                    const allFiles = listWorkspaceFiles();
                    const matches = allFiles.filter(f => {
                      if (!isVizLanguage(f.language)) return false;
                      const base = f.path.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
                      return norm(base) === target;
                    });
                    const vizFile =
                      matches.find(f => f.language === wantLang) ??
                      matches[0];
                    if (vizFile?.meta?.presetId) {
                      resolvedPresetId = vizFile.meta.presetId as string;
                    }
                  }
                  if (!resolvedPresetId) {
                    showToast(`No preset found for "${vizId}" — save it first`, "error");
                    return;
                  }
                  // Read the live inline viz canvas dimensions so the
                  // crop preview renders at the same native size.
                  const vizCanvas = document.querySelector(
                    `[data-viz-zone-track="${trackKey}"] canvas`
                  ) as HTMLCanvasElement | null;
                  const renderSize = vizCanvas
                    ? { w: vizCanvas.offsetWidth, h: vizCanvas.offsetHeight }
                    : undefined;
                  setCropTarget({ mode: "inline", vizId, presetId: resolvedPresetId, fileId, trackKey, renderSize });
                }}
              />
            )}
          </div>
        </div>
      </div>

      <BounceModal
        open={bounceOpen}
        state={bounceState}
        sizing={bounceSizing}
        offline={bounceOffline}
        stemTracks={bounceStemTracks}
        onClose={() => setBounceOpen(false)}
        onStart={handleBounceStart}
        onStop={handleBounceStop}
      />

      <StartScreen
        open={startScreenOpen}
        version={APP_VERSION}
        activeProject={activeProject}
        projects={projects}
        templates={TEMPLATES}
        showAtStart={startScreenAtStart}
        onShowAtStartChange={(show) => {
          setStartScreenAtStart(show);
          setStartScreenWanted(show);
        }}
        onClose={() => setStartScreenOpen(false)}
        onOpenProject={(id) => {
          setStartScreenOpen(false);
          void doSwitchProject(id);
        }}
        onNewFromTemplate={(template) => {
          setStartScreenOpen(false);
          void handleCreateProject(template.name, template.id);
        }}
        onBrowseProjects={() => {
          setStartScreenOpen(false);
          setSwitcherModalOpen(true);
        }}
        onOpenArchive={() => {
          setStartScreenOpen(false);
          triggerImportPicker();
        }}
      />

      <TemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onCreate={handleCreateProject}
      />

      <ProjectSwitcherModal
        open={switcherModalOpen}
        projects={projects}
        activeProjectId={activeProject.id}
        onClose={() => setSwitcherModalOpen(false)}
        onSelect={doSwitchProject}
        onRename={handleRenameProjectFromSwitcher}
        onDelete={handleDeleteProjectFromSwitcher}
      />

      <StorageFullNotice onExport={handleExportProject} onOpenLibrary={openLibraryAtYourSounds} />

      <input
        ref={importInputRef}
        type="file"
        accept={PROJECT_FILE_ACCEPT}
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = "";
          if (file) await handleImportZip(file);
        }}
      />

      {tabContextMenu && (
        <>
          <div
            style={styles.tabCtxBackdrop}
            onClick={() => setTabContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setTabContextMenu(null); }}
          />
          <div
            style={{
              ...styles.tabCtxMenu,
              left: tabContextMenu.x,
              top: tabContextMenu.y,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              data-stave-ctx-item
              data-stave-menu-item
              style={styles.menuItem}
              onClick={() => {
                shellRef.current?.closeTabsForFile(
                  tabContextMenu.fileId ?? tabContextMenu.tabId,
                );
                setTabContextMenu(null);
              }}
            >Close</button>
            <button
              data-stave-ctx-item
              data-stave-menu-item
              style={styles.menuItem}
              onClick={() => {
                shellRef.current?.closeOtherTabs(tabContextMenu.tabId);
                setTabContextMenu(null);
              }}
            >Close Others</button>
            <button
              data-stave-ctx-item
              data-stave-menu-item
              style={styles.menuItem}
              onClick={() => {
                shellRef.current?.closeAllTabsInGroup(tabContextMenu.tabId);
                setTabContextMenu(null);
              }}
            >Close All</button>
            {tabContextMenu.fileId && (
              <>
                <div style={styles.menuDivider} />
                <button
                  data-stave-ctx-item
                  style={styles.menuItem}
                  onClick={() => {
                    const fid = tabContextMenu.fileId!;
                    setActivePanelId("explorer");
                    setTabContextMenu(null);
                    // Wait for explorer panel to mount, then reveal.
                    setTimeout(() => fileTreeRef.current?.revealFile(fid), 50);
                  }}
                >Reveal in Sidebar</button>
              </>
            )}
          </div>
        </>
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tab={settingsTab}
        onTabChange={setSettingsTab}
      />

      <DocsSearchPalette
        open={docsSearchOpen}
        onClose={() => setDocsSearchOpen(false)}
      />

      {/* Perf overlay (#228) — renders only when profiling is enabled. */}
      <PerfOverlay />

      {cropTarget?.mode === "inline" && (
        <CropPopup
          vizId={cropTarget.vizId}
          presetId={cropTarget.presetId}
          fileId={cropTarget.fileId}
          trackKey={cropTarget.trackKey}
          renderSize={cropTarget.renderSize}
          onClose={() => setCropTarget(null)}
        />
      )}
      {cropTarget?.mode === "backdrop" && (
        <CropPopup
          adapter={cropTarget.adapter}
          onClose={() => setCropTarget(null)}
        />
      )}

      <DialogHost />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        placeholder="Type a command..."
      />

      <CommandPalette
        open={quickOpenOpen}
        onClose={() => setQuickOpenOpen(false)}
        placeholder="Search files by name..."
        hideCommands
        extraRows={quickOpenRows}
      />

    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    width: "100%",
    height: "100%",
    minHeight: 0,
  },
  /** Available to assistive tech, invisible on screen, and takes no layout space —
   *  the standard clip-rect pattern. NOT `display:none`/`visibility:hidden`, which
   *  would remove it from the accessibility tree and defeat the point (#889). */
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  },
  main: {
    flex: 1,
    display: "flex",
    minHeight: 0,
  },
  editorArea: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    position: "relative",
    zIndex: 0,
    display: "flex",
    flexDirection: "column" as const,
  },
  collapsedStrip: {
    width: 28,
    minWidth: 28,
    height: "100%",
    background: "var(--bg-sidebar)",
    borderRight: "1px solid var(--border-subtle)",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    border: "none",
    borderTop: "none",
    borderBottom: "none",
    borderLeft: "none",
    padding: "8px 0",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    fontSize: 14,
    fontFamily: "inherit",
  },
  switchingOverlay: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "var(--text-tertiary)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: 14,
  },
  panelRoot: {
    // Width is owned by SidePanel (#1367); panels fill the region.
    width: "100%",
    height: "100%",
    background: "var(--bg-panel)",
    borderRight: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  panelHeader: {
    padding: "10px 14px",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.8,
    color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border-subtle)",
  },
  panelBody: {
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    flex: 1,
  },
  panelHint: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    lineHeight: 1.5,
  },
  panelBtn: {
    background: "var(--bg-active)",
    border: "1px solid var(--border-strong)",
    borderRadius: 4,
    color: "var(--text-primary)",
    padding: "6px 12px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    alignSelf: "flex-start",
  },
  tabCtxBackdrop: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 9998,
  },
  tabCtxMenu: {
    position: "fixed" as const,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 4,
    padding: "4px 0",
    zIndex: 9999,
    minWidth: 160,
    boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  menuItem: {
    display: "block",
    width: "100%",
    padding: "6px 14px",
    background: "none",
    border: "none",
    color: "var(--text-chrome)",
    fontSize: 12,
    textAlign: "left" as const,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  menuDivider: {
    height: 1,
    margin: "4px 0",
    background: "var(--border-subtle)",
  },
};
