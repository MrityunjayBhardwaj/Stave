/**
 * _proto-d01.spec.ts — Phase 20-17 D-01 least-fixpoint regression oracle.
 *
 * VENDORED from the preserved Task-1 prototype (/tmp/proto-d01-fixpoint.spec.ts,
 * 20-16). Maintainer-only: run via `pnpm --filter @stave/app test:proto`
 * (vitest.proto.config.ts) — NOT in the CI `vitest.config.ts` include, mirroring
 * the `_bakery-classify.spec.ts` underscore convention. Runs under vite-node so
 * `parseExpression`/`parseStrudel` import from the editor SOURCE path (the
 * @stave/editor barrel crashes standalone node via @strudel/draw → gifenc).
 *
 * It vendors byte-for-byte copies of `splitTopLevelStatements` / `BINDING_RE`
 * + the proposed fixpoint variant; it does NOT edit parseStrudel.ts. The
 * per-iteration diagnostic console.log is the wave-by-wave observation
 * evidence — do NOT silence it. The #141 repros live alongside this spec
 * under bakery-runs/ (was /tmp/ in the throwaway prototype).
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseExpression, skipWhitespaceAndLineComments, parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'
import type { PatternIR } from '../../../editor/src/codeView/ir/PatternIR'

// Vendored Wave-0 oracle: the #141 repros live alongside this spec under bakery-runs/
// (was /tmp/ in the throwaway prototype). Loaded verbatim.
//
// ⚠ THIS ORACLE IS NARROWER THAN IT WAS. Six repros were vendored here in 20-17; five
// declared no licence and were removed in #1292, leaving the one that declares CC0. The
// verdicts the prototype recorded were taken over all six and are not re-derivable from
// this tree — treat the run below as an exercise of the classifier, not as the Wave-0
// measurement. Nothing depends on it: this spec is `_`-prefixed and the suite excludes it.
const REPRO_DIR = path.join(__dirname, 'bakery-runs')
const readRepro = (r: string): string =>
  fs.readFileSync(path.join(REPRO_DIR, `repro${r}.strudel`), 'utf8')

// ---- exact copies of the private primitives from parseStrudel.ts ----
const BINDING_RE = /^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/

function splitTopLevelStatements(
  body: string,
  baseOffset: number,
): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = []
  let depth = 0
  let inString = false
  let stringChar = ''
  let escaped = false
  let segStart = 0
  let i = 0
  const flush = (end: number): void => {
    const raw = body.slice(segStart, end)
    if (raw.trim().length > 0) {
      // #151/#152: strip /* */ + // and skip if nothing executable
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n')
        .trim()
      if (stripped.length > 0) {
        const lead = raw.length - raw.trimStart().length
        out.push({ text: raw.trim(), offset: baseOffset + segStart + lead })
      }
    }
    segStart = end + 1
  }
  while (i < body.length) {
    const ch = body[i]
    if (escaped) { escaped = false; i++; continue }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === stringChar) inString = false
      i++; continue
    }
    if (ch === '/' && body[i + 1] === '/') {
      while (i < body.length && body[i] !== '\n') i++
      continue
    }
    if (ch === '/' && body[i + 1] === '*') {
      // #152: skip /* ... */ block comments. Mirror of production.
      i += 2
      while (i < body.length && !(body[i] === '*' && body[i + 1] === '/')) i++
      if (i < body.length) i += 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; i++; continue }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; i++; continue }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; i++; continue }
    if (depth === 0 && ch === ';') { flush(i); i++; continue }
    if (depth === 0 && ch === '\n') {
      // #148 forward-peek for `.` + #150 backward-peek for `=`. Mirror
      // of production parseStrudel.ts.
      const peek = skipWhitespaceAndLineComments(body, i + 1)
      if (body[peek] === '.') { i++; continue }
      let k = i - 1
      while (k >= segStart && /\s/.test(body[k])) k--
      if (k >= segStart && body[k] === '=') { i++; continue }
      flush(i); i++; continue
    }
    i++
  }
  flush(body.length)
  return out
}

const isBareCode = (ir: PatternIR): boolean =>
  ir.tag === 'Code' && (ir as { via?: unknown }).via === undefined

// ---- PROPOSED D-01 fixpoint variant (A-1 descriptor list + A-2 loop) ----
interface Desc { stmtIndex: number; name: string; rhs: string; rhsOffset: number }

const DIAG: string[] = []

function buildBindingMapFixpoint(
  body: string,
  baseOffset: number,
  // OQ1 relaxation toggle (prototype probes BOTH dispositions)
  relaxUnreferencedOpaque: boolean,
  diagTag = '',
): { bindings: ReadonlyMap<string, PatternIR>; finalExpr: string; finalOffset: number } | null {
  const D = (s: string): void => { if (diagTag) DIAG.push(`[${diagTag}] ${s}`) }
  const stmts = splitTopLevelStatements(body, baseOffset)
  D(`stmts=${stmts.length}`)
  if (stmts.length < 2) { D('BAIL <2 stmts'); return null }

  // A-1: descriptor list + finalIdx + statement-order short-circuit
  const descs: Desc[] = []
  let finalIdx = -1
  for (let s = 0; s < stmts.length; s++) {
    const { text, offset } = stmts[s]
    const bm = text.match(BINDING_RE)
    if (!bm) { finalIdx = s; break }
    const name = bm[1]
    const rhs = bm[2].trim()
    const rhsStartInText = text.length - rhs.length
    descs.push({ stmtIndex: s, name, rhs, rhsOffset: offset + rhsStartInText })
  }
  D(`descs=${descs.map((d) => d.name).join(',')} finalIdx=${finalIdx} finalText=${finalIdx >= 0 ? JSON.stringify(stmts[finalIdx].text.slice(0, 60)) : 'n/a'}`)
  if (finalIdx === -1) { D('BAIL finalIdx=-1 (all bindings)'); return null }
  if (finalIdx !== stmts.length - 1) { D(`BAIL finalIdx ${finalIdx} != last ${stmts.length - 1} (trailing binding)`); return null }

  // A-1 OQ4: dup-key keyed on declaration identity (stmtIndex), first-dup-wins
  const seen = new Set<string>()
  for (const d of descs) {
    if (seen.has(d.name)) { D(`BAIL dup-key ${d.name}`); return null }
    seen.add(d.name)
  }

  const finalExpr = stmts[finalIdx].text
  const finalOffset = stmts[finalIdx].offset

  // A-2 step 5a: PRE-SUBSTITUTION syntactic reference graph (RHS text +
  // final-expr text). Identifier class = BINDING_RE LHS class.
  const idRe = /[A-Za-z_$][\w$]*/g
  const referencedNames = new Set<string>()
  const scanIds = (txt: string, excludeOwn?: string): void => {
    for (const m of txt.matchAll(idRe)) {
      if (m[0] !== excludeOwn) referencedNames.add(m[0])
    }
  }
  for (const d of descs) scanIds(d.rhs)
  scanIds(finalExpr)

  // A-2: bounded least-fixpoint over the RHS parse (<= N iterations)
  const resolved = new Map<string, PatternIR>()
  const pending = new Set(descs.map((d) => d.stmtIndex))
  const N = descs.length
  for (let iter = 0; iter < N; iter++) {
    let added = 0
    for (const d of descs) {
      if (!pending.has(d.stmtIndex)) continue
      const ir = parseExpression(d.rhs, d.rhsOffset, undefined, resolved)
      const bc = isBareCode(ir)
      D(`iter${iter} ${d.name} rhs=${JSON.stringify(d.rhs.slice(0, 50))} -> tag=${ir.tag} bareCode=${bc}`)
      if (!bc) {
        resolved.set(d.name, ir)
        pending.delete(d.stmtIndex)
        added++
      }
    }
    if (added === 0) break
  }
  D(`post-fixpoint resolved=[${[...resolved.keys()].join(',')}] pending=[${[...pending].join(',')}]`)

  // A-2 step 3 + 5b: occurs-check terminal / opaque fence post-fixpoint
  for (const d of descs) {
    if (!pending.has(d.stmtIndex)) continue
    // still unresolved after fixpoint: bare-Code RHS (opaque or cyclic)
    if (relaxUnreferencedOpaque) {
      // eligible iff name absent from EVERY OTHER desc RHS text AND final-expr text
      const others = descs.filter((x) => x.stmtIndex !== d.stmtIndex)
      const refElsewhere = new Set<string>()
      for (const o of others) for (const m of o.rhs.matchAll(idRe)) refElsewhere.add(m[0])
      for (const m of finalExpr.matchAll(idRe)) refElsewhere.add(m[0])
      if (!refElsewhere.has(d.name)) {
        // provably-unreferenced opaque binding → drop, do NOT whole-program bail
        pending.delete(d.stmtIndex)
        continue
      }
    }
    return null // opaque-RHS / occurs-check terminal → whole-program Code bail
  }

  return { bindings: resolved, finalExpr, finalOffset }
}

// Mirror parseStrudel's no-$: entry: build map, parse final expr threading
// bindings, wrap in synthetic Track('d1', body); classify P67.
function classify(code: string, relax: boolean, diagTag = ''): { verdict: 'structured' | 'code'; reason: string } {
  // strip whole-line comments + blank lead is done by stripParserPrelude in
  // real code; for the prototype the repros are extracted raw — emulate the
  // minimal prelude strip (drop leading // lines + the recognised setcps()
  // boot call) so the binding map sees the binding region. We approximate by
  // running the proposed map over the raw body; setcps(1) etc. are handled
  // by the real stripParserPrelude in production — here we test the FIXPOINT
  // shape, not the strip (Wave B).
  const lines = code.split('\n')
  // drop leading comment/blank lines and a leading setcps/setcpm/samples line
  let start = 0
  while (start < lines.length) {
    const t = lines[start].trim()
    if (t === '' || t.startsWith('//') || /^(setcps|setCps|setcpm|setCpm|samples|useRNG|initAudio|aliasBank|setVoicingRange)\s*\(/.test(t)) {
      start++
    } else break
  }
  // also drop a trailing // @version line region — keep simple: cut trailing comment-only lines
  let end = lines.length
  while (end > start && (lines[end - 1].trim() === '' || lines[end - 1].trim().startsWith('//') || lines[end - 1].trim().startsWith('/*') || lines[end - 1].trim().startsWith('*'))) end--
  const body = lines.slice(start, end).join('\n')
  const baseOffset = lines.slice(0, start).join('\n').length + (start > 0 ? 1 : 0)

  const bound = buildBindingMapFixpoint(body, baseOffset, relax, diagTag)
  if (!bound) {
    return { verdict: 'code', reason: 'buildBindingMap returned null (fence/shape/occurs-check/dup-key)' }
  }
  const inner = parseExpression(bound.finalExpr, bound.finalOffset, undefined, bound.bindings)
  if (diagTag) DIAG.push(`[${diagTag}] FINAL parse -> tag=${inner.tag} via=${(inner as { via?: unknown }).via !== undefined} bareCode=${isBareCode(inner)}`)
  if (isBareCode(inner)) {
    return { verdict: 'code', reason: 'final expr resolved to bare Code' }
  }
  return { verdict: 'structured', reason: `Track(d1, ${inner.tag})` }
}

describe('D-01 fixpoint HARD GATE prototype', () => {
  it('runs the surviving #141 repro + synthetics under BOTH OQ1 dispositions', () => {
    // Was six; the five that declared no licence were removed in #1292. See the note on
    // REPRO_DIR — the original six-way verdict cannot be re-taken from this tree.
    const repros = ['__LsnlgQ6osk']
    const out: string[] = []
    out.push(`=== ${repros.length} REPRO(S) (proto buildBindingMap variant) ===`)
    for (const r of repros) {
      const code = readRepro(r)
      const noRelax = classify(code, false)
      const relax = classify(code, true, `R:${r}`)
      out.push(`${r.padEnd(14)} | noRelax=${noRelax.verdict.padEnd(10)} (${noRelax.reason})`)
      out.push(`${' '.repeat(14)} | relax  =${relax.verdict.padEnd(10)} (${relax.reason})`)
    }
    out.push('')
    out.push(`=== ${repros.length} REPRO(S) (PRODUCTION parseStrudel — current source with Wave 0 bundle) ===`)
    for (const r of repros) {
      const code = readRepro(r)
      const ir = parseStrudel(code) as Record<string, unknown>
      // Mirror _bakery-classify.spec.ts:isCodeFallback — Track wrapper has `.body`.
      const body =
        ir.tag === 'Track' && ir.body && typeof ir.body === 'object'
          ? (ir.body as Record<string, unknown>)
          : ir
      const isBare = body.tag === 'Code' && (body as { via?: unknown }).via === undefined
      out.push(`${r.padEnd(14)} | production=${isBare ? 'code (bare)' : `structured (body.tag=${body.tag}${(body as { via?: unknown }).via !== undefined ? ' via' : ''})`}`)
    }
    out.push('')
    out.push('=== SYNTHETICS ===')
    const fwd = 'const a=b\nconst b=n("0")\nstack(a)'
    const cyc = 'const a=b\nconst b=a\nstack(a,b)'
    const dup = 'var x=n("0")\nvar x=n("1")\nstack(x)'
    const deadOpaque = 'var d=makeBass()\nconst p=n("0")\nstack(p)'
    const refOpaque = 'const p=makeBass()\nstack(p)'
    for (const [label, src, relax] of [
      ['forward-ref (b)', fwd, false],
      ['cyclic (c)', cyc, false],
      ['dup-key (d)', dup, false],
      ['dead-opaque 5c [noRelax]', deadOpaque, false],
      ['dead-opaque 5c [relax]', deadOpaque, true],
      ['ref-opaque 5c [relax]', refOpaque, true],
    ] as [string, string, boolean][]) {
      const v = classify(src, relax)
      out.push(`${label.padEnd(28)} | ${v.verdict.padEnd(10)} (${v.reason})`)
    }
    out.push('')
    out.push('=== DIAGNOSTICS (relax run per repro) ===')
    out.push(...DIAG)
    const text = out.join('\n')
    // eslint-disable-next-line no-console
    console.log('\n' + text + '\n')
    fs.writeFileSync('/tmp/proto-d01-output.txt', text)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Phase 20-18 Wave-0 THE LOKĀYATA PROTOTYPE — the az2 chain-ARG-signal
// question, settled by OBSERVATION (NOT inference). The phase's PRIMARY
// parity risk: does a signal-VALUED chain-method ARG bareCode the whole
// chain, or does the existing applyChain tolerate it opaquely once the
// ROOT is recognised? Verdict drives the Wave A/B taxonomy scope. The probe
// makes ZERO production change — it parses isolated shapes via the
// production parseExpression/parseStrudel and records the EXACT outcome tag.
// _-prefixed convention; runs under test:proto, NOT in CI.
// ─────────────────────────────────────────────────────────────────────────
describe('WAVE-0 az2 CHAIN-ARG-SIGNAL PROTOTYPE — settled by observation', () => {
  it('parses the isolated chain-arg-signal shapes via production parseExpression', () => {
    const tag = (ir: PatternIR): string => ir.tag
    const bare = (ir: PatternIR): boolean => isBareCode(ir)
    const probe = (label: string, src: string): string => {
      let ir: PatternIR
      try {
        ir = parseExpression(src, 0, undefined, new Map())
      } catch (e) {
        return `${label.padEnd(34)} THREW ${(e as Error).message}`
      }
      return `${label.padEnd(34)} tag=${tag(ir).padEnd(8)} bare=${String(bare(ir)).padEnd(5)}  src=${JSON.stringify(src.slice(0, 70))}`
    }

    // The FULL verbatim az2 RHS, byte-for-byte from repro__LsnlgQ6osk.strudel
    // lines 13-23 (NOT paraphrased — the 20-15 V-2 "do not paraphrase" lesson).
    const az2Rhs =
      'irand(12).struct("x(8,8)|x(4,8)")\n' +
      '  .sometimesBy(perlin.range(0.0,1.0),sub(8))\n' +
      '  .sometimes(slow(2))\n' +
      '  .scale("<G:dominant@2 G:major D:major>")\n' +
      '  .note()\n' +
      '  .s("<piano sine>")\n' +
      '  .room(0.2)\n' +
      '  .clip(1)\n' +
      '  .degradeBy(perlin.range(0,1))\n' +
      '  .fm(sine.range(1.5,8).fast(perlin.range(2.8,3.2)))\n' +
      '  .pan(sine.range(0.4,0.6).fast(perlin.range(2.8,3.2)))'

    const out: string[] = []
    out.push('=== WAVE-0 az2 CHAIN-ARG-SIGNAL PROTOTYPE (production parseExpression, isolation) ===')
    // (a) baseline: root + struct, NO signal-valued arg.
    out.push(probe('(a) irand+struct (no sig arg)', 'irand(12).struct("x(8,8)|x(4,8)")'))
    // (b) signal-VALUED chain arg — does applyChain tolerate it opaquely?
    out.push(probe('(b) irand+sometimesBy(sigarg)', 'irand(12).sometimesBy(perlin.range(0,1), sub(8))'))
    // (c) the FULL verbatim az2 RHS (current = bare Code, the D-02 target).
    out.push(probe('(c) FULL verbatim az2 RHS', az2Rhs))
    // STOP-BOUNDARY probe: the recursive signal-arg-of-signal-arg shape that
    // lives in az2 line 22 — `.fm(sine.range(1.5,8).fast(perlin.range(2.8,3.2)))`.
    // If (b)/(c) require RECURSIVE signal-expr parsing to arbitrary depth →
    // NEW-CLASS PK18 STOP (NOT Wave-0-sizable). This probe records the depth.
    out.push(probe('(d) STOP-BOUNDARY recursive sigarg', 'sine.range(1.5,8).fast(perlin.range(2.8,3.2))'))
    // control: a plain signal root in isolation (already bare today — the
    // D-02 target surface for Wave A/B, confirms nothing regressed).
    out.push(probe('ctrl perlin.range(0,1)', 'perlin.range(0,1)'))
    // control: a STRUCTURED chain whose arg is a NON-signal value, to show
    // applyChain's default arg tolerance baseline (sound() root recognised).
    out.push(probe('ctrl sound("a").sometimesBy(.5,x)', 'sound("a b").sometimesBy(0.5, fast(2))'))

    const text = out.join('\n')
    // eslint-disable-next-line no-console
    console.log('\n' + text + '\n')
    fs.writeFileSync('/tmp/proto-d01-chainarg.txt', text)
  })
})
