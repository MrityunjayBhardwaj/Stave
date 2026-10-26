import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expectNoUncaught, watchUncaught } from './_uncaught'
import { STARTER_UNTIL_2240 } from './_appBoot'

/**
 * The instrument behind #1344, #1345 and #1346.
 *
 * Those issues were filed from a throwaway probe that was deleted once it had
 * been read, which is the shape that rots: prose nothing can contradict. Four
 * of the arms below assert a CURRENT DEFECT, so they go RED when the offline
 * renderer starts working. That redness is the notification — when it fires,
 * close the issue and re-point the arm at the fixed behaviour rather than
 * widening it.
 *
 * ONE assertion per test throughout: a second `expect` in a block never runs
 * once the first has failed, and every other block still reports passing.
 */

test.use({
  // The engine's AudioContext has to be allowed to start without a click; the
  // live arm records the real graph, so a suspended context records silence.
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
})

/** The app's own Starter pattern, read from source so it cannot drift. */
function starterCode(): string {
  const src = readFileSync(resolve(__dirname, '../src/templates.ts'), 'utf8')
  const m = src.match(/export const STRUDEL_CODE = `([\s\S]*?)`;/)
  if (!m) throw new Error('STRUDEL_CODE not found in templates.ts')
  return m[1]
}

/**
 * The rung arms read the Starter the ladder was found on (#1344): it trips
 * `setcps`, then `.viz`, then `$:`, in that order. A later Starter (#2240) trips
 * other things first, which says nothing about these three rungs.
 */
const LADDER_SONG = STARTER_UNTIL_2240

/** No `setcps`, no `$:`, no `.viz` — the shape the offline path can render. */
const NO_SETCPS = 'note("c3 e3 g3 b3").s("sawtooth").gain(0.5)'

/**
 * The same shape, but sample-based. Nothing here trips any of the three rungs,
 * so it reaches the renderer — and comes back silent (#1353).
 */
const DRUMS_ONLY = 's("bd*4 hh*8")'
const SYNTH_ONLY = 'note("c3 e3 g3 b3").s("sine")'
const DRUMS_PLUS_SYNTH = 'stack(s("bd*4"), note("c3 e3 g3 b3").s("sine"))'

/** Non-zero sample count — the sharpest available reading of "is this silent". */
function nonZeroCount(mono: Float64Array): number {
  let n = 0
  for (const v of mono) if (v !== 0) n++
  return n
}

async function openApp(page: Page): Promise<void> {
  await watchUncaught(page)
  await page.addInitScript(() => {
    ;(window as unknown as { __STAVE_E2E__: boolean }).__STAVE_E2E__ = true
  })
  await page.goto('/')
  await page.waitForFunction(
    () => Boolean((window as unknown as { __staveBounceProbe?: unknown }).__staveBounceProbe),
    undefined,
    { timeout: 60000 },
  )
}

type Outcome = { ok: boolean; error?: string; wav?: string }

function call(
  page: Page,
  method:
    | 'exportLikeButton'
    | 'offlineAfterEvaluate'
    | 'recordLive'
    | 'recordAfterStop',
  code: string,
  secs: number,
): Promise<Outcome> {
  return page.evaluate(
    ([m, c, s]) =>
      (
        window as unknown as {
          __staveBounceProbe: Record<
            string,
            (code: string, secs: number) => Promise<Outcome>
          >
        }
      ).__staveBounceProbe[m as string](c as string, s as number),
    [method, code, secs] as const,
  ) as Promise<Outcome>
}

/** Minimal 16-bit PCM WAV reader — enough to measure, not a decoder. */
function readWav(b64: string): { sampleRate: number; mono: Float64Array } {
  const buf = Buffer.from(b64, 'base64')
  const channels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  // walk the chunk list rather than assuming `data` starts at byte 44
  let off = 12
  while (off + 8 <= buf.length && buf.toString('ascii', off, off + 4) !== 'data') {
    off += 8 + buf.readUInt32LE(off + 4)
  }
  const start = off + 8
  const size = buf.readUInt32LE(off + 4)
  const frames = Math.floor(size / (2 * channels))
  const mono = new Float64Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) {
      sum += buf.readInt16LE(start + (i * channels + c) * 2) / 32768
    }
    mono[i] = sum / channels
  }
  return { sampleRate, mono }
}

function peak(mono: Float64Array): number {
  let p = 0
  for (const v of mono) if (Math.abs(v) > p) p = Math.abs(v)
  return p
}

function rms(mono: Float64Array): number {
  let sq = 0
  for (const v of mono) sq += v * v
  return mono.length ? Math.sqrt(sq / mono.length) : 0
}

type ReportOutcome = {
  ok: boolean
  error?: string
  haps?: number
  played?: number
  skipped?: Array<{ reason: string; count: number }>
  warnings: string[]
  wav?: string
}

/** #1353 — `renderOfflineReport`, with the warnings the engine emitted during it. */
function callReport(page: Page, code: string, secs: number): Promise<ReportOutcome> {
  return page.evaluate(
    ([c, s]) =>
      (
        window as unknown as {
          __staveBounceProbe: {
            offlineReport: (code: string, secs: number) => Promise<ReportOutcome>
          }
        }
      ).__staveBounceProbe.offlineReport(c as string, s as number),
    [code, secs] as const,
  ) as Promise<ReportOutcome>
}

type StemsOutcome = {
  ok: boolean
  error?: string
  progress: Array<[string, number, number]>
  stems?: Array<{ key: string; ok: boolean; error?: string; silent?: boolean; refusedBytes?: number; wav?: string }>
}

/** #1409 — `renderStems`, stem by stem. */
function callStems(page: Page, stems: Record<string, string>, secs: number): Promise<StemsOutcome> {
  return page.evaluate(
    ([st, s]) =>
      (
        window as unknown as {
          __staveBounceProbe: {
            stems: (stems: Record<string, string>, secs: number) => Promise<StemsOutcome>
          }
        }
      ).__staveBounceProbe.stems(st as Record<string, string>, s as number),
    [stems, secs] as const,
  ) as Promise<StemsOutcome>
}

/** Transient count via energy flux on 10ms frames — a note-rate proxy. */
function onsetCount(mono: Float64Array, sampleRate: number): number {
  const hop = Math.floor(sampleRate * 0.01)
  const env: number[] = []
  for (let i = 0; i + hop <= mono.length; i += hop) {
    let e = 0
    for (let j = i; j < i + hop; j++) e += mono[j] * mono[j]
    env.push(Math.sqrt(e / hop))
  }
  const flux = env.slice(1).map((v, i) => Math.max(0, v - env[i]))
  const mean = flux.reduce((a, b) => a + b, 0) / flux.length
  const sd = Math.sqrt(
    flux.reduce((a, b) => a + (b - mean) ** 2, 0) / flux.length,
  )
  const thr = mean + 2 * sd
  let count = 0
  let last = -99
  flux.forEach((v, i) => {
    if (v > thr && i - last > 5) {
      count++
      last = i
    }
  })
  return count
}

type SpikeOutcome = {
  ok: boolean
  error?: string
  workletOk?: boolean
  haps?: number
  wav?: string
}

/** #1398 — drive the offline-superdough spike in the page. */
function callSpike(page: Page, code: string, secs: number): Promise<SpikeOutcome> {
  return page.evaluate(
    ([c, s]) =>
      (
        window as unknown as {
          __staveBounceProbe: {
            offlineSuperdough: (code: string, secs: number) => Promise<SpikeOutcome>
          }
        }
      ).__staveBounceProbe.offlineSuperdough(c as string, s as number),
    [code, secs] as const,
  ) as Promise<SpikeOutcome>
}

test.describe('#1398 — can the REAL graph render offline?', () => {
  /**
   * The spike. `OfflineRenderer` (since removed, #1630) skipped every
   * sample-based sound and gave the reason in its own header: "AudioWorklets
   * cannot be re-registered in a fresh
   * OfflineAudioContext." That claim decides whether an offline bounce is a
   * small change or a second synthesis engine maintained forever — and the
   * hand-rolled oscillator renderer, plus #1344/#1345/#1353, all descend from it.
   *
   * Upstream already contradicts it: `@strudel/webaudio` ships
   * `renderPatternAudio`, which builds an OfflineAudioContext, calls
   * `initAudio()` against it, and then the real `superdough()` per hap. Reading
   * that is inference. This arm RUNS it.
   *
   * A DRUM, deliberately: `bd` is exactly the class `OfflineRenderer` dropped, so
   * a non-silent render here is the whole answer. No `setcps` in the document,
   * so the arm does not depend on #1344's global-injection rungs.
   */
  test('a sample-based sound renders audibly into an OfflineAudioContext', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openApp(page)

    const out = await callSpike(page, 's("bd*4").bank("RolandTR909")', 4)

    if (!out.ok) {
      throw new Error(
        `offline render failed (workletOk=${out.workletOk}, haps=${out.haps}): ${out.error}`,
      )
    }
    // The pattern really produced events, so a silent buffer would mean the
    // AUDIO failed rather than that there was nothing to render.
    expect(out.haps, 'the pattern produced no onsets to render').toBeGreaterThanOrEqual(4)

    const { sampleRate, mono } = readWav(out.wav!)
    console.log(
      `[#1398] haps=${out.haps} peak=${peak(mono).toFixed(4)} nonZero=${nonZeroCount(mono)}/${mono.length} onsets=${onsetCount(mono, sampleRate)}`,
    )

    // ⚠ NON-SILENCE, not non-emptiness. A valid, full-length WAV of pure
    // silence is the failure shape BOTH existing renderers already have, and
    // it is the outcome an `ok` flag cannot see.
    expect(peak(mono), 'the offline render came back silent').toBeGreaterThan(0.01)
    // Four onsets in four seconds at 0.5cps — the drums are actually THERE,
    // not one click or a burst of noise.
    expect(onsetCount(mono, sampleRate)).toBeGreaterThanOrEqual(3)
  })
})

test.describe('#1400 — does an offline render leave the live graph alive?', () => {
  /**
   * The survival arm, and the sharpest reading available of the failure shape
   * this whole boundary keeps producing: a valid, full-length WAV of pure
   * silence, returned as success.
   *
   * `renderPatternAudio` opens with `await getAudioContext().close()`. That is
   * the LIVE context — `StrudelEngine` took it once at `init()` and built its
   * analyser, its master tap and every per-track analyser on it, so nothing it
   * holds survives the close and `init()` is guarded against rebuilding.
   *
   * ⚠ The trap is that the context APPEARS to recover: the render's `finally`
   * calls `setAudioContext(null)`, so the next `getAudioContext()` hands back a
   * fresh one and every "is there a context" check passes. Only the OUTPUT can
   * see it. So this arm reads peaks either side of one render, on ONE engine —
   * `booted()` reuses it, which is the entire point of measuring here rather
   * than in two separate pages.
   */
  test('live capture still has audio after an offline render (#1400)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await openApp(page)

    const before = await call(page, 'recordLive', starterCode(), 2)
    const render = await callSpike(page, 's("bd*4").bank("RolandTR909")', 4)
    const after = await call(page, 'recordLive', starterCode(), 2)

    const beforePeak = before.wav ? peak(readWav(before.wav).mono) : 0
    const afterPeak = after.wav ? peak(readWav(after.wav).mono) : 0
    console.log(
      `[#1400] beforePeak=${beforePeak.toFixed(4)} render.ok=${render.ok} ` +
        `afterPeak=${afterPeak.toFixed(4)} after.ok=${after.ok} error=${after.error ?? 'none'}`,
    )

    // The `before` reading is the control: without it, a silent `after` could
    // just as well mean the engine never sounded in this page at all.
    expect({
      beforeAudible: beforePeak > 0.05,
      renderOk: render.ok,
      afterAudible: afterPeak > 0.05,
    }).toEqual({ beforeAudible: true, renderOk: true, afterAudible: true })
    // #1647 — a render over live audio must not leave an uncaught error behind (#1639).
    await expectNoUncaught(page)
  })
})

test.describe('#1401 — is a bounce the length it was asked for?', () => {
  /**
   * `ScriptProcessorNode` delivers audio in fixed 4096-frame blocks, so a take
   * that ends on a timer keeps only the whole blocks that arrived and loses the
   * remainder: `(duration * sampleRate) mod 4096` frames, up to 93ms at 44.1kHz,
   * at ANY length. Measured on trunk: 4s→3.9938s, 8s→7.9877s, 16s→15.9753s,
   * every one landing exactly on a block boundary.
   *
   * ⚠ FOUR SECONDS IS THE DELIBERATE CHOICE. 4s at 44.1kHz is 176400 frames =
   * 43.07 blocks — it does NOT divide evenly, so the remainder exists to be
   * lost. A duration that happens to land on a block boundary (32s at 48kHz is
   * exactly 375) passes even against the bug, which is why this defect was
   * invisible on some hardware and not others.
   *
   * Asserted as an EXACT frame count rather than a tolerance: "as long as it
   * said it would be" is the actual promise, and a tolerance would re-admit the
   * truncation it exists to catch.
   */
  test('a 4-second capture contains exactly 4 seconds of frames (#1401)', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await openApp(page)

    const out = await call(page, 'recordLive', NO_SETCPS, 4)
    expect(out.ok, `capture failed: ${out.error}`).toBe(true)

    const { sampleRate, mono } = readWav(out.wav!)
    console.log(`[#1401] sr=${sampleRate} frames=${mono.length} expected=${4 * sampleRate}`)

    expect(mono.length, 'the bounce is not the length it was asked for').toBe(4 * sampleRate)
  })
})


test.describe('the three audio-bounce paths', () => {
  test('the live path records audible audio from the Starter pattern (#1346)', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await call(page, 'recordLive', starterCode(), 3)
    // Real-time capture: 3s of audio costs 3s. Peak measured 0.96 on trunk;
    // 0.05 asks only "is this audible", so a mix change cannot redden it.
    expect({
      ok: out.ok,
      audible: out.wav ? peak(readWav(out.wav).mono) > 0.05 : false,
    }).toEqual({ ok: true, audible: true })
  })

  test('the export button cannot render the Starter pattern — rung 1, setcps (#1344)', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await call(page, 'exportLikeButton', LADDER_SONG, 2)
    // `setcps` is not a module export: @strudel/core/repl.mjs registers it inside
    // injectPatternMethods(), which the repl calls at the top of its OWN evaluate.
    expect({ ok: out.ok, mentionsSetcps: /setcps is not defined/.test(out.error ?? '') })
      .toEqual({ ok: false, mentionsSetcps: true })
  })

  test('one evaluate gets past setcps and stops at .viz — rung 2 (#1344)', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await call(page, 'offlineAfterEvaluate', LADDER_SONG, 2)
    // `.viz` is installed on Pattern.prototype during StrudelEngine.evaluate and
    // deleted again afterwards — correct by design, and it means the offline
    // renderer's own evaluate can never see it.
    expect({ ok: out.ok, mentionsViz: /\.viz is not a function/.test(out.error ?? '') })
      .toEqual({ ok: false, mentionsViz: true })
  })

  test('stripping .viz reveals rung 3, the $: track syntax (#1344)', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await openApp(page)
    const stripped = LADDER_SONG.replace(/\s*\.viz\("[^"]*"\)/g, '')
    const out = await call(page, 'offlineAfterEvaluate', stripped, 2)
    // `$:` transpiles to `.p(...)`, installed and deleted the same way. This is
    // the rung that makes the ladder structural: practically every document we
    // produce uses `$:`.
    expect({ ok: out.ok, mentionsP: /\.p is not a function/.test(out.error ?? '') })
      .toEqual({ ok: false, mentionsP: true })
  })

  test('after init, setcps is absent while the other globals are present (#1344)', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await openApp(page)
    // Boot the engine the way the export button does, then census globalThis.
    await call(page, 'exportLikeButton', NO_SETCPS, 1)
    const census = await page.evaluate(() =>
      (
        window as unknown as {
          __staveBounceProbe: { globalsCensus(): Record<string, string> }
        }
      ).__staveBounceProbe.globalsCensus(),
    )
    // This is the whole diagnosis in one line: evalScope over the eight modules
    // supplies the pattern vocabulary and cannot supply setcps.
    expect(census).toEqual({
      setcps: 'undefined',
      note: 'function',
      stack: 'function',
      s: 'function',
      sound: 'function',
    })
  })

  test('a pattern without setcps renders at the engine tempo offline, not double (#1345)', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await call(page, 'offlineAfterEvaluate', NO_SETCPS, 8)
    if (!out.ok) throw new Error(`offline render failed: ${out.error}`)
    const { sampleRate, mono } = readWav(out.wav!)
    const onsets = onsetCount(mono, sampleRate)
    console.log(`[#1345] sr=${sampleRate} onsets=${onsets} over 8s`)
    // ⚠ RE-POINTED (#1353), NOT WIDENED. The old renderer's regex tempo
    // defaulted to 1 when the code had no setcps; Strudel's is 0.5. Four notes
    // per cycle => 16 onsets correct, 31 measured offline before. The render now
    // reads the engine's one tempo, so the same threshold between the two
    // readings now asserts the other side of it. The LEVEL half of #1345 is
    // still not pinned.
    expect(onsets).toBeLessThan(24)
  })

  test('a drum-only bounce renders the drums (#1353)', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await call(page, 'exportLikeButton', DRUMS_ONLY, 4)
    // ⚠ RE-POINTED, NOT WIDENED — twice now. It asserted `{ ok: true, nonZero:
    // 0 }` (a silent file returned as success), then `{ ok: false, saysSilent }`
    // once #1402 turned that silence into a refusal. `renderOffline` now plays
    // through the real graph, so the drums are in the file.
    const mono = out.wav ? readWav(out.wav).mono : new Float64Array()
    console.log(`[#1353 drums] ok=${out.ok} nonZero=${nonZeroCount(mono)}/${mono.length} error=${out.error ?? 'none'}`)
    expect({ ok: out.ok, silent: nonZeroCount(mono) === 0 }).toEqual({ ok: true, silent: false })
  })

  test('adding drums to a working render adds the drums (#1353)', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const synth = await call(page, 'exportLikeButton', SYNTH_ONLY, 4)
    const mixed = await call(page, 'exportLikeButton', DRUMS_PLUS_SYNTH, 4)
    if (!synth.ok || !mixed.ok) {
      throw new Error(`render failed: ${synth.error ?? ''} ${mixed.error ?? ''}`)
    }
    // ⚠ RE-POINTED, NOT WIDENED. This asserted the mixed render was
    // byte-identical to the synth alone — the drop made undeniable. The same two
    // renders now differ, and "differ" alone is weak (anything could move a
    // byte), so the arm also asks the drums to ADD energy: a RATIO of two
    // renders in one page, never an absolute level. Measured 1.83 in the probe.
    const synthRms = rms(readWav(synth.wav!).mono)
    const mixedRms = rms(readWav(mixed.wav!).mono)
    const identical = Buffer.from(mixed.wav!, 'base64').equals(Buffer.from(synth.wav!, 'base64'))
    console.log(`[#1353 mixed] sr=${readWav(mixed.wav!).sampleRate} synthRms=${synthRms.toFixed(5)} mixedRms=${mixedRms.toFixed(5)} ratio=${(mixedRms / synthRms).toFixed(3)}`)
    expect({ identical, drumsAddEnergy: mixedRms / synthRms > 1.3 }).toEqual({
      identical: false,
      drumsAddEnergy: true,
    })
  })

  test('a sound that cannot play is refused as silent AND named, with its count (#1353)', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await openApp(page)
    // Measured before this arm existed, on the real-graph path: ok, 0 of
    // 192,000 samples, no error — upstream catches each hap's throw and only
    // logs it. 4 seconds at 0.5 cps = 2 cycles = 8 haps.
    const out = await callReport(page, 's("nosuchsound*4")', 4)
    console.log(`[#1353 unknown] ok=${out.ok} error=${out.error ?? 'none'} warnings=${JSON.stringify(out.warnings)}`)
    expect({
      ok: out.ok,
      saysSilent: /silent/i.test(out.error ?? ''),
      named: out.warnings.some((w) => /left out 8 of 8 sounds/.test(w) && /nosuchsound/.test(w)),
    }).toEqual({ ok: false, saysSilent: true, named: true })
  })

  test('one sound that cannot play does not cost the ones that can — every skip counted (#1353)', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await openApp(page)
    // ⚠ EXACT COUNTS, on purpose. Strudel's logger drops a message identical to
    // the last within a second, so a count read from its log would say 1 where
    // 8 haps failed. The render owns the catch, so it must say 8.
    const out = await callReport(page, 'stack(s("bd*4"), s("nosuchsound*4"))', 4)
    const mono = out.wav ? readWav(out.wav).mono : new Float64Array()
    console.log(`[#1353 partial] ok=${out.ok} haps=${out.haps} played=${out.played} skipped=${JSON.stringify(out.skipped)} nonZero=${nonZeroCount(mono)}`)
    expect({
      ok: out.ok,
      haps: out.haps,
      played: out.played,
      skipped: out.skipped,
      audible: nonZeroCount(mono) > 0,
    }).toEqual({
      ok: true,
      haps: 16,
      played: 8,
      skipped: [{ reason: 'sound nosuchsound not found! Is it loaded?', count: 8 }],
      audible: true,
    })
  })

  test('a room that cannot be built does not hold the render forever (#1675)', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    // The render waits for every reverb's impulse response before it moves on.
    // `size(0)` asks for a zero-length one, which throws while it is requested;
    // measured before the guard, the render then waited forever. It must end
    // like any other sound that cannot play: counted, with the rest audible.
    const out = await Promise.race([
      callReport(page, 'stack(note("c3*4").s("sawtooth"), note("e3*4").s("sawtooth").room(0.5).size(0))', 4),
      page.waitForTimeout(30000).then(() => 'still rendering after 30s' as const),
    ])
    expect(out, 'the render ended').not.toBe('still rendering after 30s')
    const report = out as ReportOutcome
    const mono = report.wav ? readWav(report.wav).mono : new Float64Array()
    console.log(`[#1675 size(0)] ok=${report.ok} played=${report.played} skipped=${JSON.stringify(report.skipped)}`)
    expect({
      ok: report.ok,
      played: report.played,
      skippedCount: report.skipped?.reduce((n, k) => n + k.count, 0),
      audible: nonZeroCount(mono) > 0,
    }).toEqual({ ok: true, played: 8, skippedCount: 8, audible: true })
  })

  test('stems play their drums, and one silent stem costs no other stem (#1409)', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await openApp(page)
    // ⚠ THE SILENT STEM IS IN THE MIDDLE, so a set that still failed on the
    // first refusal would lose the stem AFTER it as well as the one before. The
    // drum stem is the class the old renderer dropped; it rendered to nothing and
    // was refused, which took every other stem with it.
    const out = await callStems(
      page,
      { drums: DRUMS_ONLY, missing: 's("nosuchsound*4")', synth: SYNTH_ONLY },
      4,
    )
    const row = (key: string) => out.stems?.find((s) => s.key === key)
    const audible = (key: string) => {
      const wav = row(key)?.wav
      return wav ? nonZeroCount(readWav(wav).mono) > 0 : false
    }
    console.log(
      `[#1409 stems] ok=${out.ok} error=${out.error ?? 'none'} progress=${JSON.stringify(out.progress)} ` +
        (out.stems ?? [])
          .map((s) => `${s.key}:ok=${s.ok},silent=${s.silent},refused=${s.refusedBytes},` +
            `nonZero=${s.wav ? nonZeroCount(readWav(s.wav).mono) : 0},sr=${s.wav ? readWav(s.wav).sampleRate : '-'}`)
          .join(' '),
    )
    expect({
      ok: out.ok,
      keys: out.stems?.map((s) => s.key),
      progress: out.progress,
      drums: { ok: row('drums')?.ok, audible: audible('drums') },
      // A refused take is a complete WAV: more than a bare 44-byte header.
      missing: { ok: row('missing')?.ok, silent: row('missing')?.silent, refusedKept: (row('missing')?.refusedBytes ?? 0) > 44 },
      synth: { ok: row('synth')?.ok, audible: audible('synth') },
    }).toEqual({
      ok: true,
      keys: ['drums', 'missing', 'synth'],
      progress: [['drums', 1, 3], ['missing', 2, 3], ['synth', 3, 3]],
      drums: { ok: true, audible: true },
      missing: { ok: false, silent: true, refusedKept: true },
      synth: { ok: true, audible: true },
    })
  })
})

type RenderWhilePlayingOutcome = {
  ok: boolean
  error?: string
  renderWav?: string
  liveWav?: string
  renderStartMs?: number
  renderMs?: number
  startedBefore?: boolean
  startedAfter?: boolean
  cycleBefore?: number
  cycleAfter?: number
  cps?: number
  renderingAtMs?: number
  pressedAtMs?: number
}

function callRenderWhilePlaying(
  page: Page,
  liveCode: string,
  renderCode: string,
  secs: number,
  playing: boolean,
  midRender?: 'stop' | 'play',
): Promise<RenderWhilePlayingOutcome> {
  return page.evaluate(
    ([l, r, s, p, m]) =>
      (
        window as unknown as {
          __staveBounceProbe: {
            renderWhilePlaying(
              l: string,
              r: string,
              s: number,
              p: boolean,
              m?: 'stop' | 'play',
            ): Promise<RenderWhilePlayingOutcome>
          }
        }
      ).__staveBounceProbe.renderWhilePlaying(
        l as string,
        r as string,
        s as number,
        p as boolean,
        (m ?? undefined) as 'stop' | 'play' | undefined,
      ),
    [liveCode, renderCode, secs, playing, midRender ?? null] as const,
  )
}

/** Dense and high, so live notes that leak into a render are easy to see. */
const LIVE_WHILE_RENDERING = 'note("c6*16").s("square").gain(0.3)'

/**
 * A render long enough to SPAN SCHEDULER TICKS. The live clock ticks every
 * 100ms (`zyklus.mjs:8`), so a render shorter than that can fall between two
 * ticks and trigger nothing live at all: the first measurement rendered 4s of
 * this in 15-37ms and saw no leak, which proved only that the window was too
 * short. Long songs and first-time sample loads are what make it wide.
 */
const LONG_RENDER = 'note("c3*16").s("sine")'

/**
 * How many scheduler ticks the render must span for a leak to have somewhere to
 * appear. Three is the floor `MIN_RENDER_MS` encodes; the LENGTH below is chosen
 * to clear it by a wide margin, because a margin is the only thing that keeps
 * machine speed from deciding the arm (#1670).
 */
const TICK_MS = 100
const MIN_RENDER_MS = 3 * TICK_MS

/**
 * ⚠ THIS IS A WALL-CLOCK BUDGET WEARING A DURATION'S CLOTHES (#1670). What the
 * arm needs is `renderMs` — how long the render OCCUPIES THE LIVE CLOCK — and
 * the only knob for it is how much audio is rendered. Since #1658 made the
 * render windowed, the two are linear, so the length can be chosen from a
 * measurement instead of guessed. Measured on this machine, `renderWhilePlaying`
 * over `LONG_RENDER` (renderMs ≈ 4.9 × secs):
 *
 *     secs   60        120    180        240     300
 *     ms     312, 331  603    912, 895   1178    1452
 *
 * At 60s the render took 296-308ms against a 300ms floor, so which side of the
 * floor a run landed on was decided by a few milliseconds of machine speed —
 * eight runs split 7 pass / 2 fail on that number alone, while the thing the arm
 * measures (`maxSampleDiff = 0`, no leak) held in every one of them, failures
 * included. 180s puts the render ~9 ticks wide, 3x the floor: the machine would
 * have to run 3x FASTER than measured for the precondition to decide anything.
 *
 * Raising the floor instead would have been the wrong half to move — the floor
 * is what stops this arm being green for the reason the first measurement was.
 *
 * The cost is bounded on the other side too: the probe records a 4s live take
 * around the render, so `renderMs` must stay well under it. At 180s the render
 * ends ~1.4s into that take, and the `after` window it reads lands at ~1.6-2.0s.
 */
const LONG_RENDER_SECS = 180

/**
 * A leak assertion is an ABSENCE assertion, so it needs its vacuity condition
 * ruled out in the same arm or it proves nothing (#1670). `maxSampleDiff === 0`
 * is what a clean render looks like AND what a render too short to span a
 * scheduler tick looks like — measured: at 4s the render spans 45ms, the live
 * audio is never suppressed (`live rms during` unchanged), and the difference is
 * still exactly 0.
 *
 * Every arm that concludes "no leak" calls this FIRST. It throws rather than
 * asserts, because the answer is not "failed" but "this run cannot tell you".
 */
function requireRenderSpannedTicks(tag: string, renderMs: number | undefined, diff: number): void {
  if ((renderMs ?? 0) >= MIN_RENDER_MS) return
  throw new Error(
    `[${tag}] precondition, not a leak: the render spanned ${renderMs?.toFixed(0)}ms ` +
      `(< ${MIN_RENDER_MS}ms = ${MIN_RENDER_MS / TICK_MS} scheduler ticks), so a leak had nowhere to appear ` +
      `and this arm proves nothing either way. maxSampleDiff was ${diff}. ` +
      `Raise LONG_RENDER_SECS (currently ${LONG_RENDER_SECS}s, measured ~4.9ms per second rendered); ` +
      `do not lower this floor.`,
  )
}

/**
 * Largest per-sample difference between two renders. An offline render of a
 * noise-free pattern is deterministic, so the same code rendered with the
 * transport stopped is an exact control: any difference came from outside it.
 */
function maxSampleDiff(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]))
  return d
}

/** RMS of `mono` between two times, in ms. */
function rmsBetween(mono: Float64Array, sampleRate: number, fromMs: number, toMs: number): number {
  const a = Math.max(0, Math.floor((fromMs / 1000) * sampleRate))
  const b = Math.min(mono.length, Math.floor((toMs / 1000) * sampleRate))
  return rms(mono.subarray(a, Math.max(a, b)))
}

function describeRenderWhilePlaying(tag: string, o: RenderWhilePlayingOutcome): string {
  if (!o.ok) return `[#1627 ${tag}] error=${o.error}`
  const r = readWav(o.renderWav!)
  let live = 'no take'
  if (o.liveWav) {
    const l = readWav(o.liveWav)
    const s = o.renderStartMs!
    const e = s + o.renderMs!
    live =
      `live rms before=${rmsBetween(l.mono, l.sampleRate, s - 400, s).toFixed(4)} ` +
      `during=${rmsBetween(l.mono, l.sampleRate, s, e).toFixed(4)} ` +
      `after=${rmsBetween(l.mono, l.sampleRate, e + 200, e + 600).toFixed(4)}`
  }
  return (
    `[#1627 ${tag}] renderMs=${o.renderMs!.toFixed(0)} renderingAtMs=${o.renderingAtMs?.toFixed(0)} ` +
    `pressedAtMs=${o.pressedAtMs?.toFixed(0)} startedBefore=${o.startedBefore} ` +
    `startedAfter=${o.startedAfter} cycles ${o.cycleBefore?.toFixed(3)}→${o.cycleAfter?.toFixed(3)} ` +
    `cps=${o.cps} render onsets=${onsetCount(r.mono, r.sampleRate)} rms=${rms(r.mono).toFixed(4)} ${live}`
  )
}

test.describe('#1627 — an offline render while the transport plays', () => {
  test('keeps the live notes out of the rendered file', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const stopped = await callRenderWhilePlaying(page, LIVE_WHILE_RENDERING, LONG_RENDER, LONG_RENDER_SECS, false)
    const playing = await callRenderWhilePlaying(page, LIVE_WHILE_RENDERING, LONG_RENDER, LONG_RENDER_SECS, true)
    console.log(describeRenderWhilePlaying('stopped', stopped))
    console.log(describeRenderWhilePlaying('playing', playing))
    if (!stopped.ok || !playing.ok) {
      throw new Error(`probe failed: ${stopped.error ?? ''} ${playing.error ?? ''}`)
    }
    const diff = maxSampleDiff(readWav(playing.renderWav!).mono, readWav(stopped.renderWav!).mono)
    console.log(`[#1627 leak] maxSampleDiff playing vs stopped = ${diff}`)
    // If this ever fires, the render got FASTER — raise LONG_RENDER_SECS, do not
    // lower the floor. The floor is what stops this arm being green for the
    // reason the first measurement was (see LONG_RENDER).
    requireRenderSpannedTicks('#1627 leak', playing.renderMs, diff)
    expect(diff).toBeLessThan(1e-4)
    // #1647 — a render over live audio must not leave an uncaught error behind (#1639).
    await expectNoUncaught(page)
  })

  test('leaves a playing transport playing', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await callRenderWhilePlaying(page, LIVE_WHILE_RENDERING, LONG_RENDER, LONG_RENDER_SECS, true)
    console.log(describeRenderWhilePlaying('resume', out))
    expect({ ok: out.ok, before: out.startedBefore, after: out.startedAfter }).toEqual({
      ok: true,
      before: true,
      after: true,
    })
    // #1647 — a render over live audio must not leave an uncaught error behind (#1639).
    await expectNoUncaught(page)
  })

  test('a Stop pressed during the render is not undone when the render ends', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await callRenderWhilePlaying(page, LIVE_WHILE_RENDERING, LONG_RENDER, LONG_RENDER_SECS, true, 'stop')
    console.log(describeRenderWhilePlaying('stop-mid-render', out))
    expect({ ok: out.ok, before: out.startedBefore, pressed: out.pressedAtMs !== undefined, after: out.startedAfter }).toEqual({
      ok: true,
      before: true,
      pressed: true,
      after: false,
    })
    // #1647 — a render over live audio must not leave an uncaught error behind (#1639).
    await expectNoUncaught(page)
  })

  test('a Stop pressed during the render leaves the rendered file whole (#2064)', async ({ page }) => {
    // Stop fades out every sound superdough is playing (#2058). During a render
    // superdough's context is the RENDER's, so an unguarded fade lands on the
    // bounce's own notes and the file goes quiet from the press onward.
    test.setTimeout(120000)
    await openApp(page)
    const control = await callRenderWhilePlaying(page, LIVE_WHILE_RENDERING, LONG_RENDER, LONG_RENDER_SECS, true)
    const out = await callRenderWhilePlaying(page, LIVE_WHILE_RENDERING, LONG_RENDER, LONG_RENDER_SECS, true, 'stop')
    console.log(describeRenderWhilePlaying('stop-mid-render-file', out))
    if (!control.ok || !out.ok) throw new Error(`probe failed: ${control.error ?? ''} ${out.error ?? ''}`)
    if (out.pressedAtMs === undefined) throw new Error('Stop was never pressed inside the render')
    const diff = maxSampleDiff(readWav(out.renderWav!).mono, readWav(control.renderWav!).mono)
    console.log(`[#2064 stop-mid-render] maxSampleDiff vs no Stop = ${diff}`)
    requireRenderSpannedTicks('#2064 stop-mid-render', out.renderMs, diff)
    expect(diff).toBeLessThan(1e-4)
  })

  test('a Play pressed during the render starts after it, and none of it lands in the file', async ({
    page,
  }) => {
    test.setTimeout(120000)
    await openApp(page)
    const control = await callRenderWhilePlaying(page, LIVE_WHILE_RENDERING, LONG_RENDER, LONG_RENDER_SECS, false)
    const out = await callRenderWhilePlaying(page, LIVE_WHILE_RENDERING, LONG_RENDER, LONG_RENDER_SECS, false, 'play')
    console.log(describeRenderWhilePlaying('play-mid-render', out))
    if (!control.ok || !out.ok) throw new Error(`probe failed: ${control.error ?? ''} ${out.error ?? ''}`)
    // Pressed any later than the start of rendering, an undeferred Play can
    // leak nothing (its notes land in audio already rendered) and this arm
    // would be green for that reason instead of the deferral's.
    if (out.pressedAtMs === undefined) throw new Error('Play was never pressed inside the render')
    const diff = maxSampleDiff(readWav(out.renderWav!).mono, readWav(control.renderWav!).mono)
    console.log(`[#1627 play-mid-render] maxSampleDiff vs stopped = ${diff}`)
    // Same absence assertion as the leak arm, same way of being vacuous, so the
    // same precondition (#1670). Pressing Play inside the render is necessary but
    // not sufficient: if the render then ends before a tick, the deferral it is
    // testing never got the chance to matter.
    requireRenderSpannedTicks('#1627 play-mid-render', out.renderMs, diff)
    expect({ clean: diff < 1e-4, playingAfter: out.startedAfter }).toEqual({ clean: true, playingAfter: true })
  })

  test('does not start a stopped transport', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await callRenderWhilePlaying(page, LIVE_WHILE_RENDERING, LONG_RENDER, LONG_RENDER_SECS, false)
    console.log(describeRenderWhilePlaying('stays-stopped', out))
    expect({ ok: out.ok, before: out.startedBefore, after: out.startedAfter }).toEqual({
      ok: true,
      before: false,
      after: false,
    })
  })

  /**
   * #1639 — a render note in a cut group must not choke the LIVE note holding it.
   *
   * superdough keeps one page-wide list of which note holds each cut group, and a
   * sample note with `.cut(n)` fades out whatever holds group n. Before the fix a
   * render's first `cut(1)` note faded out the sounding live `cut(1)` note, which
   * stayed silent for the rest of the take, with no error anywhere. Measured in the
   * app: live RMS 0.0149 before the render, 0.0000 after it.
   *
   * The live note is ONE looping hh that lasts 16s, so it is sounding across the whole
   * take, and anything that silences it shows. The same render in cut group 2 is the
   * control: it proves the take and the ratio can read "still playing" in this page.
   *
   * ⚠ The hh buffer is loaded first. A cold load outlasts the single note's start time,
   * and superdough drops the note, so every reading (the control's included) would be
   * silent and the arm would say nothing.
   */
  test('a render in the same cut group does not silence the live note', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const warm = await call(page, 'recordLive', 's("hh*8")', 2)
    expect(warm.ok, `warming the hh buffer failed: ${warm.error}`).toBe(true)

    const LIVE_CUT = 's("hh").loop(1).cut(1).slow(8).gain(0.8)'
    const liveAround = (o: RenderWhilePlayingOutcome) => {
      const l = readWav(o.liveWav!)
      const s = o.renderStartMs!
      const e = s + o.renderMs!
      // The take is 4s. A render slow enough to push the after-window past its end
      // reads an EMPTY slice as RMS 0, which would look exactly like a choked note.
      const takeMs = (l.mono.length / l.sampleRate) * 1000
      if (e + 600 > takeMs) throw new Error(`render too slow to read after it: ends ${e.toFixed(0)}ms into a ${takeMs.toFixed(0)}ms take`)
      return {
        sr: l.sampleRate,
        before: rmsBetween(l.mono, l.sampleRate, s - 400, s),
        after: rmsBetween(l.mono, l.sampleRate, e + 200, e + 600),
      }
    }
    const control = await callRenderWhilePlaying(page, LIVE_CUT, 's("hh*4").cut(2)', LONG_RENDER_SECS, true)
    const same = await callRenderWhilePlaying(page, LIVE_CUT, 's("hh*4").cut(1)', LONG_RENDER_SECS, true)
    if (!control.ok || !same.ok) throw new Error(`probe failed: ${control.error ?? ''} ${same.error ?? ''}`)
    const c = liveAround(control)
    const m = liveAround(same)
    console.log(
      `[#1639 cut] sr=${m.sr} control(cut 2) before=${c.before.toFixed(4)} after=${c.after.toFixed(4)} ` +
        `same(cut 1) before=${m.before.toFixed(4)} after=${m.after.toFixed(4)}`,
    )
    expect(c.after / c.before, 'the control lost its live note, so this page cannot tell').toBeGreaterThan(0.5)
    expect(m.after / m.before, 'the render choked the live note in its cut group').toBeGreaterThan(0.5)
    await expectNoUncaught(page)
  })
})

type BounceLoadedSetup = { playing?: boolean; seek?: number; loop?: { startCycle: number; cycles: number } }

type BounceLoadedOutcome = {
  ok: boolean
  error?: string
  wav?: string
  haps?: number
  played?: number
  skipped?: Array<{ reason: string; count: number }>
  cps?: number | null
  offsetBefore?: number
  loopBefore?: { startCycle: number; cycles: number } | null
  playingAfter?: boolean
  offsetAfter?: number
  loopAfter?: { startCycle: number; cycles: number } | null
}

function callBounceLoaded(
  page: Page,
  code: string,
  secs: number,
  setup?: BounceLoadedSetup,
): Promise<BounceLoadedOutcome> {
  return page.evaluate(
    ([c, s, u]) =>
      (
        window as unknown as {
          __staveBounceProbe: {
            bounceLoaded(c: string, s: number, u?: BounceLoadedSetup): Promise<BounceLoadedOutcome>
          }
        }
      ).__staveBounceProbe.bounceLoaded(
        c as string,
        s as number,
        (u ?? undefined) as BounceLoadedSetup | undefined,
      ),
    [code, secs, setup ?? null] as const,
  )
}

/**
 * #1344 — the active-document bounce (`LiveCodingRuntime.bounceOffline`). The
 * rung arms above still pin `renderOffline(code)` refusing a Stave document, and
 * that stays true by decision: taking arbitrary code through the engine's
 * evaluate window replaces what is loaded to play. These arms are the path that
 * renders one: load the document the way Play does, render what that loaded.
 */
test.describe('#1344 — bouncing the loaded document', () => {
  test('the Starter pattern bounces, with its setcps, $: tracks and .viz', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await callBounceLoaded(page, starterCode(), 4)
    const r = out.wav ? readWav(out.wav) : null
    console.log(
      `[#1344 starter] ok=${out.ok} error=${out.error} sr=${r?.sampleRate} haps=${out.haps} ` +
        `played=${out.played} cps=${out.cps} peak=${r ? peak(r.mono).toFixed(4) : '-'} ` +
        `skipped=${JSON.stringify(out.skipped)}`,
    )
    // cps is the document's own `setcps(110/60/4)` (110 bpm), read off the
    // scheduler the bounce's evaluate set. 0.05 asks only "is this audible".
    expect({ ok: out.ok, cps: out.cps, audible: r ? peak(r.mono) > 0.05 : false }).toEqual({
      ok: true,
      cps: 110 / 60 / 4,
      audible: true,
    })
  })

  test("the document's own setcps is the tempo it bounces at", async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    // The #1345 arm's pattern, whose onsets this detector reads reliably
    // (15 of 16 over 8s at 0.5 cps), at two tempos the document sets itself.
    const tune = '$: note("c3 e3 g3 b3").s("sawtooth").gain(0.5)'
    const slow = await callBounceLoaded(page, `setcps(0.5)\n${tune}`, 8)
    const fast = await callBounceLoaded(page, `setcps(1)\n${tune}`, 8)
    if (!slow.ok || !fast.ok) throw new Error(`probe failed: ${slow.error ?? ''} ${fast.error ?? ''}`)
    const s = readWav(slow.wav!)
    const f = readWav(fast.wav!)
    const slowOnsets = onsetCount(s.mono, s.sampleRate)
    const fastOnsets = onsetCount(f.mono, f.sampleRate)
    console.log(`[#1344 tempo] sr=${s.sampleRate} onsets 0.5cps=${slowOnsets} 1cps=${fastOnsets} cps=${slow.cps}/${fast.cps}`)
    expect({
      cps: [slow.cps, fast.cps],
      slowCounted: slowOnsets >= 12,
      doubled: Math.abs(fastOnsets - 2 * slowOnsets) <= 3,
    }).toEqual({ cps: [0.5, 1], slowCounted: true, doubled: true })
  })

  test('all(...) reaches the file', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const tune = '$: note("c3 e3 g3 b3").s("sine").gain(0.5)'
    const plain = await callBounceLoaded(page, tune, 4)
    const again = await callBounceLoaded(page, tune, 4)
    // `.gain` overrides, last in the chain wins, so `all` sets it to 0.1.
    const quiet = await callBounceLoaded(page, `${tune}\nall(x => x.gain(0.1))`, 4)
    if (!plain.ok || !again.ok || !quiet.ok) {
      throw new Error(`probe failed: ${plain.error ?? ''} ${again.error ?? ''} ${quiet.error ?? ''}`)
    }
    const p = readWav(plain.wav!)
    const control = rms(readWav(again.wav!).mono) / rms(p.mono)
    const ratio = rms(readWav(quiet.wav!).mono) / rms(p.mono)
    console.log(`[#1344 all] sr=${p.sampleRate} rms control=${control.toFixed(4)} all(gain 0.1)/plain=${ratio.toFixed(4)}`)
    // The per-track captures are taken before Strudel applies `all`, so a render
    // built from them would read ~1 here.
    expect({ controlSame: Math.abs(control - 1) < 0.01, quieter: ratio < 0.5 }).toEqual({
      controlSame: true,
      quieter: true,
    })
  })

  test('the master fader line scales the mix; the plain gain and postgain lines change its balance (#1711)', async ({ page }) => {
    // Two tracks take turns — `a` in the first half of each cycle, `b` in the
    // second — so each one's level is read from its own window of ONE mixed file.
    // `a` is quiet through BOTH controls a master could clobber: its own `.gain`
    // and its own `.postgain` (55 of 620 real documents set `.postgain` on tracks).
    //  - `mul(postgain(.5))` — what the fader writes — multiplies each track's
    //    postgain (or supplies .5 where it has none): the balance must not move.
    //  - `gain(.5)` and `postgain(.5)` each SET a control, overwriting `a`'s own
    //    value. They are the CONTROLS: they prove this reading can see an
    //    overwrite of either control, so the fader's line keeping the balance
    //    means something.
    test.setTimeout(120000)
    await openApp(page)
    const tune = 'a: note("c3 ~").s("sine").gain(0.4).postgain(0.5)\nb: note("~ c3").s("sine").gain(0.8)'
    const render = async (master: string) => {
      const out = await callBounceLoaded(page, master ? `${tune}\n${master}` : tune, 4)
      if (!out.ok) throw new Error(`probe failed (${master || 'no master'}): ${out.error ?? ''}`)
      const w = readWav(out.wav!)
      // Default tempo is 0.5 cycles/s: `a` sounds in 0–1 s, `b` in 1–2 s. Read the
      // middle of each half, clear of attack and release.
      return { a: rmsBetween(w.mono, w.sampleRate, 200, 800), b: rmsBetween(w.mono, w.sampleRate, 1200, 1800) }
    }
    const P = await render('')
    const M = await render('all(x => x.mul(postgain(0.5)))')
    const G = await render('all(x => x.gain(0.5))')
    const S = await render('all(x => x.postgain(0.5))')
    const balance = (l: { a: number; b: number }) => l.b / l.a
    const moved = (l: { a: number; b: number }) => Math.abs(balance(l) / balance(P) - 1)
    console.log(
      `[#1711 master] balance b/a plain=${balance(P).toFixed(3)} mul(postgain)=${balance(M).toFixed(3)} ` +
        `gain=${balance(G).toFixed(3)} postgain=${balance(S).toFixed(3)} ` +
        `scale a=${(M.a / P.a).toFixed(3)} b=${(M.b / P.b).toFixed(3)}`,
    )
    expect({
      // the fader's line: the same balance as no master, the same cut on both tracks
      balanceKept: moved(M) < 0.05,
      sameScaleOnBoth: Math.abs(M.a / P.a - M.b / P.b) < 0.05,
      quieter: M.b < P.b * 0.9,
      // controls: each set-form master visibly re-balances the mix
      gainMovesBalance: moved(G) > 0.2,
      postgainMovesBalance: moved(S) > 0.2,
    }).toEqual({ balanceKept: true, sameScaleOnBoth: true, quieter: true, gainMovesBalance: true, postgainMovesBalance: true })
  })

  test('a seek and an armed loop stay out of the file, and the loop is given back', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    // One pitch per cycle, so a shifted or looped render puts different notes in
    // different places. Sine, whose offline render is sample-exact run to run.
    const code = '$: note("<c3 e3 g3 b3>").s("sine").gain(0.5)'
    const loop = { startCycle: 1, cycles: 1 }
    const clean = await callBounceLoaded(page, code, 8)
    // Separately, because the runtime re-pairs the seek offset with an armed
    // loop: measured together, a 2.5-cycle seek left an offset of -0.027, which
    // tested the loop and barely touched the seek.
    const seeked = await callBounceLoaded(page, code, 8, { playing: true, seek: 2.5 })
    const looped = await callBounceLoaded(page, code, 8, { playing: true, loop })
    for (const [tag, o] of [['seek', seeked], ['loop', looped]] as const) {
      console.log(
        `[#1344 frame ${tag}] ok=${o.ok} error=${o.error} before offset=${o.offsetBefore} ` +
          `loop=${JSON.stringify(o.loopBefore)} after offset=${o.offsetAfter} ` +
          `loop=${JSON.stringify(o.loopAfter)} playing=${o.playingAfter}`,
      )
    }
    if (!clean.ok || !seeked.ok || !looped.ok) {
      throw new Error(`probe failed: ${clean.error ?? ''} ${seeked.error ?? ''} ${looped.error ?? ''}`)
    }
    // Each setup has to have taken hold, or its half is green for having
    // bounced from a clean frame.
    if (Math.abs(seeked.offsetBefore ?? 0) < 1 || seeked.loopBefore !== null) {
      throw new Error(`seek did not take hold: offset=${seeked.offsetBefore} loop=${JSON.stringify(seeked.loopBefore)}`)
    }
    if (JSON.stringify(looped.loopBefore) !== JSON.stringify(loop)) {
      throw new Error(`loop did not take hold: loop=${JSON.stringify(looped.loopBefore)}`)
    }
    const cleanMono = readWav(clean.wav!).mono
    const seekDiff = maxSampleDiff(readWav(seeked.wav!).mono, cleanMono)
    const loopDiff = maxSampleDiff(readWav(looped.wav!).mono, cleanMono)
    console.log(`[#1344 frame] maxSampleDiff vs clean: seek=${seekDiff} loop=${loopDiff}`)
    expect({
      seekSame: seekDiff < 1e-4,
      loopSame: loopDiff < 1e-4,
      offsetAfter: [seeked.offsetAfter, looped.offsetAfter],
      loopAfter: [seeked.loopAfter, looped.loopAfter],
      playingAfter: [seeked.playingAfter, looped.playingAfter],
    }).toEqual({
      seekSame: true,
      loopSame: true,
      offsetAfter: [0, 0],
      loopAfter: [null, loop],
      playingAfter: [false, false],
    })
  })

  test('a document that does not evaluate reports its error and renders nothing', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await callBounceLoaded(page, '$: note("c3").s("sine").nosuchmethod()', 2)
    console.log(`[#1344 broken] ok=${out.ok} error=${out.error}`)
    expect({ ok: out.ok, named: /nosuchmethod/.test(out.error ?? ''), wav: out.wav }).toEqual({
      ok: false,
      named: true,
      wav: undefined,
    })
  })
})

/**
 * #1636 — superdough pools reusable nodes (filters, compressors, supersaws,
 * wavetables) in ONE page-wide map keyed only by kind (`nodePools.mjs:8`). An
 * offline render swaps the audio context, so without a context check each side
 * was handed the other's nodes, could not connect them, and dropped the note.
 * Measured before the fix on this filtered sawtooth: a live take after a bounce
 * fell from 0.0476 to 0.0068 rms, and a bounce after a live take skipped 3 notes.
 * A plain sawtooth never touches the pool, so it cannot show this.
 */
const POOLED_FILTER_SAW = '$: note("c4 e4 g4 b4 c5 b4 g4 e4").s("sawtooth").gain(0.3).lpf(2400).release(0.12)'

// Each ordering runs on its OWN fresh page, so the pool holds exactly what that
// ordering put in it. Measured with the fix removed: a same-page sequence that
// starts with a bounce left the bounce-after-live arm green (diff 0, nothing
// skipped) and took only 17% off the live take, so neither pinned the defect.
test.describe('#1636 — an offline bounce and live playback do not trade pooled nodes', () => {
  test('a live take right after a bounce plays at the level of one on a page that never bounced', async ({ browser }) => {
    test.setTimeout(180000)
    const clean = await browser.newPage()
    await openApp(clean)
    const reference = await call(clean, 'recordLive', POOLED_FILTER_SAW, 6)
    await clean.close()
    const page = await browser.newPage()
    await openApp(page)
    const bounce = await callBounceLoaded(page, POOLED_FILTER_SAW, 6)
    const after = await call(page, 'recordLive', POOLED_FILTER_SAW, 6)
    await page.close()
    if (!reference.ok || !bounce.ok || !after.ok) {
      throw new Error(`probe failed: ${reference.error ?? ''} ${bounce.error ?? ''} ${after.error ?? ''}`)
    }
    const r = readWav(reference.wav!)
    const ratio = rms(readWav(after.wav!).mono) / rms(r.mono)
    console.log(
      `[#1636 live-after-bounce] sr=${r.sampleRate} rms reference=${rms(r.mono).toFixed(5)} ` +
        `after=${rms(readWav(after.wav!).mono).toFixed(5)} ratio=${ratio.toFixed(4)} bounceSkipped=${JSON.stringify(bounce.skipped)}`,
    )
    // Live takes of this noise-free pattern on two fresh pages agree within a few
    // percent (capture start jitter); the defect took 86% off.
    expect(Math.abs(ratio - 1) < 0.1).toBe(true)
  })

  test('a bounce right after a live take skips nothing and matches a bounce on a page that never played', async ({
    browser,
  }) => {
    test.setTimeout(180000)
    const clean = await browser.newPage()
    await openApp(clean)
    const reference = await callBounceLoaded(clean, POOLED_FILTER_SAW, 6)
    await clean.close()
    const page = await browser.newPage()
    await openApp(page)
    const live = await call(page, 'recordLive', POOLED_FILTER_SAW, 6)
    const after = await callBounceLoaded(page, POOLED_FILTER_SAW, 6)
    await page.close()
    if (!reference.ok || !live.ok || !after.ok) {
      throw new Error(`probe failed: ${reference.error ?? ''} ${live.error ?? ''} ${after.error ?? ''}`)
    }
    const f = readWav(reference.wav!)
    const diff = maxSampleDiff(readWav(after.wav!).mono, f.mono)
    console.log(
      `[#1636 bounce-after-live] sr=${f.sampleRate} skipped reference=${JSON.stringify(reference.skipped)} ` +
        `after=${JSON.stringify(after.skipped)} maxSampleDiff=${diff}`,
    )
    // An offline render of this pattern is sample-exact run to run, so any
    // difference from the page that never played came from the live take.
    expect({ skipped: after.skipped, same: diff < 1e-4 }).toEqual({ skipped: [], same: true })
  })
})

/**
 * #1635 — Stave maps familiar names (`kick`, `snare`, `hat`, …) to the loaded
 * samples (`aliases.ts`). The live output did that per note, but the offline
 * render calls superdough directly, so before the fix `s("kick*4")` played live
 * and bounced to a file refused as silent. Measured then: live rms 0.155, bounce
 * refused; `s("bd*4")` bounced at 0.162.
 */
test.describe('#1635 — a sound alias bounces like the sound it names', () => {
  test('s("kick*4") bounces sample-for-sample like s("bd*4")', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const bd = await callBounceLoaded(page, '$: s("bd*4")', 4)
    const kick = await callBounceLoaded(page, '$: s("kick*4")', 4)
    console.log(
      `[#1635 alias] bd ok=${bd.ok} err=${bd.error ?? ''} skipped=${JSON.stringify(bd.skipped)} ` +
        `kick ok=${kick.ok} err=${kick.error ?? ''} skipped=${JSON.stringify(kick.skipped)}`,
    )
    // The control has to render, or "kick matches bd" could be two failures agreeing.
    if (!bd.ok) throw new Error(`control bd did not bounce: ${bd.error}`)
    const b = readWav(bd.wav!)
    const diff = kick.wav ? maxSampleDiff(readWav(kick.wav).mono, b.mono) : Infinity
    console.log(`[#1635 alias] sr=${b.sampleRate} bd peak=${peak(b.mono).toFixed(4)} maxSampleDiff kick vs bd=${diff}`)
    expect({ ok: kick.ok, skipped: kick.skipped, same: diff < 1e-4 }).toEqual({ ok: true, skipped: [], same: true })
  })

  test('a bounce refused as silent names the sounds it left out', async ({ page }) => {
    test.setTimeout(120000)
    await openApp(page)
    const out = await callBounceLoaded(page, '$: s("nosuchsound*4")', 2)
    console.log(`[#1635 silent] ok=${out.ok} error=${out.error}`)
    expect({
      ok: out.ok,
      silent: /capture is silent/.test(out.error ?? ''),
      named: /nosuchsound/.test(out.error ?? ''),
    }).toEqual({ ok: false, silent: true, named: true })
  })
})

/**
 * #1356 — how long does the graph keep sounding AFTER the transport stops?
 *
 * Stopping halts Strudel's scheduler but does not cancel Web Audio nodes
 * already scheduled in the lookahead window. If that tail is long, a bounce
 * started right after a stop records the previous take under the opening of the
 * new one. If it is short, the modal interaction alone outlasts it and there is
 * nothing to fix. The number decides whether the reported bug binds.
 */
test('#1356 the tail after stop decays quickly', async ({ page }) => {
  test.setTimeout(120_000)
  await openApp(page)
  const out = await call(page, 'recordAfterStop', starterCode(), 8)
  expect(out.ok, out.error ?? '').toBe(true)
  const { sampleRate, mono } = readWav(out.wav!)

  // Per-250ms RMS, so the decay is visible as a curve rather than one number.
  const win = Math.floor(sampleRate / 4)
  const curve: string[] = []
  for (let i = 0; i + win <= mono.length; i += win) {
    let sum = 0
    for (let j = i; j < i + win; j++) sum += mono[j] * mono[j]
    curve.push((Math.sqrt(sum / win)).toFixed(4))
  }
  // Last window above an audible floor, in ms.
  let lastAudible = 0
  curve.forEach((v, i) => { if (Number(v) > 0.005) lastAudible = (i + 1) * 250 })

  // Measured: near-full level for a full second, then silence.
  //   0.1280 0.1146 0.1042 0.0894 0.0120 0.0000 0.0000 ...   lastAudible 1250ms
  // This is the budget `StrudelEngine.waitUntilQuiet` has to cover before a
  // bounce may start. If the tail ever outgrew that 2500ms ceiling the settle
  // would time out and contamination would return silently — which is what
  // this arm is here to catch.
  expect(lastAudible).toBeLessThan(2500)
})

/**
 * #1656 — a live sample note whose FIRST load is still in flight when a bounce
 * starts.
 *
 * The sampler reads superdough's global context again when its load finishes
 * (`sampler.mjs:61`). If a render has swapped the global in the meantime, the
 * note's source is built on the render's context and its `connect` to the live
 * gain throws (caught, so the note is simply lost). Measured before the fix: a
 * bounce straight after Play swaps 3-4 ms after the first sample request, with
 * live notes still due 0.29 s later, and releasing the load at +60 ms crossed
 * contexts on every run.
 *
 * The instrument, not the product, times the sample loads: `page.route` answers
 * every audio file request with a short generated WAV, `releaseMs` after the
 * first request (never before), so the load time does not depend on the
 * network. A real fetch released at the same moment arrived after the note was
 * due and was dropped, which reads as a pass for the wrong reason. The page
 * records every `connect` between nodes of different contexts, and every live
 * `AudioBufferSourceNode.start`.
 */
test.describe('#1656 — a live sample still loading when a bounce starts', () => {
  const DOC = `setcps(0.5)
$: note("c4*32").s("sine").gain(0.001)
$: s("hh*16").gain(0.3)`

  /** 50 ms of a 1 kHz tone, 16-bit mono 44.1 kHz — any sample name gets this. */
  function toneWav(): Buffer {
    const rate = 44100
    const n = Math.floor(rate * 0.05)
    const buf = Buffer.alloc(44 + n * 2)
    buf.write('RIFF', 0)
    buf.writeUInt32LE(36 + n * 2, 4)
    buf.write('WAVEfmt ', 8)
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20)
    buf.writeUInt16LE(1, 22)
    buf.writeUInt32LE(rate, 24)
    buf.writeUInt32LE(rate * 2, 28)
    buf.writeUInt16LE(2, 32)
    buf.writeUInt16LE(16, 34)
    buf.write('data', 36)
    buf.writeUInt32LE(n * 2, 40)
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 1000 * i) / rate) * 12000), 44 + i * 2)
    return buf
  }

  async function bounceWithHeldSamples(page: Page, releaseMs: number) {
    const body = toneWav()
    let firstRequest = 0
    await page.route(/\.(wav|mp3|ogg)(\?|$)/i, async (route) => {
      if (!firstRequest) firstRequest = Date.now()
      const wait = Math.max(0, firstRequest + releaseMs - Date.now())
      await new Promise((r) => setTimeout(r, wait))
      await route.fulfill({ status: 200, contentType: 'audio/wav', body }).catch(() => {})
    })
    await page.addInitScript(() => {
      // Init scripts also run in every frame, and #1758 renders in a throwaway
      // frame: each copy records into the TOP window, and only the top resets it.
      const w = (window.top ?? window) as unknown as { __race: { cross: string[]; liveSampleStarts: number } }
      if (window === window.top) w.__race = { cross: [], liveSampleStarts: 0 }
      const realConnect = AudioNode.prototype.connect as (...a: unknown[]) => unknown
      ;(AudioNode.prototype as unknown as { connect: unknown }).connect = function (this: AudioNode, ...a: unknown[]) {
        const dest = a[0] as { context?: BaseAudioContext } | undefined
        if (dest?.context && dest.context !== this.context) {
          w.__race.cross.push(`${this.constructor.name} -> ${(dest as object).constructor.name}`)
        }
        return realConnect.apply(this, a)
      }
      const realStart = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...a: number[]) {
        if (this.context instanceof AudioContext) w.__race.liveSampleStarts++
        return (realStart as (...x: number[]) => void).apply(this, a)
      }
    })
    await openApp(page)
    const out = await page.evaluate(
      (code) =>
        (
          window as unknown as {
            __staveBounceProbe: { bounceLoaded: (c: string, s: number, o: unknown) => Promise<{ ok: boolean; error?: string }> }
          }
        ).__staveBounceProbe.bounceLoaded(code, 4, { playing: true }),
      DOC,
    )
    // Long enough for any late live note to have been built or dropped.
    await page.waitForTimeout(1000)
    const race = await page.evaluate(() => (window as unknown as { __race: { cross: string[]; liveSampleStarts: number } }).__race)
    const log = await page.evaluate(() =>
      ((window as unknown as { __staveGetLog?: () => Array<{ message: string }> }).__staveGetLog?.() ?? []).map((e) => e.message),
    )
    return { out, race, log, heldAtAll: firstRequest > 0 }
  }

  test('a load that finishes before its note is due builds the note on the LIVE context', async ({ page }) => {
    test.setTimeout(90_000)
    const r = await bounceWithHeldSamples(page, 60)
    console.log(`[#1656 +60ms] ok=${r.out.ok} cross=${JSON.stringify(r.race.cross)} liveSampleStarts=${r.race.liveSampleStarts}`)
    expect(r.heldAtAll, 'no sample request was held — the arm did not exercise a load').toBe(true)
    expect(r.out.ok, r.out.error).toBe(true)
    expect(r.race.cross).toEqual([])
    // The note played live: without this, "no crossed connect" would also pass
    // for a note the sampler simply dropped.
    expect(r.race.liveSampleStarts).toBeGreaterThan(0)
    await expectNoUncaught(page)
  })

  test('a load that never answers in time does not hold the bounce, and the bounce says so', async ({ page }) => {
    test.setTimeout(90_000)
    const r = await bounceWithHeldSamples(page, 3000)
    console.log(`[#1656 +3000ms] ok=${r.out.ok} cross=${JSON.stringify(r.race.cross)} warned=${r.log.some((m) => /still loading/.test(m))}`)
    expect(r.heldAtAll).toBe(true)
    expect(r.out.ok, r.out.error).toBe(true)
    expect(r.race.cross).toEqual([])
    expect(r.log.filter((m) => /live sounds? (was|were) still loading/.test(m))).toHaveLength(1)
    await expectNoUncaught(page)
  })
})
