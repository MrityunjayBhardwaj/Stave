/**
 * Where a Stage 2 control can actually WRITE, measured over real documents.
 *
 * `SignalSpans` carries the source coordinates of each leg, and its doc comment
 * quotes how often each leg is spelled. This test is what OWNS those numbers.
 * They were originally taken by a throwaway probe that read `ranged` and
 * `periodCycles` — proxies for spelling — and a number transcribed beside the
 * type it describes rots the moment either moves.
 *
 * ⚠ THE PROXIES AND THE SPANS ARE NOT THE SAME QUESTION, which is the reason
 * this measures spans directly. `periodCycles !== 1` says the chain HAS a rate;
 * `spans.rate` says a control may WRITE one, and it is deliberately null when
 * two rate arms compose — `sine.slow(2).fast(4)` has a well-defined rate and no
 * well-defined place to put a new one. So the span figure is a floor under the
 * proxy figure, never equal to it by construction.
 *
 * What the numbers are FOR: the share spelling NEITHER leg is the whole
 * justification for `captionEdit`'s insert path, which appends a call instead of
 * replacing one. If that share were zero the insert path would be dead code; it
 * is not, and this is the evidence.
 *
 * ⚠ Denominator is `loadCorpus` — the sweep corpus, NOT `ref/bakery-runs-inputs`
 * (329 by content) and NOT all of `.bakery-runs`. The three are not
 * interchangeable and a figure measured on one predicts nothing about another.
 */
import { describe, it, expect } from 'vitest'
import { hasCorpusArchive, loadCorpus } from '../../../editor/src/codeView/miniSource/__tests__/evalHarness'
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'
import { signalAutomations } from '../../../editor/src/codeView/ir/signalAutomation'

describe('signal span census over the sweep corpus', () => {
  // The sweep corpus lives in the gitignored `.bakery-runs` archive, so a fresh
  // checkout (and CI) skips this, as the other corpus tests do.
  it.skipIf(!hasCorpusArchive())('pins where a control can write, and proves the insert path is reachable', async () => {
    const docs = await loadCorpus()
    let parsed = 0
    let automations = 0
    let rangeSpelled = 0
    let rateSpelled = 0
    let neitherSpelled = 0
    let noChainEnd = 0
    // The two reasons `spans.rate` can be null, which want OPPOSITE answers from
    // a rate control: nothing spelled means a control can INSERT `.slow(n)` the
    // way the range control already inserts `.range()`; two arms composing means
    // there is a rate but no honest place to put a new one, and the only correct
    // answer is to decline. Counting them together would hide that.
    //
    // ⚠ `periodCycles !== 1` is a PROXY for "the chain states a rate" and it
    // misreads an explicit `.slow(1)`, which states one and computes to 1. No
    // corpus document does that today; if one appears, the split moves and this
    // is the line to distrust first.
    let rateAbsent = 0
    let rateAmbiguous = 0

    for (const doc of docs) {
      let ir
      try {
        ir = parseStrudel(doc.code)
      } catch {
        continue
      }
      parsed++
      for (const a of signalAutomations(ir)) {
        automations++
        if (a.spans.range) rangeSpelled++
        if (a.spans.rate) rateSpelled++
        if (!a.spans.range && !a.spans.rate) neitherSpelled++
        // A leg with no insertion point cannot be edited at all, and the control
        // must be offered disabled rather than broken. If this ever leaves zero,
        // that path stopped being hypothetical and needs its own arm.
        if (a.spans.chainEnd === null) noChainEnd++
        if (!a.spans.rate) {
          if (a.periodCycles === 1) rateAbsent++
          else rateAmbiguous++
        }
      }
    }

    // The load-bearing claims, stated as properties rather than as arithmetic on
    // the pinned totals — these are what the design rests on.
    expect(parsed).toBeGreaterThan(0)
    expect(automations).toBeGreaterThan(0)
    expect(neitherSpelled, 'the insert path in captionEdit would be dead code').toBeGreaterThan(0)
    expect(rangeSpelled + neitherSpelled).toBeLessThanOrEqual(automations)

    // And the pin. If this moves, the corpus or the reader moved — read the diff,
    // then update BOTH this object and the figures quoted on `SignalSpans`.
    // The reach question a rate control has to answer before it is designed.
    expect(rateSpelled + rateAbsent + rateAmbiguous).toBe(automations)

    expect({ automations, rangeSpelled, rateSpelled, neitherSpelled, noChainEnd, rateAbsent, rateAmbiguous }).toEqual({
      // #1468 — +4, from exactly TWO documents (`-P5TIfAE` and `1FR3g6BbXIFT`,
      // both 0 → 2), named rather than counted. Lifting the leading-run rule on
      // top-level bindings let those documents resolve, so chains that had been
      // sealed inside an unresolved node became readable. Nothing lost an
      // automation; the four added are all range-spelled.
      //
      // #1590 — −85, every one a decline and none added: the reader now draws a
      // curve only where the song hands it a time a lane can draw (the walk
      // shared with the stepped reader). What left sits under a time change
      // (`.slow`/`.fast`/`.early`/`cpm`, `every`/`jux` with one), an opaque call
      // the walk cannot see through (`add`, `mul`, `rarely`, …), or a later
      // same-key call. The shares barely moved: range 88%, rate 64%, neither 9%.
      //
      // #1595 — +14, every one added and none lost: a curve under a whole-track
      // `.slow(n)` is now drawn at the time the slow hands it. Ten rows, nine
      // documents: `0/-1poFQwaznQK` +5; `0/-2rI48Rcu-UZ` and its copy
      // `250/0tjfqXVyaLfJ`, `0/-3cMJ6ZRfPGI`, `0/-EpG6XZkZ6aT`, `0/-KsW6fVLkxAn`,
      // `250/0zGIYzShEPbP`, `250/1J0KTN4g3M3h`, `500/3GDNekbJ5rJr` and
      // `500/3Pr9t15-rxs-` +1 each. The rate share fell to 59% because 12 of the 14
      // spell no rate of their own (`rand.range(…)` under `.slow(8)`): the slow is
      // the track's, not the signal's, so a rate control still inserts at `chainEnd`.
      automations: 133,
      rangeSpelled: 118,
      rateSpelled: 78,
      neitherSpelled: 12,
      // Never null on any real document today. The disabled-control path this
      // would trigger is therefore UNEXERCISED, not proven — if this leaves
      // zero, that path needs an arm before it is trusted.
      noChainEnd: 0,
      // Every automation a rate control cannot replace into is one that spells
      // NO rate at all — insertable at `chainEnd`, which is non-null throughout.
      rateAbsent: 55,
      // ZERO. The multi-arm guard in `readChain` protects a tree no real
      // document produces, which is what its own comment claims and this is the
      // evidence for. It stays: the cost is one integer and the failure it
      // prevents is a silently wrong document. But a rate control needs no
      // decline path for it on any corpus input.
      rateAmbiguous: 0,
    })
  })
})
