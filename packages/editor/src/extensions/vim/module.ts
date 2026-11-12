/**
 * Vim keybindings in the code editor (#2148): the extension's code, loaded only when Vim is
 * switched on. The build makes this file its own `dist/vim.js`, with monaco-vim inside it,
 * so nothing here is fetched for anyone who never switches Vim on (`tsup.config.ts`).
 *
 * Its common part follows every code editor (`host.onEditor`): the code editor and the
 * read-only history view, never the side-by-side diff (which is not offered). Per editor:
 *
 *  - a Vim (monaco-vim's `initVimMode`), drawing into this extension's strip of the bar
 *    under that editor (`VimBar`), so two panes side by side each have their own bar;
 *  - a handed-back key is left alone: monaco-vim is given the editor with its key events
 *    filtered (`keyFilteredEditor`), so a keystroke that is one of Vim's declared keys and
 *    is handed back to Stave never reaches Vim, and Stave and Monaco answer it as they
 *    would with Vim off;
 *  - in a read-only editor (the history view, a commit being viewed) the bar says so, Vim
 *    refuses insert mode, and Monaco refuses every edit; moving, search and yank work. An
 *    edit tried there, `u` and Ctrl+R included, says why nothing happened (`PAST_VERSION`,
 *    #2557);
 *  - Vim's edges with Monaco and Stave behave as in Vim (#2557, `edges.ts`): Vim's `u` and
 *    Ctrl+R undo and redo one whole insert (Monaco's own undo steps are left as they are);
 *    an Esc (or Ctrl+[, Ctrl+C) that cancels a half-typed command is Vim's alone; Esc with
 *    the suggestion list open closes the list and stays in insert mode;
 *  - switched off, or the editor closing, undoes all of it: the Vim is disposed, the bar
 *    strip goes (the host removes it), the cursor options Vim changed are put back as
 *    they were before Vim came (monaco-vim would otherwise leave them at its own defaults),
 *    and the context keys monaco-vim made on the editor are taken away.
 *
 * The Ex commands that save or quit do what VS Code's Vim extension does (`EX_COMMANDS`):
 * `:w` and `:wa` say "Stave saves as you type" (it does) and nothing else; `:q`, `:wq`,
 * `:x` close the tab of the editor that ran them (in the history view, that history tab);
 * `:qa`, `:wqa`, `:xa` close every code editor's tab. Each close goes through the
 * workspace's own tab close (`CodeEditor.close`, `host.closeAllEditors`).
 */
import { initVimMode, StatusBar, VimMode } from 'monaco-vim'
import type * as Monaco from 'monaco-editor'
import type { CodeEditor, ExtensionHost, ExtensionModule } from '../types'
import { VimBar } from './bar'
import { hasPendingInput, InsertUndo, isVimEsc, PAST_VERSION, removeContextKeys, suggestListOpen, type UndoModel, type VimInputState } from './edges'
import { useMonaco } from './monacoApi'

/** What `:w` and friends say. */
export const SAVES_AS_YOU_TYPE = 'Stave saves as you type'

/**
 * What a saving or quitting Ex command does, as VS Code's Vim extension does it (decided
 * on #2148): writing says `SAVES_AS_YOU_TYPE` (Stave saves as you type), quitting closes
 * this editor's tab, quitting all closes every code editor's tab. Nothing is ever lost.
 */
export type ExAction = 'message' | 'close' | 'closeAll'

/**
 * The Ex commands Stave answers, as `[name, shortest prefix, action]` (Vim's own names and
 * prefixes, so `:q`, `:qu`, `:quit` are one command). `:q!`, `:wq!` and the like run these
 * too: Vim reads the `!` as the command's argument.
 */
export const EX_COMMANDS: readonly (readonly [string, string, ExAction])[] = [
  ['write', 'w', 'message'],
  ['wall', 'wa', 'message'],
  ['update', 'up', 'message'],
  ['quit', 'q', 'close'],
  ['wq', 'wq', 'close'],
  ['xit', 'x', 'close'],
  ['exit', 'exi', 'close'],
  ['qall', 'qa', 'closeAll'],
  ['quitall', 'quita', 'closeAll'],
  ['wqall', 'wqa', 'closeAll'],
  ['xall', 'xa', 'closeAll'],
]

/** What one editor's Vim can do to its editor, for the Ex commands. */
export interface EditorActions {
  message(text: string): void
  close(): void
  closeAll(): void
}

/**
 * Each editor's actions, keyed by the Vim on it (monaco-vim hands an Ex command the Vim
 * it ran in). Vim's command table is one per page, so this is how `:q` closes the tab of
 * the editor that ran it and no other.
 */
const actionsByVim = new WeakMap<object, EditorActions>()

/** Tie a Vim to its editor's actions (and, with null, untie it). */
export function bindEditorActions(vim: object, actions: EditorActions | null): void {
  if (actions) actionsByVim.set(vim, actions)
  else actionsByVim.delete(vim)
}

/**
 * Run an Ex command's action for the Vim it ran in. Closing waits for Vim to finish
 * handling the command (it still touches the editor after), then goes through the
 * workspace's own tab close.
 */
export function runExAction(action: ExAction, vim: object): void {
  const actions = actionsByVim.get(vim)
  if (!actions) return
  if (action === 'message') actions.message(SAVES_AS_YOU_TYPE)
  else setTimeout(action === 'close' ? actions.close : actions.closeAll, 0)
}

interface VimApi {
  defineEx(name: string, prefix: string, fn: (cm: object) => void): void
}

let exDefined = false

/** Teach Vim's one command table (shared by every editor) these commands, once per page. */
function defineExCommands(): void {
  if (exDefined) return
  const vim = (VimMode as unknown as { Vim: VimApi }).Vim
  for (const [name, prefix, action] of EX_COMMANDS) {
    vim.defineEx(name, prefix, (cm) => runExAction(action, cm))
  }
  exDefined = true
}

type Editor = Monaco.editor.IStandaloneCodeEditor

/** The parts of monaco-vim's per-editor state (`cm.state.vim`) read here; nothing writes them. */
interface VimState {
  inputState?: VimInputState
  visualMode?: boolean
  /** Replaced each time Vim runs a command it counts as an edit (an operator or an edit action). */
  lastEditInputState?: object
  /** Set by an edit action (insert, paste, join, …), undefined after an operator. */
  lastEditActionCommand?: object
}

/** The editor methods monaco-vim edits the text through. */
const EDIT_METHODS: ReadonlySet<PropertyKey> = new Set(['executeEdits', 'executeCommand', 'executeCommands'])

/** What `keyFilteredEditor` may change about the editor Vim is given (#2557). */
export interface EditorHooks {
  /** A read-only editor: called before each edit Vim sends it (the editor still refuses it). */
  onEdit?: () => void
  /** Vim's `u` and Ctrl+R (monaco-vim calls the model's `undo` and `redo`). */
  undo?: () => void
  redo?: () => void
}

/**
 * The editor as monaco-vim sees it: the same editor, except that its key events skip any
 * keystroke `leaveAlone` says is not Vim's. Everything else is the editor itself, its
 * methods bound to it, apart from what `hooks` changes: each edit Vim sends a read-only
 * editor calls `onEdit` first, and the model Vim is given has its `undo` and `redo`
 * answered by `hooks.undo` and `hooks.redo` (only Vim's own `u` and Ctrl+R; Monaco's undo
 * stack and every other caller are untouched).
 */
export function keyFilteredEditor(editor: Editor, leaveAlone: (event: KeyboardEvent) => boolean, hooks: EditorHooks = {}): Editor {
  const models = new WeakMap<object, Monaco.editor.ITextModel>()
  const vimModel = (model: Monaco.editor.ITextModel | null) => {
    if (!model || (!hooks.undo && !hooks.redo)) return model
    let seen = models.get(model)
    if (!seen) {
      seen = new Proxy(model, {
        get(target, prop) {
          if (prop === 'undo' && hooks.undo) return hooks.undo
          if (prop === 'redo' && hooks.redo) return hooks.redo
          const value = Reflect.get(target, prop, target) as unknown
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
        },
      })
      models.set(model, seen)
    }
    return seen
  }
  return new Proxy(editor, {
    get(target, prop) {
      if (prop === 'onKeyDown') {
        return (listener: (e: Monaco.IKeyboardEvent) => void) =>
          target.onKeyDown((e) => {
            if (e.browserEvent && leaveAlone(e.browserEvent)) return
            listener(e)
          })
      }
      if (prop === 'getModel') return () => vimModel(target.getModel())
      const value = Reflect.get(target, prop, target) as unknown
      if (typeof value !== 'function') return value
      const bound = (value as (...a: unknown[]) => unknown).bind(target)
      const onEdit = hooks.onEdit
      if (onEdit && EDIT_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          onEdit()
          return bound(...args)
        }
      }
      return bound
    },
  })
}

/** The cursor options Vim changes, as the editor had them before Vim came. */
type CursorOptions = Pick<Monaco.editor.IEditorOptions, 'cursorWidth' | 'cursorBlinking' | 'cursorStyle'>

/** Monaco's own defaults, for an option the editor was never given. */
const CURSOR_DEFAULTS: Required<CursorOptions> = { cursorWidth: 0, cursorBlinking: 'blink', cursorStyle: 'line' }

function cursorOptions(editor: Editor): CursorOptions {
  const raw = editor.getRawOptions()
  return {
    cursorWidth: raw.cursorWidth ?? CURSOR_DEFAULTS.cursorWidth,
    cursorBlinking: raw.cursorBlinking ?? CURSOR_DEFAULTS.cursorBlinking,
    cursorStyle: raw.cursorStyle ?? CURSOR_DEFAULTS.cursorStyle,
  }
}

const BAR_STYLE = [
  'align-items: center',
  'gap: 10px',
  'min-height: 20px',
  'padding: 1px 10px',
  'font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  'font-size: 12px',
  'line-height: 18px',
  'color: var(--foreground, #e6e6ea)',
  'background: var(--background, #16161a)',
  'border-top: 1px solid var(--border, rgba(255,255,255,0.12))',
].join('; ')

/**
 * Which keystrokes Vim must leave alone: one of Vim's declared keys that is handed back
 * to Stave right now. Asked on every keystroke, so a key handed back (or given again)
 * takes effect at once.
 */
export function leaveAloneFor(host: Pick<ExtensionHost, 'keyOf' | 'takesKey'>): (event: KeyboardEvent) => boolean {
  return (event) => {
    const key = host.keyOf(event)
    return key !== null && !host.takesKey(key)
  }
}

/** Put Vim on one editor; returns how to take it off. */
export function attachVim(ed: CodeEditor, host: Pick<ExtensionHost, 'keyOf' | 'takesKey' | 'closeAllEditors'>): () => void {
  useMonaco(ed.monaco)
  defineExCommands()
  const doc = ed.bar.ownerDocument
  const node = doc.createElement('div')
  node.setAttribute('data-vim-bar', '')
  node.setAttribute('style', BAR_STYLE)
  if (ed.readOnly) node.setAttribute('data-vim-readonly', '')
  ed.bar.appendChild(node)

  const before = cursorOptions(ed.editor)
  const handedBack = leaveAloneFor(host)
  let inInsert = false
  // Keystrokes this editor answers before Vim could (Esc closing the suggestion list).
  const notVims = new WeakSet<KeyboardEvent>()
  const leaveAlone = (event: KeyboardEvent) => handedBack(event) || notVims.has(event)

  // In a read-only editor, an edit tried says why nothing happened, once per keystroke.
  let saidForKey = false
  const sayPastVersion = () => {
    if (saidForKey) return
    saidForKey = true
    vim.openNotification(PAST_VERSION)
  }
  // the model has `undo` and `redo` (monaco-vim calls them); Monaco's typings leave them out
  const undo = new InsertUndo(() => ed.editor.getModel() as unknown as UndoModel | null)
  const view = keyFilteredEditor(ed.editor, leaveAlone, {
    onEdit: ed.readOnly ? sayPastVersion : undefined,
    undo: ed.readOnly ? sayPastVersion : () => undo.undo(),
    redo: ed.readOnly ? sayPastVersion : () => undo.redo(),
  })

  // Before Vim reads a key: where the text was (so an insert the key begins includes the
  // key's own edit, for `cw` and `o`), whether an Esc cancels a half-typed command (Vim's
  // alone), and whether it closes the suggestion list instead. What Vim did with the key is
  // read once it is done with it, in a microtask: an editor listener registered after
  // Vim's is no "after", because an edit Vim makes delivers the rest of the key event to
  // the later listeners first (Monaco's shared delivery queue).
  const vimState = () => (vim as unknown as { state?: { vim?: VimState } }).state?.vim
  let textAtKey: number | null = null
  const beforeVim = ed.editor.onKeyDown((e) => {
    saidForKey = false
    const model = ed.editor.getModel()
    const state = vimState()
    const browser = e.browserEvent
    const esc = !!browser && isVimEsc(browser) && !handedBack(browser)
    if (!inInsert && model && !ed.readOnly) {
      // each normal-mode command starts a step of its own, so an insert it begins starts on one
      model.pushStackElement()
      textAtKey = model.getAlternativeVersionId()
    }
    if (esc && inInsert && suggestListOpen(ed.editor)) {
      // the suggestion list closes, and insert mode stays (VS Code's Vim does the same)
      notVims.add(browser)
      ed.editor.trigger('vim', 'hideSuggestWidget', null)
      e.preventDefault()
      e.stopPropagation()
    } else if (browser?.key === 'Escape' && !inInsert && !state?.visualMode && hasPendingInput(state?.inputState)) {
      // Vim cancels the half-typed command; nothing else hears this Esc. (Only Esc itself
      // needs this: Ctrl+[ and Ctrl+C reach Vim as its own key mapping, which monaco-vim
      // answers and stops. Observed, with a listener on the page, #2557.)
      e.stopPropagation()
    }
    const editBefore = state?.lastEditInputState
    queueMicrotask(() => {
      textAtKey = null
      // In a read-only editor, a command that would begin an insert or edit (Vim records
      // it as its last edit, then refuses it) says why nothing happened. Edits that reach
      // the editor say it through `keyFilteredEditor`.
      const after = vimState()
      if (ed.readOnly && after?.lastEditInputState !== editBefore && after?.lastEditActionCommand) sayPastVersion()
    })
  })

  // monaco-vim types its status-bar argument as its own StatusBar class, whose private
  // fields make it nominal: no other class can match it structurally. VimBar has every
  // method monaco-vim calls on it (the unit tests drive them), so it goes in through
  // `unknown` with that type.
  const vim = initVimMode(view, node, VimBar as unknown as typeof StatusBar)
  bindEditorActions(vim, {
    message: (text) => vim.openNotification(text),
    close: () => ed.close(),
    closeAll: () => host.closeAllEditors(),
  })

  vim.on('vim-mode-change', (ev: { mode: string }) => {
    const insertNow = ev.mode === 'insert' || ev.mode === 'replace'
    if (insertNow && !inInsert) undo.enter(textAtKey ?? undefined)
    else if (!insertNow && inInsert) undo.exit()
    inInsert = insertNow
  })
  // this editor's own typing has the keyboard; anything else (the grid, another editor on
  // the same file) is not part of the insert
  const contentChange = ed.editor.onDidChangeModelContent((e) => undo.changed(e, ed.editor.hasTextFocus()))
  const modelSwap = ed.editor.onDidChangeModel(() => undo.forget())

  if (ed.readOnly) {
    // the mode label is Vim's; say "read-only" after it, where it stays
    const note = doc.createElement('span')
    note.setAttribute('data-vim-readonly-note', '')
    note.setAttribute('style', 'opacity: 0.7; white-space: pre')
    note.textContent = 'read-only'
    node.insertBefore(note, node.querySelector('[data-vim-command]'))
  }

  return () => {
    // Monaco detaches an editor's model before it fires the dispose event this runs on, so
    // no model means the editor is going away: nothing to put back, and nothing it throws
    // while it goes is worth a Console row on every tab switch.
    const goingAway = !ed.editor.getModel?.()
    bindEditorActions(vim, null)
    try {
      beforeVim.dispose()
      contentChange.dispose()
      modelSwap.dispose()
      vim.dispose()
      if (!goingAway) {
        ed.editor.updateOptions(before)
        removeContextKeys(ed.editor)
      }
    } catch (e) {
      if (!goingAway) throw e
    } finally {
      node.remove()
    }
  }
}

export const vimModule: ExtensionModule = {
  activate(host) {
    host.onEditor((ed) => attachVim(ed, host))
  },
}
