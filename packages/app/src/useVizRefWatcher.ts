/**
 * useVizRefWatcher — watch all .viz("name") references in a music-lang
 * file and auto-reload inline viz when a referenced viz file is saved.
 *
 * Scans the file content for `.viz("...")` calls, resolves each name to
 * a workspace file (`.p5` / `.hydra`), and subscribes to Y.Text changes
 * on those files. When a referenced viz file changes, the hook
 * recompiles the preset and re-registers it in the named viz registry —
 * which triggers EditorView's `onNamedVizChanged` listener to remount
 * the inline viz zones.
 *
 * Usage:
 *   useVizRefWatcher(fileId)
 */

"use client";

import { useEffect, useState } from "react";
import {
  getFile,
  listWorkspaceFiles,
  subscribeToWorkspaceFile,
  flushToPreset,
  getPresetIdForFile,
  registerPresetAsNamedViz,
  VizPresetStore,
  getActiveProjectId,
} from "@stave/editor";
import { mayEvaluateQuietly } from "./gallery/runGate";

const VIZ_REF_RE = /\.viz\(\s*["']([^"']+)["']\s*\)/g;

function extractVizRefs(content: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  VIZ_REF_RE.lastIndex = 0;
  while ((m = VIZ_REF_RE.exec(content)) !== null) {
    const name = m[1];
    if (!seen.has(name)) { seen.add(name); names.push(name); }
  }
  return names;
}

function resolveVizFile(vizName: string): { fileId: string; presetId: string } | null {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, "");
  const target = norm(vizName);
  const allFiles = listWorkspaceFiles();
  for (const f of allFiles) {
    const baseName = f.path.replace(/\.[^.]+$/, "");
    const lastSeg = baseName.split("/").pop() ?? "";
    if (norm(lastSeg) === target || norm(baseName) === target) {
      let presetId = getPresetIdForFile(f);
      // Auto-generate presetId for manually created viz files
      if (!presetId) {
        presetId = `user_${baseName.replace(/[^a-zA-Z0-9]/g, "_")}`;
      }
      return { fileId: f.id, presetId };
    }
  }
  return null;
}

function recompileAndRegister(vizFileId: string, presetId: string): void {
  // #2344 — a gallery viz file nobody has agreed to run is never registered.
  const projectId = getActiveProjectId();
  if (projectId && !mayEvaluateQuietly(projectId, vizFileId)) return;
  flushToPreset(vizFileId, presetId)
    .then(() => VizPresetStore.get(presetId))
    .then((preset) => { if (preset) registerPresetAsNamedViz(preset); })
    .catch(() => { /* compile error — stale descriptor stays */ });
}

export function useVizRefWatcher(fileId: string | null): void {
  const [tick, setTick] = useState(0);

  // Subscribe to the music file's content changes to detect new .viz() refs.
  useEffect(() => {
    if (!fileId) return;
    return subscribeToWorkspaceFile(fileId, () => setTick((t) => t + 1));
  }, [fileId]);

  // Subscribe to every referenced viz file. Re-runs when the music
  // file content changes (tick) or when the fileId changes.
  useEffect(() => {
    if (!fileId) return;
    const file = getFile(fileId);
    if (!file) return;

    if (file.language !== "strudel" && file.language !== "sonicpi") return;

    const vizNames = extractVizRefs(file.content);
    if (vizNames.length === 0) return;

    const unsubs: Array<() => void> = [];

    for (const name of vizNames) {
      const resolved = resolveVizFile(name);
      if (!resolved) continue;

      const unsub = subscribeToWorkspaceFile(resolved.fileId, () => {
        recompileAndRegister(resolved.fileId, resolved.presetId);
      });
      unsubs.push(unsub);
    }

    return () => { for (const u of unsubs) u(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, tick]);
}
