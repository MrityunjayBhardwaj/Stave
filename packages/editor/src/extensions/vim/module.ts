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
 *    edit tried there says why nothing happened (`PAST_VERSION`, #2557);
 *  - Vim's edges with Monaco and Stave behave as in Vim (#2557, `edges.ts`): one insert is
 *    one undo step; an Esc that cancels a half-typed command is Vim's alone; Esc with the
 *    suggestion list open closes the list and stays in insert mode;
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
import { hasPendingInput, oneUndoPerInsert, PAST_VERSION, removeContextKeys, suggestListOpen, type VimInputState } from './edges'
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

/**
 * The editor as monaco-vim sees it: the same editor, except that its key events skip any
 * keystroke `leaveAlone` says is not Vim's. Everything else is the editor itself, its
 * methods bound to it. Given `onEdit` (a read-only editor), each edit Vim sends the editor
 * calls it first; the editor then refuses the edit as before (#2557).
 */
export function keyFilteredEditor(editor: Editor, leaveAlone: (event: KeyboardEvent) => boolean, onEdit?: () => void): Editor {
  return new Proxy(editor, {
    get(target, prop) {
      if (prop === 'onKeyDown') {
        return (listener: (e: Monaco.IKeyboardEvent) => void) =>
          target.onKeyDown((e) => {
            if (e.browserEvent && leaveAlone(e.browserEvent)) return
            listener(e)
          })
      }
      const value = Reflect.get(target, prop, target) as unknown
      if (typeof value !== 'function') return value
      const bound = (value as (...a: unknown[]) => unknown).bind(target)
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
  // Esc with the suggestion list open is Monaco's: it closes the list, and insert mode stays
  const leaveAlone = (event: KeyboardEvent) =>
    handedBack(event) || (event.key === 'Escape' && inInsert && suggestListOpen(ed.editor))
  const sayPastVersion = () => vim.openNotification(PAST_VERSION)
  const view = keyFilteredEditor(ed.editor, leaveAlone, ed.readOnly ? sayPastVersion : undefined)

  // Before Vim reads a key: what the text was (so the insert it may begin can join the
  // edit the same key made), and whether an Esc cancels a half-typed command (Vim's alone).
  // What Vim did with the key is read once it is done with it, in a microtask: an editor
  // listener registered after Vim's is no "after", because an edit Vim makes delivers the
  // rest of the key event to the later listeners first (Monaco's shared delivery queue).
  const vimState = () => (vim as unknown as { state?: { vim?: VimState } }).state?.vim
  let versionAtKey: number | null = null
  const beforeVim = ed.editor.onKeyDown((e) => {
    versionAtKey = ed.editor.getModel()?.getVersionId() ?? null
    const state = vimState()
    const editBefore = state?.lastEditInputState
    if (e.browserEvent?.key === 'Escape' && !inInsert && !state?.visualMode && hasPendingInput(state?.inputState)) {
      e.stopPropagation()
    }
    queueMicrotask(() => {
      versionAtKey = null
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

  const undo = oneUndoPerInsert(ed.editor)
  vim.on('vim-mode-change', (ev: { mode: string }) => {
    const insertNow = ev.mode === 'insert' || ev.mode === 'replace'
    if (insertNow && !inInsert) {
      const version = ed.editor.getModel()?.getVersionId() ?? null
      undo.enter(versionAtKey !== null && version !== versionAtKey)
    } else if (!insertNow && inInsert) {
      undo.exit()
    }
    inInsert = insertNow
  })
  const modelSwap = ed.editor.onDidChangeModel(() => {
    if (!inInsert) return
    undo.exit()
    undo.enter(false)
  })

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
      undo.exit()
      beforeVim.dispose()
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
