/**
 * _1116-refusal-attribution.spec.ts — PROBE (inert: `_` prefix + `.spec.ts`, #1111).
 *
 * Two questions, both surfaces, all asked through the PUBLIC entry ([[P413]]):
 *   1. How many units does a refine reach, and how many refuse?
 *   2. Of the refusals, how many are on a path that ACTUALLY HONOURED the scale and
 *      merely failed to report it? — the obligation the entry self-report creates.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseStepGrid,
  parseStepGridCore,
  parsePianoRoll,
  parsePianoRollCore,
  projectStepGridDerived,
  projectPianoRollDerived,
} from '../../../editor/src/codeView/notation/parse'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type { StepGridModel, PianoRollModel } from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

function shape(m: { leafSource?: unknown; altSource?: unknown; source?: unknown }): string {
  if (m.leafSource) return 'leaf'
  if (m.altSource) return 'altSource'
  if (m.source) return 'source'
  return 'bare'
}

function gridOnsets(m: StepGridModel): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const lane of m.lanes) {
    const cols: number[] = []
    lane.cells.forEach((c, i) => {
      if (isCellOn(c)) cols.push(i)
    })
    out.set(`${lane.sound}#${lane.part ?? 0}`, cols)
  }
  return out
}

function gridUnfaithful(base: StepGridModel, got: StepGridModel, k: number): string | null {
  const b = gridOnsets(base)
  const g = gridOnsets(got)
  if (g.size !== b.size) return `lane count ${g.size} !== ${b.size}`
  for (const [lane, cols] of b) {
    const x = g.get(lane)
    if (!x) return `lane ${lane} missing`
    if (x.length !== cols.length) return `lane ${lane} onset count ${x.length} !== ${cols.length}`
    if (x.some((c, i) => c !== cols[i] * k)) return `lane ${lane} moved`
  }
  return null
}

/** the roll's music: pitch + start + duration, all three scaling together */
function rollUnfaithful(base: PianoRollModel, got: PianoRollModel, k: number): string | null {
  if (got.notes.length !== base.notes.length) {
    return `note count ${got.notes.length} !== ${base.notes.length}`
  }
  const key = (n: { pitch: string; start: number; duration: number }, f: number) =>
    `${n.pitch}@${n.start * f}+${n.duration * f}`
  const b = base.notes.map((n) => key(n, k)).sort()
  const g = got.notes.map((n) => key(n, 1)).sort()
  for (let i = 0; i < b.length; i++) if (b[i] !== g[i]) return `note ${g[i]} !== ${b[i]}`
  return null
}

function sweep<M extends { steps: number; viewScale?: number }>(
  label: string,
  parse: (m: string, k?: number) => { ok: true; model: M } | { ok: false; reason: string },
  core: (m: string, k?: number) => { ok: true; model: M } | { ok: false; reason: string },
  derived: (
    m: string,
    fb: { ok: false; reason: string },
    k?: number,
  ) => { ok: true; model: M } | { ok: false; reason: string },
  unfaithful: (base: M, got: M, k: number) => string | null,
) {
  for (const k of [2, 4]) {
    const buckets = new Map<string, number>()
    const bump = (key: string) => buckets.set(key, (buckets.get(key) ?? 0) + 1)
    const examples = new Map<string, string>()
    let opened = 0
    let coreParsed = 0
    let honoured = 0
    let refused = 0
    const unfaith: string[] = []
    const rerouted: string[] = []

    for (const mini of minis) {
      const base = parse(mini)
      if (!base.ok) continue
      opened++
      if (core(mini).ok) coreParsed++
      const r = parse(mini, k)
      if (r.ok) {
        honoured++
        // ⚠ THE ROUTING QUESTION, asked of what the ENTRY actually returned rather
        // than by re-deriving the routing ([[P413]]): a refine must come back in the
        // same source shape, because the shape IS which writer owns the bytes.
        const s1 = `${shape(base.model as never)}/bars=${(base.model as { bars?: number }).bars ?? 1}`
        const sk = `${shape(r.model as never)}/bars=${(r.model as { bars?: number }).bars ?? 1}`
        if (s1 !== sk) rerouted.push(`${mini.replace(/\n/g, ' ')} :: ${s1} → ${sk}`)
        if (r.model.steps !== base.model.steps * k) {
          unfaith.push(`${mini} @k=${k}: steps ${r.model.steps} !== ${base.model.steps}*${k}`)
        } else {
          const why = unfaithful(base.model, r.model, k)
          if (why) unfaith.push(`${mini} @k=${k}: ${why}`)
        }
        continue
      }
      refused++
      // the SHIPPED routing: ownership decided at the document's own resolution, then
      // the scale applied by whichever path owns it — mirrored here so the buckets
      // describe the entry that actually ran, not a routing it no longer uses
      const ownedByCore = core(mini).ok
      const inner = ownedByCore
        ? core(mini, k)
        : derived(mini, core(mini) as { ok: false; reason: string }, k)
      const layer = ownedByCore ? 'core' : 'derived'
      let verdict: string
      if (!inner.ok) {
        verdict = `REFUSED-BY-ITS-OWN-PATH/${layer}/${shape(base.model as never)}`
      } else if (inner.model.steps === base.model.steps * k) {
        const why = unfaithful(base.model, inner.model, k)
        verdict = `SILENTLY-HONOURED/${layer}/${shape(inner.model as never)}/${why === null ? 'faithful' : 'UNFAITHFUL'}`
      } else {
        verdict = `UNSCALED/${layer}/${shape(inner.model as never)}`
      }
      bump(verdict)
      if (!examples.has(verdict)) examples.set(verdict, mini)
    }

    console.log(
      `\n${label} k=${k}: opened=${opened} coreParsed=${coreParsed} honoured=${honoured} refused=${refused} unfaithful=${unfaith.length}`,
    )
    for (const [key, n] of [...buckets].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(n).padStart(4)}  ${key}   e.g. ${JSON.stringify(examples.get(key)).slice(0, 62)}`)
    }
    for (const u of unfaith.slice(0, 8)) console.log(`   ⚠ ${u.slice(0, 120)}`)
    console.log(`   REROUTED (writer swapped by a zoom): ${rerouted.length}`)
    for (const u of rerouted.slice(0, 10)) console.log(`     ↔ ${u.slice(0, 110)}`)
  }
}

describe('#1116 refusal attribution, both surfaces', () => {
  it('grid', () => {
    sweep('GRID', parseStepGrid, parseStepGridCore, projectStepGridDerived, gridUnfaithful)
  })
  it('roll', () => {
    sweep('ROLL', parsePianoRoll, parsePianoRollCore, projectPianoRollDerived, rollUnfaithful)
  })
})
