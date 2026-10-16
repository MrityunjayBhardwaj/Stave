/**
 * Project undo covers a reorder (#2089).
 *
 * The Files panel writes every reorder to the mixed `childOrder` map. The
 * structural undo manager tracked `files`, `fileOrder` and `subfolderOrder`
 * only, so ⌘Z after a drag undid a move between folders but never a reorder.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  __resetWorkspaceFilesForTests,
  createWorkspaceFile,
  getChildOrder,
  getFile,
  renameWorkspaceFile,
  setChildOrder,
} from '../WorkspaceFile'
import { canUndo, resetUndoManager, undo, withStructBatch } from '../undoManager'

describe('project undo and the Files panel order (#2089)', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    resetUndoManager()
    createWorkspaceFile('a', 'a.p5', '', 'p5')
    createWorkspaceFile('b', 'b.p5', '', 'p5')
    canUndo() // the manager exists before the edit, as the app's undo-state subscription makes it
  })

  it('undoes a reorder', () => {
    withStructBatch(() => setChildOrder('', ['f:b', 'f:a']))
    expect(getChildOrder('')).toEqual(['f:b', 'f:a'])
    expect(undo()).toBe(true)
    expect(getChildOrder('')).toEqual([])
  })

  it('undoes a move and its placement as one step', () => {
    withStructBatch(() => {
      renameWorkspaceFile('a', 'dir/a.p5')
      setChildOrder('dir', ['f:a'])
    })
    expect(undo()).toBe(true)
    expect(getFile('a')?.path).toBe('a.p5')
    expect(getChildOrder('dir')).toEqual([])
  })
})
