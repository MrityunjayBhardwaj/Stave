/**
 * The places where Vim and Monaco meet, made to behave as Vim does (#2557). Each piece is
 * used by `attachVim` (`module.ts`) on one editor, and each undoes itself when Vim goes.
 *
 *  - ONE UNDO PER INSERT (`oneUndoPerInsert`). In Vim everything typed between `i` and Esc
 *    is one change, so one `u` undoes it. Monaco closes its undo step on its own as you
 *    type: between a word and a space, before Enter, before Backspace (its cursor calls the
 *    model's `pushStackElement` from inside each typing command). Monaco has no option or
 *    event to keep a step open, so while this editor's Vim is in insert mode, that model's
 *    `pushStackElement` is set aside (an own property, on that model only), and Vim closes
 *    the step itself on the way in and on the way out. When the command that entered
 *    insert mode made an edit of its own (`cw`, `o`, `S`), the step it made is opened
 *    again (`popStackElement`), so the edit and the typing are one change, as in Vim.
 *
 *  - ESC WITH A COMMAND HALF TYPED (`hasPendingInput`). `d` then Esc cancels the `d`. Vim
 *    does that, but monaco-vim then lets the Esc go on, so it reached Stave (and could leave
 *    zen mode). An Esc that cancels something is Vim's alone; an Esc with nothing to cancel
 *    still reaches Stave.
 *
 *  - ESC WITH THE SUGGESTION LIST OPEN (`suggestListOpen`). monaco-vim answers Esc before
 *    Monaco's own keys, so Esc in insert mode left insert mode and kept the list open. Now,
 *    with the list open, Esc is Monaco's: it closes the list and insert mode stays, as in
 *    VS Code's Vim. The next Esc leaves insert mode.
 *
 *  - SWITCHED OFF, NO CONTEXT KEY LEFT (`removeContextKeys`). monaco-vim makes an
 *    `insertMode` context key on the editor and never takes it away.
 */
import type * as Monaco from 'monaco-editor'

type Editor = Monaco.editor.IStandaloneCodeEditor
type Model = Monaco.editor.ITextModel

/** The context keys monaco-vim makes on an editor (its `createContextKey` calls). */
export const VIM_CONTEXT_KEYS = ['insertMode'] as const

/** What is said when an edit is tried in a read-only editor (the history view). */
export const PAST_VERSION = 'This is a past version, so it can’t be changed here'

export interface InsertUndo {
  /** Insert mode began. `joinLast`: the command that began it made an edit just now. */
  enter(joinLast: boolean): void
  /** Insert mode ended (or Vim is going): close the step, and put the model back. */
  exit(): void
}

/** Keep everything typed in one insert as one undo step, on this editor. */
export function oneUndoPerInsert(editor: Pick<Editor, 'getModel'>): InsertUndo {
  let held: { model: Model; own: PropertyDescriptor | undefined } | null = null
  const release = () => {
    if (!held) return
    const { model, own } = held
    held = null
    if (own) Object.defineProperty(model, 'pushStackElement', own)
    else delete (model as { pushStackElement?: unknown }).pushStackElement
    model.pushStackElement()
  }
  return {
    enter(joinLast) {
      release()
      const model = editor.getModel()
      if (!model) return
      if (joinLast) model.popStackElement()
      else model.pushStackElement()
      held = { model, own: Object.getOwnPropertyDescriptor(model, 'pushStackElement') }
      Object.defineProperty(model, 'pushStackElement', { value: () => undefined, configurable: true, writable: true })
    },
    exit: release,
  }
}

/** monaco-vim's state of the keys typed so far (its `InputState`), as far as it is read here. */
export interface VimInputState {
  keyBuffer?: string | readonly string[]
  operator?: string | null
  prefixRepeat?: readonly string[]
  motionRepeat?: readonly string[]
  registerName?: string | null
}

/** Is a command half typed (a count, a register, an operator, the start of a key sequence)? */
export function hasPendingInput(s: VimInputState | null | undefined): boolean {
  if (!s) return false
  return (
    String(s.keyBuffer ?? '').length > 0 ||
    !!s.operator ||
    (s.prefixRepeat?.length ?? 0) > 0 ||
    (s.motionRepeat?.length ?? 0) > 0 ||
    !!s.registerName
  )
}

/**
 * Is the editor's suggestion list showing? Monaco keeps it in the editor's own element and
 * hides it with `visibility: hidden` (and `display: none` before it first shows).
 */
export function suggestListOpen(editor: Pick<Editor, 'getDomNode'>): boolean {
  const el = editor.getDomNode()?.querySelector<HTMLElement>('.suggest-widget')
  if (!el) return false
  return el.style.visibility !== 'hidden' && el.style.display !== 'none'
}

/**
 * Take away the context keys monaco-vim made on this editor. A key made with no default is
 * removed from the editor's context as it is made (Monaco's `ContextKey.reset`), so the
 * editor's context is as it was before Vim came.
 */
export function removeContextKeys(editor: Pick<Editor, 'createContextKey'>): void {
  for (const key of VIM_CONTEXT_KEYS) {
    editor.createContextKey(key, undefined as unknown as boolean)
  }
}
