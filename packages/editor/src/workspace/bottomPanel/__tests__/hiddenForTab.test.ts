/**
 * #2022 — the bottom panel is hidden exactly when the active tab's file is a visual.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkspaceFile, deleteWorkspaceFile } from '../../WorkspaceFile'
import { VIZ_LANGUAGES } from '../../vizLanguages'
import type { WorkspaceLanguage, WorkspaceTab } from '../../types'
import { bottomPanelHiddenForTab } from '../hiddenForTab'

const made: string[] = []
function file(id: string, language: WorkspaceLanguage): string {
  createWorkspaceFile(id, `${id}.x`, '', language)
  made.push(id)
  return id
}
afterEach(() => {
  for (const id of made.splice(0)) deleteWorkspaceFile(id)
})

const editor = (fileId: string): WorkspaceTab => ({ kind: 'editor', id: `t-${fileId}`, fileId })

describe('bottomPanelHiddenForTab (#2022)', () => {
  it('there is at least one visual language to test', () => {
    expect(VIZ_LANGUAGES.length).toBeGreaterThanOrEqual(3)
  })

  it.each(VIZ_LANGUAGES.map((l) => [l]))('hidden for a %s file', (language) => {
    expect(bottomPanelHiddenForTab(editor(file(`viz-${language}`, language)))).toBe(true)
  })

  it.each([['strudel'], ['sonicpi'], ['markdown']] as [WorkspaceLanguage][])('shown for a %s file', (language) => {
    expect(bottomPanelHiddenForTab(editor(file(`doc-${language}`, language)))).toBe(false)
  })

  it('every view of a visual hides it: its preview too', () => {
    const id = file('viz-preview', VIZ_LANGUAGES[0])
    expect(bottomPanelHiddenForTab({ kind: 'preview', id: 'p', fileId: id, sourceRef: { kind: 'default' } })).toBe(true)
  })

  it('no tab, or a tab whose file is gone, hides nothing', () => {
    expect(bottomPanelHiddenForTab(null)).toBe(false)
    expect(bottomPanelHiddenForTab(editor('no-such-file'))).toBe(false)
  })
})
