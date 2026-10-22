/**
 * _waveC-diagnose.spec.ts — Wave C-1 diagnostic harness.
 * Prints per-descriptor tag/bareCode for #3 to identify the residual blocker
 * AFTER Wave C lands chord/arrange Builder roots. Observation, not assertion.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'

const SAMPLES = path.join(
  __dirname,
  '.bakery-runs',
  'samples-2026-05-19T13-24-45-538Z.json',
)

type AnyNode = { tag?: string; via?: unknown; kind?: string; body?: unknown } & Record<string, unknown>

const isBare = (n: AnyNode): boolean =>
  n.tag === 'Code' && n.via === undefined

import { parseExpression } from '../../../editor/src/codeView/ir/parseStrudel'

describe('Wave C diagnose #3 (full program)', () => {
  it('proves chord works: synthetic shape without all() side-effect statement', () => {
    // Same #3 minus the `all(x=>x.punchcard())` line.
    const { samples } = JSON.parse(fs.readFileSync(SAMPLES, 'utf8')) as {
      samples: { hash: string | null; code: string }[]
    }
    const s3 = samples.find((s) => s.hash === '-6c1hEXe8Agi')!
    // Strip the `all(x=>x.punchcard())` side-effect statement (and its blank
    // surrounds) — leaves clean `bindings*, finalExpr` shape.
    const stripped = s3.code.replace(/\nall\(x=>x\s*\.punchcard\(\)\)\n/, '\n')
    const ir = parseStrudel(stripped) as AnyNode
    const out: string[] = []
    out.push(`stripped-#3 whole-program tag=${ir.tag} bare=${isBare(ir)}`)
    if (ir.body) {
      const body = ir.body as AnyNode
      out.push(`body.tag=${body.tag} bare=${isBare(body)}`)
    }
    // Deep walk for chord Builder
    function find(root: unknown, pred: (n: AnyNode) => boolean, seen = new Set<unknown>()): AnyNode | undefined {
      if (!root || typeof root !== 'object' || seen.has(root)) return undefined
      seen.add(root)
      const n = root as AnyNode
      if (pred(n)) return n
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) {
          for (const x of v) { const hit = find(x, pred, seen); if (hit) return hit }
        } else if (v && typeof v === 'object') {
          const hit = find(v, pred, seen); if (hit) return hit
        }
      }
      return undefined
    }
    const hit = find(ir, (n) => n.tag === 'Builder' && n.kind === 'chord')
    out.push(`deep-walk Builder/chord = ${hit ? 'HIT' : 'MISS'}`)
    if (hit) out.push(`  hit.args="${String(hit.args).slice(0, 60)}"`)
    // eslint-disable-next-line no-console
    console.log(out.join('\n'))
    fs.writeFileSync('/tmp/waveC-diagnose-stripped.txt', out.join('\n'))
  })

  it('runs the WHOLE-PROGRAM parseStrudel path and shows what splits/fails', () => {
    const { samples } = JSON.parse(fs.readFileSync(SAMPLES, 'utf8')) as {
      samples: { hash: string | null; code: string }[]
    }
    const s3 = samples.find((s) => s.hash === '-6c1hEXe8Agi')!
    const ir = parseStrudel(s3.code) as AnyNode
    const out2: string[] = []
    out2.push(`whole-program tag=${ir.tag} bare=${isBare(ir)}`)
    if (ir.body) {
      const body = ir.body as AnyNode
      out2.push(`body.tag=${body.tag} bare=${isBare(body)}`)
      if (body.tag === 'Code') {
        const code = String((body as { code?: string }).code ?? '')
        out2.push(`body.code length=${code.length} first200="${code.slice(0, 200).replace(/\n/g, '\\n')}"`)
      }
    }
    // eslint-disable-next-line no-console
    console.log(out2.join('\n'))
    fs.writeFileSync('/tmp/waveC-diagnose-prog.txt', out2.join('\n'))
  })

  it('observe per-binding-RHS tags in #3 to classify residual blocker', () => {
    const { samples } = JSON.parse(fs.readFileSync(SAMPLES, 'utf8')) as {
      samples: { hash: string | null; code: string }[]
    }
    const s3 = samples.find((s) => s.hash === '-6c1hEXe8Agi')!
    const out: string[] = []

    // Probe: parse each binding RHS in isolation (no bindings map), and each
    // 'composite' RHS WITH the bindings map populated from prior bindings.
    // This classifies which binding fails to flip — the chord ones SHOULD
    // flip with Wave C; if a DIFFERENT class blocks, that's the NEW-class
    // STOP signal (pre-mortem 2 / PK18).
    const rhsList: [string, string][] = [
      ['crackles',  'sound("crackle").compressor("-24:20:10:.002:.02").gain(0.4).color("gray")'],
      ['padsbell',  'chord("Am Am").voicing().sound("gm_celesta:3").color("blue")\n    .attack(0.03).sustain(0.6).release(0.8)\n    .room(1).size(4)\n    .lpf("500 200").lpenv(4).lpattack(0.2)'],
      ['leadbell',  'note("[B3] [E3] [B3] [A3], ~ E2 ~ E2")\n    .sound("gm_tinkle_bell").color("teal")\n    .hpf(850).release(0.5).pan("0.65 0.35 0.65 0.35")\n    .room(2).gain(0.5)'],
      ['keysbcbg',  'note("[A1 E1] [C2 E1] [D2 E2] [Cb2 C2]").add(note(12))\n    .sound("passerine_acc:2").color("skyblue")\n    .rarely(x=>x.superimpose(x=>x.add(note(24).speed("-1").gain(0.2).room(1.5))))'],
      ['softkeys',  'note("[A0 E0] [C1 E0] [D1 E1] ~")\n    .sound("passerine_acc:4").color("skyblue")\n    .add(note(12).speed("-1").gain(0.7).room(1.5))'],
      ['dotsawst',  'sound("sawtooth").color("pink")\n    .pan(rand).decay(1/8).ply(4).fast(4).note("A").room(0.3)\n    .sometimes(x=>x.ply(4).gain(rand))'],
      ['deadchoir', 'sound("passerine_acc:5").note("A2 A2, A1 A1, E2, E1").fast(4).legato(0.2)\n    .gain(1).release(1.6).room(2).pan(rand).color("purple")\n    .sometimes (x=>x .add(note(-24)) .crush(8))'],
      ['deadkeys',  'keysbcbg.rev().fast(2)\n    .pan("0.5 | 0.8 | 0.2").gain("0.8").crush(8).color("skyblue")'],
      ['melosupp',  'chord("< Am C Am E >").voicing().sound("passerine_acc:5")\n    .add(note(-24)).release(2).hpf(400).dist(0.4).crush(5)\n    .fast(2).pan("0.3 0.7").color("indigo")'],
      ['allsnare',  'sound("< [~ ~ passerine_snare:1 ~] [~ ~ passerine_snare:1 [~ ~ passerine_rimshot:4 passerine_rimshot:3]] >")\n    .color("orange").gain(1.5)\n    .pan("0.5 0.5 0.5 [~ 0.25 0.75]")'],
      ['hihatpat',  'sound("passerine_hihat:4*16").color("green").note("c2 c2 c2 c2 , < [~ g1 ~ ~] [~ ~ ~ g1] >".fast(4)).gain(0.6)'],
      ['kicktemp',  'sound("< passerine_kick [~ passerine_kick passerine_kick ~ ~ ~ passerine_kick ~] >")\n    .gain(1).color("darkred")'],
      ['basse808',  'sound("< passerine_basse:2 [~ passerine_basse:2 passerine_basse:2 ~ ~ ~ passerine_basse:3 ~] >")\n    .note("A1 A1 A1 E3").gain(0.8).color("darkviolet")'],
      ['ultmkick',  'note("A1 A1 [A1 ~ ~ A1] [~ ~ A1 ~]")\n    .sound("passerine_kick:5, passerine_basse:5 ").color("darkred")'],
      ['intro',     'stack(\n    crackles, padsbell, leadbell, keysbcbg\n    )'],
      ['core1',     'stack(\n    padsbell, leadbell, softkeys,\n    allsnare, kicktemp, hihatpat, basse808\n  \n  )'],
      ['interlude', 'stack(\n   dotsawst.gain("1 0.7 0.3"), deadchoir, basse808, crackles\n  )'],
      ['core2',     'stack(\n    deadkeys, ultmkick\n  )'],
      ['core3',     'stack(\n    core2, melosupp\n  )'],
      ['outro',     'stack(\n    padsbell, deadchoir, keysbcbg.lpf("200 400 800")\n  )'],
    ]
    const finalExpr = '"< 0!8 1!12 2!4 3!4 4!4 5!4>".pick([intro, core1, interlude, core2, core3, outro])'

    // Pass 1: each in isolation
    out.push('=== Pass 1 — each RHS in isolation (no bindings) ===')
    for (const [name, rhs] of rhsList) {
      const ir = parseExpression(rhs, 0, undefined, new Map()) as AnyNode
      out.push(`${name.padEnd(10)} tag=${String(ir.tag).padEnd(8)} bare=${isBare(ir)}`)
    }
    const irFinal = parseExpression(finalExpr, 0, undefined, new Map()) as AnyNode
    out.push(`FINAL      tag=${String(irFinal.tag).padEnd(8)} bare=${isBare(irFinal)}`)

    // Pass 2: in declaration order, building bindings as we go (mimic fixpoint
    // iter 0 in order — for understanding which binding NEEDS the others).
    out.push('=== Pass 2 — declaration order with accumulating bindings ===')
    const bindings = new Map<string, AnyNode>()
    for (const [name, rhs] of rhsList) {
      const ir = parseExpression(rhs, 0, undefined, bindings as unknown as ReadonlyMap<string, never>) as AnyNode
      const bare = isBare(ir)
      out.push(`${name.padEnd(10)} tag=${String(ir.tag).padEnd(8)} bare=${bare}`)
      if (!bare) bindings.set(name, ir)
    }
    const irFinal2 = parseExpression(finalExpr, 0, undefined, bindings as unknown as ReadonlyMap<string, never>) as AnyNode
    out.push(`FINAL      tag=${String(irFinal2.tag).padEnd(8)} bare=${isBare(irFinal2)}`)

    const text = out.join('\n')
    // eslint-disable-next-line no-console
    console.log('\n' + text + '\n')
    fs.writeFileSync('/tmp/waveC-diagnose.txt', text)
  })
})
