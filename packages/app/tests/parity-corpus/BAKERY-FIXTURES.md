# Bakery Regression Fixtures — closed parser-gap classes (20-15 + 20-16)

These `bakery-*.strudel` files are **NOT** upstream `tunes.mjs` exports
(unlike the 16 curated tunes documented in `CORPUS-SOURCE.md`). They are
**minimal repros** distilled from the GitHub issues filed during the
2026-05-15 Bakery real-world stress test (Phase 20-15), vendored here as
**permanent regression fixtures** so the 6 gap classes closed in 20-15 can
never silently regress.

They are auto-discovered by `parity.test.ts` and `loc-fidelity.test.ts`
exactly like the upstream tunes (one snapshot per file). They are
**deliberately excluded** from `parity-refresh.mjs` TARGETS (and a guard
there throws if one leaks in) — they have no upstream `tunes.mjs` origin,
so the upstream-drift tool must never report them as "missing upstream".

This is the **≥9/10 known-set gate** (Phase 20-15 D-04): each fixture
asserts the gap-class repro now parses to **structured IR** (not the old
opaque `Code(BARE-FALLBACK)`).

| Fixture | Gap | Issue | Repro source | Asserts |
|---|---|---|---|---|
| `bakery-G1-let-binding.strudel` | G1 — top-level `let`/`const` bindings + `stack()` bare-ident refs | [#134](https://github.com/MrityunjayBhardwaj/Stave/issues/134) · Bakery `?Qm3zohrBUY-h` | issue #134 minimal repro | `Stack` of structured voices, not whole-program Code |
| `bakery-G2-setcpm.strudel` | G2 — `setcpm` tempo-setter prelude skip | [#135](https://github.com/MrityunjayBhardwaj/Stave/issues/135) | issue #135 minimal repro | `setcpm(...)` line stripped, `stack(...)` structured |
| `bakery-G3-backtick.strudel` | G3 — backtick template-literal string args (multi-line mini) | [#136](https://github.com/MrityunjayBhardwaj/Stave/issues/136) | issue #136 minimal repro | `$:` Track wrapping backtick `sound(...)` structured |
| `bakery-G4-comment-args.strudel` | G4 — comment-only lines between `stack()` args | [#137](https://github.com/MrityunjayBhardwaj/Stave/issues/137) | issue #137 minimal repro | `Stack[Play, Play]`, not `Stack[Code, Code]` |
| `bakery-G5-named-label.strudel` | G5 — `name: pattern` named-label syntax | [#138](https://github.com/MrityunjayBhardwaj/Stave/issues/138) | issue #138 minimal repro | `Track(trackId='p1', …)` structured |
| `bakery-132-recursive-args.strudel` | #132 — recursive mini+chain inside `note`/`n`/`s` args | [#132](https://github.com/MrityunjayBhardwaj/Stave/issues/132) · arpoon | issue #132 minimal repro (β-2 verify form) | structured `Fast`/`LastOf` over `Play`, not Code |

### Phase 20-16 fixtures (#142–#144 + #148/#150/#151/#152 segmenter)

Phase 20-16 (REFRAMED): Wave 0 (#148/#150/#151/#152 — the
`splitTopLevelStatements` ASI/comment-aware segmenter, shipped on this
branch at commit `ff93c65`) + Wave B (#142 fixture-only / #143 classifier)
+ Wave C (#144 paren-string root arm). D-01 (#140/#141 binding resolution)
was REMOVED from 20-16 and deferred to Phase 20-17, so there is **no**
`bakery-140-binding-transitive` fixture in this phase.

**Provenance note (20-15 V-2 lesson):** the named Bakery hashes
(`-P398OK_eprf` #142, `-7LU6zgzViSM` #143, `--cHhfOZ6ON1` #144) are NOT
in the local V-1 file — the `gh issue view N` **issue body** is the
verbatim ground-truth fixture source (a paraphrase silently substitutes
a working form; PV49 alias corollary). The #148/#150/#151/#152 fixtures
are minimal distillations of the Task-1 `--LsnlgQ6osk` segmenter slice
recorded in `20-16-OBSERVATIONS.md` (the 4-gap segmenter map).

| Fixture | Gap | Issue | Repro source | Asserts |
|---|---|---|---|---|
| `bakery-148-leading-dot-chain.strudel` | #148 — leading-dot multi-line method-chain continuation split by the segmenter | [#148](https://github.com/MrityunjayBhardwaj/Stave/issues/148) · Bakery `--LsnlgQ6osk` (not local) | Task-1 `--LsnlgQ6osk` segmenter slice (20-16-OBSERVATIONS) | structured `Code`-with-`via` chain off `sound(...)`, not bare Code |
| `bakery-150-eq-continuation.strudel` | #150 — `const x =\n  rhs` (`=`-terminated line is not a JS stmt boundary) | [#150](https://github.com/MrityunjayBhardwaj/Stave/issues/150) · Bakery `--LsnlgQ6osk` (not local) | Task-1 segmenter slice (20-16-OBSERVATIONS) | `Stack` over the bound voices, not whole-program Code |
| `bakery-151-comment-only.strudel` | #151 — a `// comment` on its own physical line became a phantom statement | [#151](https://github.com/MrityunjayBhardwaj/Stave/issues/151) · Bakery `-L13nBhrqGR_` (not local) | Task-1 segmenter slice (20-16-OBSERVATIONS) | `Stack` over the bound voices, not whole-program Code |
| `bakery-152-block-comment.strudel` | #152 — `/* … */` block comment not skipped → depth-0 `\n` inside it flushed | [#152](https://github.com/MrityunjayBhardwaj/Stave/issues/152) · Bakery `-LHtBlF8peGC` (not local) | Task-1 segmenter slice (20-16-OBSERVATIONS) | `Stack` over the bound voices, not whole-program Code |
| `bakery-142-samples-objlit.strudel` | #142 — `samples({…})` object-literal / `github:`/`https:` boot arg | [#142](https://github.com/MrityunjayBhardwaj/Stave/issues/142) · Bakery `-P398OK_eprf` (not local) | **verbatim `gh issue view 142` body** | `s("o0 o1")` Seq structured (the existing depth walker already strips it — B-1 OQ2 = fixture-only, NO code change) |
| `bakery-143-guarded-boot.strudel` | #143 — `typeof X !== 'undefined' && X(...)` guarded boot expr | [#143](https://github.com/MrityunjayBhardwaj/Stave/issues/143) · Bakery `-7LU6zgzViSM` (not local) | **verbatim `gh issue view 143` body** | guard line stripped, `stack( s("bd") )` → structured Play (B-2 `GUARDED_BOOT_RE`) |
| `bakery-144-paren-root.strudel` | #144 — `("…")` parenthesized-string root + leading-dot chain | [#144](https://github.com/MrityunjayBhardwaj/Stave/issues/144) · Bakery `--cHhfOZ6ON1` (not local) | **verbatim `gh issue view 144` body** | structured `Code`-with-`via` chain off the parsed mini root (C-1 `parenStrMatch` arm) |

**parity-refresh exclusion:** `parity-refresh.mjs` TARGETS is upstream-only
by construction and has a structural guard (`parity-refresh.mjs:70-75`)
that **throws** if any `bakery-*` slug leaks into TARGETS. The 7 new
fixtures are excluded automatically by NOT being added to TARGETS — no
edit to the script is needed (the guard IS the enforcement; adding the
fixtures would trip it). The upstream-drift tool therefore never reports
these vendored repros as "missing upstream".

### Phase 20-17 fixture (#140 / #141 — D-01 pervasive binding resolution)

Phase 20-17 closes the D-01 matcher line — G1 (chain-arg substitution),
G2 (bound-ident root in `parseRoot`), G3 (literal-RHS substitution via the
additive `Code.via {literal:true;raw}` arm + `classifyLiteralRhs`), G4
(pervasive optional-arg threading via `applyChain`/`parseTransform`/every
internal `parseExpression` recursion), and a bounded least-fixpoint inside
`buildBindingMap` (≤ N iterations, monotone progress, occurs-check
terminal = the kept γ-3 opaque-RHS fence predicate, byte-identical, only
repositioned post-fixpoint). The original D-02 "store as Code-with-via,
no ripple" was unconstructible (`Code.via` was the `wrapAsOpaque` shape,
no place for a literal `4`) — the D-02 CORRECTION resolves this by
ADDITIVE union widening of `Code.via` (existing arm byte-unchanged; fence
predicate byte-identical). The Wave-D consumer audit (D-1c) enumerates a
grep-reproduced FLOOR of 14 `via.`-readers + 4 NOT-A-VIA-READER FLOOR
confirmations; the HIGH-severity site (`MusicalTimeline.tsx`'s `via.inner`
deref) is guarded by `!('literal' in via)`.

**Provenance note (cascade-falsification record, 20-17):** the ORIGINAL
D-03 criterion 1 anchor was `--LsnlgQ6osk` (the local Bakery repro
vendored at `bakery-runs/repro__LsnlgQ6osk.strudel`). Wave-E empirically
falsified the inferred plan premise that `--LsnlgQ6osk` is blocked by
G1/G2/G4 — its `az2` binding is **opaque-by-SHAPE** (`irand(12)` chain
root is an unbound function-call, NOT a recognised root pattern),
NOT binding-blocked. Per PK18 + the AMENDED D-03 contract, criterion 1
re-anchored on EVIDENCE to the DUAL pair `_72eEl7NwK9e` AND
`_LHtBlF8peGC` (both #141-corpus repros, both 2/6 baseline `code (bare)`,
both now STRUCTURED in production — proving D-01's matcher-line reach
on the genuinely-in-scope cases). NO bar-lowering — the `az2` opaque-shape
class deferred to 20-18 as a NEW D-2 sub-arm (`recogniseUnboundChainRoot`
predicate + tag-mapping table).

| Fixture | Gap classes closed | Issue | Repro source | Asserts |
|---|---|---|---|---|
| `bakery-140-binding-transitive.strudel` | G1 chain-arg / G2 root-ident / G3 literal-union / G4 method-arg / bounded fixpoint | [#140](https://github.com/MrityunjayBhardwaj/Stave/issues/140) (γ-4 deferred from 20-15) · [#141](https://github.com/MrityunjayBhardwaj/Stave/issues/141) (20-15 V-1 backlog: binding refs outside stack-bare-arg — the dominant 6/14 class) · Bakery `--LsnlgQ6osk` distillation (the 2/6 anchor in 20-17 Wave-0 baseline) | distilled from `bakery-runs/repro__LsnlgQ6osk.strudel` (20-17 Wave-0 vendored): 2-3 bindings + one final expr exercising G1 (`sound(rp1)`) + G2 (`stack(rp1, ...)`) + G3 (`.slow(numChords)` with `const numChords = 4`) + G4 (transitive `beat = sound(rp1).bank(...).slow(numChords)`) + fixpoint (iter-1 resolves `beat` only AFTER iter-0 resolves `rp1` + `numChords`) | `Track('d1', Stack)` with **two** structured stack tracks: track-1 is `Code.via { method:'fast', inner: Cycle[Play(sd), Play(hh)] }` (the `rp1` G2-root substitution); track-2 is `Code.via { method:'slow', inner: Param('bank', body: Code.via { method:'fast', inner: Cycle[Play(sd), Play(hh)] }) }` (the `beat` G4-transitive substitution; the spliced `rp1` subtree appears inside `beat`'s `bank` chain). The whole-program body is **not** bareCode (`body.tag === 'Stack'` → `body.tag !== 'Code'` predicate TRUE → STRUCTURED). Pre-20-17 this distillation parsed to whole-program bareCode (no G1/G2/G3/G4); post-20-17 it is the canonical regression wall for the D-01 matcher line. |

**parity-refresh exclusion (same mechanism as 20-15 + 20-16):**
`parity-refresh.mjs:70-75`'s structural guard throws if ANY `bakery-*`
slug leaks into TARGETS. `bakery-140-binding-transitive` is excluded
automatically by NOT being added to TARGETS — no edit to the script is
needed (the guard IS the enforcement; adding the fixture would trip it).
The upstream-drift tool therefore never reports the new fixture as
"missing upstream".

### Phase 20-18 fixtures (#155 + #158 — chain-root recognition + AMENDMENT-2 negative-control)

Phase 20-18 closes the chain-root recognition gap (#155): Strudel
signal/builder family roots (`irand`/`run`/`binary*`/`perlin`/`sine`/...,
plus the grounded-then-modelled `chord`/`arrange`) are recognised as
Layer 1/2 PatternIR `{tag:'Signal'|'Builder', kind, args?}` additive
union members. The AMENDED-D-03 V-1 (`fa229bc`) PASSED both crit-1
anchors STRUCTURED + crit-2 92.0% (+6pp over the 86% must-not-regress
floor). The CI fixtures below are VERBATIM-distilled from the source
repros (the 20-15 V-2 "do not paraphrase" lesson) — a paraphrased-to-
working fixture tests nothing.

**Provenance note (D-03 AMENDMENT-2, 2026-05-20):** #3 `-6c1hEXe8Agi`
was dropped from crit-1 on evidence — its blocker is a SECOND class
(`buildBindingMap`-shape rejection: `bindings*, sideEffect, finalExpr`
fails `finalIdx !== stmts.length-1`), NOT chain-root. The chord arm
itself is validated by FOUR independent Wave-C observations: the
stripped-#3 probe (Track/Pick + deep-walk Builder/chord HIT), the
belldub/dinofunk/meltingsubmarine corpus chord-root flips, and the #7
arrange peer. `bakery-chord-voicing-root` ships as a POSITIVE-CONTROL
regression fixture asserting the chord-recogniser arm fires correctly;
the full #3 shape-fence blocker (`buildBindingMap`-shape rejection) is
tracked in **#158** and deferred to 20-19. When 20-19/#158 closes the
shape-fence, the full #3 program flip becomes a fixture there.

**Grounding:** the chord/arrange arms are grounded against the pinned
upstream SHA `f73b3956` (`packages/tonal/controls.mjs:2130` reify+
withVal for chord; `pattern.mjs:1469-1473` for arrange's continuum into
the existing struct machinery). See `~/.anvideck/projects/struCode/ref/
GROUND_TRUTH_SIGNAL_MJS.md`.

| Fixture | Gap classes closed | Issue | Repro source | Asserts |
|---|---|---|---|---|
| `bakery-141-irand-chain-root.strudel` | #155 — `irand(N).struct(...)...` chain-root + signal-valued chain ARGS (`perlin.range`, `sine.range`) carried opaquely by `applyChain` | [#155](https://github.com/MrityunjayBhardwaj/Stave/issues/155) · Bakery `--LsnlgQ6osk` (the 20-17 Wave-E-falsified anchor, RECLAIMED in 20-18) | distilled VERBATIM from `bakery-runs/repro__LsnlgQ6osk.strudel:13-23` (the `az2` declaration byte-faithful) + a `stack(az2)` final to make it self-contained | whole-program `body.tag='Code', via!==undefined` → STRUCTURED; deep-walk reaches `{tag:'Builder', kind:'irand', args:'12'}`; the `.sometimesBy(perlin.range(...),sub(8))` and `.fm(sine.range(...).fast(...))` arms carried as nested `Code.via` per the Wave-0 verdict (a)-ROOT-RECOGNITION-SUFFICES |
| `bakery-arrange-root.strudel` | #155 — `arrange([num, expr], ...)` as a `Builder` root flipping STRUCTURED | [#155](https://github.com/MrityunjayBhardwaj/Stave/issues/155) · Bakery `-KLGNJUtyyj1` (Wave-C grounded-PASS anchor; AMENDMENT-2 crit-1 anchor #2) | distilled VERBATIM from `samples-2026-05-19T13-24-45-538Z.json` `-KLGNJUtyyj1`: the `richter_chords` template-literal binding + the `arrange([48, stack(...)], [1, ...])` final-expression shape byte-faithful at the root | whole-program `tag='Track'`, `body = {tag:'Builder', kind:'arrange', args:''}` — STRUCTURED; the `arrange`-arm flip is the AMENDED-D-03 crit-1 anchor #2 (Wave C deep-walk Builder/arrange HIT + bakery `verdict=structured` corroboration) |
| `bakery-chord-voicing-root.strudel` | #155 chord ARM correctness (POSITIVE-CONTROL per D-03 AMENDMENT-2; the full #3 shape-fence blocker is tracked in [#158](https://github.com/MrityunjayBhardwaj/Stave/issues/158) → 20-19) | [#155](https://github.com/MrityunjayBhardwaj/Stave/issues/155) (chord recogniser arm) · Bakery `-6c1hEXe8Agi` (the AMENDMENT-2-dropped crit-1 anchor; deferred class → #158 → 20-19) | distilled VERBATIM from the Wave-C stripped-#3 probe (`_waveC-diagnose.spec.ts:25-62` template): the `padsbell = chord("Am Am").voicing().sound(...)...` binding byte-faithful + a `stack(padsbell)` final (the SHAPE that DOES flip STRUCTURED, proving chord arm fires) — single-quoted string-id args per P62/PV44 | whole-program `body.tag='Code', via!==undefined` → STRUCTURED; deep-walk reaches `{tag:'Builder', kind:'chord', args:'"Am Am"'}` — POSITIVE control for chord ARM correctness (Wave C Ground Truth: `controls.mjs:2130` reify+withVal); the full #3 program shape-fence blocker (`buildBindingMap`-shape rejection) is tracked in **#158** → 20-19 per AMENDMENT-2 |

**parity-refresh exclusion (same mechanism as 20-15/16/17):**
`parity-refresh.mjs:68-77`'s structural guard throws if ANY `bakery-*`
slug leaks into TARGETS. The 3 new fixtures are excluded automatically
by NOT being added to TARGETS — no edit to the script is needed (the
guard IS the enforcement; adding the fixtures would trip it). The
upstream-drift tool therefore never reports these vendored repros as
"missing upstream".

### Per-setter G2 fixtures (V-3 — α-1 → V-3 contract)

The α-1 commit body (`a2b607c`) is the authoritative input contract: the
tempo-setter tokens added to `PRELUDE_CALL_RE` beyond the pre-existing
`setcps` are **`setcpm`, `setCpm`, `setCps`** (full recognised family
`{setcps, setCps, setcpm, setCpm}`). V-3 reads that list verbatim from the
commit body and does **NOT** re-derive it via a fresh upstream audit. One
fixture per added setter proves the setter line is skipped AND the
following pattern parses structurally (R2 anti-drift):

| Fixture | Setter | Covered by |
|---|---|---|
| `bakery-G2-setcpm.strudel` | `setcpm` | the G2 repro fixture above (#135) |
| `bakery-G2-setCpm-camel.strudel` | `setCpm` | V-3 (case-insensitive FS → `-camel` slug, not a case-only filename) |
| `bakery-G2-setCps-camel.strudel` | `setCps` | V-3 |

(`setcps` was already present pre-α-1 — covered by the 20-14 corpus — so
it gets no new fixture; the contract is "one per ADDED setter".)

### Phase 20-19 fixtures (#158 — `buildBindingMap` shape-fence relaxation)

Phase 20-19 closed the `buildBindingMap` shape-fence on
`bindings*, sideEffect, finalExpr`. The fix ships a curated-list
`SIDE_EFFECT_CALL_RE` regex + `stripSideEffectStatements` helper applied
to `splitTopLevelStatements`'s output BEFORE `buildBindingMap`
consumes the array, so the program shape becomes `bindings*, finalExpr`
— the shape the existing pS:534 shape guard already accepts. The chord
recogniser arm grounded in 20-18 Wave C handles the rest.

The recognised closed set (FROZEN, 10 tokens, source-grounded at
Codeberg pin SHA `f73b395648645aabe699f91ba0989f35a6fd8a3c` — see the
provenance block at `parseStrudel.ts:484-530`):

```
all, samples, setcps, setCps, setcpm, setCpm, useRNG,
setVoicingRange, initAudio, aliasBank
```

10 permanent CI fixtures (one per token; faithful-distillation
minimum: a chord-rooted binding + the side-effect line as a depth-0
intermediate + `stack(binding)` as the final expr) + 1 negative-control
proving the filter (not the bindings substrate) is the gate:

| Fixture | Token | Side-effect form | Asserts |
|---|---|---|---|
| `bakery-158-all-shape-fence.strudel` | `all` | `all(x=>x.fast(2))` | filter strips; `stack(padsbell)` parses STRUCTURED via chord arm |
| `bakery-158-samples-shape-fence.strudel` | `samples` | `samples({a: 'github:foo/bar'})` | filter strips; STRUCTURED |
| `bakery-158-setcps-shape-fence.strudel` | `setcps` | `setcps(1.5)` | filter strips; STRUCTURED |
| `bakery-158-setCps-camel-shape-fence.strudel` | `setCps` | `setCps(1.5)` | camelCase alias (case-insensitive FS → `-camel` slug); STRUCTURED |
| `bakery-158-setcpm-shape-fence.strudel` | `setcpm` | `setcpm(120)` | filter strips; STRUCTURED |
| `bakery-158-setCpm-camel-shape-fence.strudel` | `setCpm` | `setCpm(120)` | camelCase alias; STRUCTURED |
| `bakery-158-useRNG-shape-fence.strudel` | `useRNG` | `useRNG('latest')` | filter strips; STRUCTURED |
| `bakery-158-setVoicingRange-shape-fence.strudel` | `setVoicingRange` | `setVoicingRange('lefthand', ['F2','C5'])` | filter strips; STRUCTURED |
| `bakery-158-initAudio-shape-fence.strudel` | `initAudio` | `initAudio({})` | filter strips; STRUCTURED |
| `bakery-158-aliasBank-shape-fence.strudel` | `aliasBank` | `aliasBank({a: 'github:foo/bar'})` | filter strips; STRUCTURED |
| `bakery-158-NEGATIVE-no-sideeffect.strudel` | — | (no side-effect) | proves bindings substrate works without the filter; STRUCTURED with byte-identical body to the 10 positive fixtures |

**The negative-control's role:** if `bakery-158-<token>-shape-fence`
were bareCode while `bakery-158-NEGATIVE-no-sideeffect` was structured,
the filter is broken (the side-effect intermediate is not being
stripped). If both bareCode, the bindings substrate (20-15+17)
regressed. If both structured (the design state), the system works as
the 20-19 mechanism describes.

**parity-refresh exclusion:** the `bakery-158-*` slugs are covered by
the existing structural guard at `parity-refresh.mjs:68-75` (any
`bakery-*` prefix triggers the throw if added to TARGETS); no script
edit is needed (`node packages/app/scripts/parity-refresh.mjs --dry-run`
reports 0 missing for the 11 new fixtures).

### Phase 20-20 fixtures (#159 — tokenizer-whitespace fence relaxation)

Phase 20-20 closes #159: `splitRootAndChain`'s identifier-then-paren
branch at `parseStrudel.ts:2521-2531` rejected whitespace between an
identifier and the call-site `(`, so bakery row `-G2drHRNFueu`
(`sound ("hh hh hh hh")`) fell to the bareCode fallback even though
upstream Strudel evaluates the source unchanged. The fix is a 5th
caller of the PV49 substrate `skipWhitespaceAndLineComments` at the
identifier-to-paren boundary class, with an `i = afterIdent` restore
arm preserving today's disposition for bare-identifier roots (e.g.
`let x = sine`).

**Upstream-grounded provenance — UNAMBIGUOUSLY TOLERATES:**

Upstream Strudel UNAMBIGUOUSLY TOLERATES whitespace between identifier
and call-site `(` via pure JS-eval pass-through:

- `@strudel/transpiler@1.2.6 transpiler.mjs:25-30` — `parse(input,
  {ecmaVersion: 2022, …})` (acorn).
- `@strudel/transpiler@1.2.6 transpiler.mjs:21-213` — AST walk (no
  whitespace normalisation; selective node rewrites only).
- `@strudel/core@1.2.6 evaluate.mjs:29-39` — `safeEval` wraps as
  `Function(body)()` (native JS evaluation).

Acorn parses `sound ("hh")` and `sound("hh")` as IDENTICAL
`CallExpression` ASTs per ECMA-262 (`CallExpression :: MemberExpression
Arguments` allows arbitrary whitespace). Our parser MIRRORS that
permissiveness via the PV49 extension at `splitRootAndChain`
(`parseStrudel.ts:2521-2531`; Codeberg pin SHA
`f73b395648645aabe699f91ba0989f35a6fd8a3c`).

2 permanent CI fixtures (1 canonical positive + 1 negative-control):

| Fixture | Bakery hash | Asserts |
|---|---|---|
| `bakery-159-tokenizer-whitespace.strudel` | `-G2drHRNFueu` (Bakery, not local) | minimal distillation of the verbatim row (`sound ("hh hh hh hh")` + `sound ("[bd bd][sd bd] bd sd")`; trailing blank-lines + `// @version 1.0` dropped per V-2 minimal-distillation discipline); whole-program STRUCTURED (`body.tag !== 'Code'`); inner `Seq` via the PV49-extended `splitRootAndChain` + inherited `miniMatch`/`looseMatch` regex arms |
| `bakery-159-NEGATIVE-no-whitespace.strudel` | — | same shape MINUS the whitespace between identifier and `(`; proves the whitespace-tolerance is the gate (both fixtures STRUCTURED post-fix; if the positive bareCodes while the negative stays structured, the fix is broken; if both bareCode, the inherited `sound("…")` recogniser arm regressed) |

**The negative-control's role:** if `bakery-159-tokenizer-whitespace`
were bareCode while `bakery-159-NEGATIVE-no-whitespace` was structured,
the PV49 extension at the identifier-to-paren boundary is broken (the
whitespace is not being consumed before the `(` check). If both
bareCode, the inherited `sound("…")` recogniser arm regressed
(pre-existing 20-15/20-18 substrate broke). If both structured (the
design state), the system works as the 20-20 mechanism describes.

**parity-refresh exclusion:** `bakery-159-*` slugs are covered by the
existing structural guard at `parity-refresh.mjs:68-75` (any `bakery-*`
prefix triggers the throw if added to TARGETS); no script edit is
needed (`node packages/app/scripts/parity-refresh.mjs --dry-run`
reports 0 missing for the 2 new fixtures).

**Cross-issue interaction note (#153 backlog inheritance):** the
canonical-positive fixture intentionally keeps BOTH `sound (…)`
siblings (two top-level expressions) — this locks today's FIRST-WINS
multi-line disposition (our parser today emits `Play`/`Seq` of the
FIRST `sound(…)`; the second is discarded by `applyChain` since its
prefix is `\n` not `.`). Upstream Strudel by contrast evaluates these
as LAST-WINS via `@strudel/transpiler@1.2.6 transpiler.mjs:198-204`'s
`addReturn` (rewrites only `body[body.length-1]`); `@strudel/core@1.2.6
evaluate.mjs:37-38`'s `Function(body)()` returns the last
ReturnStatement. The semantic mismatch is NOT a parity blocker (the
parity oracle's fence is `body.tag !== 'Code'`; both FIRST-WINS and
LAST-WINS produce structured), but a future #153 phase that adopts
LAST-WINS will need to update this fixture's snapshot — that's
intentional cross-issue signalling.

## bakery-143 — chain-arg walker `//`-comment apostrophe tolerance (#163; supersedes premature close of #143)

P70 occurrence-9. The 20-16 cascade closed [#143](https://github.com/MrityunjayBhardwaj/Stave/issues/143) framing the residual `-7LU6zgzViSM` as a guarded-boot recognition gap and shipped `GUARDED_BOOT_RE` (`parseStrudel.ts:228-229`). That ship is correct for the prelude-recognition surface but does NOT close `-7LU6zgzViSM` — the actual blocker is 3 calls down the parser pipeline, inside the chain-arg walkers.

20-21 RESEARCH §R-1 ran a 9-wave progressive strip on the verbatim exemplar source and isolated the root cause: an **odd-count apostrophe inside a `// line comment` in a chain-method argument**. Two char-by-char walkers in `parseStrudel.ts` test string-quote delimiters (`'` `"` `` ` ``) for paren-depth / arg-split tracking but do NOT skip `// line comments` before the string-quote test:

- **Site 1 — `findMatchingParen` (`parseStrudel.ts:2598-2628`):** root-boundary path. When the walker returns -1 (because an odd `'` inside a `// ma'am` put it into unterminated-string state), the caller cannot determine where the root call ends and bareCodes the whole program.
- **Site 2 — `splitArgsWithOffsets` (`parseStrudel.ts:2664-2747`):** arg-comma path. Inside `.layer(arrow, arrow)` the apostrophe-in-comment puts the walker into string mode, so commas inside the same conceptual line are NOT detected as arg separators; args mis-split → caller bails to opaque/bareCode.

The fix copies the existing `//` skip branch from `splitTopLevelStatements:414-417` (the segmenter's known-good shape) into both walker sites, placed BEFORE the string-quote test and AFTER the `if (inString)` branch. In `splitArgsWithOffsets`, the comment chars are appended to `current` to preserve the OFFSET CONTRACT at `pS:2685-2693` (PV49-spirit byte-additive consumption; existing `skipWhitespaceAndLineComments` primitive at `pushCurrent` consumes leading `// comment\n` when an arg starts with one).

2 permanent CI fixtures (1 canonical positive + 1 negative-control):

| Fixture | Bakery hash | Asserts |
|---|---|---|
| `bakery-143-apostrophe-in-chain-arg-comment.strudel` | `-7LU6zgzViSM` (Bakery, not local) | minimal R-5 distillation of the verbatim exemplar — `.layer(arrow1, arrow2)` with a `// ma'am` line comment inside arrow2's body; whole-program STRUCTURED (`body.tag !== 'Code'`) via the two-site walker `//`-skip surgery |
| `bakery-143-NEGATIVE-no-apostrophe-comment.strudel` | — | same shape with `// maam` (no apostrophe); proves the `//`-tolerance is the gate (both fixtures STRUCTURED post-fix; if the positive bareCodes while the negative stays structured, the `//`-skip didn't land; if the negative bareCodes post-fix, the skip is over-consuming) |

**The negative-control's role:** if `bakery-143-apostrophe-in-chain-arg-comment` were bareCode while `bakery-143-NEGATIVE-no-apostrophe-comment` was structured, the two-site walker `//`-skip is broken (the apostrophe-in-comment is still corrupting walker state). If both bareCode, the chain-arg-walker substrate regressed (pre-existing 20-15/20-18 substrate broke). If both structured (the design state), the system works as the 20-21 mechanism describes.

**Bonus-improvement (Wave A tail, V-3 allow-list extended on EVIDENCE):** the fix incidentally enriches one pre-existing parity-corpus fixture (`meltingsubmarine`) by the same mechanism (apostrophes in `'sawtooth'`/`'lefthand'`/`'triangle'` chain args adjacent to `//` comments). Pre-fix `body.tag=Code-via{echoWith}` (trailing `.slow(3/2)` unreachable); post-fix `body.tag=Slow` (entire chain captured). STRUCTURED→STRUCTURED enrichment, not a regression. SCOPE stays strict to gate-bearing class; 20-19 `-1j62z5xjyCN` bonus-close precedent applies.

**parity-refresh exclusion:** `bakery-143-*` slugs are covered by the existing structural guard at `parity-refresh.mjs:68-75` (any `bakery-*` prefix triggers the throw if added to TARGETS); no script edit is needed (`node packages/app/scripts/parity-refresh.mjs --dry-run` reports 0 missing for the 2 new fixtures).

## License

Each repro is a 1–3 line minimal distillation authored for regression
testing (not a verbatim copy of any community tune). The corpus-frame
AGPL-3.0-or-later applies (see `CORPUS-SOURCE.md` §License). Bakery
permalinks in the issue bodies attribute the original community patterns
that surfaced each class.

## Drift policy

Same as the 16 tunes (`parity.test.ts` header): a snapshot diff on these
fixtures from a non-corpus PR is **news** — it means a gap class
regressed (or the fix changed shape). Never `vitest -u` casually to
"make it green". The whole point of these 6 files is that the snapshot
goes red the moment one of the 6 classes regresses.
