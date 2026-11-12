/**
 * vizFileLookup — the ONE answer to "which workspace file is the viz called X?"
 *
 * The renderer registers viz files as named vizzes in `registerAllVizFiles`
 * (StrudelEditorClient). Every other surface that has to find the file behind
 * an inline `.viz("X")` — the ✎ edit button, the ✂ crop fallback, the viz-ref
 * watcher — must give the SAME answer, or it opens / crops / recompiles a
 * different file than the one on screen (#2322: ✎ opened `fold.strudel`, a
 * pattern, instead of the `Fold.p5` sketch it was drawing).
 *
 * The rules, all mirrored from the registration path so they cannot drift:
 *   - Only viz-language files are vizzes (`isVizLanguage`). A pattern that
 *     shares a visual's name can never be picked.
 *   - A file's preset id is `getPresetIdForFile(f)`, else the `user_<path>`
 *     id the renderer derives for a file that was never seeded from a preset.
 *   - A hydra/glsl file that shares a basename with a p5 file registers as
 *     `<name>:hydra` / `<name>:glsl`; the bare name belongs to the p5 sketch.
 *   - Names resolve the way `resolveDescriptor` reads the registry: an exact
 *     registered name first, then a normalized one (`normalizeVizName`);
 *     re-registering a name replaces it, so the LAST file wins.
 */

import {
  getPresetIdForFile,
  isVizLanguage,
  normalizeVizName,
  rendererForLanguage,
} from "@stave/editor";
import type { WorkspaceFile } from "@stave/editor";

/**
 * What the name rule reads of a file: its path and language. A gallery
 * preview's files (#2490) aren't workspace files, and resolve by the same rule.
 */
export type NamedVizFile = Pick<WorkspaceFile, "path" | "language">;

/** A file's basename without its extension: `viz/Fold.p5` → `Fold`. */
export function vizBaseName(path: string): string {
  return path.split("/").pop()!.replace(/\.[^.]+$/, "");
}

/**
 * The preset id the renderer stores and registers a viz file under: its
 * seeded preset id, else `user_<path without extension, sanitized>`.
 */
export function presetIdForVizFile(file: WorkspaceFile): string {
  const seeded = getPresetIdForFile(file);
  if (seeded) return seeded;
  const baseName = file.path.replace(/\.[^.]+$/, "");
  return `user_${baseName.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/** Basenames of every p5 viz file — the names a hydra/glsl twin must yield. */
export function p5VizBasenames(files: readonly NamedVizFile[]): Set<string> {
  return new Set(
    files.filter((f) => f.language === "p5js").map((f) => vizBaseName(f.path)),
  );
}

/**
 * The renderer-qualified name a non-p5 viz file registers under when it
 * shares a basename with a p5 file (`scope.hydra` beside `scope.p5` →
 * `scope:hydra`), or `null` when it registers under its own preset name.
 */
export function qualifiedVizName(
  file: NamedVizFile,
  p5Basenames: ReadonlySet<string>,
): string | null {
  const renderer = rendererForLanguage(file.language);
  if (!renderer || renderer === "p5") return null;
  const base = vizBaseName(file.path);
  return p5Basenames.has(base) ? `${base}:${renderer}` : null;
}

/** The viz file whose preset id is `presetId`, if it is in `files`. */
export function findVizFileByPresetId(
  files: readonly WorkspaceFile[],
  presetId: string,
): WorkspaceFile | undefined {
  return files.find(
    (f) => isVizLanguage(f.language) && presetIdForVizFile(f) === presetId,
  );
}

/**
 * The viz file an inline `.viz(vizId)` draws, resolved by name the way the
 * registry resolves it. Each viz file's registered name is its qualified name
 * or, standing in for its preset name, its basename.
 */
export function findVizFileByName<F extends NamedVizFile>(
  files: readonly F[],
  vizId: string,
): F | undefined {
  const vizFiles = files.filter((f) => isVizLanguage(f.language));
  const p5Basenames = p5VizBasenames(vizFiles);
  const named = vizFiles.map((f) => ({
    file: f,
    name: qualifiedVizName(f, p5Basenames) ?? vizBaseName(f.path),
  }));
  const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];
  const exact = last(named.filter((n) => n.name === vizId));
  if (exact) return exact.file;
  const target = normalizeVizName(vizId);
  return last(named.filter((n) => normalizeVizName(n.name) === target))?.file;
}

/**
 * The viz file an inline zone is drawing: by its resolved `presetId` when the
 * zone has one (exact — the preset IS the drawn viz), else by name.
 */
export function resolveVizFile(
  files: readonly WorkspaceFile[],
  vizId: string,
  presetId: string | null | undefined,
): WorkspaceFile | undefined {
  if (presetId) {
    const byPreset = findVizFileByPresetId(files, presetId);
    if (byPreset) return byPreset;
  }
  return findVizFileByName(files, vizId);
}
