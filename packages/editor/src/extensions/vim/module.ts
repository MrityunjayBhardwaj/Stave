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
 *    refuses insert mode, and Monaco refuses every edit; moving, search and yank work;
 *  - switched off, or the editor closing, undoes all of it: the Vim is disposed, the bar
 *    strip goes (the host removes it), and the cursor options Vim changed are put back as
 *    they were before Vim came (monaco-vim would otherwise leave them at its own defaults).
 *
 * `:w`, `:q` and friends say "Stave saves as you type" and do nothing else (`SAVE_COMMANDS`).
 */
import { initVimMode, VimMode } from 'monaco-vim'
import type * as Monaco from 'monaco-editor'
import type { CodeEditor, ExtensionHost, ExtensionModule } from '../types'
import { VimBar } from './bar'
import { useMonaco } from './monacoApi'

/** What `:w` and friends say. */
export const SAVES_AS_YOU_TYPE = 'Stave saves as you type'

/**
 * The Ex commands that save or quit, as `[name, shortest prefix]` (Vim's own names): each
 * says `SAVES_AS_YOU_TYPE` and does nothing else. `:q!` and `:w!` run these too (the `!` is
 * read as the command's argument).
 */
export const SAVE_COMMANDS: readonly (readonly [string, string])[] = [
  ['write', 'w'],
  ['wq', 'wq'],
  ['wall', 'wa'],
  ['wqall', 'wqa'],
  ['xit', 'x'],
  ['xall', 'xa'],
  ['update', 'up'],
  ['quit', 'q'],
  ['qall', 'qa'],
  ['quitall', 'quita'],
]

interface VimApi {
  defineEx(name: string, prefix: string, fn: (cm: { openNotification(text: string): void }) => void): void
}

let exDefined = false

/** Teach Vim's one command table (shared by every editor) the save commands, once per page. */
function defineSaveCommands(): void {
  if (exDefined) return
  const vim = (VimMode as unknown as { Vim: VimApi }).Vim
  for (const [name, prefix] of SAVE_COMMANDS) {
    vim.defineEx(name, prefix, (cm) => cm.openNotification(SAVES_AS_YOU_TYPE))
  }
  exDefined = true
}

type Editor = Monaco.editor.IStandaloneCodeEditor

/**
 * The editor as monaco-vim sees it: the same editor, except that its key events skip any
 * keystroke `leaveAlone` says is not Vim's. Everything else is the editor itself, its
 * methods bound to it.
 */
export function keyFilteredEditor(editor: Editor, leaveAlone: (event: KeyboardEvent) => boolean): Editor {
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
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
}

/** The cursor options Vim changes, as the editor had them before Vim came. */
type CursorOptions = Pick<Monaco.editor.IEditorOptions, 'cursorWidth' | 'cursorBlinking' | 'cursorStyle'>

/** Monaco's own defaults, for an option the editor was never given. */
const CURSOR_DEFAULTS: Required<CursorOptions> = { cursorWidth: 0, cursorBlinking: 'blink', cursorStyle: 'line' }

function cursorOptions(editor: Editor): CursorOptions {
  const raw = (editor as Editor & { getRawOptions?: () => Monaco.editor.IEditorOptions }).getRawOptions?.() ?? {}
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

/** Put Vim on one editor; returns how to take it off. */
export function attachVim(ed: CodeEditor, host: Pick<ExtensionHost, 'keyOf' | 'takesKey'>): () => void {
  useMonaco(ed.monaco)
  defineSaveCommands()
  const doc = ed.bar.ownerDocument
  const node = doc.createElement('div')
  node.setAttribute('data-vim-bar', '')
  node.setAttribute('style', BAR_STYLE)
  if (ed.readOnly) node.setAttribute('data-vim-readonly', '')
  ed.bar.appendChild(node)

  const before = cursorOptions(ed.editor)
  const leaveAlone = (event: KeyboardEvent) => {
    const key = host.keyOf(event)
    return key !== null && !host.takesKey(key)
  }
  const view = keyFilteredEditor(ed.editor, leaveAlone)
  const vim = initVimMode(view, node, VimBar as never)

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
    try {
      vim.dispose()
      if (!goingAway) ed.editor.updateOptions(before)
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
