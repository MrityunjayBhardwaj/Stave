/**
 * The places where Vim and Monaco meet, made to behave as Vim does (#2557). Each piece is
 * used by `attachVim` (`module.ts`) on one editor, and each goes when Vim goes.
 *
 *  - ONE UNDO PER INSERT (`InsertUndo`). In Vim everything typed between `i` and Esc is
 *    one change, so one `u` undoes it. Monaco closes its undo step on its own as you type
 *    (between a word and a space, before Enter, before Backspace). Monaco's steps are left
 *    exactly as they are: other parts of Stave rely on them (the code view's write-back
 *    brackets each edit or drag as a step of its own). Instead Vim remembers where each
 *    insert began and ended (the model's alternative version id, which comes back to the
 *    same number when an edit is undone), and Vim's own `u` and Ctrl+R step Monaco's
 *    undo until they reach that mark. An edit that is not this insert's typing (the
 *    grid, another editor on the same file) ends the insert's span there, so it stays a
 *    step of its own, and the typing after it is a span of its own.
 *
 *  - ESC WITH A COMMAND HALF TYPED (`hasPendingInput`). `d` then Esc cancels the `d`. Vim
 *    does that, but monaco-vim then lets the Esc go on, so it reached Stave (and could
 *    leave zen mode). An Esc that cancels something is Vim's alone; an Esc with nothing to
 *    cancel still reaches Stave.
 *
 *  - ESC WITH THE SUGGESTION LIST OPEN (`suggestListOpen`). monaco-vim answers Esc before
 *    Monaco's own keys, so Esc in insert mode left insert mode with the list. Now, with
 *    the list open, Esc closes the list and insert mode stays, as in VS Code's Vim. So do
 *    Ctrl+[ and Ctrl+C, which are Esc to Vim (`isVimEsc`).
 *
 *  - SWITCHED OFF, NO CONTEXT KEY LEFT (`removeContextKeys`). monaco-vim makes an
 *    `insertMode` context key on the editor and never takes it away.
 */
import type * as Monaco from 'monaco-editor'

type Editor = Monaco.editor.IStandaloneCodeEditor

/** The context keys monaco-vim makes on an editor (its `createContextKey` calls). */
export const VIM_CONTEXT_KEYS = ['insertMode'] as const

/** What is said when an edit is tried in a read-only editor (the history view). */
export const PAST_VERSION = 'This is a past version, so it can’t be changed here'

/**
 * The model, as far as `InsertUndo` uses it. `undo` and `redo` are the model's own (Monaco's
 * public typings leave them out; monaco-vim's `u` and Ctrl+R call them).
 */
export interface UndoModel {
  getAlternativeVersionId(): number
  pushStackElement(): void
  undo(): unknown
  redo(): unknown
}

/** What a content change says about itself, as far as `InsertUndo` reads it. */
export interface ContentChange {
  isUndoing: boolean
  isRedoing: boolean
  isFlush: boolean
}

/** One stretch of an insert's typing: where it began, and every state it passed through. */
interface Span {
  start: number
  seen: Set<number>
}

/** Never undo or redo more than this many of Monaco's steps for one `u` or Ctrl+R. */
const MOST_STEPS = 10_000

/**
 * Where each insert began and ended, so Vim's `u` and Ctrl+R undo and redo it whole.
 * Monaco's undo stack itself is never changed; only Vim's `u` and Ctrl+R take several of
 * its steps at once, and only across states this insert's own typing made.
 */
export class InsertUndo {
  /** Each finished span, by the state it ended at. */
  private readonly spans = new Map<number, Span>()
  /** Spans undone, newest last, so Ctrl+R can put each back whole. */
  private readonly undone: { from: number; to: number; steps: number }[] = []
  /** The span being typed, while in insert mode. */
  private open: Span | null = null
  private last = 0

  constructor(private readonly model: () => UndoModel | null) {}

  /** Insert mode began; the insert's span begins at `start` (before the key's own edit, for `cw` and `o`). */
  enter(start?: number): void {
    const m = this.model()
    if (!m) return
    // the step before the insert ends here, so undoing the insert stops exactly here
    m.pushStackElement()
    const now = m.getAlternativeVersionId()
    const from = start ?? now
    this.open = { start: from, seen: new Set([from, now]) }
    this.last = now
  }

  /** Insert mode ended: the span ends at the current state. */
  exit(): void {
    const m = this.model()
    if (!this.open || !m) {
      this.open = null
      return
    }
    m.pushStackElement()
    this.close(m.getAlternativeVersionId())
    this.open = null
  }

  /** A content change; `own` when it is this editor's typing (the editor has the keyboard). */
  changed(e: ContentChange, own: boolean): void {
    if (e.isUndoing || e.isRedoing) {
      // an undo or redo in the middle of an insert: what came before it is a span of its own
      if (this.open) this.restartAfter()
      return
    }
    this.undone.length = 0 // a new edit: nothing is left to redo
    if (e.isFlush) {
      this.spans.clear()
      if (this.open) this.restartAfter()
      return
    }
    if (!this.open) return
    if (own) {
      this.last = this.model()?.getAlternativeVersionId() ?? this.last
      this.open.seen.add(this.last)
    } else {
      // not this insert's typing: it stays a step of its own, between two spans
      this.restartAfter()
    }
  }

  /** The editor shows another model: nothing remembered applies to it. */
  forget(): void {
    this.spans.clear()
    this.undone.length = 0
    if (this.open) this.restartAfter()
  }

  /** Vim's `u`: a whole insert when the text is where an insert ended, else one step. */
  undo(): void {
    const m = this.model()
    if (!m) return
    const end = m.getAlternativeVersionId()
    const span = this.spans.get(end)
    if (!span) {
      m.undo()
      return
    }
    let at = end
    let steps = 0
    while (at !== span.start && steps < MOST_STEPS) {
      m.undo()
      steps++
      const next = m.getAlternativeVersionId()
      if (next === at || !span.seen.has(next)) break
      at = next
    }
    if (m.getAlternativeVersionId() === span.start) this.undone.push({ from: span.start, to: end, steps })
  }

  /** Vim's Ctrl+R: the whole insert the last `u` undid, else one step. */
  redo(): void {
    const m = this.model()
    if (!m) return
    const at = m.getAlternativeVersionId()
    const plan = this.undone[this.undone.length - 1]
    if (!plan || plan.from !== at) {
      m.redo()
      return
    }
    this.undone.pop()
    let now = at
    for (let i = 0; i < plan.steps && now !== plan.to; i++) {
      m.redo()
      const next = m.getAlternativeVersionId()
      if (next === now) break
      now = next
    }
  }

  private close(end: number): void {
    if (this.open && end !== this.open.start) {
      this.open.seen.add(end)
      this.spans.set(end, this.open)
    }
  }

  /** End the open span where this insert's typing last left it, and begin a new one now. */
  private restartAfter(): void {
    const m = this.model()
    if (!this.open || !m) return
    this.close(this.last)
    const now = m.getAlternativeVersionId()
    this.open = { start: now, seen: new Set([now]) }
    this.last = now
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
 * Is this keystroke Esc to Vim? Esc itself, and Ctrl+[ and Ctrl+C, which monaco-vim's
 * keymap turns into Esc. (A Ctrl key handed back to Stave never reaches Vim, so the caller
 * asks this only of keys Vim gets.)
 */
export function isVimEsc(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (event.key === 'Escape') return true
  if (!event.ctrlKey || event.metaKey || event.altKey) return false
  return event.key === '[' || event.code === 'BracketLeft' || event.key.toLowerCase() === 'c'
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
