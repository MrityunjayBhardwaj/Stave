/**
 * #2490 — the preview frame's registry of an entry's files: which of them a
 * pattern's `.viz("name")` draws.
 *
 * The frame gets every file of the entry it can run (previewProtocol.ts), and a
 * pattern there may call `.viz("bloom")` for the entry's own `bloom.hydra`. The
 * name answers to the SAME rule the studio registers a project's visuals under
 * (`registerAllVizFiles` in StrudelEditorClient, read back by
 * `findVizFileByName` in vizFileLookup.ts): a visual's name is its file name
 * without the extension; a Hydra / GLSL / three.js file that shares that name
 * with a p5 sketch answers to `<name>:hydra` (and so on) and leaves the bare
 * name to the sketch; an exact name wins over a case/space/hyphen/underscore-
 * insensitive one; and when two files answer, the later one wins. A pattern
 * file is never a visual, whatever its name.
 *
 * A name no file of the entry answers to falls through to the visuals Stave
 * ships (`resolveDescriptor` over the built-in list, as in the studio once no
 * registered name matched) — that part is the player's, since it needs the
 * renderers; this module only maps names to files, so it can be tested alone.
 */
import type { WorkspaceLanguage } from "@stave/editor";
import { findVizFileByName, vizBaseName } from "../visualizers/vizFileLookup";
import type { PreviewFile, PreviewKind } from "./previewProtocol";

/** A preview kind as the workspace language the studio's rule reads. */
const LANGUAGE_OF: Record<PreviewKind, WorkspaceLanguage> = {
  strudel: "strudel",
  hydra: "hydra",
  p5: "p5js",
  glsl: "glsl",
  three: "three",
};

export interface PreviewRegistry {
  /** The entry's visual a `.viz(name)` call draws, or null when none answers to it. */
  visualFor(name: string): PreviewFile | null;
}

/** A visual's name as the studio names its preset: the file name without its extension. */
export const visualName = vizBaseName;

export function previewRegistry(files: readonly PreviewFile[]): PreviewRegistry {
  const named = files.map((file) => ({ file, path: file.path, language: LANGUAGE_OF[file.kind] }));
  return {
    visualFor(name) {
      return findVizFileByName(named, name)?.file ?? null;
    },
  };
}

