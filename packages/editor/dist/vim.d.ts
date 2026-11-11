import * as Monaco from 'monaco-editor';
import { C as CodeEditor, e as ExtensionHost, a as ExtensionModule } from './types-CBQx0xzY.js';

/** What `:w` and friends say. */
declare const SAVES_AS_YOU_TYPE = "Stave saves as you type";
/**
 * The Ex commands that save or quit, as `[name, shortest prefix]` (Vim's own names): each
 * says `SAVES_AS_YOU_TYPE` and does nothing else. `:q!` and `:w!` run these too (the `!` is
 * read as the command's argument).
 */
declare const SAVE_COMMANDS: readonly (readonly [string, string])[];
type Editor = Monaco.editor.IStandaloneCodeEditor;
/**
 * The editor as monaco-vim sees it: the same editor, except that its key events skip any
 * keystroke `leaveAlone` says is not Vim's. Everything else is the editor itself, its
 * methods bound to it.
 */
declare function keyFilteredEditor(editor: Editor, leaveAlone: (event: KeyboardEvent) => boolean): Editor;
/** Put Vim on one editor; returns how to take it off. */
declare function attachVim(ed: CodeEditor, host: Pick<ExtensionHost, 'keyOf' | 'takesKey'>): () => void;
declare const vimModule: ExtensionModule;

export { SAVES_AS_YOU_TYPE, SAVE_COMMANDS, attachVim, keyFilteredEditor, vimModule };
