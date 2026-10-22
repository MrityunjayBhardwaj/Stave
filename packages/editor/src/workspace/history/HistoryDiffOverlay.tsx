/**
 * HistoryDiffOverlay — read-only Monaco diff over the project commit store
 * (Phase H, #198). Launched per-commit from the History panel. Shows, for one
 * file at a time, either:
 *   - "vs previous": the commit's content against its parent (what it changed)
 *   - "vs current":  the commit's content against the live workspace
 *
 * Both sides read through `getFileContentAt` (parent back-walk); "current" reads
 * the live Y.Text via `getLiveFileContent`. The file picker is scoped to the
 * files the commit touched (`Object.keys(commit.files)`). Read-only — restoring
 * is the panel's job (Restore/Fork), not the diff's.
 *
 * Monaco lifecycle: `automaticLayout: true` re-measures on container resize
 * (the offsetWidth gotcha), so the overlay can live in the elastic bottom panel.
 */

import * as React from 'react'
// @monaco-editor/react ships React-18 types; cast to any for React 19 JSX
// (same pattern as EditorView).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { DiffEditor as DiffEditorRaw } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { getFileContentAt, type ProjectHistory, type Commit } from './historyGraph'
import { getLiveFileContent } from './historyService'
import { defineStrudelMonacoTheme } from '../../theme/monacoTheme'
import { ensureWorkspaceLanguages, toMonacoLanguage } from '../languages'
import { registerStrudelLanguage } from '../../monaco/language'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DiffEditor = DiffEditorRaw as any

type Mode = 'previous' | 'current'

const fg = 'var(--foreground, #e6e6ea)'
const border = 'var(--border, #2a2a32)'
const accent = 'var(--accent, #6ea8fe)'
const bg = 'var(--background, #16161a)'

function shortId(id: string): string {
  return id.slice(0, 7)
}

export interface HistoryDiffOverlayProps {
  readonly history: ProjectHistory
  /** the commit the user clicked "Diff" on (the right/base reference). */
  readonly commit: Commit
  /** File-scope default selection (used if it's among the commit's changes). */
  readonly initialFileId?: string | null
  /**
   * Initial diff mode. Defaults to `'previous'` (what the commit changed). The
   * "Uncommitted Changes" section passes `'current'` for a live ↔ HEAD diff
   * (commit = HEAD) (#211).
   */
  readonly defaultMode?: Mode
  /**
   * File-picker scope override (#211). When given, the picker lists THESE ids
   * (the uncommitted dirty set) instead of the commit's own changeset, so a
   * working file HEAD never touched is still selectable. `getFileContentAt`
   * back-walks for the original side regardless.
   */
  readonly pickerFileIds?: readonly string[]
  readonly onClose: () => void
}

export function HistoryDiffOverlay({
  history,
  commit,
  initialFileId,
  defaultMode = 'previous',
  pickerFileIds,
  onClose,
}: HistoryDiffOverlayProps): React.ReactElement {
  const changedIds = React.useMemo(
    () => (pickerFileIds && pickerFileIds.length > 0 ? [...pickerFileIds] : Object.keys(commit.files)),
    [commit, pickerFileIds],
  )
  const [mode, setMode] = React.useState<Mode>(defaultMode)
  // Sync the mode when a reused preview slot (#210) gets a new request with a
  // different default (e.g. commit drill-down 'previous' → uncommitted 'current').
  // Fires only when `defaultMode` actually changes, so a manual toggle sticks.
  React.useEffect(() => {
    setMode(defaultMode)
  }, [defaultMode])
  const [fileId, setFileId] = React.useState<string>(() =>
    initialFileId && changedIds.includes(initialFileId) ? initialFileId : (changedIds[0] ?? ''),
  )

  // keep selection valid if the commit prop changes under us
  React.useEffect(() => {
    if (!changedIds.includes(fileId)) setFileId(changedIds[0] ?? '')
  }, [changedIds, fileId])

  // Follow an external file selection — when this viewer is hosted in a
  // reused tab/slot (#210), a new drill-down changes `initialFileId` while
  // the component stays mounted; sync the picker to it. (No-op for the
  // user's own dropdown picks since `initialFileId` doesn't change then.)
  React.useEffect(() => {
    if (initialFileId && changedIds.includes(initialFileId)) setFileId(initialFileId)
  }, [initialFileId, changedIds])

  const diffEditorRef = React.useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  const handleMount = React.useCallback(
    (editor: Monaco.editor.IStandaloneDiffEditor, monaco: typeof Monaco): void => {
      diffEditorRef.current = editor
      defineStrudelMonacoTheme(monaco)
      registerStrudelLanguage(monaco)
      ensureWorkspaceLanguages(monaco)
      monaco.editor.setTheme('stave-dark')
    },
    [],
  )

  // Reset the widget's model BEFORE Monaco disposes the text models on
  // unmount — otherwise the DiffEditorWidget tears down in the wrong order
  // ("TextModel got disposed before DiffEditorWidget model got reset") when
  // the host tab is closed or switched away (#210).
  React.useEffect(() => {
    return () => {
      try {
        diffEditorRef.current?.setModel(null)
      } catch {
        /* already disposed — nothing to reset */
      }
    }
  }, [])

  const wrap: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    background: bg,
    zIndex: 5,
  }
  const headerRow: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap', // narrow side panel — controls wrap instead of overflowing
    gap: 6,
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: `1px solid ${border}`,
    fontSize: 12,
    color: fg,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  }
  const ctl: React.CSSProperties = {
    background: 'transparent',
    color: fg,
    border: `1px solid ${border}`,
    borderRadius: 4,
    padding: '2px 6px',
    fontSize: 11,
    cursor: 'pointer',
  }

  if (changedIds.length === 0) {
    return (
      <div style={wrap} data-history-diff-overlay>
        <div style={headerRow}>
          <span style={{ flex: 1 }}>Diff · {shortId(commit.id)}</span>
          <button style={ctl} onClick={onClose} data-history-diff-close>
            Close
          </button>
        </div>
        <div style={{ padding: 16, color: 'var(--foreground-muted, #a0a0aa)', fontSize: 12 }}>
          This commit changed no files (label-only checkpoint).
        </div>
      </div>
    )
  }

  const lang = toMonacoLanguage(history.fileMeta[fileId]?.language ?? 'strudel')
  const parent = commit.parent
  const original =
    mode === 'previous'
      ? (parent ? getFileContentAt(history, fileId, parent) : null)
      : getFileContentAt(history, fileId, commit.id)
  const modified =
    mode === 'current'
      ? getLiveFileContent(fileId)
      : getFileContentAt(history, fileId, commit.id)

  return (
    <div style={wrap} data-history-diff-overlay>
      <div style={headerRow}>
        <select
          aria-label="diff file"
          value={fileId}
          onChange={(e) => setFileId(e.target.value)}
          style={ctl}
          data-history-diff-file
        >
          {changedIds.map((id) => (
            <option key={id} value={id}>
              {history.fileMeta[id]?.path ?? id}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden' }}>
          {(['previous', 'current'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              data-history-diff-mode={m}
              style={{
                ...ctl,
                border: 'none',
                borderRadius: 0,
                background: mode === m ? accent : 'transparent',
                color: mode === m ? '#0b0b0f' : fg,
              }}
            >
              {m === 'previous' ? 'vs previous' : 'vs current'}
            </button>
          ))}
        </div>
        <span style={{ flex: 1, color: 'var(--foreground-muted, #a0a0aa)' }}>
          {mode === 'previous'
            ? `${parent ? shortId(parent) : '∅'} → ${shortId(commit.id)}`
            : `${shortId(commit.id)} → current`}
        </span>
        <button style={ctl} onClick={onClose} data-history-diff-close>
          Close
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditor
          height="100%"
          language={lang}
          original={original ?? ''}
          modified={modified ?? ''}
          onMount={handleMount}
          options={{
            readOnly: true,
            // Hosted full-width in the main editor area now (#210) — there's
            // room for a proper side-by-side diff.
            renderSideBySide: true,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 12,
            scrollBeyondLastLine: false,
            renderOverviewRuler: false,
          }}
        />
      </div>
    </div>
  )
}
