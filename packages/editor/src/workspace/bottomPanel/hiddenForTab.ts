/**
 * Is the bottom panel hidden for this tab (#2022)?
 *
 * The Timeline, Pattern and Mixer describe a piece of music. A visual — a p5,
 * Hydra or GLSL file — has no music in it to describe, so while one is the
 * active pane the panel is hidden rather than left showing a stand-by message
 * or another file's song. Any view of a visual counts: its code, its preview,
 * its history.
 *
 * No tab at all, or a tab whose file is gone, hides nothing: the panel's
 * default is to be there.
 */
import { getFile } from '../WorkspaceFile'
import { isVizLanguage } from '../vizLanguages'
import type { WorkspaceTab } from '../types'

export function bottomPanelHiddenForTab(tab: WorkspaceTab | null): boolean {
  if (!tab) return false
  const language = getFile(tab.fileId)?.language
  return language != null && isVizLanguage(language)
}
