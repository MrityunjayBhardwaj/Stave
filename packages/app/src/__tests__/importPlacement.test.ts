/**
 * Where an imported share lands in the open project (#2288): under `shared/<when>/`,
 * with new ids, its order kept, and never on top of anything already there.
 */
import { describe, expect, it } from 'vitest'
import { folderNameFor, placeImport, type ImportSource } from '../importPlacement'

const at = new Date(2026, 10, 3, 14, 5).getTime()
const when = '2026-11-03 14-05'

const source = (over: Partial<ImportSource> = {}): ImportSource => ({
  sharedAt: at,
  files: [
    { id: 'a', path: 'drums.strudel', language: 'strudel', content: 's("bd")' },
    { id: 'b', path: 'bass.strudel', language: 'strudel', content: 'note("c2")' },
    { id: 'c', path: 'viz/scope.js', language: 'javascript', content: '' },
  ],
  fileOrder: { '': ['b', 'a'], viz: ['c'] },
  subfolderOrder: { '': ['viz'] },
  ...over,
})

const ids = (): (() => string) => {
  let n = 0
  return () => `new${++n}`
}

describe('placeImport', () => {
  it('puts every file under shared/<when>/, subfolders kept', () => {
    const p = placeImport(source(), ['main.strudel'], [], ids())
    expect(p.folder).toBe(`shared/${when}`)
    expect(p.files.map((f) => f.path)).toEqual([
      `shared/${when}/drums.strudel`,
      `shared/${when}/bass.strudel`,
      `shared/${when}/viz/scope.js`,
    ])
    expect(p.files.map((f) => f.content)).toEqual(['s("bd")', 'note("c2")', ''])
  })

  it('gives every file a new id, so importing your own share overwrites nothing', () => {
    const p = placeImport(source(), [], [], ids())
    expect(p.files.map((f) => f.id)).toEqual(['new1', 'new2', 'new3'])
    expect(p.files.some((f) => ['a', 'b', 'c'].includes(f.id))).toBe(false)
  })

  it('keeps the order, in the new folder and with the new ids', () => {
    const p = placeImport(source(), [], [], ids())
    expect(p.fileOrder).toEqual({ [`shared/${when}`]: ['new2', 'new1'], [`shared/${when}/viz`]: ['new3'] })
    expect(p.subfolderOrder[`shared/${when}`]).toEqual(['viz'])
  })

  it('opens the last pattern at the top of the share, in its order', () => {
    // order is bass, drums: drums is last
    expect(placeImport(source(), [], [], ids()).open).toBe('new1')
    // no order: the last pattern listed — bass, not the sketch after it
    expect(placeImport(source({ fileOrder: {} }), [], [], ids()).open).toBe('new2')
    expect(placeImport(source({ files: [], fileOrder: {} }), [], [], ids()).open).toBeNull()
  })

  it('opens a pattern over a sketch that comes after it', () => {
    const files = [
      { id: 'p', path: 'song.strudel', language: 'strudel', content: '' },
      { id: 'v', path: 'viz/sun.p5', language: 'p5js', content: '' },
    ]
    expect(placeImport(source({ files, fileOrder: {}, subfolderOrder: {} }), [], [], ids()).open).toBe('new1')
    // no pattern at all: the last file
    const sketches = [files[1], { id: 'w', path: 'viz/moon.hydra', language: 'hydra', content: '' }]
    expect(placeImport(source({ files: sketches, fileOrder: {}, subfolderOrder: {} }), [], [], ids()).open).toBe('new2')
  })

  it('a second import made at the same minute gets its own folder', () => {
    const first = placeImport(source(), [], [], ids())
    const paths = first.files.map((f) => f.path)
    const second = placeImport(source(), paths, first.subfolderOrder.shared, ids())
    expect(second.folder).toBe(`shared/${when} (2)`)
    expect(second.subfolderOrder.shared).toEqual([when, `${when} (2)`])
    const third = placeImport(source(), [...paths, ...second.files.map((f) => f.path)], second.subfolderOrder.shared, ids())
    expect(third.folder).toBe(`shared/${when} (3)`)
  })

  it('a folder name taken only by a file deeper down still counts as taken', () => {
    const p = placeImport(source(), [`shared/${when}/old/x.strudel`], [], ids())
    expect(p.folder).toBe(`shared/${when} (2)`)
  })
})

describe('folderNameFor', () => {
  it('is local date and time with no colon', () => {
    expect(folderNameFor(at)).toBe(when)
    expect(folderNameFor(new Date(2026, 0, 9, 3, 7).getTime())).toBe('2026-01-09 03-07')
  })
})
