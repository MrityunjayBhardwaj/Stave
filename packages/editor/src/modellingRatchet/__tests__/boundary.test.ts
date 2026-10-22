import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  boundaryProblems,
  entryImportsInside,
  exceptionsOnMain,
  krillReadProblems,
  listProblems,
  loadExceptions,
  measureBoundary,
  measureKrillReads,
  MINI_ADAPTER,
  MINI_RUNNERS,
  miniRunnerProblems,
  REPO_ROOT,
  EDITOR_PACKAGE_JSON,
  shrinkOnlyProblems,
  type ExceptionList,
  type KrillReader,
  type Measurement,
  type Reach,
} from '../boundary'

const E = 'packages/editor/src'
const PANELS = `${E}/visualEdit/panels`
const exists = (rel: string): boolean => fs.existsSync(path.join(REPO_ROOT, rel))
/** throw the WHOLE list — `toEqual([])` truncates it, and the message is the instruction */
const none = (problems: string[], what: string): void => {
  if (problems.length) throw new Error(`${what} (${problems.length}):\n  ${problems.join('\n  ')}`)
}

describe('the code↔view boundary (#1879)', () => {
  describe('the tree as it is', () => {
    let measured: Measurement
    let list: ExceptionList
    beforeAll(() => {
      measured = measureBoundary()
      list = loadExceptions()
    }, 120_000)

    it('the exception list is well formed, and every file it names exists', () => {
      none(listProblems(list, exists), 'boundary.exceptions.json is malformed')
    })

    it('every reach across the boundary has an exception, and every exception still has its reach', () => {
      const enforcedReaches = list.enforced.reduce((n, e) => n + e.reaches.length, 0)
      // said on every run, zero included: the declared files are NOT checked by anything here
      console.info(
        `code↔view boundary: examined ${measured.examined} product files outside codeView/; ` +
          `${measured.reaches.length} reaches measured, ${enforcedReaches} excepted in ${list.enforced.length} files; ` +
          `${list.declared.length} more files declared and NOT enforced; ` +
          `${measured.examinedInside} product files inside codeView/ examined for a @strudel/mini import ` +
          `(allowed: ${MINI_ADAPTER} and ${Object.keys(MINI_RUNNERS).length} named engine file(s), ${measured.miniRunners.length} seen importing it)`,
      )
      expect(measured.examined, 'no files were examined — the walk is broken, not the boundary clean').toBeGreaterThan(300)
      expect(measured.examinedInside, 'no file inside codeView/ was examined — the @strudel/mini rule saw nothing').toBeGreaterThan(50)
      none(boundaryProblems(measured.reaches, list), 'the code↔view boundary is crossed')
    })

    it('every engine file named as running Strudel still imports @strudel/mini (#1971)', () => {
      none(miniRunnerProblems(measured), 'MINI_RUNNERS names a file that no longer imports @strudel/mini')
      // and the names are real files, each with a reason
      for (const [file, why] of Object.entries(MINI_RUNNERS)) {
        expect(exists(file), `${file} does not exist`).toBe(true)
        expect(why.length, `${file} has no reason`).toBeGreaterThan(20)
      }
    })

    it('only the adapter reads a field of krill\'s nodes — and the old reader, function by function (#1972)', () => {
      const krill = measureKrillReads()
      const readers = list.krillReaders ?? []
      const allowed = readers.reduce((n, e) => n + Object.values(e.functions).reduce((a, b) => a + b, 0), 0)
      const found = [...krill.reads.values()].reduce((n, byFn) => n + [...byFn.values()].reduce((a, b) => a + b, 0), 0)
      // said on every run, zero included
      console.info(
        `krill node fields: examined ${krill.examined} product files outside ${MINI_ADAPTER}; ` +
          `${found} reads measured in ${krill.reads.size} file(s), ${allowed} allowed in ${readers.length} listed file(s)`,
      )
      expect(krill.examined, 'no files were examined — the walk is broken, not the tree clean').toBeGreaterThan(350)
      none(krillReadProblems(krill, readers), "krill's node fields are read outside the adapter")
    })

    it("the list only shrinks against origin/main's", () => {
      const main = exceptionsOnMain()
      if (main.kind === 'absent') {
        // Legitimate until the change that introduces the list has merged — and that includes
        // branches stacked on it, whose entries may already carry "added" lines (#1884 was the
        // first). So this cannot fail; it says, every run, that the check did not happen.
        const added = [...list.enforced, ...list.declared].filter((e) => e.added !== undefined).map((e) => e.file)
        console.warn(
          `code↔view boundary: no exception list on origin/main, so shrink-only was NOT checked in this run` +
            (added.length ? ` (${added.length} entries carry "added" lines: ${added.join(', ')})` : ''),
        )
        return
      }
      if (main.list.krillReaders === undefined && list.krillReaders !== undefined) {
        // the change that introduces the krill readers has no earlier numbers to shrink against
        console.warn('code↔view boundary: origin/main lists no krillReaders, so their numbers were NOT compared in this run')
      }
      none(shrinkOnlyProblems(list, main.list), 'the exception list grew')
    })
  })

  describe("krill's node fields (#1972)", () => {
    const PARSE = `${E}/codeView/notation/parse.ts`
    const reader = (functions: Record<string, number>, added?: Record<string, string>): KrillReader => ({
      file: PARSE,
      why: 'the old reader',
      issue: '#1012',
      functions,
      ...(added ? { added } : {}),
    })
    const plant = (file: string, src: string): Map<string, Map<string, number>> =>
      measureKrillReads({ overlay: { [file]: src }, onlyOverlay: true }).reads
    const counts = (m: Map<string, Map<string, number>>): Record<string, Record<string, number>> =>
      Object.fromEntries([...m].map(([f, byFn]) => [f, Object.fromEntries(byFn)]))

    it('a read in a panel is caught, however it is spelled — and named by the function it sits in', () => {
      const file = `${PANELS}/plantedKrillRead.tsx`
      const reads = plant(
        file,
        [
          `export function dotted(n: any) { return n.source_ }`,
          `export function optional(n: any) { return n?.options_?.weight }`,
          `export function bracket(n: any) { return n['location_'] }`,
          `export function destructured(n: any) { const { type_, arguments_: args } = n; return [type_, args] }`,
          `export const arrow = (n: any) => n.source_.map((c: any) => c.type_)`,
        ].join('\n'),
      )
      expect(counts(reads)).toEqual({ [file]: { dotted: 1, optional: 1, bracket: 1, destructured: 2, arrow: 2 } })
      const problems = krillReadProblems({ reads }, [])
      expect(problems).toHaveLength(5)
      expect(problems[0]).toMatch(/plantedKrillRead\.tsx reads a krill node field in `arrow` \(2\)\. Ask codeView\/strudelMini\//)
    })

    it('in the app as well, and inside codeView/ outside the adapter', () => {
      for (const file of ['packages/app/src/components/plantedKrillRead.tsx', `${E}/codeView/notation/plantedKrillRead.ts`]) {
        expect(counts(plant(file, `export const f = (n: any) => n.source_`)), file).toEqual({ [file]: { f: 1 } })
      }
    })

    it('the adapter itself is not examined, and neither is a test', () => {
      for (const file of [`${E}/codeView/strudelMini/plantedKrillRead.ts`, `${PANELS}/__tests__/plantedKrillRead.test.ts`]) {
        expect(plant(file, `export const f = (n: any) => n.source_`).size, file).toBe(0)
      }
    })

    it('naming a field is not reading it: a comment, a string, a type member, an object key', () => {
      const file = `${PANELS}/plantedKrillRead.tsx`
      const reads = plant(
        file,
        [
          `// reads n.source_ and n.type_ — in a comment`,
          `export const text = 'n.source_ in a string'`,
          `export interface Looks { source_: string; type_: 'atom' }`,
          `export const made = { source_: 'bd', location_: null }`,
          `export const other = (n: { source: string; kind: string }) => n.source + n.kind`,
        ].join('\n'),
      )
      expect(reads.size).toBe(0)
    })

    it('a listed function may read exactly its number: one more is red, one fewer is stale, none is stale', () => {
      const src = (n: number): string => `function chordAtoms(p: any) { return [${Array.from({ length: n }, () => 'p.source_').join(', ')}] }`
      const at = (n: number): string[] => krillReadProblems({ reads: plant(PARSE, src(n)) }, [reader({ chordAtoms: 2 })])
      expect(at(2)).toEqual([])
      expect(at(3)).toHaveLength(1)
      expect(at(3)[0]).toMatch(/`chordAtoms` reads krill node fields 3 times; boundary\.exceptions\.json allows 2, and that number only goes down/)
      expect(at(1)[0]).toMatch(/`chordAtoms` is allowed 2 krill node reads and makes 1\. Good: lower its number/)
      expect(krillReadProblems({ reads: new Map() }, [reader({ chordAtoms: 2 })])[0]).toMatch(/`chordAtoms` is listed under krillReaders and reads no krill node field\. Good: delete its line/)
    })

    it('an allowance covers its own function in its own file, nothing else', () => {
      const other = krillReadProblems({ reads: plant(PARSE, `function topLevelSpans(p: any) { return p.source_ }`) }, [reader({ chordAtoms: 1 })])
      expect(other.some((p) => /reads a krill node field in `topLevelSpans`/.test(p))).toBe(true)
      const elsewhere = `${E}/codeView/ir/parseMini.ts`
      const moved = krillReadProblems({ reads: plant(elsewhere, `function chordAtoms(p: any) { return p.source_ }`) }, [reader({ chordAtoms: 1 })])
      expect(moved.some((p) => p.startsWith(`${elsewhere} reads a krill node field in \`chordAtoms\``))).toBe(true)
    })

    it("the list's shape: an issue, a why, whole numbers of 1 or more, one entry per file", () => {
      const list = (krillReaders: KrillReader[]): ExceptionList => ({ about: '', enforced: [], declared: [], krillReaders })
      expect(listProblems(list([reader({ chordAtoms: 2 })]), exists)).toEqual([])
      expect(listProblems(list([{ ...reader({ chordAtoms: 2 }), issue: 'soon' }]), exists)).toHaveLength(1)
      expect(listProblems(list([{ ...reader({ chordAtoms: 2 }), why: '' }]), exists)).toHaveLength(1)
      expect(listProblems(list([reader({})]), exists)).toHaveLength(1)
      expect(listProblems(list([reader({ chordAtoms: 0 })]), exists)).toHaveLength(1)
      expect(listProblems(list([reader({ chordAtoms: 1.5 })]), exists)).toHaveLength(1)
      expect(listProblems(list([reader({ chordAtoms: 1 }), reader({ tokenize: 1 })]), exists)).toHaveLength(1)
      expect(listProblems(list([{ ...reader({ chordAtoms: 1 }), file: `${E}/gone.ts` }]), exists)).toHaveLength(1)
      expect(listProblems(list([reader({ chordAtoms: 1 }, { tokenize: '#1 not listed' })]), exists)).toHaveLength(1)
    })

    it('shrink-only: a number may fall or a function go; a rise or a new function needs its own "added" line', () => {
      const list = (krillReaders?: KrillReader[]): ExceptionList => ({ about: '', enforced: [], declared: [], ...(krillReaders ? { krillReaders } : {}) })
      const base = list([reader({ chordAtoms: 3, tokenize: 2 })])
      expect(shrinkOnlyProblems(list([reader({ chordAtoms: 3, tokenize: 2 })]), base)).toEqual([])
      expect(shrinkOnlyProblems(list([reader({ chordAtoms: 2 })]), base)).toEqual([])
      expect(shrinkOnlyProblems(list([]), base)).toEqual([])
      const rose = shrinkOnlyProblems(list([reader({ chordAtoms: 4, tokenize: 2 })]), base)
      expect(rose).toHaveLength(1)
      expect(rose[0]).toMatch(/chordAtoms \(3 → 4\) reads more krill node fields than on origin\/main's list/)
      expect(shrinkOnlyProblems(list([reader({ chordAtoms: 3, tokenize: 2, readOps: 1 })]), base)[0]).toMatch(/readOps \(0 → 1\)/)
      expect(shrinkOnlyProblems(list([reader({ chordAtoms: 4, tokenize: 2 }, { chordAtoms: '#1012 why it grew' })]), base)).toEqual([])
      // one line covers one function
      expect(shrinkOnlyProblems(list([reader({ chordAtoms: 4, tokenize: 3 }, { chordAtoms: '#1012 why it grew' })]), base)[0]).toMatch(/tokenize \(2 → 3\)/)
      // the change that introduces the section has nothing to compare against
      expect(shrinkOnlyProblems(list([reader({ chordAtoms: 99 })]), list())).toEqual([])
    })
  })

  describe('inside the area', () => {
    it('no file imports the entry — a file inside imports the module that has the name', () => {
      none(entryImportsInside(), 'files inside codeView/ import codeView/index.ts')
    })

    it('a planted one is caught, however the entry is spelled', () => {
      const C = `${E}/codeView`
      const planted = {
        [`${C}/plantedDot.ts`]: `import { parseStepGrid } from '.'\nexport const x = parseStepGrid`,
        [`${C}/mixer/plantedUp.ts`]: `import type { ChunkInfo } from '..'\nexport type X = ChunkInfo`,
        [`${C}/mixer/plantedIndex.ts`]: `export { detectChunk } from '../index'`,
        [`${C}/mixer/plantedDynamic.ts`]: `export const x = () => import('../index')`,
        [`${C}/mixer/plantedSibling.ts`]: `import { detectChunk } from '../chunkDetect'\nexport const x = detectChunk`,
      }
      expect(entryImportsInside({ overlay: planted })).toEqual([
        `${C}/mixer/plantedDynamic.ts`,
        `${C}/mixer/plantedIndex.ts`,
        `${C}/mixer/plantedUp.ts`,
        `${C}/plantedDot.ts`,
      ])
    })
  })

  // Each planted file is judged alone (`onlyOverlay`): the red state of every rule is reached
  // inside this suite, on a file that does not exist on disk.
  describe('planted crossings', () => {
    const planted: Record<string, string> = {
      // ── rule: import ──
      [`${PANELS}/plantedDeep.tsx`]: `import { parseStepGrid } from '../../codeView/notation/parse'\nexport const x = parseStepGrid`,
      [`${PANELS}/plantedEntry.tsx`]: `import { parseStepGrid } from '../../codeView'\nexport const x = parseStepGrid`,
      [`${PANELS}/plantedDeepType.tsx`]: `import type { StepGridModel } from '../../codeView/notation/model'\nexport type X = StepGridModel`,
      [`${PANELS}/plantedDynamic.tsx`]: `export const x = () => import('../../codeView/notation/serialize')`,
      [`${PANELS}/plantedStar.tsx`]: `export * from '../../codeView/arrange'`,
      [`${PANELS}/plantedRequire.tsx`]: `declare const require: (s: string) => unknown\nexport const x = require('../../codeView/notation/parse')`,
      [`${PANELS}/plantedImportType.tsx`]: `export type T = import('../../codeView/notation/model').StepGridModel`,
      // the package itself has no subpath into the area any more (#1943); this arm plants one
      // in an overlaid package.json (below), so the rule is still reached
      [`packages/app/src/components/plantedSubpath.ts`]: `import { splitMuteMarker } from '@stave/editor/plantedTrackId'\nexport const x = splitMuteMarker`,
      // ── rule: owner ──
      [`${PANELS}/plantedMini.tsx`]: `import { mini } from '@strudel/mini'\nexport const x = mini`,
      [`${PANELS}/plantedKrill.tsx`]: `import * as krill from '@strudel/mini/krill-parser.js'\nexport const x = krill`,
      [`${PANELS}/plantedAcorn.tsx`]: `import { parse } from 'acorn'\nexport const x = parse`,
      [`${E}/engine/plantedEngineMini.ts`]: `import { mini } from '@strudel/mini'\nexport const x = mini`,
      [`${E}/engine/plantedEngineAcorn.ts`]: `import { parse } from 'acorn'\nexport const x = parse`,
      // @strudel/mini has one importer INSIDE the area too (#1971): a view's parser, a dynamic
      // import, a re-export — and the adapter's own directory, which is where it belongs
      [`${E}/codeView/notation/plantedInsideKrill.ts`]: `import { parse } from '@strudel/mini/krill-parser.js'\nexport const x = parse`,
      [`${E}/codeView/plantedInsideDynamic.ts`]: `export const x = () => import('@strudel/mini/mini.mjs')`,
      [`${E}/codeView/ir/plantedInsideReexport.ts`]: `export { mini } from '@strudel/mini'`,
      [`${E}/codeView/strudelMini/plantedAdapter.ts`]: `import { parse } from '@strudel/mini/krill-parser.js'\nexport const x = parse`,
      // inside the area nothing else is asked: acorn and a sibling's internals are its own business
      [`${E}/codeView/plantedInsideAcorn.ts`]: `import { parse } from 'acorn'\nimport { parseStepGrid } from './notation/parse'\nexport const x = [parse, parseStepGrid]`,
      // ── rule: door ──
      // the real shape: no import of the writer at all, it arrives as a callback parameter
      [`${PANELS}/plantedDoorCallback.tsx`]:
        `import { useActiveChunk } from './useActiveChunk'\n` +
        `export function useIt() { const { applyEdit } = useActiveChunk(); return () => applyEdit((fresh, wb) => { wb.replaceRanges([{ range: fresh.miniRange!, text: 'x' }], 'seq') }) }`,
      [`${PANELS}/plantedDoorElement.tsx`]: `import type { Writeback } from '../../codeView'\nexport const f = (wb: Writeback) => wb['beginGesture']()`,
      [`${PANELS}/plantedDoorDestructure.tsx`]: `import type { Writeback } from '../../codeView'\nexport const f = (wb: Writeback) => { const { currentSource } = wb; return currentSource }`,
      [`${PANELS}/plantedDoorAlias.tsx`]: `import { Writeback as W } from '../../codeView'\nexport const f = (e: never, m: never) => new W(e, m)`,
      [`${PANELS}/plantedDoorPassed.tsx`]: `import { Writeback } from '../../codeView'\nexport const f = (g: (c: unknown) => void) => g(Writeback)`,
      [`${PANELS}/plantedDoorApplyEdits.tsx`]: `import { applyEdits } from '../../codeView'\nexport const f = () => applyEdits('abc', [{ range: [0, 1], text: 'x' }])`,
      [`packages/app/src/components/plantedDoorApp.ts`]: `import { applyEdits } from '@stave/editor'\nexport const f = () => applyEdits('abc', [])`,
      [`packages/app/src/components/plantedDoorNamespace.ts`]: `import * as Ed from '@stave/editor'\nexport const f = () => Ed.applyEdits('abc', [])`,
      // a raw Monaco document write, behind the door's back (#1914) — on the model, on the
      // editor, by element access, by destructuring, and from the app
      [`${PANELS}/plantedRawModel.tsx`]: `import type * as Monaco from 'monaco-editor'\nexport const f = (m: Monaco.editor.ITextModel) => { m.setValue('x'); m.pushEditOperations([], [], () => null); m.applyEdits([]) }`,
      [`${PANELS}/plantedRawEditor.tsx`]: `import type * as Monaco from 'monaco-editor'\nexport const f = (e: Monaco.editor.IStandaloneCodeEditor) => { e.executeEdits('me', []); e.setValue('x') }`,
      [`${PANELS}/plantedRawElement.tsx`]: `import type * as Monaco from 'monaco-editor'\nexport const f = (e: Monaco.editor.ICodeEditor) => e['executeCommands']('me', [])`,
      [`${PANELS}/plantedRawDestructure.tsx`]: `import type * as Monaco from 'monaco-editor'\nexport const f = (m: Monaco.editor.ITextModel) => { const { setValue } = m; return setValue }`,
      [`packages/app/src/components/plantedRawApp.ts`]: `import type * as Monaco from 'monaco-editor'\nexport const f = (m: Monaco.editor.ITextModel) => m.setValue('x')`,
      // ── must NOT fire ──
      // Monaco reads, and a form field's own setValue / pushEditOperations
      [`${PANELS}/plantedRawLookalike.tsx`]:
        `import type * as Monaco from 'monaco-editor'\nexport const f = (m: Monaco.editor.ITextModel, e: Monaco.editor.ICodeEditor) => [m.getValue(), e.getValue(), e.getModel()]\n` +
        `class Field { setValue(_v: string): void {} pushEditOperations(): void {} }\nexport const g = () => { const x = new Field(); x.setValue('a'); x.pushEditOperations() }\n` +
        // the same interface name and method, declared here rather than by Monaco
        `interface ITextModel { setValue(v: string): void }\nexport const h = (m: ITextModel) => m.setValue('a')`,
      [`${PANELS}/plantedTypeOnly.tsx`]: `import type { Writeback, OffsetEdit } from '../../codeView'\nexport type Apply = (m: (wb: Writeback) => void, e: OffsetEdit) => void`,
      [`${PANELS}/plantedLookalike.tsx`]:
        `class Mine { replaceRanges(): void {} insertAt(): void {} }\nexport const f = () => { const m = new Mine(); m.replaceRanges(); m.insertAt() }\n` +
        `export function applyEdits(): void {}\nexport const g = () => applyEdits()`,
    }
    let by: Map<string, Reach[]>
    const of = (name: string): string[] => {
      const key = Object.keys(planted).find((f) => f.endsWith(`/${name}`))
      if (!key) throw new Error(`no planted file ${name}`)
      return (by.get(key) ?? []).map((r) => r.reach)
    }
    // The real package.json plus one planted subpath built from a file in the area. Not in
    // `planted`: it is configuration the scan reads, not a file it judges.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, EDITOR_PACKAGE_JSON), 'utf8'))
    const plantedPackageJson = JSON.stringify({
      ...pkg,
      exports: { ...pkg.exports, './plantedTrackId': { import: './dist/codeView/ir/trackId.js' } },
    })
    beforeAll(() => {
      const m = measureBoundary({ overlay: { ...planted, [EDITOR_PACKAGE_JSON]: plantedPackageJson }, onlyOverlay: true })
      expect(m.examined + m.examinedInside).toBe(Object.keys(planted).length)
      expect(m.examinedInside).toBe(5)
      by = new Map()
      for (const r of m.reaches) by.set(r.file, [...(by.get(r.file) ?? []), r])
    }, 120_000)

    it('a deep import is a crossing — value, type-only, dynamic, and export-star alike', () => {
      expect(of('plantedDeep.tsx')).toEqual(['codeView/notation/parse#parseStepGrid'])
      expect(of('plantedDeepType.tsx')).toEqual(['codeView/notation/model#StepGridModel'])
      expect(of('plantedDynamic.tsx')).toEqual(['codeView/notation/serialize#*'])
      expect(of('plantedStar.tsx')).toEqual(['codeView/arrange/index#*'])
      expect(of('plantedRequire.tsx')).toEqual(['codeView/notation/parse#*'])
      expect(of('plantedImportType.tsx')).toEqual(['codeView/notation/model#*'])
    })

    it('the same name through the entry is not', () => {
      expect(of('plantedEntry.tsx')).toEqual([])
    })

    it('a package subpath that is built from a file in the area is a deep import', () => {
      expect(of('plantedSubpath.ts')).toEqual(['codeView/ir/trackId#splitMuteMarker'])
    })

    it('an owner import outside the area is a crossing — and the engine is exempt for acorn only', () => {
      expect(of('plantedMini.tsx')).toEqual(['owner#@strudel/mini'])
      expect(of('plantedKrill.tsx')).toEqual(['owner#@strudel/mini/krill-parser.js'])
      expect(of('plantedAcorn.tsx')).toEqual(['owner#acorn'])
      expect(of('plantedEngineAcorn.ts')).toEqual([])
      // an engine file is allowed @strudel/mini by NAME, and this one is not named (#1971)
      expect(of('plantedEngineMini.ts')).toEqual(['owner#@strudel/mini'])
    })

    it('@strudel/mini imported inside the area is a crossing too — anywhere but the adapter (#1971)', () => {
      expect(of('plantedInsideKrill.ts')).toEqual(['owner#@strudel/mini/krill-parser.js'])
      expect(of('plantedInsideDynamic.ts')).toEqual(['owner#@strudel/mini/mini.mjs'])
      expect(of('plantedInsideReexport.ts')).toEqual(['owner#@strudel/mini'])
      expect(of('plantedAdapter.ts')).toEqual([])
      expect(of('plantedInsideAcorn.ts')).toEqual([])
    })

    it('a named engine file that stops importing @strudel/mini is stale, and says so (#1971)', () => {
      const [file] = Object.keys(MINI_RUNNERS)
      const real = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')
      expect(miniRunnerProblems(measureBoundary({ overlay: { [file]: real }, onlyOverlay: true }))).toEqual([])
      const without = real.replace(/import\('@strudel\/mini'\)/g, "import('@strudel/core')")
      expect(without).not.toBe(real)
      const stale = miniRunnerProblems(measureBoundary({ overlay: { [file]: without }, onlyOverlay: true }))
      expect(stale).toHaveLength(1)
      expect(stale[0]).toMatch(/StrudelEngine\.ts is named in MINI_RUNNERS and does not import @strudel\/mini/)
    }, 120_000)

    it('a direct write is a crossing even with no import of the writer in sight', () => {
      expect(of('plantedDoorCallback.tsx')).toEqual(['door#Writeback.replaceRanges'])
    })

    it('…and by element access, destructuring, an aliased constructor, the class passed as a value', () => {
      expect(of('plantedDoorElement.tsx')).toEqual(['door#Writeback.beginGesture'])
      expect(of('plantedDoorDestructure.tsx')).toEqual(['door#Writeback.currentSource'])
      expect(of('plantedDoorAlias.tsx')).toEqual(['door#new Writeback'])
      expect(of('plantedDoorPassed.tsx')).toEqual(['door#Writeback as a value'])
    })

    it('…and through the door functions, from the editor and from the app', () => {
      expect(of('plantedDoorApplyEdits.tsx')).toEqual(['door#applyEdits'])
      expect(of('plantedDoorApp.ts')).toEqual(['door#applyEdits'])
      expect(of('plantedDoorNamespace.ts')).toEqual(['door#applyEdits'])
    })

    it('a raw Monaco document write is a crossing — model, editor, element access, destructuring, app (#1914)', () => {
      expect(of('plantedRawModel.tsx')).toEqual([
        'door#monaco ITextModel.applyEdits',
        'door#monaco ITextModel.pushEditOperations',
        'door#monaco ITextModel.setValue',
      ])
      expect(of('plantedRawEditor.tsx')).toEqual(['door#monaco ICodeEditor.executeEdits', 'door#monaco ICodeEditor.setValue'])
      expect(of('plantedRawElement.tsx')).toEqual(['door#monaco ICodeEditor.executeCommands'])
      expect(of('plantedRawDestructure.tsx')).toEqual(['door#monaco ITextModel.setValue'])
      expect(of('plantedRawApp.ts')).toEqual(['door#monaco ITextModel.setValue'])
    })

    it('a Monaco READ is not a write, and a setValue Monaco did not declare is not the door', () => {
      expect(of('plantedRawLookalike.tsx')).toEqual([])
    })

    it('naming the writer as a TYPE is not a write, and a look-alike method on another class is not the door', () => {
      expect(of('plantedTypeOnly.tsx')).toEqual([])
      expect(of('plantedLookalike.tsx')).toEqual([])
    })

    it('every planted crossing fails the gate, with the instruction for its rule', () => {
      const list = loadExceptions()
      const reaches = [...by.values()].flat()
      const problems = boundaryProblems(reaches, { ...list, enforced: [] })
      expect(problems).toHaveLength(reaches.length)
      expect(problems.find((p) => p.includes('plantedDeep.tsx'))).toMatch(/Import it from codeView\/index\.ts/)
      expect(problems.find((p) => p.includes('plantedMini.tsx'))).toMatch(/parser owners/)
      expect(problems.find((p) => p.includes('plantedDoorCallback.tsx'))).toMatch(/Only codeView\/ writes to the document/)
    })

    it('a THIRD reach from the engine is red — its entry covers exactly the two it names', () => {
      const file = `${E}/engine/StrudelEngine.ts`
      const real = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')
      const m = measureBoundary({ overlay: { [file]: `import { parseMini } from '../codeView/ir/parseMini'\n${real}` }, onlyOverlay: true })
      const mine = boundaryProblems(m.reaches, loadExceptions()).filter((p) => p.startsWith(file))
      expect(mine).toHaveLength(1)
      expect(mine[0]).toMatch(/reaches codeView\/ir\/parseMini#parseMini \(import\) and no exception allows it/)
    }, 120_000)
  })

  describe('the list against what is measured', () => {
    const reach = (file: string, r: string): Reach => ({ file, rule: 'import', reach: r })
    const list = (enforced: ExceptionList['enforced'], declared: ExceptionList['declared'] = []): ExceptionList => ({ about: 'a', enforced, declared })
    const entry = (file: string, reaches: string[], extra: object = {}) => ({ file, reaches, why: 'w', issue: '#1880', ...extra })

    it('passes when the two agree exactly', () => {
      expect(boundaryProblems([reach('a.ts', 'codeView/x#y')], list([entry('a.ts', ['codeView/x#y'])]))).toEqual([])
    })

    it('a reach in a file with no entry is red', () => {
      expect(boundaryProblems([reach('a.ts', 'codeView/x#y')], list([]))).toHaveLength(1)
    })

    it('one more reach from a file that HAS an entry is red', () => {
      const p = boundaryProblems([reach('a.ts', 'codeView/x#y'), reach('a.ts', 'codeView/x#z')], list([entry('a.ts', ['codeView/x#y'])]))
      expect(p).toHaveLength(1)
      expect(p[0]).toMatch(/codeView\/x#z/)
    })

    it('a stale entry is red — the reach is gone and the entry stayed', () => {
      const p = boundaryProblems([reach('a.ts', 'codeView/x#y')], list([entry('a.ts', ['codeView/x#y', 'codeView/x#z'])]))
      expect(p).toHaveLength(1)
      expect(p[0]).toMatch(/codeView\/x#z is STALE/)
      expect(boundaryProblems([], list([entry('a.ts', ['codeView/x#y'])]))[0]).toMatch(/STALE/)
    })

    it("an entry does not cover another file's reach", () => {
      expect(boundaryProblems([reach('b.ts', 'codeView/x#y')], list([entry('a.ts', ['codeView/x#y'])]))).toHaveLength(2)
    })
  })

  describe("the list's own shape", () => {
    const ok = { file: 'a.ts', reaches: ['codeView/x#y'], why: 'w', issue: '#1880' }
    const shape = (e: object, declared: object[] = []): string[] =>
      listProblems({ about: 'a', enforced: [e as never], declared: declared as never }, (f) => f === 'a.ts')

    it('accepts a well-formed entry', () => {
      expect(shape(ok)).toEqual([])
    })

    it('refuses an entry that names no issue, or more than a bare issue number', () => {
      expect(shape({ ...ok, issue: '' })).toHaveLength(1)
      expect(shape({ ...ok, issue: 'later' })).toHaveLength(1)
      expect(shape({ ...ok, issue: '#1880 and friends' })).toHaveLength(1)
    })

    it('refuses a missing why, no reaches, a reach twice, a file twice, a file that is gone', () => {
      expect(shape({ ...ok, why: '' })).toHaveLength(1)
      expect(shape({ ...ok, reaches: [] })).toHaveLength(1)
      expect(shape({ ...ok, reaches: ['codeView/x#y', 'codeView/x#y'] })).toHaveLength(1)
      expect(listProblems({ about: 'a', enforced: [ok, ok], declared: [] }, () => true)).toHaveLength(1)
      expect(shape({ ...ok, file: 'gone.ts' })).toHaveLength(1)
    })

    it('refuses an "added" line that names no issue, is not keyed by reach, or names a reach the entry lacks', () => {
      expect(shape({ ...ok, added: { 'codeView/x#y': 'needed it' } })).toHaveLength(1)
      expect(shape({ ...ok, added: { 'codeView/x#y': '#1880 the grid needs it until the op moves in' } })).toEqual([])
      expect(shape({ ...ok, added: '#1880 one line for the whole entry' })).toHaveLength(1)
      expect(shape({ ...ok, added: { 'codeView/x#elsewhere': '#1880 not a reach of this entry' } })).toHaveLength(1)
      expect(shape(ok, [{ file: 'a.ts', what: 'w', issue: '#1880', added: 'later' }])).toHaveLength(1)
    })

    it('holds the declared section to the same shape', () => {
      expect(shape(ok, [{ file: 'a.ts', what: 'reads by hand', issue: '#1880' }])).toEqual([])
      expect(shape(ok, [{ file: 'a.ts', what: '', issue: '#1880' }])).toHaveLength(1)
      expect(shape(ok, [{ file: 'gone.ts', what: 'w', issue: '#1880' }])).toHaveLength(1)
    })
  })

  describe('shrink-only against origin/main', () => {
    const base: ExceptionList = { about: 'a', enforced: [{ file: 'a.ts', reaches: ['codeView/x#y', 'codeView/x#z'], why: 'w', issue: '#1880' }], declared: [{ file: 'd.ts', what: 'w', issue: '#1880' }] }

    it('accepts the same list, a dropped reach, a dropped file', () => {
      expect(shrinkOnlyProblems(base, base)).toEqual([])
      expect(shrinkOnlyProblems({ ...base, enforced: [{ ...base.enforced[0], reaches: ['codeView/x#y'] }] }, base)).toEqual([])
      expect(shrinkOnlyProblems({ ...base, enforced: [], declared: [] }, base)).toEqual([])
    })

    it('refuses a new reach on an existing entry, and a new file, without an "added" line', () => {
      const more = { ...base.enforced[0], reaches: [...base.enforced[0].reaches, 'codeView/x#new'] }
      expect(shrinkOnlyProblems({ ...base, enforced: [more] }, base)).toHaveLength(1)
      const other = { file: 'b.ts', reaches: ['door#Writeback.replaceRanges'], why: 'w', issue: '#1880' }
      expect(shrinkOnlyProblems({ ...base, enforced: [...base.enforced, other] }, base)).toHaveLength(1)
      expect(shrinkOnlyProblems({ ...base, declared: [...base.declared, { file: 'e.ts', what: 'w', issue: '#1880' }] }, base)).toHaveLength(1)
    })

    it('accepts them once the entry says which issue let them in', () => {
      const more = { ...base.enforced[0], reaches: [...base.enforced[0].reaches, 'codeView/x#new'], added: { 'codeView/x#new': '#1880 needed until the op moves in' } }
      expect(shrinkOnlyProblems({ ...base, enforced: [more] }, base)).toEqual([])
      expect(shrinkOnlyProblems({ ...base, declared: [...base.declared, { file: 'e.ts', what: 'w', issue: '#1880', added: '#1880 found while moving the mixer' }] }, base)).toEqual([])
    })

    it('one "added" line does not cover the NEXT new reach on the same entry', () => {
      const two = {
        ...base.enforced[0],
        reaches: [...base.enforced[0].reaches, 'codeView/x#new', 'codeView/x#newer'],
        added: { 'codeView/x#new': '#1880 needed until the op moves in' },
      }
      const p = shrinkOnlyProblems({ ...base, enforced: [two] }, base)
      expect(p).toHaveLength(1)
      expect(p[0]).toMatch(/codeView\/x#newer is not on origin\/main's list/)
    })
  })
})
