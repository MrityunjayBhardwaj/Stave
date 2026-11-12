/**
 * What monaco-vim imports from `monaco-editor/esm/vs/editor/editor.api`, taken from the
 * Monaco the page already runs (#2148).
 *
 * Stave's Monaco is loaded at run time by `@monaco-editor/loader` (from `/monaco/vs`), not
 * bundled. monaco-vim imports Monaco's ESM build by path; bundled as it is, that would be
 * a second Monaco of several megabytes, whose classes are not the page's. So the build
 * points that import here (`tsup.config.ts`, and `vitest.config.ts` for tests), and the
 * Vim extension hands in the page's Monaco (`useMonaco`) before it makes its first Vim.
 *
 * The exports are live bindings: monaco-vim reads them when it runs, never when it loads.
 */
import type * as Monaco from 'monaco-editor'

export let KeyCode = undefined as unknown as typeof Monaco.KeyCode
export let Range = undefined as unknown as typeof Monaco.Range
export let Position = undefined as unknown as typeof Monaco.Position
export let Selection = undefined as unknown as typeof Monaco.Selection
export let SelectionDirection = undefined as unknown as typeof Monaco.SelectionDirection
export let editor = undefined as unknown as typeof Monaco.editor

/** Point every export at the page's Monaco. The same namespace again is a no-op. */
export function useMonaco(monaco: typeof Monaco): void {
  KeyCode = monaco.KeyCode
  Range = monaco.Range
  Position = monaco.Position
  Selection = monaco.Selection
  SelectionDirection = monaco.SelectionDirection
  editor = monaco.editor
}
