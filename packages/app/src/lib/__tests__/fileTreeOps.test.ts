import { describe, expect, it } from 'vitest'

import {
  foldersEmptiedBy,
  foldersUnder,
  isPlaceholder,
  nextFreeCopyPath,
  pathTaken,
  placeItem,
  renameFolder,
  type Entry,
  type FileRef,
} from '../fileTreeOps'

const files: FileRef[] = [
  { id: 'p', path: 'pattern.strudel' },
  { id: 'a', path: 'preset/viz/a.p5' },
  { id: 'b', path: 'preset/viz/b.p5' },
  { id: 'c', path: 'preset/viz/c.p5' },
  { id: 'k', path: 'preset/viz/deep/k.p5' },
]

// What the tree shows: alphabetical, folders first, except the top level,
// which the template ordered with the file first.
const shown = (folder: string): Entry[] =>
  ({
    '': ['f:p', 'd:preset'],
    preset: ['d:viz'],
    'preset/viz': ['d:deep', 'f:a', 'f:b', 'f:c'],
  })[folder] ?? []

describe('pathTaken (#2090)', () => {
  it('sees a file at the path and a folder living there', () => {
    expect(pathTaken(files, 'pattern.strudel')).toBe(true)
    expect(pathTaken(files, 'preset')).toBe(true)
    expect(pathTaken(files, 'preset/viz/deep')).toBe(true)
    expect(pathTaken(files, 'preset/vi')).toBe(false)
    expect(pathTaken(files, 'preset/viz/a.p')).toBe(false)
  })
  it('does not count the files being moved', () => {
    expect(pathTaken(files, 'pattern.strudel', new Set(['p']))).toBe(false)
  })
})

describe('nextFreeCopyPath (#2090)', () => {
  it('counts up past the copies that exist', () => {
    expect(nextFreeCopyPath(files, 'preset/viz/a.p5')).toBe('preset/viz/a copy.p5')
    const more = [...files, { id: 'x', path: 'preset/viz/a copy.p5' }, { id: 'y', path: 'preset/viz/a copy 2.p5' }]
    expect(nextFreeCopyPath(more, 'preset/viz/a.p5')).toBe('preset/viz/a copy 3.p5')
    expect(nextFreeCopyPath(files, 'README')).toBe('README copy')
  })
})

describe('placeItem — reorder within a folder (#2089)', () => {
  it('starts from the order shown, so only the dragged item moves', () => {
    const r = placeItem({ files, item: { kind: 'file', fileId: 'c' }, targetParent: 'preset/viz', anchor: 'f:a', position: 'above', shownOrder: shown })
    expect(r.ok && r.order).toEqual({ parent: 'preset/viz', entries: ['d:deep', 'f:c', 'f:a', 'f:b'] })
    expect(r.ok && r.renames).toEqual([])
  })
  it('does nothing for a drop that changes nothing', () => {
    expect(placeItem({ files, item: { kind: 'file', fileId: 'a' }, targetParent: 'preset/viz', anchor: 'f:b', position: 'above', shownOrder: shown })).toEqual({ ok: false, reason: null })
    expect(placeItem({ files, item: { kind: 'file', fileId: 'a' }, targetParent: 'preset/viz', anchor: 'f:a', position: 'below', shownOrder: shown })).toEqual({ ok: false, reason: null })
    expect(placeItem({ files, item: { kind: 'file', fileId: 'a' }, targetParent: 'preset/viz', anchor: null, position: 'below', shownOrder: shown })).toEqual({ ok: false, reason: null })
  })
})

describe('placeItem — across folders (#2089)', () => {
  it('moves a file dropped beside a file in another folder, at that spot', () => {
    const r = placeItem({ files, item: { kind: 'file', fileId: 'p' }, targetParent: 'preset/viz', anchor: 'f:b', position: 'below', shownOrder: shown })
    expect(r.ok && r.renames).toEqual([{ id: 'p', path: 'preset/viz/pattern.strudel' }])
    expect(r.ok && r.order?.entries).toEqual(['d:deep', 'f:a', 'f:b', 'f:p', 'f:c'])
    expect(r.ok && r.leftParent).toEqual({ parent: '', entry: 'f:p' })
  })
  it('moves a folder beside a file at the top level', () => {
    const r = placeItem({ files, item: { kind: 'folder', folderPath: 'preset/viz' }, targetParent: '', anchor: 'f:p', position: 'above', shownOrder: shown })
    expect(r.ok && r.renames.map((x) => x.path)).toEqual(['viz/a.p5', 'viz/b.p5', 'viz/c.p5', 'viz/deep/k.p5'])
    expect(r.ok && r.order?.entries).toEqual(['d:viz', 'f:p', 'd:preset'])
    expect(r.ok && r.carryOrders).toEqual({ from: 'preset/viz', to: 'viz' })
  })
  it('keeps the folder a move empties', () => {
    const r = placeItem({ files, item: { kind: 'folder', folderPath: 'preset/viz' }, targetParent: '', anchor: null, position: 'below', shownOrder: shown })
    expect(r.ok && r.keepFolder).toBe('preset')
    const r2 = placeItem({ files, item: { kind: 'file', fileId: 'a' }, targetParent: '', anchor: null, position: 'below', shownOrder: shown })
    expect(r2.ok && r2.keepFolder).toBe(null) // b and c are still there
  })
  it('refuses a move onto a taken name, and a folder into itself', () => {
    const clash = [...files, { id: 's', path: 'a.p5' }]
    expect(placeItem({ files: clash, item: { kind: 'file', fileId: 'a' }, targetParent: '', anchor: null, position: 'below', shownOrder: shown })).toEqual({ ok: false, reason: '"a.p5" already exists in the top level.' })
    expect(placeItem({ files, item: { kind: 'folder', folderPath: 'preset' }, targetParent: 'preset/viz', anchor: null, position: 'below', shownOrder: shown })).toEqual({ ok: false, reason: '"preset" can\'t go inside itself.' })
    // released where it started: silent
    expect(placeItem({ files, item: { kind: 'folder', folderPath: 'preset' }, targetParent: 'preset', anchor: null, position: 'below', shownOrder: shown })).toEqual({ ok: false, reason: null })
  })
})

describe('renameFolder (#2089, #2090)', () => {
  it('renames everything under it and carries its order', () => {
    const r = renameFolder(files, 'preset/viz', 'vis')
    expect(r.ok && r.renames.map((x) => x.path)).toEqual(['preset/vis/a.p5', 'preset/vis/b.p5', 'preset/vis/c.p5', 'preset/vis/deep/k.p5'])
    expect(r.ok && r.carryOrders).toEqual({ from: 'preset/viz', to: 'preset/vis' })
    expect(r.ok && r.parentEntry).toEqual({ parent: 'preset', from: 'd:viz', to: 'd:vis' })
  })
  it('refuses a name a sibling has', () => {
    const more = [...files, { id: 'x', path: 'x/.keep' }]
    expect(renameFolder(more, 'x', 'preset')).toEqual({ ok: false, reason: '"preset" already exists in the top level.' })
    expect(renameFolder(more, 'x', 'pattern.strudel')).toEqual({ ok: false, reason: '"pattern.strudel" already exists in the top level.' })
  })
})

describe('foldersUnder', () => {
  it('lists the folder and every folder below it', () => {
    expect(foldersUnder(files, 'preset').sort()).toEqual(['preset', 'preset/viz', 'preset/viz/deep'])
  })
})

describe('foldersEmptiedBy (#2089)', () => {
  it('keeps the folder a delete empties, and only that one', () => {
    // deleting viz (and deep inside it) empties preset
    const viz = new Set(['a', 'b', 'c', 'k'])
    expect(foldersEmptiedBy(files, viz, 'preset/viz')).toEqual(['preset'])
    // deleting a, b, c leaves deep/k: viz is not empty
    expect(foldersEmptiedBy(files, new Set(['a', 'b', 'c']))).toEqual([])
    // deleting k empties deep
    expect(foldersEmptiedBy(files, new Set(['k']))).toEqual(['preset/viz/deep'])
    // a top-level file empties no folder
    expect(foldersEmptiedBy(files, new Set(['p']))).toEqual([])
  })
})

describe('isPlaceholder', () => {
  it('is the .keep file and nothing else', () => {
    expect(isPlaceholder('x/.keep')).toBe(true)
    expect(isPlaceholder('.keep')).toBe(true)
    expect(isPlaceholder('x/a.keep')).toBe(false)
    expect(isPlaceholder('x/.keeps')).toBe(false)
  })
})
