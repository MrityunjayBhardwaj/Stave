import { describe, it, expect } from 'vitest'
import { parseStrudel, extractTracks, stripParserPrelude } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import type { PatternIR } from '../PatternIR'

/** Test-local recursive walker: find first node matching predicate. Inlined
 *  here because no shared helper exists yet (RESEARCH §C — α-1 PART C). */
function findNode(
  node: PatternIR,
  pred: (n: PatternIR) => boolean,
): PatternIR | undefined {
  if (pred(node)) return node
  // Walk children for known structural tags.
  const kids: PatternIR[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = node as any
  if (n.body && typeof n.body === 'object' && 'tag' in n.body) kids.push(n.body)
  if (n.value && typeof n.value === 'object' && 'tag' in n.value) kids.push(n.value)
  if (n.then && typeof n.then === 'object' && 'tag' in n.then) kids.push(n.then)
  if (n.else_ && typeof n.else_ === 'object' && 'tag' in n.else_) kids.push(n.else_)
  if (Array.isArray(n.tracks)) kids.push(...n.tracks.filter((c: unknown) => c && typeof c === 'object' && 'tag' in (c as object)))
  if (Array.isArray(n.children)) kids.push(...n.children.filter((c: unknown) => c && typeof c === 'object' && 'tag' in (c as object)))
  if (n.via?.inner) kids.push(n.via.inner)
  for (const k of kids) {
    const found = findNode(k, pred)
    if (found) return found
  }
  return undefined
}

describe('20-11 wave α — Track wrap shape', () => {
  it('non-`$:` single expression wraps in synthetic Track(d1, ...) (γ-4 — D-04 option a)', () => {
    // Wave γ — synthetic-d1 wrap. The wrap has NO loc and NO userMethod
    // (distinguishes from .p("d1")). toStrudel's β-2 Track arm strips it
    // on round-trip when userMethod === undefined so byte identity holds.
    const ir = parseStrudel('s("bd*4")')
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    expect(ir.trackId).toBe('d1')
    expect(ir.userMethod).toBeUndefined()
    expect(ir.loc).toBeUndefined()
    // The body is the inner expression (not Track-wrapped).
    expect(ir.body.tag).not.toBe('Track')
  })

  it('single `$:` block wraps with d1 + loc covering $: line range', () => {
    const code = '$: s("bd*4")'
    const ir = parseStrudel(code)
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    expect(ir.trackId).toBe('d1')
    expect(ir.loc?.[0]?.start).toBe(0)            // $ position
    expect(ir.loc?.[0]?.end).toBe(code.length)    // through end of source
    expect(ir.userMethod).toBeUndefined()         // synthetic-from-$:
  })

  it('two `$:` blocks wrap as Stack of Track(d1, ...) + Track(d2, ...)', () => {
    const ir = parseStrudel('$: s("hh*8")\n$: s("hh*8")')
    expect(ir.tag).toBe('Stack')
    if (ir.tag !== 'Stack') throw new Error('unreachable')
    const tracks = ir.tracks
    expect(tracks.length).toBe(2)
    expect(tracks[0].tag).toBe('Track')
    expect(tracks[1].tag).toBe('Track')
    if (tracks[0].tag !== 'Track' || tracks[1].tag !== 'Track') {
      throw new Error('unreachable')
    }
    expect(tracks[0].trackId).toBe('d1')
    expect(tracks[1].trackId).toBe('d2')
    // First Track loc starts at 0 ($ of first line); second starts at 13
    // (\n + $ of second line). Each loc spans through the next $: line
    // start (or code.length for the last).
    expect(tracks[0].loc?.[0]?.start).toBe(0)
    expect(tracks[1].loc?.[0]?.start).toBe(13)
  })

  it('.p("name") on single `$:` expression: outer Track(d1) wraps inner Track("name") with userMethod=p', () => {
    // The outer extractTracks wrap (Track('d1', ...) for the single $:)
    // contains the inner `.p("lead")`-derived Track. collect's outer-
    // then-inner walk semantics will apply at β-1; γ-6 has the regression
    // test for the inner-wins precedence.
    const ir = parseStrudel('$: note("c").p("lead")')
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    expect(ir.trackId).toBe('d1')   // outer synthetic-from-$:
    const inner = ir.body
    expect(inner.tag).toBe('Track')
    if (inner.tag !== 'Track') throw new Error('unreachable')
    expect(inner.trackId).toBe('lead')
    expect(inner.userMethod).toBe('p')
  })

  it('.p() with empty string falls back to wrapAsOpaque (PV37 preserved)', () => {
    const ir = parseStrudel('$: note("c").p("")')
    // outer Track('d1', ...). Inner is the receiver wrapped as Code-with-via,
    // NOT Track — empty trackId is meaningless and would collide with the
    // synthetic `d1` numbering.
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    expect(ir.body.tag).toBe('Code')
  })

  it('.p() with mini-syntax falls back to wrapAsOpaque (P50 single-decision)', () => {
    const ir = parseStrudel('$: note("c").p("<a b>")')
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    expect(ir.body.tag).toBe('Code')   // angle brackets routed through wrapAsOpaque
    if (ir.body.tag !== 'Code') throw new Error('unreachable')
    expect(ir.body.via).toBeDefined()
    expect(ir.body.via?.method).toBe('p')
    expect(ir.body.via?.args).toBe('"<a b>"')
  })

  it("Phase 20-11 wave-δ — .p('name') with SINGLE quotes also produces Track wrap", () => {
    // Strudel's transpiler converts DOUBLE-quoted strings to mini-
    // notation Patterns at runtime, so `.p("name")` would crash. The
    // working idiom is single quotes (`.p('name')`). The IR parser
    // must accept both quote styles so the user's correct-at-runtime
    // single-quoted form ALSO wraps as Track at the IR level.
    const ir = parseStrudel("$: note(\"c\").p('kick')")
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    expect(ir.trackId).toBe('d1')
    const inner = ir.body
    expect(inner.tag).toBe('Track')
    if (inner.tag !== 'Track') throw new Error('unreachable')
    expect(inner.trackId).toBe('kick')
    expect(inner.userMethod).toBe('p')
  })
})

// Light shape probe to keep the export surface honest — α-3 PART A widens
// extractTracks shape; α-2 already added dollarStart/end. Belongs here so
// the parser's public-shape regressions land in one suite.
describe('20-11 wave α — extractTracks return shape includes dollarStart + end', () => {
  it('two `$:` blocks expose dollarStart and end on each track', () => {
    const code = '$: s("bd")\n$: s("hh")'
    const tracks = extractTracks(code)
    expect(tracks).toHaveLength(2)
    expect(tracks[0].dollarStart).toBe(0)
    // First track's end is the second `$:` line start (after the newline).
    expect(tracks[0].end).toBeGreaterThan(0)
    expect(tracks[0].end).toBeLessThan(code.length)
    expect(tracks[1].dollarStart).toBe(tracks[0].end)
    expect(tracks[1].end).toBe(code.length)
  })

  it('single `$:` block ends at code.length', () => {
    const code = '$: s("bd")'
    const tracks = extractTracks(code)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].dollarStart).toBe(0)
    expect(tracks[0].end).toBe(code.length)
  })
})

// Phase 20-12 α-1 — D-06 freq Param whitelist promotion.
// Pre-20-12: `.freq(440)` chain wrapped as opaque Code via the default arm of
// parseChain → `evt.params.freq` was always undefined. β-4 chrome reads
// `evt.note ⊕ evt.params.note ⊕ evt.params.n ⊕ evt.params.freq`; without α-1
// the freq read path was dead code. PV37 wrap-never-drop preserved for
// non-recognised arg shapes (default arm of parseParamArg returns null →
// wrapAsOpaque); P50 single-decision (numeric → Param; mini-pattern → Param
// with PatternIR value; else → wrapAsOpaque).
describe('20-12 α-1 — freq Param promotion', () => {
  it('parses .freq(440) as Param{key:freq,value:440}, NOT opaque Code', () => {
    const ir = parseStrudel('s("piano").freq(440)')
    const found = findNode(ir, (n) => n.tag === 'Param' && (n as { key: string }).key === 'freq')
    expect(found).toBeDefined()
    if (!found || found.tag !== 'Param') throw new Error('unreachable')
    expect(found.key).toBe('freq')
    expect(found.value).toBe(440)
    expect(found.rawArgs).toBe('440')
  })

  it('round-trips s("piano").freq(440) byte-equal through toStrudel(parseStrudel(...))', () => {
    const code = 's("piano").freq(440)'
    expect(toStrudel(parseStrudel(code))).toBe(code)
  })

  it('non-recognised arg shape (.freq(somevar)) falls back to wrapAsOpaque (PV37 preserved)', () => {
    // Bare identifier is not numeric, not an identifier-string literal, not
    // a quoted string — parseParamArg returns null → default arm wraps as
    // Code-with-via. P50: single decision, no third path.
    const ir = parseStrudel('s("piano").freq(somevar)')
    const found = findNode(ir, (n) => n.tag === 'Code' && (n as { via?: { method: string } }).via?.method === 'freq')
    expect(found).toBeDefined()
    if (!found || found.tag !== 'Code') throw new Error('unreachable')
    expect(found.via?.method).toBe('freq')
    expect(found.via?.args).toBe('somevar')
  })

  // Phase 20-12 wave-δ — freq is numeric-only. Pattern-arg .freq("<200 880>")
  // resolves per-cycle to a number that chrome's extractPitch would Y-staircase.
  // That's a PV37 violation — chrome reading pitch from what the user wrote as
  // a parametric/wrap-as-opaque shape. Gate the freq case to numeric-only;
  // pattern args land in wrapAsOpaque alongside `.freq(somevar)`.
  it('pattern arg .freq("<200 880>") wraps as Code (PV37, wave-δ gate)', () => {
    const ir = parseStrudel('s("sine").freq("<200 880>")')
    // Must NOT find a Param node for freq.
    const param = findNode(ir, (n) => n.tag === 'Param' && (n as { key: string }).key === 'freq')
    expect(param).toBeUndefined()
    // Must find a Code-with-via for freq.
    const code = findNode(
      ir,
      (n) => n.tag === 'Code' && (n as { via?: { method: string } }).via?.method === 'freq',
    )
    expect(code).toBeDefined()
    if (!code || code.tag !== 'Code') throw new Error('unreachable')
    expect(code.via?.method).toBe('freq')
    expect(code.via?.args).toBe('"<200 880>"')
  })

  it('identifier-string arg .freq("foo") wraps as Code (numeric-only gate)', () => {
    // parseParamArg arm 2 (literal-string) would normally produce
    // Param{value: "foo"} for sample-key Params, but freq is numeric-only.
    const ir = parseStrudel('s("sine").freq("foo")')
    const param = findNode(ir, (n) => n.tag === 'Param' && (n as { key: string }).key === 'freq')
    expect(param).toBeUndefined()
    const code = findNode(
      ir,
      (n) => n.tag === 'Code' && (n as { via?: { method: string } }).via?.method === 'freq',
    )
    expect(code).toBeDefined()
  })

  it('other Param keys still accept pattern args (s, n, note unchanged)', () => {
    // Smoke-check: numeric-only gate is freq-specific, not a global change.
    // Chain form so the .s/.note arms fire (top-level s("...") is a receiver,
    // not a chain step).
    const irS = parseStrudel('note("c4").s("<piano harp>")')
    const sParam = findNode(irS, (n) => n.tag === 'Param' && (n as { key: string }).key === 's')
    expect(sParam).toBeDefined()

    const irNote = parseStrudel('s("piano").note("<c4 d4>")')
    const noteParam = findNode(
      irNote,
      (n) => n.tag === 'Param' && (n as { key: string }).key === 'note',
    )
    expect(noteParam).toBeDefined()
  })
})

describe('20-14 parser-gap fix — stripParserPrelude', () => {
  it('skips a single line comment before the body', () => {
    const code = '// comment\ns("bd")'
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe('s("bd")')
    expect(offset).toBe(code.indexOf('s('))
  })

  it('skips multiple blank lines + comments', () => {
    const code = '\n\n  // hi\n\nfoo'
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe('foo')
    expect(offset).toBe(code.indexOf('foo'))
  })

  it('skips a single-line samples({...}) call', () => {
    const code = "samples({a:1})\ns(\"bd\")"
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe('s("bd")')
    expect(offset).toBe(code.indexOf('s("bd")'))
  })

  it('skips a multi-line samples({…}) call as one unit', () => {
    const code = 'samples({a:1,\n  b:2})\ns("bd")'
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe('s("bd")')
    expect(offset).toBe(code.indexOf('s("bd")'))
  })

  it('skips useRNG()', () => {
    const code = "useRNG('legacy')\nstack(s(\"bd\"),s(\"hh\"))"
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe('stack(s("bd"),s("hh"))')
    expect(offset).toBe(code.indexOf('stack('))
  })

  it('skips a mixed prelude (comment + samples + comment + useRNG)', () => {
    const code = '// hi\nsamples({a:1})\n// bye\nuseRNG(\'legacy\')\ns("bd")'
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe('s("bd")')
    expect(offset).toBe(code.indexOf('s("bd")'))
  })

  it('skips setcps + setVoicingRange (dinofunk-shape prelude)', () => {
    const code =
      "setcps(1)\nuseRNG('legacy')\nsetVoicingRange('lefthand', ['c3','a4'])\ns(\"bd\")"
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe('s("bd")')
    expect(offset).toBe(code.indexOf('s("bd")'))
  })

  // #1963 — the setter names reach the prelude list through `TEMPO_SETTERS`. Spelled
  // out here on purpose: a name dropped from that list must turn its own arm red, and an
  // arm built by mapping over the list would vanish along with the name.
  it.each(['setcps', 'setCps', 'setcpm', 'setCpm'])('skips a leading %s(...) as prelude', (setter) => {
    const code = `${setter}(120)\ns("bd")`
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe('s("bd")')
    expect(offset).toBe(code.indexOf('s("bd")'))
  })

  it('CONTROL — a set-prefixed call that is not a tempo setter is not prelude', () => {
    // `setGain` is not one of Strudel's boot calls; stripping it would hide the statement
    const code = 'setGain(0.5)\ns("bd")'
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe(code)
    expect(offset).toBe(0)
  })

  it('returns unchanged code when there is no prelude', () => {
    const code = 'note("c4")'
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe('note("c4")')
    expect(offset).toBe(0)
  })

  it('returns empty body + offset == code.length when source is ALL prelude', () => {
    const code = "// only a header\nsamples({a:1})\nuseRNG('legacy')\n"
    const { body, offset } = stripParserPrelude(code)
    expect(body.trim()).toBe('')
    // Offset must point past the last consumed prelude line.
    expect(offset).toBe(code.length)
  })

  it('does NOT strip inline `// ...` comments after expression code on a body line', () => {
    // Inline trailing comment on the body line is part of the body —
    // strip is whole-line only.
    const code = 's("bd") // explanation'
    const { body, offset } = stripParserPrelude(code)
    expect(body).toBe('s("bd") // explanation')
    expect(offset).toBe(0)
  })
})

describe('20-14 parser-gap fix — parseStrudel structural IR for prelude\'d tunes', () => {
  it('chop-shape body parses to a structured IR (NOT Code fallback)', () => {
    // Mirrors `packages/app/tests/parity-corpus/chop.strudel` shape:
    // header comments + samples() prelude + a sample-pattern expression
    // with a .chop chain. Before the fix this produced Track(d1, Code(<all>)).
    const code = [
      '// "Chop"',
      "// @by Felix Roos",
      '',
      "samples({ p: 'https://example.invalid/sample.mp3' })",
      '',
      's("p").chop(128)',
    ].join('\n')
    const ir = parseStrudel(code)
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    expect(ir.trackId).toBe('d1')
    // Body must be the structured `.chop(...)` IR — not the Code() fallback.
    expect(ir.body.tag).not.toBe('Code')
    // .chop(n) produces a Chop tag.
    const chop = findNode(ir, (n) => n.tag === 'Chop')
    expect(chop).toBeDefined()
  })
})

describe('20-14 parser-gap fix — bare-string-as-pattern (cluster A)', () => {
  it('bare string at top level parses to structured IR (NOT Code)', () => {
    // Strudel transpiler auto-promotes top-level string literals to mini-
    // patterns. Pre-fix: splitRootAndChain saw expr[0]==='"' (not an
    // identifier char and not '('), returned root="", chain=<whole expr>;
    // parseRoot('') fell through to IR.code(). Now parseRoot's bare-string
    // arm fires and delegates to parseMini.
    const ir = parseStrudel('"c3 e3"')
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    expect(ir.body.tag).not.toBe('Code')
    // parseMini on `c3 e3` produces a top-level Seq of two Play nodes.
    const play = findNode(ir, (n) => n.tag === 'Play')
    expect(play).toBeDefined()
  })

  it('bare string with method chain parses both the pattern + chain', () => {
    // barryHarris-shape: `"0,2,[7 6]".add("<0 1>").scale(...)`. The chain
    // is applied via applyChain on top of the bare-string IR.
    const ir = parseStrudel('"c3 e3".fast(2)')
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    // .fast(n) constructs a Fast tag wrapping the bare-string IR.
    const fast = findNode(ir, (n) => n.tag === 'Fast')
    expect(fast).toBeDefined()
    // And the Play nodes from the inner mini are still present.
    const play = findNode(ir, (n) => n.tag === 'Play')
    expect(play).toBeDefined()
  })
})

describe('20-14 parser-gap fix — multi-line chain walker (cluster B)', () => {
  it('walks across newlines + indent between method calls', () => {
    // Pre-fix: after consuming `.delay("1")`, the walker's `rest` was
    // `\n  .delaytime(...)\n  .delayfeedback(...)` which doesn't start
    // with '.', so the loop exited and the later methods were silently
    // dropped to Code-fallback at parseExpression's catch-all.
    const ir = parseStrudel(
      's("bd").fast(2)\n  .slow(3)\n  .fast(4)',
    )
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    // All three methods must land in the chain — without the cluster B
    // fix, only the first `.fast(2)` was applied and the rest were
    // dropped to Code-fallback. Verify by counting Fast + Slow tags.
    const tags: string[] = []
    function walk(n: PatternIR): void {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const x = n as any
      tags.push(n.tag)
      if (x.body && typeof x.body === 'object' && 'tag' in x.body) walk(x.body)
      if (x.value && typeof x.value === 'object' && 'tag' in x.value) walk(x.value)
      if (Array.isArray(x.children))
        for (const c of x.children) if (c && typeof c === 'object' && 'tag' in c) walk(c)
      if (x.via?.inner) walk(x.via.inner)
    }
    walk(ir)
    // Two `Fast` (outermost from `.fast(4)` + innermost from `.fast(2)`)
    // and one `Slow` (`.slow(3)`) — all three methods stacked.
    expect(tags.filter((t) => t === 'Fast').length).toBe(2)
    expect(tags.filter((t) => t === 'Slow').length).toBe(1)
  })

  it('tolerates an inline `// comment` between methods', () => {
    // bassFuge-shape: `.sub(1) // sub 1 -> 1-indexed\n.layer(...)`. The
    // separator regex must skip both the inline comment AND the trailing
    // newline before the next `.`.
    const ir = parseStrudel(
      's("bd").fast(2)  // explanation\n  .slow(3)',
    )
    expect(ir.tag).toBe('Track')
    if (ir.tag !== 'Track') throw new Error('unreachable')
    // Both .fast + .slow present despite the inline comment between them.
    const tags: string[] = []
    function walk(n: PatternIR): void {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const x = n as any
      tags.push(n.tag)
      if (x.body && typeof x.body === 'object' && 'tag' in x.body) walk(x.body)
      if (x.value && typeof x.value === 'object' && 'tag' in x.value) walk(x.value)
      if (Array.isArray(x.children))
        for (const c of x.children) if (c && typeof c === 'object' && 'tag' in c) walk(c)
      if (x.via?.inner) walk(x.via.inner)
    }
    walk(ir)
    expect(tags).toContain('Fast')
    expect(tags).toContain('Slow')
  })
})

describe("#659 — single-quoted string args ('x')", () => {
  // The Song-timeline uses the STATIC parser (parseStrudel — no audio eval,
  // #611). Its string-arg arms recognised only "…" and `` `…` ``; a single-
  // quoted arg fell through to bare Code, so the timeline silently lost those
  // notes/sounds even though the live audio engine plays them fine. These
  // assert single quotes parse identically to double quotes across every
  // string-literal-arg site (root note/s/sound/mini, bare-string root,
  // parenthesized-string root, and the chain-method `.s()` Param arm).

  it('s(\'bd\') root → Play with params.s, identical to s("bd")', () => {
    const sq = parseStrudel("s('bd')")
    const playSq = findNode(sq, (n) => n.tag === 'Play')
    expect(playSq).toBeDefined()
    expect((playSq as { params?: { s?: string } } | undefined)?.params?.s).toBe('bd')
  })

  it("note('c4 e4') root → Play nodes, identical to double quotes", () => {
    const sq = parseStrudel("note('c4 e4')")
    const playSq = findNode(sq, (n) => n.tag === 'Play')
    expect(playSq).toBeDefined()
  })

  it("mini('0 1 2') root → Play nodes", () => {
    const sq = parseStrudel("mini('0 1 2')")
    const playSq = findNode(sq, (n) => n.tag === 'Play')
    expect(playSq).toBeDefined()
  })

  it("chain note(\"c4\").s('square') → Param key 's' = 'square' (was dropped)", () => {
    const ir = parseStrudel('note("c4").s(\'square\')')
    const sParam = findNode(ir, (n) => n.tag === 'Param' && (n as { key: string }).key === 's')
    expect(sParam).toBeDefined()
    expect((sParam as { value?: unknown } | undefined)?.value).toBe('square')
  })

  it("chain note(\"c4\").s('<bd cp>') → pattern arg parses to a Param (mini)", () => {
    const ir = parseStrudel('note("c4").s(\'<bd cp>\')')
    const sParam = findNode(ir, (n) => n.tag === 'Param' && (n as { key: string }).key === 's')
    expect(sParam).toBeDefined()
  })

  it("bare single-quoted root '0 1 2' → mini Play nodes", () => {
    const sq = parseStrudel("'0 1 2'")
    const playSq = findNode(sq, (n) => n.tag === 'Play')
    expect(playSq).toBeDefined()
  })

  it("parenthesized single-quoted root ('1 2 3') → mini Play nodes", () => {
    const sq = parseStrudel("('1 2 3')")
    const playSq = findNode(sq, (n) => n.tag === 'Play')
    expect(playSq).toBeDefined()
  })

  it("preserves inner byte offset — Play.loc points at the single-quoted atom", () => {
    // Source `s('bd')`: the 'b' is at index 3 (s=0 (=1 '=2 b=3). The inner
    // offset must be computed from the actual quote char, not a hardcoded
    // indexOf('"') — range discipline for the visual editor.
    const sq = parseStrudel("s('bd')")
    const playSq = findNode(sq, (n) => n.tag === 'Play') as
      | { loc?: { start: number }[] }
      | undefined
    expect(playSq?.loc?.[0]?.start).toBe(3)
  })

  it("single ↔ double byte offsets match for the same atom", () => {
    const findStart = (code: string) =>
      (findNode(parseStrudel(code), (n) => n.tag === 'Play') as
        | { loc?: { start: number }[] }
        | undefined)?.loc?.[0]?.start
    // `note('c4 e4')` vs `note("c4 e4")` — same atom position either way.
    expect(findStart("note('c4 e4')")).toBe(findStart('note("c4 e4")'))
  })
})
