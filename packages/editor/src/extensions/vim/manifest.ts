/**
 * Vim keybindings in the code editor (#2148), as an extension: the manifest, plain data.
 *
 * It is for the editor as a whole (`languages: '*'`), so it has a common part only. Its
 * code (`module.ts`, built on monaco-vim) is a separate file in the package build
 * (`dist/vim.js`), fetched only when someone switches Vim on: `load` is the one place
 * that names it, and the build keeps that import apart (see `tsup.config.ts`).
 *
 * THE KEYS it uses are declared here (#2513), so Stave can show them and the person can
 * hand any of them back. They are spelled as Vim spells them, with `ctrl`: off a Mac that
 * is the Ctrl key, which Stave's own shortcuts also use, so inside the code Vim's keys go
 * to Vim (as in Vim and VSCodeVim) except the ones handed back by default below. On a Mac
 * `ctrl` is the Control key and Stave's shortcuts use Cmd, so the two never meet.
 *
 * Handed back by default, as decided on #2148: Play, Stop, the command palette, quick open,
 * and Ctrl+Z (VSCodeVim hands back Ctrl+Z as well). Vim leaves a handed-back key alone
 * (`module.ts` asks `host.keyOf` and `host.takesKey` on every keystroke).
 */
import type { ExtensionKey, ExtensionManifest, ExtensionModule } from '../types'

export const VIM_ID = 'vim'

const KEYS: readonly ExtensionKey[] = [
  // handed back to Stave unless the person gives them to Vim
  { key: 'ctrl+enter', name: 'Play (Stave)', where: 'code', givenBack: true },
  { key: 'ctrl+.', name: 'Stop (Stave)', where: 'code', givenBack: true },
  { key: 'ctrl+shift+p', name: 'Command palette (Stave)', where: 'code', givenBack: true },
  { key: 'ctrl+p', name: 'Quick open (Stave); in Vim, up a line', where: 'code', givenBack: true },
  { key: 'ctrl+z', name: 'Undo (Stave)', where: 'code', givenBack: true },
  // Vim's own
  { key: 'ctrl+r', name: 'Redo', where: 'code' },
  { key: 'ctrl+c', name: 'Back to normal mode', where: 'code' },
  { key: 'ctrl+[', name: 'Back to normal mode', where: 'code' },
  { key: 'ctrl+v', name: 'Visual block mode', where: 'code' },
  { key: 'ctrl+q', name: 'Visual block mode', where: 'code' },
  { key: 'ctrl+d', name: 'Half a page down', where: 'code' },
  { key: 'ctrl+u', name: 'Half a page up', where: 'code' },
  { key: 'ctrl+f', name: 'A page down', where: 'code' },
  { key: 'ctrl+b', name: 'A page up', where: 'code' },
  { key: 'ctrl+e', name: 'Scroll down a line', where: 'code' },
  { key: 'ctrl+y', name: 'Scroll up a line', where: 'code' },
  { key: 'ctrl+n', name: 'Down a line', where: 'code' },
  { key: 'ctrl+o', name: 'Jump back', where: 'code' },
  { key: 'ctrl+i', name: 'Jump forward', where: 'code' },
  { key: 'ctrl+a', name: 'Add to the number', where: 'code' },
  { key: 'ctrl+x', name: 'Subtract from the number', where: 'code' },
  { key: 'ctrl+w', name: 'Delete the word before the cursor (insert mode)', where: 'code' },
  { key: 'ctrl+t', name: 'Indent the line (insert mode)', where: 'code' },
  { key: 'ctrl+space', name: 'Next WORD', where: 'code' },
  { key: 'ctrl+backspace', name: 'Previous WORD', where: 'code' },
]

export const VIM: ExtensionManifest = {
  id: VIM_ID,
  name: 'Vim',
  description: 'Vim keybindings in the code editor',
  languages: '*',
  provides: { keys: KEYS },
  // the build turns this into `import('./vim.js')`, a file of its own (tsup.config.ts)
  load: (): Promise<ExtensionModule> => import('./module').then((m) => m.vimModule),
  about: {
    version: '0.1.0',
    experimental: true,
    icon: 'V',
    tint: 'linear-gradient(135deg, #019733, #0b5d2a)',
    summary:
      'Vim keybindings for the code editor: normal, insert and visual modes, motions, search, registers and : commands. Each editor gets a bar underneath that shows the mode and the keys you have typed.',
    readme: [
      {
        heading: 'Modes and the bar',
        text: 'Each code editor gets a bar underneath it. The mode is on the left and the keys you have typed so far are on the right. Press : to type a command in that editor’s bar. Enter runs it and Esc closes it. With two editors side by side, each has its own bar.',
      },
      {
        heading: 'Saving',
        text: 'Stave saves as you type, so :w, :q and the like show “Stave saves as you type” and do nothing else.',
      },
      {
        heading: 'Keys',
        text: 'Inside the code, Vim’s Ctrl keys go to Vim, as in Vim. Play, Stop, the command palette, quick open and Ctrl+Z still go to Stave. On a Mac, Stave’s shortcuts use Cmd, so they never meet Vim’s Ctrl keys.',
      },
      {
        heading: 'Past versions',
        text: 'In the history view you can move around, search and yank, but a past version cannot be edited. The side-by-side diff has no Vim.',
      },
    ],
    changes: [{ version: '0.1.0', note: 'First version, built on monaco-vim 0.4.4 (MIT).' }],
  },
}
