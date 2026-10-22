/**
 * IR Inspector store — the latest parsed-and-collected snapshot from
 * the most recent successful Strudel eval. Subscribed by the IR
 * Inspector panel; emitted by `StrudelEditorClient`'s eval hook.
 *
 * Why a tiny purpose-built store instead of reusing engineLog: the
 * payload is structurally different (a tree + an event array, not a
 * sequence of log lines) and the UI semantics are different too —
 * Console keeps history, Inspector keeps only the latest.
 */
import type { PatternIR } from '../codeView'
import type { IREvent } from '../codeView'
import type { RuntimeId } from './engineLog'
import { captureSnapshot } from './timelineCapture'

export interface IRSnapshot {
  /** Epoch ms when the snapshot was captured. */
  ts: number
  /** Workspace file path the source came from, if known. */
  source?: string
  /** Runtime that produced this snapshot — only Strudel for v0. */
  runtime: RuntimeId
  /** The raw user code that was parsed. */
  code: string
  /** Per-pass IR snapshots, in execution order. IR-shaped only — collected events live in `events`. */
  passes: readonly { readonly name: string; readonly ir: PatternIR }[]
  /** Alias of `passes[passes.length - 1].ir`. Publishers MUST keep these in sync. */
  ir: PatternIR
  /** Collected events for one cycle window starting at t=0. */
  events: IREvent[]
  /** Lookup: irNodeId → IREvent. PV38 clause 1.
   *  Built at publish time by enrichWithLookups; ReadonlyMap enforces
   *  PV33 (snapshot immutability post-publish). */
  irNodeIdLookup: ReadonlyMap<string, IREvent>
  /** Lookup: `${loc[0].start}:${loc[0].end}` → IREvent[]. Used by
   *  engine-side hap matching (normalizeStrudelHap); haps don't carry
   *  the hash, only the loc. ReadonlyMap enforces PV33. */
  irNodeLocLookup: ReadonlyMap<string, IREvent[]>
  /** Lookup: 1-based Monaco line number → leaf irNodeIds whose
   *  loc[0] starts on that line. PV38 phase-20-07 use; built once
   *  at publish time by enrichWithLookups; ReadonlyMap enforces PV33.
   *  Empty map when no events carry both irNodeId and loc. Used by
   *  Monaco gutter click → leaf-set resolver for breakpoint
   *  registration (Phase 20-07). PV37 alignment: events without
   *  irNodeId never appear in this index. */
  irNodeIdsByLine: ReadonlyMap<number, readonly string[]>
}

/** Input shape for publishIRSnapshot — caller does not construct lookups;
 *  the publisher enriches via enrichWithLookups. Type-system enforces
 *  this contract (Trap 9 mitigation — caller cannot bypass the publisher). */
export type IRSnapshotInput = Omit<IRSnapshot, 'irNodeIdLookup' | 'irNodeLocLookup' | 'irNodeIdsByLine'>

type Listener = (snap: IRSnapshot | null) => void

let current: IRSnapshot | null = null
const listeners = new Set<Listener>()

/** Build the two lookup tables from snap.events. Pure function; returns
 *  a NEW IRSnapshot with the lookups attached. Original `snap` is unchanged
 *  (PV33 alignment — caller's input shape is never mutated). */
function enrichWithLookups(snap: IRSnapshotInput): IRSnapshot {
  const idLookup = new Map<string, IREvent>()
  const locLookup = new Map<string, IREvent[]>()
  const lineLookup = new Map<number, string[]>()
  for (const e of snap.events) {
    if (e.irNodeId) idLookup.set(e.irNodeId, e)
    if (e.loc && e.loc.length > 0) {
      const key = `${e.loc[0].start}:${e.loc[0].end}`
      const arr = locLookup.get(key)
      if (arr) arr.push(e)
      else locLookup.set(key, [e])
      // Phase 20-07 (PV38) — line index for Monaco gutter click resolver.
      // Same single pass over snap.events; no extra walk. PV37 alignment:
      // only events carrying an irNodeId enter this index.
      if (e.irNodeId) {
        const line = countLines(snap.code, e.loc[0].start)
        const ids = lineLookup.get(line)
        if (ids) {
          if (!ids.includes(e.irNodeId)) ids.push(e.irNodeId)
        } else {
          lineLookup.set(line, [e.irNodeId])
        }
      }
    }
  }
  return {
    ...snap,
    irNodeIdLookup: idLookup,
    irNodeLocLookup: locLookup,
    irNodeIdsByLine: lineLookup,
  }
}

/** Count 1-based Monaco line number for a 0-based byte offset in source
 *  code. Iterates '\n' (charCode 10) between [0, offset). Mirrors
 *  Monaco's `model.getPositionAt(offset).lineNumber`. Duplicated from
 *  IRInspectorPanel.tsx:336-342 — 4 lines, no other callers in editor
 *  package; keeping enrichWithLookups self-contained. */
function countLines(code: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code.charCodeAt(i) === 10) line++
  }
  return line
}

/**
 * Publish a snapshot. Two parallel side-effects fire on every publish
 * (PK9 step 8 — order independent, both must run):
 *  1. captureSnapshot fan-out — pushes into the timeline ring buffer
 *     (timelineCapture.ts) so past evals can be scrubbed.
 *  2. listener fan-out — single-slot consumers (the IR Inspector
 *     panel's live subscribe) re-render with the new snapshot.
 *
 * The optional `meta` parameter carries cycle position (read by the
 * publisher from `runtime.getCurrentCycle()`) onto the capture entry.
 * Existing callers pass no `meta` and continue to compile; capture
 * defaults `cycleCount` to `null` in that case.
 */
export function publishIRSnapshot(
  snap: IRSnapshotInput,
  meta?: { cycleCount?: number | null },
): void {
  // Enrich BEFORE storing/capturing/notifying so all consumers see the
  // same lookup tables. PV33: lookups join the immutable snapshot.
  const enriched = enrichWithLookups(snap)
  current = enriched
  // PK9 step 8a — timeline capture fan-out (Phase 19-08).
  captureSnapshot(enriched, {
    ts: enriched.ts,
    cycleCount: meta?.cycleCount ?? null,
  })
  // PK9 step 8b — listener fan-out (single-slot consumers).
  for (const l of listeners) {
    try { l(enriched) } catch { /* listener errors don't block the publish */ }
  }
}

export function clearIRSnapshot(): void {
  current = null
  for (const l of listeners) {
    try { l(null) } catch { /* swallow */ }
  }
}

export function getIRSnapshot(): IRSnapshot | null {
  return current
}

export function subscribeIRSnapshot(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
