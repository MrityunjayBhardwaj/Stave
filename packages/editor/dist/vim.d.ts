import * as Monaco from 'monaco-editor';
import { C as CodeEditor, e as ExtensionHost, a as ExtensionModule } from './types-2qbwQyap.js';

/** What `:w` and friends say. */
declare const SAVES_AS_YOU_TYPE = "Stave saves as you type";
/**
 * What a saving or quitting Ex command does, as VS Code's Vim extension does it (decided
 * on #2148): writing says `SAVES_AS_YOU_TYPE` (Stave saves as you type), quitting closes
 * this editor's tab, quitting all closes every code editor's tab. Nothing is ever lost.
 */
type ExAction = 'message' | 'close' | 'closeAll';
/**
 * The Ex commands Stave answers, as `[name, shortest prefix, action]` (Vim's own names and
 * prefixes, so `:q`, `:qu`, `:quit` are one command). `:q!`, `:wq!` and the like run these
 * too: Vim reads the `!` as the command's argument.
 */
declare const EX_COMMANDS: readonly (readonly [string, string, ExAction])[];
/** What one editor's Vim can do to its editor, for the Ex commands. */
interface EditorActions {
    message(text: string): void;
    close(): void;
    closeAll(): void;
}
/** Tie a Vim to its editor's actions (and, with null, untie it). */
declare function bindEditorActions(vim: object, actions: EditorActions | null): void;
/**
 * Run an Ex command's action for the Vim it ran in. Closing waits for Vim to finish
 * handling the command (it still touches the editor after), then goes through the
 * workspace's own tab close.
 */
declare function runExAction(action: ExAction, vim: object): void;
type Editor = Monaco.editor.IStandaloneCodeEditor;
/** What `keyFilteredEditor` may change about the editor Vim is given (#2557). */
interface EditorHooks {
    /** A read-only editor: called before each edit Vim sends it (the editor still refuses it). */
    onEdit?: () => void;
    /** Vim's `u` and Ctrl+R (monaco-vim calls the model's `undo` and `redo`). */
    undo?: () => void;
    redo?: () => void;
}
/**
 * The editor as monaco-vim sees it: the same editor, except that its key events skip any
 * keystroke `leaveAlone` says is not Vim's. Everything else is the editor itself, its
 * methods bound to it, apart from what `hooks` changes: each edit Vim sends a read-only
 * editor calls `onEdit` first, and the model Vim is given has its `undo` and `redo`
 * answered by `hooks.undo` and `hooks.redo` (only Vim's own `u` and Ctrl+R; Monaco's undo
 * stack and every other caller are untouched).
 */
declare function keyFilteredEditor(editor: Editor, leaveAlone: (event: KeyboardEvent) => boolean, hooks?: EditorHooks): Editor;
/**
 * Which keystrokes Vim must leave alone: one of Vim's declared keys that is handed back
 * to Stave right now. Asked on every keystroke, so a key handed back (or given again)
 * takes effect at once.
 */
declare function leaveAloneFor(host: Pick<ExtensionHost, 'keyOf' | 'takesKey'>): (event: KeyboardEvent) => boolean;
/** Put Vim on one editor; returns how to take it off. */
declare function attachVim(ed: CodeEditor, host: Pick<ExtensionHost, 'keyOf' | 'takesKey' | 'closeAllEditors'>): () => void;
declare const vimModule: ExtensionModule;

export { EX_COMMANDS, type EditorActions, type EditorHooks, type ExAction, SAVES_AS_YOU_TYPE, attachVim, bindEditorActions, keyFilteredEditor, leaveAloneFor, runExAction, vimModule };
