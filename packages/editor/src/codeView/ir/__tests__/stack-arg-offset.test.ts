/**
 * Issue #107 regression — stack-arg offset propagation.
 *
 * `stack(s("hh*8"), s("bd"))` used to parse each arg with offset reset
 * to 0, so atom `loc` ranges on the resulting events were positions
 * within the arg slice, not within the whole file. Click-to-source in
 * the MusicalTimeline navigated to the file's first line (typically a
 * comment) for any sample-track event nested inside a stack call.
 *
 * Root cause: `parseStrudel.ts` stack arm called
 * `parseExpression(a.trim())` without a `baseOffset`. The defer
 * comment ("Argument offsets are dropped here for v0") was the
 * explicit deferral. This test pins the v1 fix.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { walkLeafItems } from '../structuralWalk'

// The atom loc lives on the parsed IR's Play leaves; `walkLeafItems` is the
// structural walk that carries each leaf's loc (loc[0] = innermost atom range,
// wrapper ranges appended) — the same `.loc` the retired collect engine set on
// its events, produced WITHOUT running the behaviour interpreter. Cycle 0
// suffices: every leaf is reached once and loc is timing-independent.
const leafLocs = (code: string) => walkLeafItems(parseStrudel(code), 1)

describe('#107 — stack-arg loc threads through to inner atoms', () => {
  it('top-level stack(s("a"), s("b")) — atoms resolve to absolute positions', () => {
    const code = 'stack(s("a"), s("b"))'
    //                   ^=8        ^=18
    const leaves = leafLocs(code)
    expect(leaves.length).toBe(2)
    expect(leaves[0].loc?.[0]).toEqual({ start: 9, end: 10 })
    expect(leaves[1].loc?.[0]).toEqual({ start: 17, end: 18 })
  })

  it('multi-line stack — args carry per-line absolute offsets', () => {
    const code = 'stack(\n  s("hh"),\n  s("bd")\n)'
    // Layout (offsets):
    //   '\n'        at 5
    //   '  s("hh")' starts at 6, "hh" atom inside `s("` → atom at 11
    //   ',\n'       after closing paren at 14
    //   '  s("bd")' starts at 17, "bd" atom at 22
    const leaves = leafLocs(code)
    expect(leaves.length).toBe(2)
    expect(leaves[0].loc?.[0]).toEqual({ start: 12, end: 14 })
    expect(leaves[1].loc?.[0]).toEqual({ start: 23, end: 25 })
  })

  it('stack INSIDE a $: track — offset compounds (track offset + stack-arg offset)', () => {
    // The user's actual reproduction shape: $: prefixes a track whose
    // body starts a few chars in, and stack(...) lives inside that
    // body. Each atom's loc must = trackOffset + stackArgOffset.
    const code = '// header\n$: stack(s("hh"), s("bd"))'
    //            0         10  13           21       30
    // After '$: ' (3 chars) at 13, stack arm runs with baseOffset=13.
    // Within stack(...): inner starts at 19 ('s("hh"), s("bd")'),
    //   first arg 's("hh")' offset 0 within inner → atom 'hh' at
    //   19 + 3 = 22.  second arg ' s("bd")' starts at 9 within inner
    //   (after ', '), trimmed offset 10 → atom 'bd' at 19 + 13 = 32.
    const leaves = leafLocs(code)
    expect(leaves.length).toBe(2)
    expect(leaves[0].loc?.[0]).toEqual({ start: 22, end: 24 })
    expect(leaves[1].loc?.[0]).toEqual({ start: 31, end: 33 })
  })

  it('chain method on stack arg preserves inner atom as loc[0] (wrapper appended)', () => {
    // `stack(s("hh").gain(0.5))` — the `.gain(0.5)` chain wraps the
    // inner s("hh") as opaque Code. withWrapperLoc appends; loc[0]
    // stays as the most-specific atom range.
    const code = 'stack(s("hh").gain(0.5))'
    //                   ^=8 ('h' of "hh")
    const leaves = leafLocs(code)
    expect(leaves.length).toBe(1)
    expect(leaves[0].loc?.[0]).toEqual({ start: 9, end: 11 })
    // Wrapper's range appended (gain call site)
    expect(leaves[0].loc!.length).toBeGreaterThanOrEqual(2)
  })

  it("stack arg with leading whitespace — offset skips the whitespace", () => {
    const code = 'stack(   s("hh"),    s("bd"))'
    // First arg trimmed-start at offset 9 within trimmed ('s' of 's("hh")'),
    // atom 'hh' at 9 + 3 = 12 within trimmed (= absolute since baseOffset=0).
    const leaves = leafLocs(code)
    expect(leaves.length).toBe(2)
    expect(leaves[0].loc?.[0].start).toBe(12)
    // Second arg: after first arg's `s("hh"),` (offset 9..16) and
    // `    ` whitespace (4 chars), trimmed-start at 21, atom 'bd' at 24.
    expect(leaves[1].loc?.[0].start).toBe(24)
  })
})

/**
 * Issue #901 — whitespace between the `stack` keyword and its `(`.
 *
 * `stack (…)` and `stack\n(…)` dropped the WHOLE program to the opaque
 * Code fallback → a blank timeline. The arm matched with `/^stack\s*\(/`
 * (which tolerates the gap) and then located the paren by re-searching
 * for a LITERAL `stack(` — the two disagreed the moment a gap appeared,
 * and the arm fell through. stack was the only root arm doing this;
 * arrange/cat, the curated arm and the loose arm all derive the paren
 * from their own match, which is why `cat (…)` and `note (…)` were fine.
 *
 * Offsets are asserted (not just the node tag) because the gap shifts
 * every inner atom: a fix that recognised `stack (` but mis-attributed
 * its args would still break click-to-source and lane attribution.
 */
describe('#901 — stack tolerates whitespace before its paren', () => {
  it('stack (…) with a SPACE — parses to Stack, atoms keep absolute offsets', () => {
    const code = 'stack (s("a"), s("b"))'
    //            0....5^gap 6='('     ^a=10        ^b=18
    const ir = parseStrudel(code)
    const body = ir.tag === 'Track' ? ir.body : ir
    expect(body.tag).toBe('Stack')

    const leaves = leafLocs(code)
    expect(leaves.length).toBe(2)
    // One space ⇒ every atom sits exactly 1 char later than the tight case.
    expect(leaves[0].loc?.[0]).toEqual({ start: 10, end: 11 })
    expect(leaves[1].loc?.[0]).toEqual({ start: 18, end: 19 })
  })

  it('stack\\n(…) with a NEWLINE — parses to Stack, atoms keep absolute offsets', () => {
    const code = 'stack\n(s("a"), s("b"))'
    const ir = parseStrudel(code)
    const body = ir.tag === 'Track' ? ir.body : ir
    expect(body.tag).toBe('Stack')

    const leaves = leafLocs(code)
    expect(leaves.length).toBe(2)
    // '\n' is one char, so the layout matches the SPACE case exactly.
    expect(leaves[0].loc?.[0]).toEqual({ start: 10, end: 11 })
    expect(leaves[1].loc?.[0]).toEqual({ start: 18, end: 19 })
  })

  it('the Stack node loc spans the whole call INCLUDING the gap', () => {
    const code = 'stack  (s("a"), s("b"))'
    const ir = parseStrudel(code)
    const body = ir.tag === 'Track' ? ir.body : ir
    expect(body.tag).toBe('Stack')
    // Slicing the source at the reported loc must read back as the
    // entire expression — the gap included, closing paren included.
    const loc = body.loc![0]
    expect(code.slice(loc.start, loc.end)).toBe('stack  (s("a"), s("b"))')
  })

  it('gap + leading whitespace — the track offset still compounds', () => {
    const code = '$: stack (s("a"), s("b"))'
    //            0.. '$: ' ends at 3; stack at 3, '(' at 9, 'a' at 13, 'b' at 21
    const leaves = leafLocs(code)
    expect(leaves.length).toBe(2)
    expect(leaves[0].loc?.[0]).toEqual({ start: 13, end: 14 })
    expect(leaves[1].loc?.[0]).toEqual({ start: 21, end: 22 })
  })
})
