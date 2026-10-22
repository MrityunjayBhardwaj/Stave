/**
 * useActiveWriter — the active editor and the writer bound to it (#1909).
 *
 * The one copy of the binding every write-back surface starts from: follow the
 * active Monaco editor, and build a writer for it (`createWriter`, the door's
 * construction) whenever it changes. `useActiveChunk` (the cursor panels) and
 * `useMixerModel` (the strips) both sit on it, so the two can't drift.
 *
 * Each caller gets its OWN writer. That is load-bearing: `isCommitting(writer)`
 * answers for one writer only, so a panel skips re-reading the document after its
 * own write but still re-reads after a write made through another surface.
 *
 * `editor` is state (effects that subscribe to it re-run when it changes);
 * `editorRef` / `writerRef` are the same values for synchronous reads inside event
 * handlers, set in this hook's effect before any later effect of the caller runs.
 */
import * as React from 'react'

import { getActiveEditor, onActiveEditorChange } from '../workspace/editorRegistry'
import { createWriter, type Writeback } from '../codeView'

export interface ActiveWriter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorRef: React.MutableRefObject<any>
  writerRef: React.MutableRefObject<Writeback | null>
}

export function useActiveWriter(): ActiveWriter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editor, setEditor] = React.useState<any>(() => getActiveEditor())
  const editorRef = React.useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const writerRef = React.useRef<Writeback | null>(null)

  // Track the active editor.
  React.useEffect(() => {
    setEditor(getActiveEditor())
    return onActiveEditorChange(() => setEditor(getActiveEditor()))
  }, [])

  // (Re)build the writer when the active editor changes.
  React.useEffect(() => {
    editorRef.current = editor
    writerRef.current = editor ? createWriter(editor) : null
  }, [editor])

  return { editor, editorRef, writerRef }
}
