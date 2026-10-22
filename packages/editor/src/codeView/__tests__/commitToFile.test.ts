/**
 * commitToFile — the commit door's file route names WHY it refused (#1414).
 * Moved here from the editor registry with the route itself (#1911).
 *
 * This route has always refused correctly. What it could not do was say
 * WHICH refusal fired, and all fourteen of its call sites discarded even the
 * boolean — so a refused timeline gesture and an applied one were
 * indistinguishable, and "how often does this happen, and why" had no answer.
 *
 * These arms are that instrument. Each drives ONE refusal to its own value, so
 * a report built on them can name a cause rather than count anonymous failures.
 * The load-bearing one is `stale-document`: it must refuse AND write nothing,
 * because applying stale offsets corrupts unrelated code.
 *
 * Per feedback_editor_idb_test_split: plain fakes over a fake Monaco, no Monaco
 * runtime. `vi.resetModules()` per arm because the registry captures the monaco
 * namespace ONCE per module instance and never clears it (the door reads it
 * from there) — without a fresh
 * module the `no-monaco` arm is unreachable, and every arm becomes
 * order-dependent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OffsetEdit } from '../writeback'

const FILE = 'song.js'
const DOC = 'stack(a, b)'

interface EditCalls {
  pushEditOperations: number
  stackElements: number
}

function fakeEditor(text: string, opts: { positionThrows?: boolean } = {}) {
  const calls: EditCalls = { pushEditOperations: 0, stackElements: 0 }
  const model = {
    getValue: () => text,
    getPositionAt: (offset: number) => {
      if (opts.positionThrows) throw new Error('model detached')
      return { lineNumber: 1, column: offset + 1 }
    },
    pushStackElement: () => {
      calls.stackElements += 1
    },
    pushEditOperations: () => {
      calls.pushEditOperations += 1
      return null
    },
  }
  return { editor: { getModel: () => model }, calls }
}

class FakeRange {
  constructor(
    readonly a: number,
    readonly b: number,
    readonly c: number,
    readonly d: number,
  ) {}
}

const EDIT: OffsetEdit[] = [{ range: [0, 5], text: 'lead' }]

/** Fresh module instances — see the header on why this cannot be hoisted. The
 * registry and the door come from the SAME fresh graph, or the door would read a
 * registry the arm never registered anything in. */
async function freshRegistry() {
  vi.resetModules()
  const reg = await import('../../workspace/editorRegistry')
  const door = await import('../writeback')
  return { ...reg, commitToFile: door.commitToFile }
}

describe('commitToFile — every refusal names itself (#1414)', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it("applies, and reports 'applied', when everything is in place", async () => {
    const reg = await freshRegistry()
    const f = fakeEditor(DOC)
    reg.registerMonacoNamespace({ Range: FakeRange } as never)
    reg.registerEditor(FILE, f.editor as never)

    expect(reg.commitToFile(FILE, EDIT, 'arrange.weights', DOC)).toBe('applied')
    // The write actually reached the model — otherwise 'applied' is a lie and
    // every other arm here is measuring nothing.
    expect(f.calls.pushEditOperations).toBe(1)
  })

  it("reports 'no-editor' when no editor is registered for the file", async () => {
    const reg = await freshRegistry()
    reg.registerMonacoNamespace({ Range: FakeRange } as never)

    expect(reg.commitToFile(FILE, EDIT, 'arrange.weights', DOC)).toBe('no-editor')
  })

  it("reports 'no-monaco' when the namespace was never captured", async () => {
    const reg = await freshRegistry()
    const f = fakeEditor(DOC)
    reg.registerEditor(FILE, f.editor as never) // no registerMonacoNamespace

    expect(reg.commitToFile(FILE, EDIT, 'arrange.weights', DOC)).toBe('no-monaco')
    expect(f.calls.pushEditOperations).toBe(0)
  })

  it("reports 'no-edits' when the serializer declined and produced nothing", async () => {
    const reg = await freshRegistry()
    const f = fakeEditor(DOC)
    reg.registerMonacoNamespace({ Range: FakeRange } as never)
    reg.registerEditor(FILE, f.editor as never)

    expect(reg.commitToFile(FILE, [], 'arrange.structure', DOC)).toBe('no-edits')
    expect(f.calls.pushEditOperations).toBe(0)
  })

  it("reports 'stale-document' AND WRITES NOTHING when the model moved underneath", async () => {
    const reg = await freshRegistry()
    // The live model says something else than the snapshot the offsets came from.
    const f = fakeEditor('stack(a, b, c)')
    reg.registerMonacoNamespace({ Range: FakeRange } as never)
    reg.registerEditor(FILE, f.editor as never)

    expect(reg.commitToFile(FILE, EDIT, 'arrange.weights', DOC)).toBe('stale-document')
    // ⚠ THE ARM THAT GUARDS REAL CORRUPTION. Applying offsets computed against
    // `DOC` to a document that is no longer `DOC` rewrites whatever now occupies
    // those bytes. Naming the refusal is worthless if the write went out anyway.
    expect(f.calls.pushEditOperations).toBe(0)
    expect(f.calls.stackElements).toBe(0)
  })

  it("reports 'writeback-threw' when the write-back itself fails", async () => {
    const reg = await freshRegistry()
    const f = fakeEditor(DOC, { positionThrows: true })
    reg.registerMonacoNamespace({ Range: FakeRange } as never)
    reg.registerEditor(FILE, f.editor as never)

    expect(reg.commitToFile(FILE, EDIT, 'arrange.weights', DOC)).toBe('writeback-threw')
    expect(f.calls.pushEditOperations).toBe(0)
  })

  it('cannot be called without the document the edits were computed against (#1911)', async () => {
    const reg = await freshRegistry()
    const f = fakeEditor('anything at all')
    reg.registerMonacoNamespace({ Range: FakeRange } as never)
    reg.registerEditor(FILE, f.editor as never)

    // `expectedDoc` used to be optional, and leaving it out wrote blind. It is
    // the file route's only protection against stale offsets — its callers do
    // not re-detect against the live document the way a panel does — so it is
    // required, and leaving it out no longer compiles.
    // @ts-expect-error — expectedDoc is required
    const outcome = reg.commitToFile(FILE, EDIT, 'arrange.weights')
    // At runtime a missing document is a document that does not match.
    expect(outcome).toBe('stale-document')
    expect(f.calls.pushEditOperations).toBe(0)
  })

  it('reports the FIRST unmet precondition when several hold at once', async () => {
    const reg = await freshRegistry()
    // No editor AND no edits AND no monaco. The cause a caller reports has to be
    // deterministic, else the Console tells a different story on each run.
    expect(reg.commitToFile(FILE, [], 'arrange.weights', DOC)).toBe('no-editor')
  })

  it('never returns a falsy value — `if (outcome)` is always a bug', async () => {
    const reg = await freshRegistry()
    const f = fakeEditor('moved')
    reg.registerMonacoNamespace({ Range: FakeRange } as never)
    reg.registerEditor(FILE, f.editor as never)

    // Pinned deliberately: this union replaced a `boolean`, so the tempting
    // `if (commitToFile(...))` now reads as success for EVERY refusal.
    // The comparison against 'applied' is not style — it is the contract.
    const refused = reg.commitToFile(FILE, EDIT, 'arrange.weights', DOC)
    expect(refused).toBe('stale-document')
    expect(Boolean(refused)).toBe(true)
    expect(refused === 'applied').toBe(false)
  })
})
