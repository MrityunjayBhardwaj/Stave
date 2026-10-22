# Strudel Hover-Docs Parity — End to End

**Status:** living doc · **Owner:** editor / `monaco/docs` subsystem
**Ground truth:** `@strudel/*` `1.2.6`–`1.3.0` `register()` / `registerControl()` calls; anchors harvested from live `strudel.cc/learn/*` pages (see §7).

This document traces the Strudel hover-documentation system from the data map to the rendered tooltip, defines what "parity with Strudel" means, inventories current coverage, enumerates the missing function **families**, and specifies the implementation plan — including the **verified per-function `sourceUrl`** every entry must carry so its `Reference →` link lands on the exact strudel.cc heading.

---

## 1. Why this exists

Hovering a Strudel function in the editor should show its signature, a one-line description, an example, and a `Reference →` link to the canonical docs. Today only ~50 functions are covered. The lookup is a **hand-curated map with no runtime fallback**, so any unlisted function is a *silent* no-hover (no error, no tooltip). The `pickRestart` bug (#802) was one visible symptom of a whole missing family; this doc exists so the remaining gaps are closed **by family, with correct links**, not one reported symptom at a time.

Governing invariant: **[[PV163]]** — a fallback-less vocab map is populated by *family*, not by *member*. Error pattern: **[[P254]]**.

---

## 2. What "parity" means

**Definition.** A Strudel function has *hover parity* when hovering its name in the editor yields a `RuntimeDoc` with:

1. `signature` — the call shape (`.name(args)` for chainable methods, `name(args)` for factories/standalones).
2. `description` — one line (Monaco content-sizes the box; keep it terse — see §6 box-width note).
3. `example` — a runnable one-liner, ideally lifted/adapted from the upstream JSDoc.
4. `sourceUrl` — a **verified** `strudel.cc/learn/<topic>/#<anchor>` permalink (or intentional omission → functions-browser fallback, see §7).

**Metric.** `parity% = documented_user_facing_functions / registered_user_facing_functions`. We deliberately exclude the long tail of control-param aliases (see §6, "the tail") — parity targets what a musician would actually hover, not every registered synonym.

**Non-goals.** We do not document: internal helpers, deprecated aliases, or one-letter param shorthands (`att`, `dec`, `ds`, `ctf`, …) unless they're commonly taught.

---

## 3. End-to-end pipeline

```
STRUDEL_DOCS (hand-curated map)  ─┐
VIZ_ENTRIES (generated ._x/.x)   ─┼─►  STRUDEL_DOCS_INDEX  ──►  registerStrudelHover()
aliases { pickSqueeze: 'inhabit'} ┘         (DocsIndex)              │  createDotCompletionProvider()
                                                                     ▼
      Monaco hover event ──► resolveDoc(index, word) ──► renderHoverContents(doc) ──► .monaco-hover widget
                                  │ direct key                       │ signature (code block)
                                  │ then alias                       │ description
                                  └ else null (SILENT no-hover)      │ example
                                                                     └ [Reference →](sourceUrl ?? docsBaseUrl)
```

**File map**

| Concern | File | Symbol |
|---|---|---|
| The data map | `monaco/strudelDocs.ts` | `STRUDEL_DOCS`, `VIZ_KINDS`→`VIZ_ENTRIES`, `STRUDEL_DOCS_INDEX`, `registerStrudelHover` |
| The doc shape + resolver | `monaco/docs/types.ts` | `RuntimeDoc` (`sourceUrl?`), `DocsIndex` (`aliases?`), `resolveDoc` |
| Hover + completion factories | `monaco/docs/providers.ts` | `createHoverProvider`, `renderHoverContents`, `createDotCompletionProvider` |
| Registration | `workspace/languages.ts` | `ensureWorkspaceLanguages` calls `registerStrudelHover(m)` |
| Box-width CSS | `app/src/app/globals.css` | `.monaco-hover` width cap + code wrap |

**Resolution contract** (`resolveDoc`): direct key → alias key → `null`. **There is no JSDoc/runtime fallback.** This is the crux: an absent key produces *nothing*, not an error — so gaps are invisible until a user reports "why no hover?"

**Render contract** (`renderHoverContents`): emits an array of `IMarkdownString` — signature (```typescript fenced), description, `**Example:** \`…\``, optional `**Returns:**`, and `[Reference →](href)` where **`href = doc.sourceUrl ?? index.meta.docsBaseUrl`**. `docsBaseUrl = https://strudel.cc/functions/` (the searchable browser). `sourceUrl: ''` (empty string) *suppresses* the link entirely (`'' ?? x` stays `''`, falsy) — used for Stave-only entries like `.viz`.

**Completion side-effect:** every `STRUDEL_DOCS` key is also offered by `createDotCompletionProvider` on `.`-trigger. Adding a doc adds a completion — a bonus, except for non-chainable functions (`squeeze`, `note`, signals) that appear in the dot-list slightly inaccurately. Acceptable; hover is the primary surface.

---

## 4. Data model & conventions

```ts
interface RuntimeDoc {
  signature: string          // required
  description: string        // required
  example: string            // required (enforced by strudelDocs.test.ts)
  returns?: string
  sourceUrl?: string         // verified permalink; omit → docsBaseUrl fallback; '' → no link
}
```

- **Chain form vs factory form.** Hover matches the bare word (`getWordAtPosition`), so ONE entry covers both `pickRestart(...)` and `.pickRestart(...)`. Signature should reflect the *primary* usage.
- **Synonyms → `aliases`,** not duplicate entries. Strudel's `register(['a','b'], …)` synonyms map `b → a` in `STRUDEL_DOCS_INDEX.aliases` (e.g. `pickSqueeze → inhabit`, `pickmodSqueeze → inhabitmod`). One doc, many spellings.
- **Viz methods are generated,** not hand-written: `VIZ_KINDS` × 2 chain forms (`._name` inline / `.name` backdrop) → `VIZ_ENTRIES`. Add a new viz kind to the table, not 2 entries.
- **`_`-prefixed names hover fine** (`_` is a Monaco word char); **`$` does not** (word separator) — `$:` track syntax is intentionally undocumented.

---

## 5. Current coverage (baseline)

Documented today (~50 fns + 18 viz forms): `note s n?` core; `stack cat` factories; `fast slow rev iter chunk jux off euclid` time; `gain pan lpf hpf cutoff resonance room delay orbit vowel speed sustain release` effects; `struct mask every` conditional; `sometimes degradeBy layer` random/accum; `meta setcps`; the **pick family** (#802/PR #803); the `viz` Stave method; and the 9 viz kinds × 2 forms.

> ⚠️ **Several documented families are *half*-covered** — the exact incomplete-enumeration smell (§6). See the gap table.

---

## 6. Gap analysis — the missing families

Derived by diffing the registered universe (`register()` + `registerControl()` across core/mini/tonal/webaudio) against the doc keys. Counts are approximate (alias spellings inflate raw totals); the *families* are exact.

### 6a. Half-covered families (highest priority — inconsistent today)

| Family | Have ✓ | Missing ✗ |
|---|---|---|
| **Envelope (ADSR)** | `sustain`, `release` | `attack`, `decay`, `adsr`, `hold` — *documents `.release()` but not `.attack()`* |
| **Random / probability** | `sometimes`, `degradeBy` | `often`, `rarely`, `always`, `never`, `almostAlways`, `almostNever`, `someCyclesBy`, `sometimesBy`, `undegrade`, `degrade`, `choose`, `wchoose`, `chooseCycles` |
| **Filters (q/env)** | `lpf`, `hpf`, `cutoff`, `resonance` | `lpq`, `hpq`, `bpf`, `bpq`, `lpenv`, `lpattack`…`lprelease`, `ftype` |
| **Accumulation** | `layer`, `off` | `superimpose`, `echo`, `echoWith`, `stut` |
| **Delay / reverb detail** | `delay`, `room` | `delaytime`, `delayfeedback`, `roomsize`, `roomfade`, `roomlp`, `roomdim`, `iresponse` |
| **every / conditional** | `every`, `struct`, `mask`, `chunk` | `firstOf`, `lastOf`, `when`, `chunkBack`, `arp`, `arpWith`, `reset`, `restart`, `invert`, `hush` |
| **Factories** | `cat`, `stack` | `seq`, `stepcat`, `arrange`, `polymeter`, `polymeterSteps`, `run`, `binary`, `binaryN` |

### 6b. Entirely-missing high-value families

| Family | Members |
|---|---|
| **Signals / oscillators** | `sine`, `cosine`, `saw`, `tri`, `square`, `rand`, `irand`, `perlin`, `brand`, `brandBy`, `mousex`, `mousey` |
| **Tonal / harmony** | `scale`, `transpose`, `scaleTranspose`, `voicing`, `rootNotes`, `arp` |
| **Sample playback / slicing** | `begin`, `end`, `loop`, `loopBegin`, `loopEnd`, `chop`, `striate`, `slice`, `splice`, `scrub`, `fit`, `cut`, `clip`, `loopAt` |
| **Time / structure** | `ply`, `segment`, `zoom`, `inside`, `outside`, `swing`, `swingBy`, `palindrome`, `euclidLegato`, `ribbon`, `compress` |
| **Distortion / dynamics** | `distort`, `crush`, `coarse`, `velocity`, `postgain`, `xfade`, `compressor` |
| **Modulation / synth FX** | `phaser`(+`phaserdepth`/`phasersweep`/`phasercenter`), `tremolo`(`am`/`tremolodepth`/…), `vib`, `vibmod`, `fm`(+`fmh`/`fmenv`/`fmattack`/`fmdecay`), `noise`, `zzfx`, `wavetable` |
| **Pitch envelope** | `penv`, `pattack`, `pdecay`, `prelease`, `pcurve`, `panchor` |

### 6c. The tail (~345 names) — intentionally *not* documented

Control-param aliases and obscure/internal helpers (`bandf`, `bpa`, `ccn`, `dt`, `rsize`, `ctf`, `att`, `chunkbackinto`, …). Documenting these adds noise to hover + completion for negligible gain. Excluded from the parity metric.

---

## 7. The `Reference →` URL contract (verified mapping)

**Rule (this is the point of the doc):** every entry ships a **verified** `sourceUrl`. Do **not** guess anchors — Strudel's anchor is the *slugified full heading* (`scale(name)` → `#scalename`, `pickRestart` → `#pickrestart`, 2nd `delay` heading → `#delay-1`, `arpWith` → `#arpwith-`). Harvest from the live page, then use the exact id.

**Verification method used here:** `WebFetch` each `strudel.cc/learn/<topic>/` page → extract every heading's anchor id → map function → `#anchor`. Re-verify on Strudel version bumps (headings/anchors can shift). Functions with *no* page anchor (e.g. `every`, `time`, `range`, `within`, `unit`, `accelerate`) **omit `sourceUrl`** → fall back to `docsBaseUrl` (the `every` precedent).

### Verified anchors by page (harvested — use verbatim)

**`/learn/effects/`** — `lpf #lpf · lpq #lpq · hpf #hpf · hpq #hpq · bpf #bpf · bpq #bpq · ftype #ftype · vowel #vowel · attack #attack · decay #decay · sustain #sustain · release #release · adsr #adsr · lpattack #lpattack · lpdecay #lpdecay · lpsustain #lpsustain · lprelease #lprelease · lpenv #lpenv · pattack #pattack · pdecay #pdecay · prelease #prelease · penv #penv · pcurve #pcurve · panchor #panchor · gain #gain · velocity #velocity · compressor #compressor · postgain #postgain · xfade #xfade · jux #jux · juxBy #juxby · pan #pan · coarse #coarse · crush #crush · distort #distort · orbit #orbit · delay #delay-1 · delaytime #delaytime · delayfeedback #delayfeedback · room #room · roomsize #roomsize · roomfade #roomfade · roomlp #roomlp · roomdim #roomdim · iresponse #iresponse · phaser #phaser-1 · phaserdepth #phaserdepth · phasercenter #phasercenter · phasersweep #phasersweep · am #am · tremolosync #tremolosync · tremolodepth #tremolodepth · tremoloskew #tremoloskew · tremolophase #tremolophase · tremoloshape #tremoloshape · duckorbit #duckorbit · duckattack #duckattack · duckdepth #duckdepth`

**`/learn/random-modifiers/`** — `sometimes #sometimes · sometimesBy #sometimesby · someCycles #somecycles · someCyclesBy #somecyclesby · often #often · rarely #rarely · almostAlways #almostalways · almostNever #almostnever · always #always · never #never · degrade #degrade · degradeBy #degradeby · undegrade #undegrade · undegradeBy #undegradeby · choose #choose · wchoose #wchoose · chooseCycles #choosecycles`

**`/learn/time-modifiers/`** — `fast #fast · slow #slow · rev #rev · iter #iter · iterBack #iterback · ply #ply · segment #segment · compress #compress · zoom #zoom · inside #inside · outside #outside · swing #swing · swingBy #swingby · palindrome #palindrome · euclid #euclid · euclidLegato #euclidlegato · ribbon #ribbon`

**`/learn/conditional-modifiers/`** — `lastOf #lastof · firstOf #firstof · when #when · chunk #chunk · chunkBack #chunkback · fastChunk #fastchunk · arp #arp · arpWith #arpwith- · struct #struct · mask #mask · reset #reset · restart #restart · hush #hush · invert #invert · pick #pick · pickmod #pickmod · pickF #pickf · pickmodF #pickmodf · pickRestart #pickrestart · pickmodRestart #pickmodrestart · pickReset #pickreset · pickmodReset #pickmodreset · inhabit #inhabit · inhabitmod #inhabitmod · squeeze #squeeze`

**`/learn/signals/`** — `sine #sine · cosine #cosine · saw #saw · tri #tri · square #square · rand #rand · irand #irand · perlin #perlin · brand #brand · brandBy #brandby · mousex #mousex · mousey #mousey`

**`/learn/accumulation/`** — `superimpose #superimpose · layer #layer · off #off · echo #echo · echoWith #echowith · stut #stut`

**`/learn/factories/`** — `cat #cat · seq #seq · stack #stack · stepcat #stepcat · arrange #arrange · polymeter #polymeter · polymeterSteps #polymetersteps · run #run · binary #binary · binaryN #binaryn`

**`/learn/samples/`** — `begin #begin · end #end · loop #loop · loopBegin #loopbegin · loopEnd #loopend · cut #cut · clip #clip · loopAt #loopat · fit #fit · chop #chop · striate #striate · slice #slice · splice #splice · scrub #scrub · speed #speed`

**`/learn/notes/`** — `note #note-names (or #note-numbers) · freq #freq`

**`/learn/tonal/`** — `scale #scalename · transpose #transposesemitones · scaleTranspose #scaletransposesteps · voicing #voicing · rootNotes #rootnotesoctave--2`

**`/learn/synths/`** — `fm #fm · fmh #fmh · fmattack #fmattack · fmdecay #fmdecay · fmsustain #fmsustain · fmenv #fmenv · vib #vib · vibmod #vibmod · noise #noise · zzfx #zzfx · wavetable #wavetable-synthesis`

**No verified anchor → omit `sourceUrl` (functions-browser fallback):** `every`, `whenmod`, `ifp`, `time`, `range`, `within`, `plyWith`, `hurry`, `unit`, `accelerate`, `isaw`, `legato` (synonym of `clip` → may point to `#clip`), `n` (falls under `#selecting-sounds`).

### ⚠️ Retro-fix required (already-shipped pick family)

PR #803 shipped the pick family with **omitted** `sourceUrl` (functions-browser fallback) because the wrong pages were checked at the time. They are in fact documented at `/learn/conditional-modifiers/`. **Action:** upgrade all pick-family entries + `squeeze` to the verified anchors above. (Tracked as the first task in §8.)

---

## 8. Implementation plan (phased, family-complete)

Each phase adds a **whole family**, grounded in the upstream module's JSDoc, each entry with a verified `sourceUrl` from §7, and extends `strudelDocs.test.ts` with a family-coverage assertion. Editor `dist` rebuilt + committed per phase (it's git-tracked). One GitHub issue per phase.

| # | Phase | Rationale | Source module |
|---|---|---|---|
| 0 | **Retro-fix pick family `sourceUrl`s** | correctness — links currently fall back | `pick.mjs` + §7 |
| 1 | **Half-covered families** (envelope, random, filter q/env, accumulation, delay/room detail, every/conditional, factories) | remove the jarring `.release()`-but-not-`.attack()` inconsistencies first | `controls.mjs`, `pattern.mjs` |
| 2 | **Signals / oscillators** | biggest entirely-missing high-use family (`.lpf(sine.range(…))`) | `signal.mjs` |
| 3 | **Tonal / harmony** (`scale`, `n`, `transpose`, `voicing`, `arp`) | `scale`/`n` are as common as `note` | `@strudel/tonal` |
| 4 | **Sample slicing** (`begin`/`end`/`chop`/`striate`/`slice`/`loop`/…) | breakbeat workflows | `controls.mjs`, `@strudel/webaudio` |
| 5 | **Distortion / dynamics + modulation/synth FX** (`distort`/`crush`/`coarse`, `phaser`/`tremolo`/`vib`/`fm`) | rounds out the effect surface | `controls.mjs` |
| 6 | **Time/structure remainder** (`ply`/`segment`/`zoom`/`swing`/`palindrome`/…) | polish | `pattern.mjs` |

**Definition of done per phase:** family added whole · verified `sourceUrl` each · coverage test green · unit `monaco/docs` suite green · **live hover observed** (`.monaco-hover:not(.hidden)` renders signature+desc+example+Reference→, and the Reference link opens the exact anchor) · dist rebuilt+committed.

---

## 9. Invariants, guards & known edge cases

- **[[PV163]] / [[P254]]** — populate by family, guard with a coverage test. Never add just the reported member.
- **Box width** (`app/src/app/globals.css`) — Monaco sizes a hover to its widest line and *scrolls* overflow; `.monaco-hover` is capped at `max-width:340px !important` + code wraps. This **supersedes** the old "trim the description to one line" workaround (`setcps`): long descriptions now wrap instead of widening. Keep descriptions terse anyway for readability.
- **Name collisions** — `squeeze` exists twice: pick.mjs `squeeze(index,list)` (documented) vs. a `.squeeze(pat)` control. Our single entry documents the pick-family meaning. `reset`/`restart` similarly have pattern + control senses; document the pattern sense.
- **No-anchor fallback** is legitimate (`every`), not a bug — but prefer a verified anchor whenever one exists (that's what §7 exists to prevent: silent fallback when a real anchor was available, exactly the pick-family miss).
- **Version drift** — anchors were harvested at `@strudel` 1.2.6/1.3.0. On upgrade, re-run the §7 harvest; a moved heading silently breaks a `Reference →` link (a `#404` fragment still loads the page, so it fails *quietly*).
- **Verification is a real hover, not the unit map test** — the map test proves the key exists; only a live hover proves Monaco renders it and the link resolves.

---

## 10. Related

- Memory: `project_strudel_doc_permalinks` (history: #766 per-fn permalinks; #802/#803 pick family; box-width fix).
- Catalogues: `.anvi/vyapti.md` **PV163**, `.anvi/hetvabhasa.md` **P254**, plus the earlier scanner-family invariant **PV162**.
- Ground truth: `@strudel/core/pick.mjs`, `controls.mjs`, `signal.mjs`; `strudel.cc/learn/*`.
