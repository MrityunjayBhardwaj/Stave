/**
 * HistoryViewOverlay — read-only "time-travel" reader over the project commit
 * store (Phase β subset, #204). Launched by the History panel's View action.
 *
 * Shows the project AS IT WAS at a commit: a read-only Monaco editor of any
 * file's content at that point (file picker over every file alive at the
 * commit, reconstructed via `snapshotAt`'s parent back-walk), with a clear
 * "Viewing <id> · Exit" frame. Exit returns to the live commit list.
 *
 * Scope note (#204): this is the editor-only slice of β time-travel — you can
 * READ the historical state. Making the RUNTIME (audio + inline viz) follow the
 * viewed commit is a separate, larger change (a non-destructive override across
 * the editor / namedViz / runtime read paths) tracked as the remainder of #204.
 *
 * Monaco lifecycle: `automaticLayout: true` re-measures on container resize
 * (the offsetWidth gotcha), so the overlay lives in the elastic bottom panel.
 */

import * as React from 'react'
// @monaco-editor/react ships React-18 types; cast to any for React 19 JSX
// (same pattern as EditorView / HistoryDiffOverlay).
import EditorRaw from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { snapshotAt, type ProjectHistory, type Commit } from './historyGraph'
import { defineStrudelMonacoTheme } from '../../theme/monacoTheme'
import { ensureWorkspaceLanguages, toMonacoLanguage } from '../languages'
import { registerStrudelLanguage } from '../../monaco/language'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Editor = EditorRaw as any

const fg = 'var(--foreground, #e6e6ea)'
const muted = 'var(--foreground-muted, #a0a0aa)'
const border = 'var(--border, #2a2a32)'
const accent = 'var(--accent, #6ea8fe)'
const bg = 'var(--background, #16161a)'

function shortId(id: string): string {
  return id.slice(0, 7)
}

export interface HistoryViewOverlayProps {
  readonly history: ProjectHistory
  /** the commit being viewed (its full reconstructed state is shown). */
  readonly commit: Commit
  /** File-scope default selection (used if it existed at the commit). */
  readonly initialFileId?: string | null
  readonly onClose: () => void
}

export function HistoryViewOverlay({
  history,
  commit,
  initialFileId,
  onClose,
}: HistoryViewOverlayProps): React.ReactElement {
  const snapshot = React.useMemo(() => snapshotAt(history, commit.id), [history, commit])
  const fileIds = React.useMemo(() => Object.keys(snapshot.files), [snapshot])
  const [fileId, setFileId] = React.useState<string>(() =>
    initialFileId && fileIds.includes(initialFileId) ? initialFileId : (fileIds[0] ?? ''),
  )

  React.useEffect(() => {
    if (!fileIds.includes(fileId)) setFileId(fileIds[0] ?? '')
  }, [fileIds, fileId])

  // Follow an external file selection when hosted in a reused tab (#210).
  React.useEffect(() => {
    if (initialFileId && fileIds.includes(initialFileId)) setFileId(initialFileId)
  }, [initialFileId, fileIds])

  const handleMount = React.useCallback(
    (_editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco): void => {
      defineStrudelMonacoTheme(monaco)
      registerStrudelLanguage(monaco)
      ensureWorkspaceLanguages(monaco)
      monaco.editor.setTheme('stave-dark')
    },
    [],
  )

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
    gap: 8,
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

  return (
    <div style={wrap} data-history-view-overlay={commit.id}>
      <div style={headerRow}>
        <span
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: accent,
            border: `1px solid ${accent}`,
            borderRadius: 10,
            padding: '1px 7px',
          }}
        >
          ⏱ Viewing {shortId(commit.id)}
        </span>
        {fileIds.length > 0 ? (
          <select
            aria-label="view file"
            value={fileId}
            onChange={(e) => setFileId(e.target.value)}
            style={ctl}
            data-history-view-file
          >
            {fileIds.map((id) => (
              <option key={id} value={id}>
                {history.fileMeta[id]?.path ?? id}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: muted }}>no files at this commit</span>
        )}
        <span style={{ flex: 1, color: muted }}>read-only snapshot</span>
        <button style={{ ...ctl, borderColor: accent }} onClick={onClose} data-history-view-exit>
          Exit
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {fileIds.length > 0 ? (
          <Editor
            height="100%"
            language={toMonacoLanguage(history.fileMeta[fileId]?.language ?? 'strudel')}
            value={snapshot.files[fileId] ?? ''}
            path={`history:${commit.id}:${fileId}`}
            onMount={handleMount}
            options={{
              readOnly: true,
              domReadOnly: true,
              automaticLayout: true,
              minimap: { enabled: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              renderLineHighlight: 'none',
            }}
          />
        ) : (
          <div style={{ padding: 16, color: muted, fontSize: 12 }}>
            This commit has no files to view.
          </div>
        )}
      </div>
    </div>
  )
}
