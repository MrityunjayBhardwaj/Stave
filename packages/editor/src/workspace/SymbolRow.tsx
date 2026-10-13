/**
 * SymbolRow — the characters a pattern is made of, one tap away on a phone (#2005).
 *
 * `~ * " [ ] < > ( )` sit two or three taps deep on a phone keyboard: typing
 * `s("bd*4, [~ oh]*4")` means changing keyboard layers about a dozen times. While the
 * keyboard is up on a phone held upright, with the cursor in a code file, this row
 * sits directly above it — it is the last thing in the shell, and the shell ends where
 * the keyboard begins (`visibleArea.ts`).
 *
 * A key TYPES its character: it goes through the editor's own `type` command, the one
 * a key press goes through, so the bracket and quote pairing, the over-typing of a
 * closing bracket and the undo history are the editor's and not a copy of them. Each
 * key is one undo step.
 *
 * A tap must not take the cursor out of the code — that would close the keyboard and
 * the row with it. So the row refuses the press's default (which is what moves focus)
 * and acts on the click; its buttons are not tab stops.
 *
 * Not shown: with no on-screen keyboard (a hardware keyboard never shrinks the visible
 * area, so there is no special case for it); when the keyboard was raised from
 * somewhere other than the code; in a file that is not code; held sideways, where the
 * code has four lines and a row would take two of them; on a tablet or a desktop.
 */
import * as React from 'react'

import { getActiveEditor } from './editorRegistry'
import { usePhoneLayout } from './usePhone'
import { useKeyboardUp } from './visibleArea'

/** left to right, as the issue lists them */
export const SYMBOL_ROW_KEYS: readonly string[] = ['~', '*', '"', '[', ']', '<', '>', '(', ')']

/** languages whose files are prose, not code */
const NOT_CODE: ReadonlySet<string> = new Set(['markdown', 'plaintext'])

/** the smallest control a finger hits reliably */
const TOUCH = 44

/** the editor being typed in, if it is a code file */
function codeEditorBeingTyped(): ReturnType<typeof getActiveEditor> {
  const editor = getActiveEditor()
  if (!editor?.hasTextFocus?.()) return null
  const language = editor.getModel?.()?.getLanguageId?.()
  if (!language || NOT_CODE.has(language)) return null
  return editor
}

/** type `text` at the cursor as a key press would, as one undo step */
export function typeSymbol(text: string): boolean {
  const editor = codeEditorBeingTyped()
  if (!editor) return false
  editor.pushUndoStop?.()
  editor.trigger?.('symbol-row', 'type', { text })
  editor.pushUndoStop?.()
  return true
}

export function SymbolRow(): React.ReactElement | null {
  const upright = usePhoneLayout() === 'upright'
  const keyboardUp = useKeyboardUp()
  // the row follows the cursor into and out of the code while the keyboard stays up
  const [, focusMoved] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    if (!keyboardUp) return
    document.addEventListener('focusin', focusMoved)
    document.addEventListener('focusout', focusMoved)
    return () => {
      document.removeEventListener('focusin', focusMoved)
      document.removeEventListener('focusout', focusMoved)
    }
  }, [keyboardUp])

  if (!upright || !keyboardUp || !codeEditorBeingTyped()) return null

  const keepFocus = (e: React.SyntheticEvent): void => e.preventDefault()
  return (
    <div
      data-symbol-row
      role="toolbar"
      aria-label="Pattern symbols"
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      style={{
        display: 'flex',
        flex: '0 0 auto',
        height: TOUCH,
        background: 'var(--surface, #17172a)',
        borderTop: '1px solid var(--border, #2a2a3e)',
        // the keys are dragged over by a thumb on its way to the keyboard: no page gesture starts here
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      {SYMBOL_ROW_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          tabIndex={-1}
          data-symbol-key={k}
          aria-label={`Type ${k}`}
          onClick={() => typeSymbol(k)}
          style={{
            appearance: 'none',
            flex: '1 1 0',
            minWidth: 0,
            height: '100%',
            border: 'none',
            borderRight: '1px solid var(--border, #2a2a3e)',
            background: 'transparent',
            color: 'var(--foreground, #e6e6ec)',
            fontFamily: 'var(--font-mono), ui-monospace, monospace',
            fontSize: 18,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {k}
        </button>
      ))}
    </div>
  )
}
