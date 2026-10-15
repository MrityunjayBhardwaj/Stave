"use client";

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  listWorkspaceFiles,
  subscribeToFileList,
  deleteWorkspaceFile,
  renameWorkspaceFile,
  createWorkspaceFile,
  getFolderOrder,
  setFolderOrder,
  subscribeToFolderOrder,
  getSubfolderOrder,
  setSubfolderOrder,
  getChildOrder,
  setChildOrder,
  withStructBatch,
  subscribeToHistory,
  getCurrentHistory,
  getModifiedFileIdsSinceHead,
  subscribeToDocUpdate,
  type WorkspaceFile,
} from "@stave/editor";
import { showPrompt, showConfirm, showToast } from "../dialogs/host";
import { extensionToLanguage, promptAndCreateFile } from "../lib/newFile";
import { Icon } from "./Icon";
import { FileTypeIcon, FolderIcon } from "./FileTypeIcon";

interface FileTreeProps {
  projectName: string;
  onOpenFile: (fileId: string, intent?: { preview?: boolean }) => void;
  activeFileId: string | null;
  /** Called when a user drops a single .zip onto the sidebar. If set,
   *  the tree skips the normal file-by-file import and delegates. */
  onImportZipProject?: (file: File) => void;
  /** Open the Version History panel focused on this file ("File History"). */
  onFileHistory: (fileId: string) => void;
}

export interface FileTreeHandle {
  /** Expand all ancestor folders of the given file and scroll its row
   *  into view. No-op if the file isn't in the current project. */
  revealFile: (fileId: string) => void;
}

interface TreeNode {
  kind: "file" | "folder";
  name: string;
  path: string;
  file?: WorkspaceFile;
  children?: TreeNode[];
}

// ── Tree building ────────────────────────────────────────────────────

function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeNode>();

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const segments = file.path.split("/");
    let parentChildren = root;
    let pathSoFar = "";

    // Walk intermediate folders
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg;

      let folder = folderMap.get(pathSoFar);
      if (!folder) {
        folder = {
          kind: "folder",
          name: seg,
          path: pathSoFar,
          children: [],
        };
        folderMap.set(pathSoFar, folder);
        parentChildren.push(folder);
      }
      parentChildren = folder.children!;
    }

    // File at leaf
    const fileName = segments[segments.length - 1];
    parentChildren.push({
      kind: "file",
      name: fileName,
      path: file.path,
      file,
    });
  }

  return root;
}

/**
 * Apply ordering to a tree level. If a mixed `childOrder` exists for
 * this folder, it's used as-is (folders and files interleaved). Otherwise
 * falls back to the legacy model: folders first (ordered by
 * subfolderOrder), then files (ordered by fileOrder).
 */
function applyFolderOrder(
  nodes: TreeNode[],
  folderPath: string,
  getFileOrderFn: (path: string) => string[],
  getSubOrderFn: (path: string) => string[],
  getChildOrderFn: (path: string) => string[],
): void {
  // ── Mixed child order (new) ──
  const childOrder = getChildOrderFn(folderPath);
  if (childOrder.length > 0) {
    const folderByName = new Map<string, TreeNode>();
    const fileById = new Map<string, TreeNode>();
    for (const n of nodes) {
      if (n.kind === "folder") folderByName.set(n.name, n);
      else if (n.file) fileById.set(n.file.id, n);
    }
    const ordered: TreeNode[] = [];
    const seen = new Set<string>();
    for (const entry of childOrder) {
      if (entry.startsWith("d:")) {
        const name = entry.slice(2);
        const node = folderByName.get(name);
        if (node) { ordered.push(node); seen.add("d:" + name); }
      } else if (entry.startsWith("f:")) {
        const id = entry.slice(2);
        const node = fileById.get(id);
        if (node) { ordered.push(node); seen.add("f:" + id); }
      }
    }
    // Append any nodes not covered by childOrder (newly created items).
    for (const n of nodes) {
      const key = n.kind === "folder" ? "d:" + n.name : "f:" + (n.file?.id ?? "");
      if (!seen.has(key)) ordered.push(n);
    }
    nodes.length = 0;
    nodes.push(...ordered);
  } else {
    // ── Legacy: folders first, then files ──
    const folders: TreeNode[] = [];
    const files: TreeNode[] = [];
    for (const n of nodes) {
      if (n.kind === "folder") folders.push(n);
      else files.push(n);
    }

    const fileOrder = getFileOrderFn(folderPath);
    if (fileOrder.length > 0) {
      const idx = new Map<string, number>();
      fileOrder.forEach((id, i) => idx.set(id, i));
      const ordered: TreeNode[] = [];
      const rest: TreeNode[] = [];
      for (const n of files) {
        if (n.file && idx.has(n.file.id)) ordered.push(n);
        else rest.push(n);
      }
      ordered.sort((a, b) => idx.get(a.file!.id)! - idx.get(b.file!.id)!);
      files.length = 0;
      files.push(...ordered, ...rest);
    }

    const subOrder = getSubOrderFn(folderPath);
    if (subOrder.length > 0) {
      const idx = new Map<string, number>();
      subOrder.forEach((name, i) => idx.set(name, i));
      const ordered: TreeNode[] = [];
      const rest: TreeNode[] = [];
      for (const n of folders) {
        if (idx.has(n.name)) ordered.push(n);
        else rest.push(n);
      }
      ordered.sort((a, b) => idx.get(a.name)! - idx.get(b.name)!);
      folders.length = 0;
      folders.push(...ordered, ...rest);
    }

    nodes.length = 0;
    nodes.push(...folders, ...files);
  }

  // Recurse into each folder with that folder's own path as parent.
  for (const n of nodes) {
    if (n.kind === "folder" && n.children) {
      applyFolderOrder(n.children, n.path, getFileOrderFn, getSubOrderFn, getChildOrderFn);
    }
  }
}

// ── Main component ──────────────────────────────────────────────────

export const FileTree = React.forwardRef<FileTreeHandle, FileTreeProps>(function FileTree({
  projectName, onOpenFile, activeFileId, onImportZipProject, onFileHistory,
}, forwardedRef) {
  // Subscribe to file list changes — re-list whenever a file is added,
  // removed, or renamed. `fileListRev` is the dep that forces the memo
  // to recompute (empty dep array would compute once and never again).
  const [fileListRev, setFileListRev] = useState(0);
  useEffect(() => {
    return subscribeToFileList(() => setFileListRev((n) => n + 1));
  }, []);
  const [folderOrderRev, setFolderOrderRev] = useState(0);
  useEffect(() => {
    return subscribeToFolderOrder(() => setFolderOrderRev((n) => n + 1));
  }, []);

  // History-divergence signals (Phase D, #193): the per-file "uncommitted
  // since HEAD" dot and the header branch chip. Re-derived on history changes
  // (commit/branch/restore) AND on live doc edits — a file goes dirty the
  // moment you type, and clean again when an auto-commit captures it. Doc
  // updates are debounced so per-keystroke churn doesn't thrash the tree.
  const [historyRev, setHistoryRev] = useState(0);
  useEffect(() => {
    const bump = () => setHistoryRev((n) => n + 1);
    const offHistory = subscribeToHistory(bump);
    let t: ReturnType<typeof setTimeout> | null = null;
    const offDoc = subscribeToDocUpdate(
      () => {
        if (t) clearTimeout(t);
        t = setTimeout(bump, 250);
      },
      { localOnly: true },
    );
    return () => {
      offHistory();
      offDoc();
      if (t) clearTimeout(t);
    };
  }, []);

  const files = useMemo(() => listWorkspaceFiles(), [fileListRev]);

  // current branch (header chip when ≠ main) + the set of files dirty vs HEAD.
  const currentBranch = useMemo(
    () => getCurrentHistory()?.currentBranch ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyRev],
  );
  const modifiedFileIds = useMemo(
    // whole dirty set in one pass (one workspace read), not O(N) per-file reads
    () => getModifiedFileIdsSinceHead(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, historyRev],
  );
  const tree = useMemo(() => {
    const t = buildTree(files);
    applyFolderOrder(
      t,
      "",
      (path) => getFolderOrder(path),
      (path) => getSubfolderOrder(path),
      (path) => getChildOrder(path),
    );
    return t;
    // folderOrderRev is a trigger-only dep — the lookup closes over the
    // store's live state and re-reads on every tree rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, folderOrderRev]);

  // Sidebar hover state — drives VS Code-style hover-only header actions
  // (New file / New folder appear only while the cursor is inside the panel).
  //
  // The panel's WIDTH is deliberately not here: it belongs to the region, not
  // to this panel, and lives in SidePanel (#1367). This tree renders at 100%
  // of whatever width the region has.
  const [sidebarHover, setSidebarHover] = useState(false);

  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  // When the active file changes, ensure all its parent folders are
  // expanded so the highlighted file is actually visible in the tree.
  useEffect(() => {
    if (!activeFileId) return;
    const file = files.find((f) => f.id === activeFileId);
    if (!file) return;
    const segments = file.path.split("/");
    if (segments.length <= 1) return; // file is at root, nothing to expand
    setCollapsedFolders((prev) => {
      let changed = false;
      const next = new Set(prev);
      let pathSoFar = "";
      for (let i = 0; i < segments.length - 1; i++) {
        pathSoFar = pathSoFar ? `${pathSoFar}/${segments[i]}` : segments[i];
        if (next.has(pathSoFar)) {
          next.delete(pathSoFar);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeFileId, files]);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  // Context menu — kind-tagged so each target (file / folder / empty root)
  // renders its own item list. `x/y` are viewport coords; the menu itself
  // clamps so it never spills off the right or bottom edge.
  type ContextMenuState =
    | { kind: "file"; fileId: string; x: number; y: number }
    | { kind: "folder"; folderPath: string; x: number; y: number }
    | { kind: "root"; x: number; y: number };
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Multi-select state. Cmd/Ctrl-click toggles a file into the set; a
  // plain click clears the set. Selected rows render with the active
  // highlight. Context menu on a multi-selected file shows a bulk
  // "Delete N files" option.
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  const inputRef = useRef<HTMLInputElement>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

  // Focus input when editing
  useEffect(() => {
    if (editingFileId && inputRef.current) {
      inputRef.current.focus();
      // Select filename without extension
      const val = inputRef.current.value;
      const dotIdx = val.lastIndexOf(".");
      if (dotIdx > 0) {
        inputRef.current.setSelectionRange(0, dotIdx);
      } else {
        inputRef.current.select();
      }
    }
  }, [editingFileId]);

  // Reveal: expand every ancestor folder + scroll the row into view.
  useImperativeHandle(forwardedRef, () => ({
    revealFile: (fileId: string) => {
      const file = files.find((f) => f.id === fileId);
      if (!file) return;
      setCollapsedFolders((prev) => {
        const next = new Set(prev);
        const segments = file.path.split("/");
        let acc = "";
        for (let i = 0; i < segments.length - 1; i++) {
          acc = acc ? `${acc}/${segments[i]}` : segments[i];
          next.delete(acc);
        }
        return next;
      });
      // Scroll the row into view after the tree has re-rendered.
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-file-tree-item="${CSS.escape(fileId)}"]`,
          );
          el?.scrollIntoView({ block: "nearest" });
        });
      });
    },
  }), [files]);

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const startRename = useCallback((file: WorkspaceFile) => {
    setEditingFileId(file.id);
    const parts = file.path.split("/");
    setEditValue(parts[parts.length - 1]); // just the file name
    setContextMenu(null);
  }, []);

  const commitRename = useCallback(() => {
    if (!editingFileId || !editValue.trim()) {
      setEditingFileId(null);
      return;
    }
    const file = files.find((f) => f.id === editingFileId);
    if (!file) {
      setEditingFileId(null);
      return;
    }
    const parts = file.path.split("/");
    parts[parts.length - 1] = editValue.trim();
    const newPath = parts.join("/");
    renameWorkspaceFile(editingFileId, newPath);
    setEditingFileId(null);
  }, [editingFileId, editValue, files]);

  const handleDuplicate = useCallback((fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    setContextMenu(null);
    const dot = file.path.lastIndexOf(".");
    const slash = file.path.lastIndexOf("/");
    // "foo/bar.strudel" → "foo/bar copy.strudel"; "bar" → "bar copy"
    const newPath = dot > slash
      ? `${file.path.slice(0, dot)} copy${file.path.slice(dot)}`
      : `${file.path} copy`;
    const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    createWorkspaceFile(id, newPath, file.content, file.language, file.meta as Record<string, unknown> | undefined);
  }, [files]);

  const handleCopyPath = useCallback(async (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    setContextMenu(null);
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.path);
      showToast(`Copied path: ${file.path}`);
    } catch {
      showToast("Failed to copy — clipboard blocked by browser", "error");
    }
  }, [files]);

  const handleDelete = useCallback(async (fileId: string) => {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    setContextMenu(null);
    const ok = await showConfirm({
      title: "Delete file?",
      description: `"${file.path}" will be removed from this project.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) deleteWorkspaceFile(fileId);
  }, [files]);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedFileIds);
    setContextMenu(null);
    if (ids.length === 0) return;
    const ok = await showConfirm({
      title: `Delete ${ids.length} files?`,
      description: "The selected files will be removed from this project.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    withStructBatch(() => {
      for (const id of ids) deleteWorkspaceFile(id);
    });
    setSelectedFileIds(new Set());
  }, [selectedFileIds]);

  // Folder rename — cascade-rename every file whose path starts with
  // `oldPath + "/"` (plus the .keep placeholder), swapping the prefix.
  const handleRenameFolder = useCallback(async (oldPath: string) => {
    const oldName = oldPath.split("/").pop() ?? "";
    const parentPath = oldPath.includes("/")
      ? oldPath.slice(0, oldPath.lastIndexOf("/"))
      : "";
    setContextMenu(null);
    const newName = await showPrompt({
      title: "Rename folder",
      initialValue: oldName,
      placeholder: "Folder name",
      confirmLabel: "Rename",
    });
    if (!newName || !newName.trim() || newName === oldName) return;
    const newPath = parentPath ? `${parentPath}/${newName.trim()}` : newName.trim();
    withStructBatch(() => {
      for (const f of files) {
        if (f.path === oldPath || f.path.startsWith(oldPath + "/")) {
          const suffix = f.path.slice(oldPath.length);
          renameWorkspaceFile(f.id, `${newPath}${suffix}`);
        }
      }
    });
  }, [files]);

  // Folder delete — cascade-delete every file under the folder.
  const handleDeleteFolder = useCallback(async (path: string) => {
    const doomed = files.filter(
      (f) => f.path === path || f.path.startsWith(path + "/"),
    );
    setContextMenu(null);
    if (doomed.length === 0) return;
    const visible = doomed.filter((f) => !f.path.endsWith("/.keep")).length;
    const description = visible === 0
      ? `The empty folder "${path}" will be removed.`
      : `"${path}" and ${visible} file${visible === 1 ? "" : "s"} will be removed.`;
    const ok = await showConfirm({
      title: "Delete folder?",
      description,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) {
      withStructBatch(() => {
        for (const f of doomed) deleteWorkspaceFile(f.id);
      });
    }
  }, [files]);

  const handleNewFile = useCallback(
    (folderPath = "") => promptAndCreateFile(folderPath),
    [],
  );

  const handleNewFolder = useCallback(async (parentPath = "") => {
    const name = await showPrompt({
      title: "New folder",
      placeholder: "Folder name",
      confirmLabel: "Create",
    });
    if (!name || !name.trim()) return;
    // Folders are implicit — create a .keep placeholder file so the folder
    // appears in the tree and persists to IDB. The user can delete it later.
    const folderName = name.trim();
    const path = parentPath ? `${parentPath}/${folderName}/.keep` : `${folderName}/.keep`;
    const id = `file_${Date.now()}_keep`;
    createWorkspaceFile(id, path, "", "markdown");
  }, []);

  // ── Drag-drop move (files + folders) ────────────────────────────────

  // Drop target state — which folder (or root) is currently being hovered
  // over with a dragged item. Drives the visual highlight. `null` = none.
  const [dropTarget, setDropTarget] = useState<string | "__root__" | null>(null);

  // Between-file drop target for within-folder reorder (PM-3). When the
  // user hovers over a file row with a file drag, we show a 2px insertion
  // indicator above or below depending on cursor Y. `fileId` is the anchor
  // the insertion is relative to; `position` = "above" | "below".
  const [betweenTarget, setBetweenTarget] = useState<{
    fileId: string;
    position: "above" | "below";
  } | null>(null);

  // Between-folder drop target for folder reorder (#14). Activated when
  // dragging a folder over another folder at the same parent level and
  // the cursor is in the top- or bottom- edge zone (25%).
  const [betweenFolderTarget, setBetweenFolderTarget] = useState<{
    folderPath: string;
    position: "above" | "below";
  } | null>(null);

  // Move a file into a folder (or root if targetFolderPath is ""). No-op
  // if the file is already directly in that folder. Also migrates the
  // file's fileOrder entry from the source folder's order array to the
  // target folder's (append at end) so within-folder ordering stays
  // consistent after a cross-folder drop (#15).
  const moveFileToFolder = useCallback(
    (fileId: string, targetFolderPath: string) => {
      const file = files.find((f) => f.id === fileId);
      if (!file) return;
      const fileName = file.path.split("/").pop()!;
      const newPath = targetFolderPath
        ? `${targetFolderPath}/${fileName}`
        : fileName;
      if (newPath === file.path) return;
      const oldFolder = file.path.includes("/")
        ? file.path.slice(0, file.path.lastIndexOf("/"))
        : "";
      // Batch all three mutations into ONE transaction so undo reverts
      // the cross-folder move as a single step (instead of 3 separate
      // ones).
      withStructBatch(() => {
        renameWorkspaceFile(fileId, newPath);
        if (oldFolder === targetFolderPath) return;
        const sourceOrder = getFolderOrder(oldFolder);
        if (sourceOrder.includes(fileId)) {
          setFolderOrder(oldFolder, sourceOrder.filter((id) => id !== fileId));
        }
        const targetOrder = getFolderOrder(targetFolderPath);
        if (!targetOrder.includes(fileId)) {
          setFolderOrder(targetFolderPath, [...targetOrder, fileId]);
        }
      });
    },
    [files],
  );

  // Move a folder (and all its contents) into another folder. Preserves
  // hierarchy: "sketches/foo.strudel" dropped onto "assets/" becomes
  // "assets/sketches/foo.strudel". Prevents dropping a folder into itself
  // or any of its descendants.
  const moveFolderToFolder = useCallback(
    (sourceFolderPath: string, targetFolderPath: string) => {
      if (
        targetFolderPath === sourceFolderPath ||
        targetFolderPath.startsWith(sourceFolderPath + "/")
      ) {
        return; // can't drop into self or descendant
      }
      const folderName = sourceFolderPath.split("/").pop()!;
      const newPrefix = targetFolderPath
        ? `${targetFolderPath}/${folderName}`
        : folderName;
      if (newPrefix === sourceFolderPath) return; // no-op
      const affected = files.filter(
        (f) => f.path === sourceFolderPath || f.path.startsWith(sourceFolderPath + "/"),
      );
      // Batch so the whole folder move is ONE undo step.
      withStructBatch(() => {
        for (const f of affected) {
          const suffix = f.path.slice(sourceFolderPath.length);
          const newPath = `${newPrefix}${suffix}`;
          renameWorkspaceFile(f.id, newPath);
        }
      });
    },
    [files],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, payload: { kind: "file"; fileId: string } | { kind: "folder"; folderPath: string }) => {
      e.dataTransfer.setData(
        "application/stave-tree-item",
        JSON.stringify(payload),
      );
      // Also set a kind-specific MIME marker so dragover handlers can
      // branch on kind WITHOUT reading the payload body (dataTransfer.getData
      // isn't accessible during dragover in most browsers).
      e.dataTransfer.setData(
        payload.kind === "file"
          ? "application/stave-file-drag"
          : "application/stave-folder-drag",
        "1",
      );
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleDragOverFolder = useCallback(
    (e: React.DragEvent, folderPath: string) => {
      // Accept tree drags OR native OS files.
      const isTree = e.dataTransfer.types.includes("application/stave-tree-item");
      const isFiles = e.dataTransfer.types.includes("Files");
      if (!isTree && !isFiles) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = isFiles ? "copy" : "move";
      // Native file drops always go INTO the folder (no reorder zones).
      if (isFiles) {
        setBetweenFolderTarget(null);
        setDropTarget(folderPath);
        return;
      }
      // Zone detection — top 25% = insert above, bottom 25% = below,
      // middle 50% = nest into the folder. Works for both file and folder
      // drags so items can be interleaved at the same level.
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = e.clientY - rect.top;
      const quarter = rect.height / 4;
      if (y < quarter) {
        setBetweenFolderTarget({ folderPath, position: "above" });
        setDropTarget(null);
      } else if (y > rect.height - quarter) {
        setBetweenFolderTarget({ folderPath, position: "below" });
        setDropTarget(null);
      } else {
        setBetweenFolderTarget(null);
        setDropTarget(folderPath);
      }
    },
    [],
  );

  const handleDragOverRoot = useCallback((e: React.DragEvent) => {
    const isTree = e.dataTransfer.types.includes("application/stave-tree-item");
    const isFiles = e.dataTransfer.types.includes("Files");
    if (!isTree && !isFiles) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isFiles ? "copy" : "move";
    setDropTarget("__root__");
  }, []);

  // Import native OS files dropped onto the tree. Each file's text
  // content is read, language inferred from extension; unknown
  // extensions are rejected with a toast per file. Creates workspace
  // files under `targetFolderPath` (use "" for root).
  const importNativeFiles = useCallback(async (files: FileList, targetFolderPath: string) => {
    const arr = Array.from(files);
    // A single .zip drop → project import (when the caller wired it).
    if (arr.length === 1 && arr[0].name.toLowerCase().endsWith(".zip")) {
      if (onImportZipProject) {
        onImportZipProject(arr[0]);
      } else {
        showToast("Drop a .zip onto the sidebar to import a project.", "error");
      }
      return;
    }
    for (const f of arr) {
      if (f.name.toLowerCase().endsWith(".zip")) {
        showToast(`Skipped "${f.name}" — drop a single .zip to import as a project.`, "error");
        continue;
      }
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const language = extensionToLanguage(ext);
      if (!language) {
        showToast(`Skipped "${f.name}" — unsupported extension ".${ext}"`, "error");
        continue;
      }
      const text = await f.text();
      const path = targetFolderPath ? `${targetFolderPath}/${f.name}` : f.name;
      const id = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      createWorkspaceFile(id, path, text, language);
    }
  }, [onImportZipProject]);

  const handleDragLeaveTree = useCallback(() => {
    setDropTarget(null);
    setBetweenTarget(null);
    setBetweenFolderTarget(null);
  }, []);

  // Dragover on a FILE row — decide whether this is a reorder (within
  // same folder) vs a folder-drop. We always call preventDefault so the
  // drop event can fire. Above midpoint → insert above; below → below.
  const handleDragOverFile = useCallback(
    (e: React.DragEvent, targetFileId: string) => {
      if (!e.dataTransfer.types.includes("application/stave-tree-item")) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      setBetweenTarget({
        fileId: targetFileId,
        position: e.clientY < midY ? "above" : "below",
      });
      setDropTarget(null);
    },
    [],
  );

  // Compute the parent folder path of a file (everything except the last
  // segment). Root returns "".
  const folderPathOf = useCallback((filePath: string) => {
    const i = filePath.lastIndexOf("/");
    return i < 0 ? "" : filePath.slice(0, i);
  }, []);

  /**
   * Unified child reorder — moves `sourceEntry` relative to
   * `anchorEntry` at the same folder level. Both entries use the
   * `"d:name"` / `"f:id"` encoding. Writes to `childOrder`, which
   * supports interleaved folders and files.
   */
  const reorderChildWithin = useCallback(
    (
      parentPath: string,
      sourceEntry: string,
      anchorEntry: string,
      position: "above" | "below",
    ) => {
      if (sourceEntry === anchorEntry) return;
      // Build the current child order — seed from existing childOrder,
      // or synthesise from the tree (folders-first then files).
      const prefix = parentPath ? parentPath + "/" : "";
      const folderNames = new Set<string>();
      const fileEntries: string[] = [];
      for (const f of files) {
        if (!f.path.startsWith(prefix)) continue;
        const rest = f.path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash >= 0) {
          folderNames.add(rest.slice(0, slash));
        } else if (!f.path.endsWith("/.keep")) {
          fileEntries.push("f:" + f.id);
        }
      }
      const folderEntries = [...folderNames].sort().map((n) => "d:" + n);

      // If childOrder already exists, use it as seed. Otherwise
      // synthesise from subfolderOrder + fileOrder, or alphabetical.
      let existing = getChildOrder(parentPath);
      if (existing.length === 0) {
        // Build from legacy ordering
        const subOrder = getSubfolderOrder(parentPath);
        const fileOrder = getFolderOrder(parentPath);

        let orderedFolders = folderEntries;
        if (subOrder.length > 0) {
          const idx = new Map(subOrder.map((n, i) => [n, i]));
          orderedFolders = [...folderEntries].sort((a, b) => {
            const na = a.slice(2), nb = b.slice(2);
            const ia = idx.get(na) ?? Infinity, ib = idx.get(nb) ?? Infinity;
            return ia - ib;
          });
        }

        let orderedFiles = fileEntries;
        if (fileOrder.length > 0) {
          const idx = new Map(fileOrder.map((id, i) => [id, i]));
          orderedFiles = [...fileEntries].sort((a, b) => {
            const ia = idx.get(a.slice(2)) ?? Infinity, ib = idx.get(b.slice(2)) ?? Infinity;
            return ia - ib;
          });
        }

        existing = [...orderedFolders, ...orderedFiles];
      }

      // Ensure source and anchor are in the list
      const allEntries = new Set(existing);
      for (const e of [...folderEntries, ...fileEntries]) allEntries.add(e);
      const base = [...allEntries].filter((e) => {
        if (e.startsWith("d:")) return folderNames.has(e.slice(2));
        if (e.startsWith("f:")) return fileEntries.includes(e);
        return false;
      });

      const without = base.filter((e) => e !== sourceEntry);
      const anchorIdx = without.indexOf(anchorEntry);
      if (anchorIdx < 0) return;
      const insertAt = position === "above" ? anchorIdx : anchorIdx + 1;
      const next = [
        ...without.slice(0, insertAt),
        sourceEntry,
        ...without.slice(insertAt),
      ];
      setChildOrder(parentPath, next);
    },
    [files],
  );

  // Legacy wrappers used by handleDrop and handleDropOnFile
  const reorderFolderWithin = useCallback(
    (sourcePath: string, anchorPath: string, position: "above" | "below") => {
      const parentOf = (p: string) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
      const nameOf = (p: string) => { const i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); };
      const parent = parentOf(sourcePath);
      if (parent !== parentOf(anchorPath)) return;
      reorderChildWithin(parent, "d:" + nameOf(sourcePath), "d:" + nameOf(anchorPath), position);
    },
    [reorderChildWithin],
  );

  const reorderFileWithin = useCallback(
    (fileId: string, anchorId: string, position: "above" | "below") => {
      if (fileId === anchorId) return;
      const source = files.find((f) => f.id === fileId);
      const anchor = files.find((f) => f.id === anchorId);
      if (!source || !anchor) return;
      const folder = folderPathOf(source.path);
      if (folder !== folderPathOf(anchor.path)) return;
      reorderChildWithin(folder, "f:" + fileId, "f:" + anchorId, position);
    },
    [files, folderPathOf, reorderChildWithin],
  );

  const handleDropOnFile = useCallback(
    (e: React.DragEvent, targetFileId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const raw = e.dataTransfer.getData("application/stave-tree-item");
      setBetweenTarget(null);
      if (!raw) return;
      try {
        const payload = JSON.parse(raw) as
          | { kind: "file"; fileId: string }
          | { kind: "folder"; folderPath: string };
        const position = betweenTarget?.position ?? "below";
        if (payload.kind === "file") {
          reorderFileWithin(payload.fileId, targetFileId, position);
        } else {
          // Folder dropped on a file row — reorder the folder relative
          // to the file within their shared parent level.
          const targetFile = files.find((f) => f.id === targetFileId);
          if (!targetFile) return;
          const parentPath = folderPathOf(targetFile.path);
          reorderChildWithin(parentPath, "d:" + payload.folderPath.split("/").pop()!, "f:" + targetFileId, position);
        }
      } catch {
        /* ignore */
      }
    },
    [betweenTarget, reorderFileWithin, reorderChildWithin, files, folderPathOf],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetFolderPath: string) => {
      e.preventDefault();
      e.stopPropagation();
      // Native OS file drop — import and return.
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        setDropTarget(null);
        setBetweenFolderTarget(null);
        void importNativeFiles(e.dataTransfer.files, targetFolderPath);
        return;
      }
      const raw = e.dataTransfer.getData("application/stave-tree-item");
      const pendingBetween = betweenFolderTarget;
      setBetweenFolderTarget(null);
      if (!raw) return;
      try {
        const payload = JSON.parse(raw) as
          | { kind: "file"; fileId: string }
          | { kind: "folder"; folderPath: string };
        // Between-zone active on a folder row → reorder (not nest).
        if (pendingBetween && pendingBetween.folderPath === targetFolderPath) {
          const anchorEntry = "d:" + targetFolderPath.split("/").pop()!;
          const parentOf = (p: string) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
          const parentPath = parentOf(targetFolderPath);

          if (payload.kind === "folder") {
            reorderFolderWithin(payload.folderPath, targetFolderPath, pendingBetween.position);
          } else {
            // File dropped on the edge of a folder row → reorder file
            // relative to the folder at their shared parent level.
            reorderChildWithin(parentPath, "f:" + payload.fileId, anchorEntry, pendingBetween.position);
          }
          setDropTarget(null);
          return;
        }
        // Middle zone or no between → nest into folder.
        if (payload.kind === "file") {
          moveFileToFolder(payload.fileId, targetFolderPath);
        } else if (payload.kind === "folder") {
          moveFolderToFolder(payload.folderPath, targetFolderPath);
        }
      } catch {
        /* ignore malformed payload */
      }
      setDropTarget(null);
    },
    [moveFileToFolder, moveFolderToFolder, betweenFolderTarget, reorderFolderWithin, reorderChildWithin, importNativeFiles],
  );

  return (
    <div
      data-sidebar
      onMouseEnter={() => setSidebarHover(true)}
      onMouseLeave={() => setSidebarHover(false)}
      style={styles.sidebar}
    >
      <div style={styles.header}>
        <span style={styles.title} title={projectName}>{projectName}</span>
        {currentBranch && currentBranch !== "main" && (
          <span
            data-file-tree-branch={currentBranch}
            title={`On branch "${currentBranch}" (not main)`}
            style={styles.branchChip}
          >
            ⑂ {currentBranch}
          </span>
        )}
        <div
          style={{
            ...styles.headerActions,
            opacity: sidebarHover ? 1 : 0,
            pointerEvents: sidebarHover ? "auto" : "none",
            transition: "opacity 160ms ease-out",
          }}
        >
          <button
            style={styles.iconBtn}
            title="New file"
            onClick={() => handleNewFile("")}
          >
            <Icon name="new-file" size={14} />
          </button>
          <button
            style={styles.iconBtn}
            title="New folder"
            onClick={() => handleNewFolder("")}
          >
            <Icon name="new-folder" size={14} />
          </button>
        </div>
      </div>

      <div
        style={{
          ...styles.list,
          ...(dropTarget === "__root__" ? styles.listDropActive : {}),
        }}
        onDragOver={handleDragOverRoot}
        onDragLeave={(e) => {
          // Only clear when leaving the list (not when moving between children)
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            handleDragLeaveTree();
          }
        }}
        onDrop={(e) => handleDrop(e, "")}
        onContextMenu={(e) => {
          // Only fire for the empty root area — if the click landed on a
          // child row, that row's own handler stops propagation first.
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          setContextMenu({ kind: "root", x: e.clientX, y: e.clientY });
        }}
      >
        {tree.length === 0 && (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>This project is empty</div>
            <div style={styles.emptyHint}>
              Press <Kbd>⌘N</Kbd> for a new project, or drop files to start.
            </div>
            <div style={styles.emptyActions}>
              <button
                style={styles.emptyAction}
                onClick={() => handleNewFile("")}
              >
                + New file
              </button>
              <button
                style={styles.emptyAction}
                onClick={() => handleNewFolder("")}
              >
                + New folder
              </button>
            </div>
          </div>
        )}
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            modifiedFileIds={modifiedFileIds}
            collapsedFolders={collapsedFolders}
            onToggleFolder={toggleFolder}
            onOpenFile={onOpenFile}
            activeFileId={activeFileId}
            editingFileId={editingFileId}
            editValue={editValue}
            setEditValue={setEditValue}
            onCommitRename={commitRename}
            onCancelRename={() => setEditingFileId(null)}
            onContextMenu={(fileId, x, y) => setContextMenu({ kind: "file", fileId, x, y })}
            onContextMenuFolder={(folderPath, x, y) => setContextMenu({ kind: "folder", folderPath, x, y })}
            inputRef={inputRef}
            onNewFile={handleNewFile}
            onNewFolder={handleNewFolder}
            dropTarget={dropTarget}
            betweenTarget={betweenTarget}
            betweenFolderTarget={betweenFolderTarget}
            selectedFileIds={selectedFileIds}
            onToggleSelect={(id) => setSelectedFileIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            onClearSelection={() => setSelectedFileIds(new Set())}
            onDragStart={handleDragStart}
            onDragOverFolder={handleDragOverFolder}
            onDropOnFolder={handleDrop}
            onDragOverFile={handleDragOverFile}
            onDropOnFile={handleDropOnFile}
          />
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenFile={onOpenFile}
          onRenameFile={(id) => {
            const f = files.find((x) => x.id === id);
            if (f) startRename(f);
          }}
          onDeleteFile={handleDelete}
          onDuplicateFile={handleDuplicate}
          onCopyPath={handleCopyPath}
          onFileHistory={onFileHistory}
          onBulkDelete={handleBulkDelete}
          selectedFileIds={selectedFileIds}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onToggleFolder={toggleFolder}
          collapsedFolders={collapsedFolders}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
        />
      )}

    </div>
  );
});

// ── Recursive TreeItem ──────────────────────────────────────────────

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onOpenFile: (fileId: string, intent?: { preview?: boolean }) => void;
  activeFileId: string | null;
  editingFileId: string | null;
  editValue: string;
  setEditValue: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onContextMenu: (fileId: string, x: number, y: number) => void;
  onContextMenuFolder: (folderPath: string, x: number, y: number) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onNewFile: (folderPath?: string) => void;
  onNewFolder: (parentPath?: string) => void;
  // Multi-select
  selectedFileIds: Set<string>;
  onToggleSelect: (fileId: string) => void;
  onClearSelection: () => void;
  // Drag-drop
  dropTarget: string | "__root__" | null;
  betweenTarget: { fileId: string; position: "above" | "below" } | null;
  betweenFolderTarget: { folderPath: string; position: "above" | "below" } | null;
  onDragStart: (
    e: React.DragEvent,
    payload:
      | { kind: "file"; fileId: string }
      | { kind: "folder"; folderPath: string },
  ) => void;
  onDragOverFolder: (e: React.DragEvent, folderPath: string) => void;
  onDropOnFolder: (e: React.DragEvent, targetFolderPath: string) => void;
  onDragOverFile: (e: React.DragEvent, targetFileId: string) => void;
  onDropOnFile: (e: React.DragEvent, targetFileId: string) => void;
  /** file ids dirty vs current-branch HEAD — drive the per-row badge (#193). */
  modifiedFileIds: ReadonlySet<string>;
}

function TreeItem(props: TreeItemProps) {
  const { node, depth, modifiedFileIds } = props;

  if (node.kind === "folder") {
    const collapsed = props.collapsedFolders.has(node.path);
    const isDropTarget = props.dropTarget === node.path;
    const bf = props.betweenFolderTarget;
    const showFAbove = bf?.folderPath === node.path && bf.position === "above";
    const showFBelow = bf?.folderPath === node.path && bf.position === "below";
    return (
      <div>
        <div
          data-folder-path={node.path}
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            props.onDragStart(e, { kind: "folder", folderPath: node.path });
          }}
          onDragOver={(e) => {
            e.stopPropagation();
            props.onDragOverFolder(e, node.path);
          }}
          onDrop={(e) => props.onDropOnFolder(e, node.path)}
          style={{
            ...styles.item,
            ...(isDropTarget ? styles.dropTarget : {}),
            paddingLeft: 8 + depth * 12,
            boxShadow: showFAbove
              ? "inset 0 2px 0 0 var(--accent-strong)"
              : showFBelow
              ? "inset 0 -2px 0 0 var(--accent-strong)"
              : undefined,
          }}
          onClick={() => props.onToggleFolder(node.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onContextMenuFolder(node.path, e.clientX, e.clientY);
          }}
        >
          <span style={styles.chevron}>{collapsed ? "▸" : "▾"}</span>
          <span style={styles.folderIcon}><FolderIcon /></span>
          <span style={styles.itemName}>{node.name}</span>
        </div>
        {!collapsed &&
          node.children!.map((child) => (
            <TreeItem key={child.path} {...props} node={child} depth={depth + 1} />
          ))}
      </div>
    );
  }

  // File
  const file = node.file!;
  const isEditing = props.editingFileId === file.id;
  const isActive = props.activeFileId === file.id;
  // Hide .keep placeholder files
  if (node.name === ".keep") return null;

  const between = props.betweenTarget;
  const showAbove = between?.fileId === file.id && between.position === "above";
  const showBelow = between?.fileId === file.id && between.position === "below";
  const isSelected = props.selectedFileIds.has(file.id);

  return (
    <div
      data-file-tree-item={file.id}
      data-active-file={isActive ? "true" : "false"}
      data-selected={isSelected ? "true" : "false"}
      draggable={!isEditing}
      onDragStart={(e) => {
        e.stopPropagation();
        props.onDragStart(e, { kind: "file", fileId: file.id });
      }}
      onDragOver={(e) => props.onDragOverFile(e, file.id)}
      onDrop={(e) => props.onDropOnFile(e, file.id)}
      style={{
        ...styles.item,
        ...(isActive || isSelected ? styles.itemActive : {}),
        paddingLeft: 8 + depth * 12,
        position: "relative",
        boxShadow: showAbove
          ? "inset 0 2px 0 0 var(--accent-strong)"
          : showBelow
          ? "inset 0 -2px 0 0 var(--accent-strong)"
          : undefined,
      }}
      onClick={(e) => {
        if (isEditing) return;
        if (e.metaKey || e.ctrlKey) {
          e.stopPropagation();
          props.onToggleSelect(file.id);
          return;
        }
        props.onClearSelection();
        props.onOpenFile(file.id, { preview: true });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onContextMenu(file.id, e.clientX, e.clientY);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isEditing) {
          props.onClearSelection();
          props.onOpenFile(file.id, { preview: false });
        }
      }}
    >
      <span style={styles.fileIcon}><FileTypeIcon language={file.language} /></span>
      {isEditing ? (
        <input
          ref={props.inputRef}
          value={props.editValue}
          onChange={(e) => props.setEditValue(e.target.value)}
          onBlur={props.onCommitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.onCommitRename();
            if (e.key === "Escape") props.onCancelRename();
          }}
          onClick={(e) => e.stopPropagation()}
          style={styles.renameInput}
        />
      ) : (
        <span style={styles.itemName}>{node.name}</span>
      )}
      {!isEditing && modifiedFileIds.has(file.id) && (
        <span
          data-file-modified={file.id}
          title="Modified since last commit"
          style={styles.dirtyDot}
        />
      )}
    </div>
  );
}

// ── Context menu ────────────────────────────────────────────────────

type ContextMenuState =
  | { kind: "file"; fileId: string; x: number; y: number }
  | { kind: "folder"; folderPath: string; x: number; y: number }
  | { kind: "root"; x: number; y: number };

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onOpenFile: (fileId: string, intent?: { preview?: boolean }) => void;
  onRenameFile: (fileId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onDuplicateFile: (fileId: string) => void;
  onCopyPath: (fileId: string) => void;
  onFileHistory: (fileId: string) => void;
  onBulkDelete: () => void;
  selectedFileIds: Set<string>;
  onNewFile: (folderPath?: string) => void;
  onNewFolder: (parentPath?: string) => void;
  onToggleFolder: (folderPath: string) => void;
  collapsedFolders: Set<string>;
  onRenameFolder: (folderPath: string) => void;
  onDeleteFolder: (folderPath: string) => void;
}

// Split nested labels — "New File..." is one item, but we want a
// divider rule between "Open" and "Rename". A `null` entry renders a
// horizontal divider.
type MenuEntry =
  | { label: string; onClick: () => void; danger?: boolean }
  | null;


function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        background: "var(--bg-input)",
        border: "1px solid var(--border-strong)",
        borderRadius: 3,
        padding: "1px 5px",
        fontSize: 10,
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </kbd>
  );
}

function ContextMenu(props: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: props.state.x, y: props.state.y });

  // After mount, clamp to viewport so the menu never spills off the
  // right or bottom edge (VS Code behaviour).
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 4;
    let nx = props.state.x;
    let ny = props.state.y;
    if (nx + rect.width > window.innerWidth - margin) {
      nx = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (ny + rect.height > window.innerHeight - margin) {
      ny = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.state]);

  const entries: MenuEntry[] =
    props.state.kind === "file"
      ? (() => {
          const fileId = (props.state as { fileId: string }).fileId;
          // Bulk mode kicks in when the right-clicked file is part of a
          // multi-selection of >1 items. Surfaces a single 'Delete N'
          // action instead of the per-file menu.
          const isBulk = props.selectedFileIds.size > 1 && props.selectedFileIds.has(fileId);
          if (isBulk) {
            return [
              { label: `Delete ${props.selectedFileIds.size} files`, danger: true,
                onClick: () => props.onBulkDelete() },
            ];
          }
          return [
            { label: "Open", onClick: () => { props.onOpenFile(fileId); props.onClose(); } },
            { label: "File History", onClick: () => { props.onFileHistory(fileId); props.onClose(); } },
            null,
            { label: "Duplicate", onClick: () => props.onDuplicateFile(fileId) },
            { label: "Copy Path", onClick: () => props.onCopyPath(fileId) },
            null,
            { label: "Rename...", onClick: () => { props.onRenameFile(fileId); props.onClose(); } },
            { label: "Delete", danger: true, onClick: () => props.onDeleteFile(fileId) },
          ];
        })()
      : props.state.kind === "folder"
      ? (() => {
          const fp = (props.state as { folderPath: string }).folderPath;
          const isCollapsed = props.collapsedFolders.has(fp);
          return [
            { label: "New File...", onClick: () => { props.onNewFile(fp); props.onClose(); } },
            { label: "New Folder...", onClick: () => { props.onNewFolder(fp); props.onClose(); } },
            null,
            { label: isCollapsed ? "Expand" : "Collapse", onClick: () => { props.onToggleFolder(fp); props.onClose(); } },
            null,
            { label: "Rename...", onClick: () => props.onRenameFolder(fp) },
            { label: "Delete", danger: true, onClick: () => props.onDeleteFolder(fp) },
          ];
        })()
      : [
          { label: "New File...", onClick: () => { props.onNewFile(""); props.onClose(); } },
          { label: "New Folder...", onClick: () => { props.onNewFolder(""); props.onClose(); } },
        ];

  return (
    <div
      ref={ref}
      style={{ ...styles.contextMenu, left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry === null ? (
          <div key={`div-${i}`} style={styles.menuDivider} />
        ) : (
          <button
            key={entry.label}
            data-stave-ctx-item
            data-stave-menu-item
            data-danger={entry.danger ? "true" : "false"}
            style={{ ...styles.menuItem, ...(entry.danger ? styles.menuItemDanger : {}) }}
            onClick={entry.onClick}
          >
            {entry.label}
          </button>
        ),
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    // Width belongs to SidePanel (#1367); the tree fills whatever it is given.
    width: "100%",
    height: "100%",
    background: "var(--bg-sidebar)",
    borderRight: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column" as const,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: 13,
    color: "var(--text-chrome)",
    userSelect: "none" as const,
    position: "relative" as const,
    zIndex: 1,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    borderBottom: "1px solid var(--border-subtle)",
    gap: 4,
  },
  title: {
    fontWeight: 600,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--text-tertiary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    flex: 1,
  },
  headerActions: {
    display: "flex",
    gap: 2,
  },
  iconBtn: {
    background: "none",
    border: "none",
    color: "var(--text-icon)",
    cursor: "pointer",
    fontSize: 14,
    padding: "2px 6px",
    borderRadius: 3,
  },
  list: {
    flex: 1,
    overflow: "auto",
    padding: "4px 0",
  },
  empty: {
    padding: "28px 16px",
    textAlign: "center" as const,
    color: "var(--text-muted)",
    fontSize: 12,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
  },
  emptyHint: {
    fontSize: 11,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
  emptyActions: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    marginTop: 6,
    width: "100%",
  },
  emptyAction: {
    background: "var(--bg-active)",
    border: "1px solid var(--border-strong)",
    borderRadius: 4,
    color: "var(--text-primary)",
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  item: {
    padding: "4px 8px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 13,
  },
  itemActive: {
    background: "var(--bg-hover)",
    color: "var(--text-primary)",
    borderLeft: "2px solid var(--accent)",
    paddingLeft: 6, // compensate for the border
  },
  dropTarget: {
    background: "var(--bg-active-strong)",
    outline: "1px dashed var(--accent)",
    outlineOffset: "-1px",
  },
  listDropActive: {
    background: "var(--bg-drag-zone)",
    outline: "1px dashed var(--accent)",
    outlineOffset: "-2px",
  },
  chevron: {
    fontSize: 10,
    width: 10,
    color: "var(--text-muted)",
  },
  folderIcon: {
    display: "flex",
    marginRight: 2,
    color: "var(--text-icon)",
  },
  fileIcon: {
    display: "flex",
    marginLeft: 10, // align files under folder-chevron column
    marginRight: 2,
    color: "var(--text-icon)",
  },
  itemName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    flex: 1,
  },
  dirtyDot: {
    flex: "0 0 auto",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--accent-strong)",
    marginLeft: 4,
  },
  branchChip: {
    flex: "0 0 auto",
    fontSize: 10,
    lineHeight: 1.4,
    padding: "1px 6px",
    borderRadius: 10,
    color: "var(--accent-strong)",
    border: "1px solid color-mix(in srgb, var(--accent-strong) 45%, transparent)",
    background: "color-mix(in srgb, var(--accent-strong) 12%, transparent)",
    maxWidth: 110,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  renameInput: {
    background: "var(--bg-input)",
    border: "1px solid var(--border-stronger)",
    borderRadius: 3,
    color: "var(--text-primary)",
    fontSize: 13,
    padding: "1px 4px",
    flex: 1,
    outline: "none",
    fontFamily: "inherit",
  },
  contextMenu: {
    position: "fixed" as const,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 4,
    padding: "4px 0",
    zIndex: 9999,
    minWidth: 120,
    boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
  },
  menuItem: {
    display: "block",
    width: "100%",
    padding: "6px 14px",
    background: "none",
    border: "none",
    color: "var(--text-chrome)",
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: "left" as const,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  menuItemDanger: {
    color: "var(--danger-fg)",
  },
  menuDivider: {
    height: 1,
    margin: "4px 0",
    background: "var(--border-subtle)",
  },
};
