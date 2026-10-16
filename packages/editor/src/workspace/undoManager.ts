/**
 * Project-level undo manager — wraps Y.UndoManager so the app can
 * offer undo/redo for STRUCTURAL operations (file create/delete/rename,
 * folder reorder). Text-content typing is NOT tracked here because
 * Monaco has its own in-editor undo stack; surfacing those here would
 * double-undo and cause confusing UX.
 *
 * The scope is the set of top-level Y maps (files / fileOrder /
 * subfolderOrder / childOrder — the last is where the Files panel writes
 * every reorder, so without it ⌘Z never undid one, #2089). The `trackedOrigins` is a sentinel Symbol — structural
 * ops wrap their `doc.transact` calls with this origin so content-typing
 * transactions (which use `null` / framework origins) are ignored.
 */

import * as Y from 'yjs'
import { getActiveDoc } from './projectDoc'

/** Sentinel origin for structural transactions — pass as second arg to doc.transact. */
export const STRUCT_ORIGIN = Symbol.for('stave:struct')

/**
 * Run `fn` inside a single structural transaction so every store
 * mutation it triggers (rename + folder-order updates, etc.) collapses
 * into ONE undo stack item instead of fanning into N items. Nested
 * transacts piggyback on the outer one — callers just call the
 * existing store functions as usual.
 */
export function withStructBatch<T>(fn: () => T): T {
  const doc = getActiveDoc()
  let out: T | undefined
  doc.transact(() => { out = fn() }, STRUCT_ORIGIN)
  return out as T
}

type Listener = () => void

let active: {
  um: Y.UndoManager
  listeners: Set<Listener>
  cleanup: () => void
} | null = null

function ensureUndoManager(): Y.UndoManager {
  if (active) return active.um
  const doc = getActiveDoc()
  const files = doc.getMap('files') as Y.Map<Y.Map<unknown>>
  const fileOrder = doc.getMap('fileOrder') as Y.Map<Y.Array<string>>
  const subfolderOrder = doc.getMap('subfolderOrder') as Y.Map<Y.Array<string>>
  const childOrder = doc.getMap('childOrder') as Y.Map<Y.Array<string>>
  // Include every existing inner file-map in the scope so deep changes
  // to a file's `path` / `meta` fields are captured too. Y.UndoManager's
  // scope check compares `transaction.changedParentTypes` against
  // `scope` by direct match — ancestors don't auto-bubble — so we have
  // to track inner maps explicitly.
  const um = new Y.UndoManager([files, fileOrder, subfolderOrder, childOrder], {
    trackedOrigins: new Set([STRUCT_ORIGIN]),
    captureTimeout: 300,
  })
  for (const inner of files.values()) {
    if (inner instanceof Y.Map) um.addToScope(inner)
  }
  // Track new file maps as they appear.
  const filesObserver = (event: Y.YMapEvent<Y.Map<unknown>>) => {
    for (const [key, change] of event.changes.keys) {
      if (change.action === 'add' || change.action === 'update') {
        const val = files.get(key)
        if (val instanceof Y.Map) um.addToScope(val)
      }
    }
  }
  files.observe(filesObserver)
  const listeners = new Set<Listener>()
  const notify = () => {
    for (const l of listeners) l()
  }
  const onStackItemAdded = () => notify()
  const onStackItemPopped = () => notify()
  const onStackCleared = () => notify()
  um.on('stack-item-added', onStackItemAdded)
  um.on('stack-item-popped', onStackItemPopped)
  um.on('stack-cleared', onStackCleared)
  active = {
    um,
    listeners,
    cleanup: () => {
      um.off('stack-item-added', onStackItemAdded)
      um.off('stack-item-popped', onStackItemPopped)
      um.off('stack-cleared', onStackCleared)
      files.unobserve(filesObserver)
      um.destroy()
    },
  }
  return um
}

/** Call when the active project Y.Doc changes so the undo stack rebuilds. */
export function resetUndoManager(): void {
  if (active) {
    active.cleanup()
    active = null
  }
}

export function undo(): boolean {
  const um = ensureUndoManager()
  const result = um.undo()
  return result !== null
}

export function redo(): boolean {
  const um = ensureUndoManager()
  const result = um.redo()
  return result !== null
}

export function canUndo(): boolean {
  const um = ensureUndoManager()
  return um.undoStack.length > 0
}

export function canRedo(): boolean {
  const um = ensureUndoManager()
  return um.redoStack.length > 0
}

export function subscribeToUndoState(cb: Listener): () => void {
  ensureUndoManager()
  const listeners = active!.listeners
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
