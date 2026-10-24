/**
 * Asset Library — Snippets provider (#2165): the built-in Strudel sketches.
 *
 * Each sketch is a row: its topic is the category chip (`group`), its level the
 * level chip, and Copy copies its code. Preview plays it and Insert adds it to
 * the project as a new file; both are injected, as in the Sounds and Viz
 * providers, so the mapping is unit-testable without an engine or a workspace.
 */

import type { Asset, AssetPreviewHandle, AssetProvider } from "./types";
import { STRUDEL_SNIPPETS, type StrudelSnippet } from "./snippets/strudelSnippets";

export interface SnippetsProviderDeps {
  /** Play a sketch; returns a handle to stop it. */
  startPreview: (snippet: StrudelSnippet) => AssetPreviewHandle | Promise<AssetPreviewHandle>;
  /** Add a sketch to the project as a new file, and open it. */
  onInsert: (snippet: StrudelSnippet) => void;
  /** The sketches to list (tests pass their own). */
  snippets?: readonly StrudelSnippet[];
}

const LEVEL_TAG: Record<StrudelSnippet["level"], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export function createSnippetsProvider(deps: SnippetsProviderDeps): AssetProvider {
  const snippets = deps.snippets ?? STRUDEL_SNIPPETS;
  const assets: Asset[] = snippets.map((snippet) => ({
    type: "snippet",
    id: snippet.id,
    name: snippet.name,
    source: "built-in",
    code: snippet.code,
    group: snippet.topic,
    level: snippet.level,
    // the level leads, so it shows on the row and a search for it finds it
    tags: [LEVEL_TAG[snippet.level], ...snippet.tags],
    preview: () => deps.startPreview(snippet),
    insert: () => deps.onInsert(snippet),
    insertLabel: "Add to project as a new file",
  }));
  return {
    type: "snippet",
    label: "Snippets",
    list: () => assets,
  };
}
