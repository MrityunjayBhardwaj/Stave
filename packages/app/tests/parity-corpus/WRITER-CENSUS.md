# The writer census — what the syntactic core serves alone, and why

Generated and asserted by `writer-census.test.ts` (#1009, epic #1007 phase P3).
Raw per-ask rows: `WRITER-CENSUS.json`.

This document is **P6's input**. P6 proposes deleting the syntactic core
(`notation/parse.ts`'s krill AST → cells model, M2 in the epic's inventory). The set
enumerated below is exactly what that deletion would cost.

---

## ⚠ RE-BASED AT #1242 — the corpus widened, and the P6 number in this doc was ALREADY STALE

The mini-corpus harvest became the UNION of a literal walk and the product's own unit
walk: **1535 → 1633 units, 98 arrivals, 0 departures**. Every figure below this section
was taken over the 1535-row corpus and is superseded by the table here.

Measured as a PAIRED DIFFERENTIAL on one tree in one session — the census run twice,
once with `mini-corpus.json` checked out at `studio_v0.2.0` and once with the union —
so the move is attributable to the population and to nothing else:

| figure | corpus 1535 | **corpus 1633** | mechanism |
| --- | --- | --- | --- |
| corpus units | 1535 | **1633** | union of two proposers (#1242) |
| core-served asks | 1204 (991 distinct minis) | **1273** (1037 distinct minis) | +69 asks over +46 minis |
| transfers | 1041 | **1096** | +55 |
| untransferable | 63 (57 minis) | **68** (62 minis) | +5 |
| unverified (no-probe) | 100 | **109** | +9 |
| structured transfers | 633 | **684** | +51 |
| array-value residual | 8 | **9** | +1 |
| structural untransferable | 55 | **59** | +4 |
| …core view has STRUCTURE | 50 | **53** | +3 |
| …core edit VERIFIED ok | 49 | **53** | +4 |
| **the P6 blocker set** | **48** (grid 18 + roll 30) | **51** (grid 18 + roll 33) | **+3, ENTIRELY ON THE ROLL** |

> **MOVED AT #1827 (each bar drawn at its own step count): untransferable 68 → 70, core-served
> asks 1273 → 1275, transfers and unverified unmoved.** Two corpus patterns whose bars hold
> step counts that do not nest — `<~ ~ bd*3 bd*4 bd*3 bd*4 bd*4 bd*4>` (grid) and
> `<[36 48]*2 [34 46]*3 [41 53]*4 [39 51]*2>` (roll) — used to need 96 shared columns and were
> refused; the core now draws them one bar at a time. The derived projections still cap at
> 64 shared columns, so both arrive as `core-structured` untransferable asks. Structural
> untransferable 59 → 61, core view has STRUCTURE 53 → 55, core edit VERIFIED ok 53 → 55, and
> so the P6 blocker set 51 → 53 (grid 18 → 19, roll 33 → 34): the core writes both faithfully.

> **MOVED AT #1849 (a `,`-part is read the way it is read alone): core-served asks 1275 → 1303,
> transfers 1096 → 1106, untransferable 70 → 76, unverified 109 → 121, structured transfers
> 684 → 694.** A `,`-pattern whose part the flat reading refused (`bd@3 sd, hh!6`), or whose roll
> parts differ in width, used to fall to the leaf reading as a whole; the stack now asks that
> part the lone-part chain and keeps its answer when it is one flat part. 7 grid and 21 roll
> units move to the core (4 + 18 that were leaf-read, 3 + 3 that were refused), bringing 28
> asks: 10 transfer (all structured), 6 are `no-leaf-anchor` untransferable — the leaf writer
> cannot anchor a `,`-stack, the same bound as the rest of the residual — and 12 have no probe.
> Array-value residual 9 → 12, all three the newly opened grids, all `no-leaf-anchor`.
> Structural untransferable 61 → 64, STRUCTURE 55 → 58, VERIFIED ok 55 → 56, and the P6
> blocker set 53 → 54 (grid 19, roll 34 → 35). The two new structural rows without a verified
> core edit are the rolls `0,.1` and `0,.1,7, 6.9` (`no-probe`: decimal `n` values).

> ⚠⚠ **THE "54" THIS DOCUMENT QUOTES BELOW IS TWO CHANGES BEHIND THE GATE, AND WAS
> ALREADY WRONG BEFORE #1242 TOUCHED ANYTHING.** Re-measured on `studio_v0.2.0` over
> the unchanged 1535-row corpus, the blocker reads **48**, not 54.
>
> The figure IS gated — it is the `coreStructured && coreProbe === 'ok'` pin in
> `writer-census.test.ts` — so this is not an ungated number. It is the worse and
> more ordinary thing: **a document that TRANSCRIBES a gated figure and then drifts
> from it.** Traced: the pin read `toBe(54)` from #1015 until **#1066** (the onset
> snap grid, `44a97960`) moved it to `toBe(48)`. That PR updated the pin and left the
> table below reading `54 | 54 | unmoved — see below`, directly under its own
> blockquote explaining what #1066 changed. #1242 then moves it 48 → 51.
>
> **#1046 IS THIS EXACT COMPLAINT AND IS STILL OPEN.** It was filed on 2026-07-26
> about the sibling document (`ROLL-CAP-SWEEP.md`), it names these same four rows,
> and it already prescribes the right fix: *derive the table from
> `WRITER-CENSUS.json`, do not transcribe it.* Correcting 54 → 51 by hand only resets
> the clock, which is why this box states the trail instead of quietly editing the
> digit. **Anything scoping #1012 against 54 must be re-derived** — take the number
> from a run, never from this file.
>
> **The move itself is clean and is the useful half.** The grid blocker is UNMOVED at
> 18 across the whole widening; all three new blockers are roll asks. A population
> that grew 6.4% did not enlarge the grid's irreplaceable set at all, which is what
> says the grid half is a property of the notation rather than of how much of it we
> happened to harvest. The roll half rising is the ordinary reading — the roll's cap
> of 4 is the binding constraint, and more material means more asks past it.
>
> ⚠ **NOT re-measured at roll cap 12.** The "39 (24 grid + 15 roll)" figure below is a
> 1535-corpus observation and is left standing rather than scaled, because that figure
> was OBSERVED by running the census with `LEAF_PROJECT_BARS.roll = 12` and a derived
> replacement would be exactly the kind of unmeasured number this box is about.
>
> ✅ **RESOLVED at #1046 — it has now been re-observed, and given somewhere to live.**
> That reasoning was right and it left the figure with no way forward: it could not be
> derived, and re-taking it by hand only started the same clock again. It is now taken by
> `scripts/p6-cap-census.mjs`, committed as `P6-CAP12.json`, and spliced into the block in
> §#1020 — and it carries the same run's reading at the SHIPPED cap as an expiry stamp, so
> the census reddens when the world it was observed in has moved. The current pair is in
> that block; every "39" below is superseded.

---

## ⚠ RE-BASED AGAIN AT #1010 P4c — the duration class is CLOSED (figures below are pre-#1242)

The step-grid printer now **preserves** a note's length instead of re-deriving it from
the columns. That retires class 2 of the five-part anatomy below ("11 duration loss →
#1026 / **#1010**") — the owner named there has landed.

Attributed row by row against the `WRITER-CENSUS.json` this harness generated at
`studio_v0.2.0`: **1204 rows on both sides, no row appearing or disappearing**, and the
eleven corrupting asks are the *only* rows that moved.

| figure | pre-P4c | **now** | mechanism |
| --- | --- | --- | --- |
| corpus units | 1535 | **1535** | — |
| core-served asks | 1204 (791 grid / 413 roll) | **1204** | — |
| transfers | 1026 = 85.2% | **1041** = 86.5% | +9 from `view-corrupts` (#1010 P4c), then +6 from `irrational-onset` (#1066) |
| untransferable | 78 | **63** | −15; its corrupting half fell 11 → **0** at #1010 P4c, its `no-view` half 67 → 69 → **63** at #1066 |

> **#1066 — the onset snap grid, +6 transfers.** The grid every played onset is
> rounded onto before it is asked for a denominator was `LCM(1..16)` =
> `2^4·3^2·5·7·11·13`. It carries only four factors of two, so neither 32 nor 64
> divides it — while `MAX_STEPS`, the acceptance ceiling, is **64**. A thirty-second
> onset (`9/32`) rounded to `0.2812506937506937`, which no `d ≤ 64` makes integral,
> so `denom` refused it as `irrational-onset`. The projection advertised 64 columns
> while the grid feeding it topped out at sixteenths for powers of two, and the
> refusal blamed the pattern for a position the snapping had made irrational.
>
> Widened to `2^6·3^2·5·7·11·13`. It is a strict widening — the old grid divides the
> new one — so no row could move the other way, and none did. What moved, over the
> whole corpus verdict pin: **20 rows leave `irrational-onset`** — 15 to `ok`, 5 to
> `the pattern needs more than 64 steps`, which is the honest refusal those five
> always deserved. Two more leave `unstable-period` for `irrational-onset`: an
> inexact grid could round the same musical instant to different keys in different
> cycles, so period detection failed before the onset check was ever reached.
> **Zero rows lost a view.**
>
> The population is ordinary rather than exotic — sixteenth-note figures inside a
> two-bar alternation, e.g. `[~ ~ ~ hh ~ ~ hh ~ …] <[…] […]>` and
> `[f1 ~ ~ f1 …][db1 ~ ~ db1 …]`. It also lifts repeated subdivision from three
> gestures to five: the grid writer was emitting documents its own reader refused
> to reopen (#1066).
| **view-corrupts** | 11 | **0** | the printer keeps the length |
| structured transfers | 624 | **633** | all 9 recovered asks are structured |
| unverified (no-probe) | 100 | **100** | — |
| array-value residual | 8 | **8** | — |
| candidate-structural residual | 70 | **61** | the 9 recovered |
| **the P6 blocker set** | **54** | **54** | **unmoved — see below** |
| the P6 blocker at roll cap 12 | 39 (24 grid + 15 roll) | **39** (24 grid + 15 roll) | ⚠ **SUPERSEDED at #1046** — re-observed; see the generated block in §#1020 |

Of the eleven: **9 became clean transfers**, and **2 became `no-view`** at gate
`view-usable` — `[bd ~]*2` and `[- - sd -]*2`, where the column resolution cannot spell
the length at all, so the writer declines and the view is no longer offered. That is the
ranking this project already held before the phase existed: a view that never opens beats
one that opens and mis-writes.

**P4c recovered 9 views and reduced P6's number by ZERO.** That is not a disappointment,
it is the conjunction doing its job: all 9 had a structured core view (`coreStructured`
falls 65 → 56) and **none** had a verified core edit (`coreProbe === 'ok'` is unmoved at
55). The core could not write those asks faithfully either, so they were never part of what
blocks deleting it. ⚠ **The two numbers this paragraph used to name — 54, and 39 if the
roll cap moves in the same change — are both stale. Take the pair from the generated block
in §#1020 below** (#1046).

Every figure above is printed by `writer-census.test.ts` — the `BOTH SURFACES` and
`THE P6 BLOCKER` blocks — and pinned to a literal that fails on movement. Take them from a
run, never from prose. ⚠ **That instruction was already written here and this paragraph
did not follow it**, which is the whole reason the block in §#1020 is generated rather
than corrected.

---

## ⚠ RE-BASED AT #1037 — every figure below this banner is over the OLD corpus

The harvester was rebuilt to ask the transpiler which strings become patterns
instead of approximating it with a regex. The corpus went **1500 → 1535** units:
backtick minis in (long, multi-line, multi-cycle — the hard material), and
**commented-out code out** (94 strings that existed only inside `//sound("…")`
lines and were never asks at all). **No runtime code changed in that diff**, so
every movement is the population's.

The document below has NOT been rewritten line by line, deliberately: a
half-updated table is worse than a clearly-dated one, and that failure mode is
what this whole arc has been about. Read every figure below as **pre-#1037**, and
take the current values from here or from the pins in `writer-census.test.ts`,
which fail on movement:

| figure | pre-#1037 | **now** |
| --- | --- | --- |
| corpus units | 1500 | **1535** |
| core-served asks | 1217 (803 grid / 414 roll) | **1204** (791 grid / 413 roll) |
| transfers | 1055 = 86.7% | **1026** = 85.2% |
| untransferable | 68 | **78** |
| unverified (no-probe) | 94 | **100** |
| array-value residual | 7 | **8** |
| unstable-period residual | 33 | **36** |
| **the P6 blocker set** | **46** | **54** |
| the P6 blocker at roll cap 12 | 34 (19 grid + 15 roll) | **39** (24 grid + 15 roll) |

⚠ **The last two rows are pre-#1037 on both sides and neither is current** — the blocker
has since moved twice more and the cap-12 figure had no gate at all until #1046. Take both
from the generated block in §#1020.

The rate fell 86.7% → 85.2% and that is **not a regression**: the population it is
over now contains the multi-cycle material the old net could not see, and no
longer contains code nobody runs. A rate over the two is not comparable, which is
why both are stated with their corpus.

**For P6:** ⚠ this line named **54**, and **39** if the roll cap moves to 12 in the same
change. Both are pre-#1037 and neither is current — take the pair from the generated block
in §#1020 (#1046).

---

## The measurement

For every **surface-ask** the syntactic core serves — one (mini, surface) pair — both
writers are put through the *same* edit probe (`engineEditOracle.ts`, the one
`writer-reach.test.ts` uses):

| | |
|---|---|
| **incumbent** | the core's own model, **verified not assumed** |
| **counterfactual** | `project{StepGrid,PianoRoll}Derived` — the real writer chain below the core, asked in the real order |

A surface-ask is *not* a mini: a mini can be core-served on both surfaces. Both counts
are given; quote the **mini** count when the question is "how much text loses its view".

### Denominator, re-derived rather than inherited

The epic quotes **234 of 1208** core-served asks as served by neither derived
projection. That figure was over a corpus snapshot of 1492 nonempty minis. Today the
corpus holds 1500 and the core serves **1217** (803 grid / 414 roll), pinned in the test
to `writer-reach`'s complement so the two gates cannot drift apart silently.

---

## The result

> **Updated after #1019, #1021 and #1022 landed.** The figures below are post-fix. Where
> a number moved, the pre-fix value is given beside it, because the *movement* is the
> finding — see "What #1019 actually bought" below.
>
> **#1022's contribution is a MEASUREMENT gain, not a reach gain, and the two must not be
> read as the same thing.** The probe read cycle 0 and nothing else, so any pattern that
> rests in its first bar was filed unverified. It now advances to the first bar the model
> spans that actually sounds. Transfers 1058 → 1066 and unverified 102 → 94 — **the +8
> came entirely out of `unverified`, and `untransferable` did not move by one ask.**
> Nothing was reclassified from broken to working; asks that were untestable became
> testable and then passed.

> **#1026 is a different kind of correction again, and it moved the headline down.** The
> oracle's grid arm compared **onsets only** — `durAware: false`, commented "an onset
> instrument — the grid has no duration axis". That is a true statement about what the
> grid *panel* draws and a false licence for what the grid *writer* may alter: a view
> that cannot show duration still must not change it, because "edits locally / no silent
> data loss" is a property of the document. Restoring the axis reclassifies **11 grid
> asks** from `transfers` to `view-corrupts`. Every one plays the right atoms at the
> right instants and holds one of them for a different length. **The roll does not move
> on any figure** — it was already duration-aware, which makes it this change's control
> arm — and `unverified` does not move at all.

| outcome | asks | of 1217 | was (pre-#1026) | was (pre-#1019) |
|---|---|---|---|---|
| **transfers** — a derived writer opens it AND the edit survives the engine | **1055** | 86.7% | 1066 | 965 |
| **untransferable** — no derived view, or the view corrupts | **68** | 5.6% | 57 | 151 |
| **unverified** — opened, but no clean single-note delete probe exists | **94** | 7.7% | 94 | 101 |

Per surface: grid **708 / 803 = 88.2%**, roll **347 / 414 = 83.8%**.

- Transfers by writer: **1022 element / 33 leaf**.
- **11 asks corrupt, all on the grid, all from the element re-emit.** This paragraph used
  to read "zero asks corrupt on either surface… which is what makes the untransferable
  set readable as an *admission* result and not a fidelity one". That zero was the
  oracle's, not the writers'. The honest reading is now: the untransferable set is an
  admission result **plus** 11 fidelity failures. What survives as an invariant is
  sharper and has a mechanism behind it — **the leaf adapter corrupts nowhere, 0 of the
  11 here and 0 of the 29 in `writer-reach`.** Byte surgery copies every structural byte
  it was not asked to change, so it cannot lose a length; the element re-emit re-derives
  every length from a cell model that has none.
- **14 transfers change the view's shape** (10 grid / 4 roll) — reach moves, no verdict
  moves, and the user sees a different grid. Unchanged by the fix.
- The 68 untransferable asks sit behind **63 distinct minis** (was 57 / 52, and 151 / 146).
- **Additive per unit, verified row by row rather than netted:** across all 1217 asks,
  **0 went from a better outcome to a worse one**. The 94 that moved went
  `no-view → transfers` (93) and `no-view → no-probe` (1).

### The 151 split into a hole and a bound — the hole was most of it, and it is now closed

| | asks | now |
|---|---|---|
| a `word:index` naming hole (**#1019**) | 101 | **7** |
| candidate structural bound | 50 | **61** |

> The structural column moved 50 → 61 at **#1026** and that is not a change in this
> split's meaning: the 11 duration reclassifications play no array value, so they land
> wholly in the second column. The claim this table protects — that naming the
> `:`-variant did not touch the structural column — is about #1019 and still holds,
> because the array column is still 7.

**#1019, and why the structural column not moving is the load-bearing half.** krill
lowers `bd:3` to the array value `["bd", 3]`. `readGridOnsets` named a `string`, a
`number` and an `{s, n}` object, and fell through to `no-note-content` for the array —
so every `:`-variant was invisible to both derived projections. The core parses `:`
itself and answers first, so nothing looked broken.

The fix rejoins the array to its own source text. That is not a new rule: `tail` is the
**only** op that builds an array value and it *accretes*
(`@strudel/mini/mini.mjs:50-52` — `Array.isArray(a) ? [...a, b] : [a, b]`), so joining
on `:` is the exact inverse of the one construction path, and `cellToken` can write the
token straight back out.

The naming column fell 101 → **7** and the structural column stayed at **exactly 50**.
A fix that had also moved the second column would have meant the two classes were never
independent and the whole hole-versus-bound split needed re-deriving.

The 7 that remain play a `:`-variant *and* have a second, real blocker — six `,`-stacks
with no leaf anchor, one past the period cap. They are structural residual that happens
to contain a `:`, and the gate asserts that none of them is refused for note content.

> **The tail is load-bearing, and the reference notes were wrong about it.** The array
> was documented as a two-element pair. It is not: `sd:0:0.5` arrives as
> `["sd", 0, 0.5]`, and **1372 of the corpus's array-valued haps have three members**. A
> `v[0] + ':' + v[1]` naming — the one that follows from the notes — would have written
> `sd:0` back into the document and silently dropped the gain. Members can also be
> non-numeric (`piano:x:.5`), so the join accepts strings as well as numbers.

> **Correction to the pre-fix write-up.** The 8 asks this document previously called
> "out of scope (a *patterned* index, `gm_bird_tweet:<0 1 2 3>`)" were **not patterned
> indices — not one of them**. They were decimal-tail forms — `LinnDrum_hh:0:.3`,
> `pulse:.3`, `sawtooth:0:.8`, `trial:0:.4`, `gm_epiano1 piano:x:.5`, and three
> `,`-stacks — which the rewrite regex `(\w+):(\d+)` left a stray `:` in, so the
> experiment scored them as unscoreable rather than as failures. Five of the eight
> transfer under the real fix, precisely because it joins the whole tail instead of
> pattern-matching an integer index.

---

## What #1019 actually bought — and the instrument that hid it

**93 asks moved from "no derived view at all" to a verified transfer.** All on the grid,
all answered by the element writer, all showing the same shape the core showed, none
corrupting.

**Of those 93, only 32 have more than one cell.** The other 61 are a single atom — a
correct model of a bare instrument name, and a useless surface. Structured transfers
overall went **609 → 641** (and to **648** once #1022 let the probe see patterns that
rest in bar 0), and *that* is the product-facing number. The raw 93 should not be quoted
as reach.

Three figures have been attached to this hole at different times. Only the last is a
transfer count:

| figure | what it actually counted |
|---|---|
| 205 | asks whose mini *contains* an array value and that no writer opens — co-occurrence |
| 92 | asks whose *view opens* after a text rewrite — a parse result, never an edit result |
| **93 / 32** | **asks that gained a verified transfer / of those, the ones with structure** |

### The measurement was suppressed by a copy of the bug it was measuring (#1021)

With only the reader fixed, the census reported transfers **unchanged at exactly 965**,
and all 94 newly-opened asks landed in `no-probe` with reason `no-readable-haps`.

That was not a fact about the projections. `atomOf` in `engineEditOracle.ts` named a
played atom from a number, a string, or an object with `.s`/`.note`/`.n` — and an array
is an object with none of those, so it returned `null`, which `enginePlayedCycle` reads
as "this whole mini is unreadable". **The instrument carried the identical naming hole
it had been built to measure**, and it had been passing all of its own assertions.

The oracle now names the array through the readers' own `tailToken`, imported rather
than reimplemented, so there is one rule instead of two. Only then did transfers move
off 965.

The lesson is narrower and sharper than "test your tests": a `no-probe` bucket is a
claim about the *model*, and it silently became a claim about the *oracle*. Any reason
code that can be produced by the instrument's own limits needs a check that it is not.

### CLOSED (#1022): `no-readable-haps` conflated two different facts

*Kept because the shape of the error is the reusable part.* The reason code meant both
"the oracle cannot name this value" and "this plays nothing in the cycle I looked at" —
an oracle limitation and a property of the notation, sharing one label, in the very
bucket that exists to tell unverified apart from untestable.

It is now two reasons, `unnameable-value` and `silent-in-probed-window`, and the probe
advances past silent bars instead of giving up on cycle 0. **All nine were the second
case and all nine are now verified**; the bucket is empty. What follows is the original
diagnosis.

Nine asks reported it, and none of them was a naming failure — they are alternations
that are **silent in the probed cycle** (`<- cp:1>`, `<~ sd ~ sd ~>`, `<- c5>`). The
probe reads one cycle, sees no onsets, and reports the same reason it uses for an
unnameable value. "Plays nothing here" and "plays something I cannot name" are different
facts and should not share a label. Pre-existing, not introduced here, and filed
separately.

---

## The rate is stable across two differently-drawn populations

`writer-census-eval.test.ts` re-derives the ask population from **evaluation** instead
of the parse-side harvest — over the 150 real tunes, taking the mini the eval-first
resolver (#1006) hands each unit.

| population | transfer rate | was (pre-#1026) | was (pre-#1019) |
|---|---|---|---|
| mini-corpus (parse-side harvest), 1500 minis | **1055 / 1217 = 86.7%** | 1066 / 1217 = 87.6% | 965 / 1217 = 79.3% |
| eval-first, all resolved minis | **427 / 500 = 85.4%** | 432 / 500 = 86.4% | 413 / 500 = 82.6% |
| eval-first, only the minis the parse snapshot lacks | **76 / 93 = 81.7%** | 77 / 93 = 82.8% | 73 / 93 = 78.5% |

> ⚠ **The eval rows had drifted before #1026 touched them, and that is worth more than the
> correction itself.** This document recorded 430/500 and 75/93. Re-measured on the same
> tree with the *old* oracle they are 432/500 and 77/93 — so they had moved across #1018
> and #1022 and nobody re-read them. **The eval arm prints its figures and asserts none of
> them**, unlike the harvest arm, whose every headline is pinned to a literal that turns
> red on movement. An ungated number in a document is a number that decays quietly. Filed.
>
> #1026's own contribution, isolated by running both oracles on this tree: **−5 asks** on
> the 500 arm and **−1** on the 93 slice. Monotone down on both, which is the only
> direction a strictly stricter comparison can move a transfer count — and worth checking
> rather than assuming, because the raw before/after would have shown 75 → 76 going *up*.

**Both arms had to be re-read after #1019, and this table is the reason.** The two arms
run the same writers over differently-drawn ask populations, so a fix to the writers moves
both. Quoting the new harvest figure beside the old eval figure would have put a post-fix
number and a pre-fix number in adjacent cells and invited the reader to treat the gap as a
population effect — which is the failure this table exists to guard against, committed by
the table itself.

The pre-fix reading was that the eval arm scored *higher* than the harvest arm. After the
fix it scores marginally **lower** (86.0% against 86.7%), so that ordering was never a
real effect — it was the naming hole falling differently across two populations that
overlap heavily. What survives is the thing worth keeping: **all three figures agree
inside ~1pp for the two large populations, and the genuinely-new slice sits 6pp below
them** (n=93, so still a weak signal, but a more visible one than the 0.8pp it was).

Read that as: **the transfer rate is close to a property of the corpus rather than of how
the asks were drawn** — and note that the eval arm's assertions are loose bounds
(`> 200`, `>= 142`), so it will *not* turn red when its rate moves. Its figures must be
re-read from the test output whenever the writers change; nothing pins them.

Eval coverage for this arm is **142/150** — #1008's floor, reported beside the figure
because every number computed from an eval sweep is over the documents that evaluated.

---

## The 50 candidate-structural asks, by verified mechanism

Classified against the **engine**, not the refusal label — the label has overstated the
opportunity every time it has been counted.

### 1. Period past the surface cap — 33 asks (66% of the structural residual)

**Mechanism, measured:** 31 of the 33 have a true cycle period past their surface's
`LEAF_PROJECT_BARS` cap (grid 12, roll 4); 2 are genuinely aperiodic within 24 cycles.
**Zero have a period within the cap** — that assertion is the mechanism's must-not, and
it fires if the gate is ever misattributing.

**The finding that gates P6 (#1020): 20 of the roll's 27 have a period in (4, 12] — the
roll's own cap of 4 is what stops them, and the grid's *existing* cap of 12 clears them.**
The cap sweep that set the roll to 4 measured **zero** gain at every cap — but it ran
through `writer-reach`, which by definition sweeps only the asks the core *refuses*. On
the asks the core *serves*, the same cap is the single largest blocker. A gate defined as
another gate's complement carries a population restriction its numbers don't mention.

These are ordinary music, not edge cases:

```
roll  <0 1 2 3 4>                          roll  <0 3 5 7 3 5 0 2>
roll  0 <2 3> <5 7 5>                      roll  <12!8 7!8>
roll  <A1@4 D2@4 C#2@1>                    roll  <62 71 72 74 80 74 71 60 53 52 30> [36]
roll  <c4 ~ ~ e4 ~ g4 ~ ~ b4 ~ g4 ~ e4 ~>  step  <sawtooth!16 pulse!8>
step  <a2 ~ ~ f2 ~ ~ g2 ~ ~ e2 ~ ~ …>      step  <~ ~ ~ ~ ~ ~ ~ ~ c5 ~ e5 g5 ~ ~ e5 g5>
```

Full list in the test output; 27 roll / 6 grid.

### 2. The shared leaf — 9 asks (`view-unusable`)

**Mechanism:** a `,`-stack whose elements are `*n` / euclid, so several played onsets
come from **one** source atom. The core models this syntactically (it knows `bd*4` means
four cells); a behaviour projection sees four onsets with one span to write them back to,
so the cell↔leaf-span bijection fails — the leaf writer refuses the shared leaf and the
element writer has no region tiling for a stack. **No cap reaches these.**

```
step  bd*4, sd(2,4,1), hh*8      step  bd(3, 8), hh(4, 8, 1)
step  bd*4, [- cp]*2, [- hh]*4   step  [bd ~]*2, [~ hh]*2, ~ sd
step  bd*2,~ [cp,sd]             step  bd*4, cp(7, 16,14)
step  <~ ~ [~ cp]*2 [~ cp]*2 cp*4 [~ cp]*2>
roll  <0*2>                      roll  <[-3@1 -2@1 -1@1 0@1]*2>
```

### 3. Duplicate / unsafe lanes — 4 asks (`edit-unsafe`)

```
step  hh,hh oh sd                     step  gm_choir_aahs,gm_choir_aahs
step  <[ht bd~][ht bd~][ht bd~]>      roll  <[0 4 7] [~ ~ ~] [0 4 7] [~ ~ ~]>
```

Two are a `,`-stack with a **repeated lane name**, which the grid cannot address
unambiguously. `bd~` in the third is a single token, not `bd ~`.

### 4. Onsets that do not land on a grid — 2 asks (`irrational-onset`)

```
step  a b c2 d1 e3 f4 g5 f4 a a b b b c c d d e e e e f f f f g g g g a a a   (31 elements)
step  [ a4 ~ ~ a4] [ a4 ~ a4 ~]  [ a4 ~ ~ a4 ]  [ a4 ~ a4 a4 ]*2
```

A 31-element sequence puts onsets at `k/31`; no cell grid represents that.

### 5. Degenerate — 2 asks (`no-note-content`)

```
step  ~        roll  ~
```

A pattern of pure silence. The core opens a view of nothing. `coreStructured = false`,
so **this is not a view worth preserving** and should not be counted as a blocker.

---

## What actually blocks deleting the core

Filtering the 50 to asks whose **core view has structure** (more than one cell/note — a
one-cell view of an instrument name is a correct model and a useless surface) and whose
**core edit is itself verified**:

| | asks | was (pre-#1026) |
|---|---|---|
| candidate structural | 61 | 50 |
| …with a structured core view | 57 | 46 |
| …with a verified core edit | 47 | 45 |
| **…both (the set that actually blocks deletion)** | **46** | 44 |

> **46 at #1026, up from 44 — and the small size of that move is the finding.** Eleven
> asks were reclassified from `transfers` to `view-corrupts`, so the structural set grew
> by eleven, but the blocker set grew by only **two**. This column holds the INCUMBENT to
> the same restored axis, and **eight of the eleven are asks whose core write loses the
> same duration** — never reach on either side, and charging them to the projection would
> be a free win for the incumbent, which is exactly what the conjunction exists to stop.
> Only the three the core writes faithfully are a real cost, and two of those have a
> structured core view.
>
> **41 → 45, and so 40 → 44, at #1022 — with the untransferable set unchanged at 50.**
> This column is the **incumbent's** probe, and the incumbent benefits from a better probe
> exactly as the challenger does. Four core views whose patterns rest in bar 0 were filed
> unverified and are now verified, so they graduate from "structured but untestable" into
> the blocker set. **The cost of deleting the core did not rise; our measurement of it
> did.** A change that had also moved the 50 would have meant something else entirely.

The two filters are not nested, so the conjunction (46) is the number to quote, never
either single column. The residue: **4 asks have no structured core view at all** —
`~` on both surfaces, `<0 -@7>`, and `gm_choir_aahs,gm_choir_aahs` — a view of silence or
of one repeated lane, which is not a view worth preserving. **6 more have a structured
core view whose edit the probe cannot verify** (fully chorded, so *neither* writer is
testable) — unverified, not untransferable.

### So the honest answer to P3

**The syntactic core's irreplaceable reach is 46 surface-asks, not 234** — and it is
not one bound but a stack of five, four of which have a named owner. Anatomy of the
candidate-structural **61** (the blocker set's count for each is in brackets):

1. **33 period-cap** [30] → #1020. 20 clear at a cap the grid already ships.
2. **11 duration loss** [3] → **#1026 / #1010.** New at #1026: these are not admission
   failures at all but fidelity ones — the view opens, the edit writes back, and a
   surviving note is a different length. Every one is the element re-emit, so retiring it
   for surgery removes the class. Only 3 reach the blocker set, because on the other 8
   the *core's* write loses the same duration and the ask was never reach on either side.
3. **9 shared leaf** [9] → the bijection. No fix known; this is the real bound.
4. **4 duplicate lanes / 2 irrational onsets** [3 / 1] → genuine, small, structural.
5. **2 degenerate** [0] → not worth keeping.

**Verdict for P6: not blocked, but not free either.** Deleting the core is viable *after*
#1019 and #1020 land, and even then leaves roughly **15 asks** (shared leaf + duplicate
lanes + irrational onsets) with no derived view at all. **That 15 is unchanged by #1026** —
the duration class is a fixable fidelity failure owned by #1010, not a permanent bound, so
it does not join the residual the deletion has to accept. Whether that is acceptable is a
product call, not a measurement one — but it is a decision about 15 asks over ~15 minis,
not about 234.

> **#1019 has now landed, and it did not change this verdict by one ask.** The blocker
> set was still **40** at the time (44 after #1022 made the incumbent's own probe less
> blind, 46 after #1026 restored the duration axis — see above) and its four components are still 33 / 9 / 6 / 2. That is the
> expected result and worth stating plainly: the naming hole and the structural bound
> were always independent claims, and closing the first was never going to move the
> second. What #1019 changed is the *untransferable* total (151 → 57) and the live
> product surface (32 structured views that did not exist). **#1020 remains the only
> one of the two that moves P6's number.**

### #1020 has now been measured, and it moves the number — conditionally

Full sweep: **`ROLL-CAP-SWEEP.md`**. `LEAF_PROJECT_BARS.roll` swept at 4/6/8/12 against
both populations separately. At 12, with the core deleted:

<!-- P6-TABLE:BEGIN — generated by writer-census.test.ts (#1046); do not edit by hand -->

> **REGENERATED BY THE CENSUS ON EVERY RUN — no dating banner above this block
> applies to it.** These figures are current for the tree they are committed with.

At roll cap **12**, with the syntactic core deleted (#1012) — over 1633 corpus
units, 1306 core-served asks (831 grid / 475 roll):

| | cap 4 (shipped) | cap 12 |
|---|---|---|
| untransferable asks, both surfaces | 76 | 58 |
| roll untransferable | 41 | 23 |
| **the set that actually blocks deleting the core** | 54 | 38 |
| …of it, grid | 20 | 20 |
| …of it, roll | 34 | 18 |

**The cap's own contribution is 16 asks** (54 − 38), all of it on the roll: 34 − 18 = 16.

**The grid is the control arm** and it is identical to the digit at both caps — 831 asks / 730 transfers / 35 untransferable / blocker 20 at cap 4, and 831 / 730 / 35 / 20 at cap 12. The constant is per-surface and roll-only, so a grid column that moved would mean the sweep had changed something it was not aiming at.

The cap-4 column is DERIVED from this run. The cap-12 column is an OBSERVATION taken by `node scripts/p6-cap-census.mjs 12`, which sets the module constant exactly as a ship would; it carries the cap-4 column from its own run as an expiry stamp, and `writer-census.test.ts` reddens when that stamp stops matching this tree.

<!-- P6-TABLE:END -->

> ⚠ **This table used to be a hand-typed copy of `ROLL-CAP-SWEEP.md`'s, and the two had
> drifted apart from each other AND from the pin in `writer-census.test.ts`** — which is
> how one document came to say the blocker was 34 at cap 12 while another said 39, with
> the shipped-cap pin sitting green at a third value the whole time. Both documents now
> splice the same generated block from the same run, so they cannot quote different gains
> (#1046). Zero corrupt and zero asks moved to a worse outcome, per ask, at every cap.

> ⚠ **Re-derived at #1026** (was 44 → 32). The cap-12 figure was **observed** by running
> this census with the constant set, not obtained by subtracting the cap's known
> contribution from 46. The two agreed; the point was that the agreement had been checked
> rather than assumed — and that reasoning is why the cap-12 column is still an
> observation today rather than a subtraction. ⚠ Its digits are pre-#1037 and the "cap's
> contribution is unchanged at 12" clause it carried is no longer true; take both from
> the generated block above.

**The cap has NOT been raised, and that is deliberate.** Its two populations do not pay at
the same time. In production `parsePianoRoll` is core → projection, so for a core-*served*
mini the core answers and the derived writers are never consulted: the +13 transfers above
are a counterfactual about a core that still exists. Meanwhile the same raise opens **9
new views on the core-*refused* population at 27.6% live for zero extra reach** — the
exact trade the cap was set to 4 to refuse, and reproduced here on today's code rather
than inherited.

So the raise belongs to the deletion, not before it. **P6 should be scoped against the
cap-12 column of the generated block above, and must include `LEAF_PROJECT_BARS.roll = 12`
in its own diff.** ⚠ This sentence used to name a digit; the digit was two corpus rebuilds
stale while the sentence went on reading like a conclusion (#1046). Raising the cap
earlier costs real product surface and buys nothing until the core stops answering first.

The 12 remaining roll asks the raise clears are branch alternations whose notes each own a
source token; the 17 that survive it are the shared-leaf family, and they stop at
`note-crosses-bar` (`@n` inside `<>`, 0 → 4) and `view-unusable` (`!n` inside `<>`,
2 → 4) rather than at the period gate. **No cap reaches those** — they are the same
bijection bound §2 already names.

The alternative outcome the phase was told to be willing to report — "two writers,
bounded" — is **not** what the measurement says. It says one writer plus a small named
residual, and the residual is enumerated above rather than estimated.
