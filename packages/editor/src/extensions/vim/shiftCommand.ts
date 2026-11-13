/**
 * The one Monaco internal monaco-vim imports (`>>` and `<<`): a command that indents or
 * outdents one line (#2148).
 *
 * monaco-vim imports Monaco's own `ShiftCommand` from its ESM build by path. The page's
 * Monaco is loaded at run time and does not export it (see `monacoApi.ts`), so the build
 * points that import here. This does what Vim's `>>`/`<<` need, through Monaco's public
 * command interface: monaco-vim always hands it an empty selection at the start of the
 * line to shift.
 *
 * Indent: add one indent (a tab, or `indentSize` spaces) at the start of the line; an
 * empty line is left alone, as in Vim. Outdent: take away one tab, or up to `indentSize`
 * spaces, from the start of the line.
 */
import type * as Monaco from 'monaco-editor'
import { Range } from './monacoApi'

export interface ShiftOptions {
  readonly isUnshift: boolean
  readonly tabSize: number
  readonly indentSize: number
  readonly insertSpaces: boolean
}

/** What a line's leading indent is to become, as one edit; null when nothing changes. */
export function shiftEdit(line: string, opts: ShiftOptions): { from: number; to: number; text: string } | null {
  const size = Math.max(1, opts.indentSize || opts.tabSize || 1)
  if (!opts.isUnshift) {
    if (line.length === 0) return null
    return { from: 1, to: 1, text: opts.insertSpaces ? ' '.repeat(size) : '\t' }
  }
  if (line.startsWith('\t')) return { from: 1, to: 2, text: '' }
  let n = 0
  while (n < size && line[n] === ' ') n++
  return n === 0 ? null : { from: 1, to: n + 1, text: '' }
}

export class ShiftCommand implements Monaco.editor.ICommand {
  private selectionId: string | null = null

  constructor(
    private readonly selection: Monaco.Selection,
    private readonly opts: ShiftOptions,
  ) {}

  getEditOperations(model: Monaco.editor.ITextModel, builder: Monaco.editor.IEditOperationBuilder): void {
    const lineNumber = this.selection.startLineNumber
    const edit = shiftEdit(model.getLineContent(lineNumber), this.opts)
    if (edit) builder.addEditOperation(new Range(lineNumber, edit.from, lineNumber, edit.to), edit.text)
    this.selectionId = builder.trackSelection(this.selection)
  }

  computeCursorState(_model: Monaco.editor.ITextModel, helper: Monaco.editor.ICursorStateComputerData): Monaco.Selection {
    return this.selectionId ? helper.getTrackedSelection(this.selectionId) : this.selection
  }
}
