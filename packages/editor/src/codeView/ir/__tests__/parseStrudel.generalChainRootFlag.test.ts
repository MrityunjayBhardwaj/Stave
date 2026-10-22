import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseStrudel } from '../parseStrudel'

/**
 * Phase 20-18 Wave E — the never-gate-counted invariant (STRUCTURAL proof).
 *
 * Wave E threads an OFF-BY-DEFAULT optional opts param
 * `{ recogniseGeneralChainRoots?: boolean }` through
 * `parseStrudel → parseExpression → parseRoot` (the 20-17 G4
 * optional-arg-threading idiom; PV50: STACK param, NEVER module state). When
 * `opts.recogniseGeneralChainRoots === true`, the general arm in `parseRoot`
 * emits a structured-OPAQUE `Code.via{method, args, callSiteRange, inner}`
 * wrapper for unbound `identifier(...)` chain heads NOT in the curated
 * `CHAIN_ROOT_RECOGNISER` set (D-01: unknowns CANNOT be modelled — opaque is
 * correct for the general path; this is NOT a `Signal`/`Builder` tag).
 *
 * This spec PINS three structural invariants — together they are the
 * "never-gate-counted" proof:
 *
 *   (i)   default-off path is byte-identical to pre-E-1 — `parseStrudel`
 *         with NO opts argument produces bare-Code (`tag==='Code' &&
 *         via===undefined`) for an unbound long-tail call. Every existing
 *         caller is in this regime by construction; the parity oracle's
 *         opaque-fence (`isCodeFallback`) treats this as fallback (not
 *         structured), so the long-tail does NOT inflate parity.
 *
 *   (ii)  enabled-works — the same input with
 *         `{recogniseGeneralChainRoots:true}` produces a STRUCTURED node
 *         (`body.tag !== 'Code' || body.via !== undefined`) and a deep
 *         walk reaches the structured-opaque wrapper for the long-tail
 *         call site. This proves the arm is constructible and observable
 *         WHEN explicitly enabled — making the long tail MEASURABLE
 *         (the D-01 flagged-general path).
 *
 *   (iii) one-arg oracle invariant — `_bakery-classify.spec.ts:77` calls
 *         `parseStrudel(s.code)` with EXACTLY ONE arg. The oracle never
 *         constructs `opts` → the flag is STRUCTURALLY unreachable from
 *         the gate path. This is a grep-asserted permanent test (the
 *         Wave-0 ACTION 7 pre-state hardened into CI here). Any later
 *         wave adding a 2nd arg to that call site is a STOP.
 *
 * Together these three invariants encode the "MEASURED but NEVER
 * gate-counted" contract: the long tail is observable via opts (ii); the
 * default path stays opaque-fenced (i); and the gate path structurally
 * cannot construct opts (iii). Removing ANY of the three reopens a
 * potential gate-counting path.
 *
 * PV50 (no module state) is verified by inspection: see the durable
 * contract recorded VERBATIM in `20-18-OBSERVATIONS.md §"Wave E
 * never-gate-counted invariant"`.
 */

// 20-18 E-1 — bareCode discriminator (the same shape the parity oracle's
// `isCodeFallback` uses; see _bakery-classify.spec.ts:isCodeFallback): a
// Code node with `via === undefined` is the opaque-fence sentinel.
function isBareCode(ir: unknown): boolean {
  if (!ir || typeof ir !== 'object') return false
  const node = ir as { tag?: unknown; via?: unknown }
  return node.tag === 'Code' && node.via === undefined
}

// Recursively walk an IR node looking for ANY descendant with the
// structured-opaque general-arm wrapper shape ({method, args, inner}
// — the same shape `wrapAsOpaque` produces; NOT the literal-RHS shape).
function findGeneralOpaqueWrapper(
  ir: unknown,
  predicate: (via: { method: string; args: string }) => boolean,
): boolean {
  if (!ir || typeof ir !== 'object') return false
  const node = ir as Record<string, unknown>
  // Check this node's `via`
  const via = node.via as
    | { method?: string; args?: string; inner?: unknown; literal?: true }
    | undefined
  if (
    via &&
    typeof via.method === 'string' &&
    typeof via.args === 'string' &&
    via.literal !== true && // exclude literal arm
    predicate({ method: via.method, args: via.args })
  ) {
    return true
  }
  // Recurse children
  for (const key of Object.keys(node)) {
    const v = node[key]
    if (Array.isArray(v)) {
      for (const item of v) {
        if (findGeneralOpaqueWrapper(item, predicate)) return true
      }
    } else if (v && typeof v === 'object') {
      if (findGeneralOpaqueWrapper(v, predicate)) return true
    }
  }
  return false
}

describe('Wave E — flagged-general chain-root: never-gate-counted invariant', () => {
  /**
   * INVARIANT (i) — default-off path is byte-identical: an unbound
   * `foo(1).bar()` shape with NO opts arg → the deep tree contains NO
   * structured-opaque wrapper for the `foo` token. The result remains the
   * bare-Code form that the parity oracle treats as fallback.
   */
  it('(i) default-off — bare unbound `foo(1).bar()` is bare Code at the long-tail root (no wrapper for `foo`)', () => {
    // The user's code wraps in a synthetic Track('d1', ...) per parseStrudel;
    // we navigate to the inner expression and assert the long-tail form.
    const ir = parseStrudel('foo(1).bar()')
    // Find a wrapper whose method is `foo` (the unbound long-tail token).
    // With opts undefined, the general arm is dormant → NO such wrapper
    // exists in the tree.
    const hasFooWrapper = findGeneralOpaqueWrapper(
      ir,
      (via) => via.method === 'foo',
    )
    expect(hasFooWrapper).toBe(false)
    // Sanity: the result is the bare-Code form somewhere in the tree
    // (the parser falls back to IR.code(trimmed) for unrecognised root +
    // is wrapped in a Track for the no-`$:` path). The opaque fence will
    // fire on this in the parity oracle.
    // We don't assert a specific bare-Code location (the Track wrapping is
    // a separate concern) — only the structural absence of the wrapper.
  })

  /**
   * INVARIANT (ii) — enabled-works: the same input with
   * `{recogniseGeneralChainRoots:true}` produces a STRUCTURED result, and
   * a deep walk reaches a structured-opaque wrapper for the `foo` root.
   */
  it('(ii) enabled — `parseStrudel(foo(1).bar(), { recogniseGeneralChainRoots: true })` emits a structured-opaque wrapper for `foo`', () => {
    const ir = parseStrudel('foo(1).bar()', {
      recogniseGeneralChainRoots: true,
    })
    // The top-level should NOT be bare-Code (it carries at least the
    // Track wrapper + the wrapped inner; even at the inner-most level
    // the long-tail root is wrapped, not bare).
    const isTopLevelBareCode = isBareCode(ir)
    expect(isTopLevelBareCode).toBe(false)
    // Deep walk: find the structured-opaque wrapper for `foo` with raw
    // args `1` (the byte-verbatim source slice).
    const hasFooWrapper = findGeneralOpaqueWrapper(
      ir,
      (via) => via.method === 'foo' && via.args === '1',
    )
    expect(hasFooWrapper).toBe(true)
  })

  /**
   * INVARIANT (ii.b) — enabled-works on a bare identifier root (no parens):
   * unbound bare `foo` with the flag on emits the same structural marker
   * with empty args. The long-tail covers BOTH `identifier(...)` and bare
   * `identifier` shapes.
   */
  it('(ii.b) enabled — bare unbound `foo.bar()` is structured (wrapper with empty args)', () => {
    const ir = parseStrudel('foo.bar()', {
      recogniseGeneralChainRoots: true,
    })
    const isTopLevelBareCode = isBareCode(ir)
    expect(isTopLevelBareCode).toBe(false)
    const hasFooWrapper = findGeneralOpaqueWrapper(
      ir,
      (via) => via.method === 'foo' && via.args === '',
    )
    expect(hasFooWrapper).toBe(true)
  })

  /**
   * INVARIANT (i.b) — curated roots are UNCHANGED by the flag (the arm
   * is strictly the NON-curated complement). Enabling the flag on a
   * curated root (`sine.range(0,1)`) must still produce the curated
   * `Signal{kind:'sine'}` tag, NOT the general wrapper.
   */
  it('(i.b) enabled — curated `sine.range(0,1)` is still a `Signal` (general arm is strictly NON-curated complement)', () => {
    const ir = parseStrudel('sine.range(0,1)', {
      recogniseGeneralChainRoots: true,
    })
    // Search for a Signal node anywhere in the tree (the curated arm fires
    // BEFORE the general arm; the general arm has an explicit
    // `!CHAIN_ROOT_RECOGNISER.has(token)` exclusion).
    const hasSignalSine = JSON.stringify(ir).includes('"tag":"Signal"')
    expect(hasSignalSine).toBe(true)
    // And NO general-opaque wrapper for `sine` (the curated arm wins).
    const hasSineWrapper = findGeneralOpaqueWrapper(
      ir,
      (via) => via.method === 'sine',
    )
    expect(hasSineWrapper).toBe(false)
  })

  /**
   * INVARIANT (iii) — STRUCTURAL grep assertion: the parity oracle
   * (`packages/app/tests/parity-corpus/_bakery-classify.spec.ts`) calls
   * `parseStrudel(s.code)` with EXACTLY ONE arg. The oracle never
   * constructs the opts object → the flag is structurally unreachable
   * from the gate path. Any later wave adding a 2nd arg here is a STOP.
   *
   * Mirrors the literalRhs spec's "read source, grep, assert" idiom; the
   * source-of-truth is the gate spec itself, not a documented invariant.
   */
  it('(iii) ORACLE STRUCTURAL INVARIANT — `_bakery-classify.spec.ts` calls `parseStrudel(s.code)` with EXACTLY one arg (no opts construct)', () => {
    // Resolve the gate spec relative to the editor package root.
    // We walk up from this test's __dirname (resolved by vitest) until we
    // find the parity-corpus spec. Use a hard-coded relative path from
    // the repo root via `process.cwd()` is unreliable in monorepo nested
    // vitest runs — instead, walk up from __filename's directory.
    // (vitest evaluates this with import.meta.url; in commonJS interop
    // we use process.cwd() as the safer anchor since pnpm filters set
    // cwd to the package.)
    // The editor package's cwd is `packages/editor`; the gate spec lives
    // at `packages/app/tests/parity-corpus/_bakery-classify.spec.ts`.
    const candidates = [
      // From packages/editor cwd:
      path.resolve(
        process.cwd(),
        '../app/tests/parity-corpus/_bakery-classify.spec.ts',
      ),
      // From repo root cwd:
      path.resolve(
        process.cwd(),
        'packages/app/tests/parity-corpus/_bakery-classify.spec.ts',
      ),
    ]
    const gateSpecPath = candidates.find((p) => fs.existsSync(p))
    expect(
      gateSpecPath,
      `expected to find _bakery-classify.spec.ts at one of: ${candidates.join(', ')}`,
    ).toBeDefined()
    if (!gateSpecPath) return
    const src = fs.readFileSync(gateSpecPath, 'utf8')
    // The exact pre-state recorded in 20-18-OBSERVATIONS §"ACTION 7":
    //   77:        fallback = isCodeFallback(parseStrudel(s.code))
    // Assert presence + exactly ONE call site with that signature.
    const lines = src.split('\n')
    const callSites = lines.filter((l) => /\bparseStrudel\s*\(/.test(l))
    // There should be exactly one call site of parseStrudel in the gate
    // spec (the oracle). If a later wave adds a 2nd, this trips.
    expect(callSites.length).toBe(1)
    const onlyCall = callSites[0]
    // The call must be `parseStrudel(s.code)` — EXACTLY one arg, no comma,
    // no opts. We assert the call passes a SINGLE arg by checking the
    // text `parseStrudel(s.code)` is present and that the line does NOT
    // contain a second arg pattern (`parseStrudel(s.code,`).
    expect(onlyCall).toMatch(/parseStrudel\(s\.code\)/)
    // Negative: no comma immediately after `s.code` in the call.
    expect(onlyCall).not.toMatch(/parseStrudel\(s\.code\s*,/)
    // And, defensively, the opts-key string MUST NOT appear in the
    // gate spec file (the oracle never names the key).
    expect(src).not.toContain('recogniseGeneralChainRoots')
  })
})
