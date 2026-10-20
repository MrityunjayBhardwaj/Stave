import { test, expect, type Page, type CDPSession } from '@playwright/test'
import { chooseDisplay } from './_laneType'
import { execFileSync } from 'node:child_process'

import { bootApp, seedCode } from './_appBoot'
import { expectNoUncaught, watchUncaught } from './_uncaught'

/**
 * #1755 / #1758 — an offline render leaves nothing behind once it ends.
 *
 * Every waveform the Song timeline draws for a synth track, and every bounce,
 * is an `OfflineAudioContext` holding the whole rendered audio (a 512 s stereo
 * track is ~197 MB at 48 kHz). A context that has loaded audio worklets is
 * never collected in Chromium unless the frame it belongs to is removed.
 *
 *  1. A song whose sounds need no worklet (#1755): after three waveform passes
 *     and a bounce, no context is alive. Counted with `Runtime.queryObjects` on
 *     the page's `OfflineAudioContext.prototype`.
 *  2. A song whose sounds DO need worklets (#1758): those renders are built in
 *     a throwaway frame and disposed. ⚠ `queryObjects` on the page's prototype
 *     cannot see a context from another frame (it would read 0 either way), so
 *     this arm measures the renderer's memory instead — macOS `footprint`,
 *     which counts compressed pages (RSS does not: it FELL while every leaked
 *     context was still alive). Measured before the fix, same probe: 173 → 1,348
 *     MB over five redraws; after: flat within ~50 MB.
 *  3. A render built in a frame still sounds right (#1758). Its nodes come from
 *     another realm, where the page's `instanceof` answers false; unpatched,
 *     superdough silently dropped LFO modulation there and threw on every node
 *     cleanup. An LFO-modulated bounce must differ from the same bounce without
 *     the LFO, and reverb / vowel / delay (methods superdough adds to the page's
 *     `BaseAudioContext.prototype`) must render, with no page error.
 */

async function envelopes(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('[data-full-song-envelopes]')?.getAttribute('data-full-song-envelopes') ?? '')
}

async function rendering(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[data-full-song-envelope-rendering]')?.getAttribute('data-full-song-envelope-rendering') ?? '',
  )
}

/** Offline contexts still alive after a forced garbage collection. */
async function liveOfflineContexts(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage')
  const { result: proto } = await cdp.send('Runtime.evaluate', { expression: 'OfflineAudioContext.prototype' })
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId! })
  const { result } = await cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objectId!,
    functionDeclaration: 'function () { return this.length }',
    returnByValue: true,
  })
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: '' }).catch(() => {})
  return result.value as number
}

/**
 * #2079 — a synth lane with no saved type draws as Bars, though it is still
 * rendered; save Waveform for each lane in `lanes` ("d1:fresh d2:fresh") so the
 * drawn envelopes can be waited on. Choosing it again is a no-op.
 */
async function saveWaveform(page: Page, lanes: string): Promise<void> {
  for (const lane of lanes.split(' ')) await chooseDisplay(page, lane.split(':')[0], 'waveform')
}

/** Seed `code` and wait until every lane's envelope has been rendered for it. */
async function drawn(page: Page, code: string, lanes: string): Promise<void> {
  await seedCode(page, code)
  await saveWaveform(page, lanes)
  await expect.poll(() => envelopes(page), { timeout: 60_000 }).toBe(lanes)
  await expect.poll(() => rendering(page), { timeout: 10_000 }).toBe('')
}

async function bounce(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByText('Bounce to WAV...').click()
  const dialog = page.getByRole('dialog', { name: 'Bounce to WAV' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '30s' }).click()
  const download = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  await download
}

/** Two synth tracks, 64 cycles long; `cutoff` changes what both play. */
const plain = (cutoff: number) =>
  'setcps(0.5)\n' +
  `$: arrange([64, note("<c3 e3 g3 b3>*8").s("sawtooth").lpf(${cutoff})])\n` +
  `$: arrange([64, note("<g2 b2 d3>*4").s("square").lpf(${cutoff})])`

test.describe.configure({ mode: 'serial' })

test('a song with no worklet sound keeps no offline render alive (#1755)', async ({ page }) => {
  test.setTimeout(180_000)
  await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
  const cdp = await page.context().newCDPSession(page)
  const alive: number[] = []
  for (const cutoff of [800, 1200, 1600]) {
    await drawn(page, plain(cutoff), 'd1:fresh d2:fresh')
    alive.push(await liveOfflineContexts(cdp))
  }
  await bounce(page)
  await expect.poll(() => rendering(page), { timeout: 10_000 }).toBe('')
  alive.push(await liveOfflineContexts(cdp))
  console.log(`[#1755 plain] live offline contexts after passes 1-3, then a bounce: ${alive.join(' ')}`)
  // Before #1755 (measured on the same spec): 2, 2, 4, 5 — every render kept.
  expect(alive).toEqual([0, 0, 0, 0])
})

/** The largest renderer process's memory footprint in MB, after a forced GC (macOS `footprint`). */
async function rendererFootprintMB(page: Page, cdp: CDPSession): Promise<number> {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  await page.waitForTimeout(1500)
  const browserCdp = await page.context().browser()!.newBrowserCDPSession()
  const { processInfo } = (await browserCdp.send('SystemInfo.getProcessInfo')) as {
    processInfo: Array<{ type: string; id: number }>
  }
  const mbs = processInfo
    .filter((p) => p.type === 'renderer')
    .map((p) => {
      const m = execFileSync('footprint', [String(p.id)], { encoding: 'utf8' }).match(/Footprint:\s*([\d.]+)\s*(KB|MB|GB)/i)
      if (!m) throw new Error(`footprint printed no figure for renderer ${p.id}`)
      const v = Number(m[1])
      return m[2].toUpperCase() === 'GB' ? v * 1024 : m[2].toUpperCase() === 'KB' ? v / 1024 : v
    })
  if (mbs.length === 0) throw new Error('no renderer process found')
  return Math.max(...mbs)
}

/** Seed `code` and wait for THIS pass's renders: rendering turns on after the edit, then off, every lane fresh. */
async function redrawn(page: Page, code: string, lanes: string): Promise<void> {
  await seedCode(page, code)
  await expect.poll(() => rendering(page), { timeout: 30_000, intervals: [25] }).not.toBe('')
  await expect.poll(() => rendering(page), { timeout: 120_000 }).toBe('')
  await saveWaveform(page, lanes)
  await expect.poll(() => envelopes(page), { timeout: 30_000 }).toBe(lanes)
}

/** Two 512 s tracks whose sounds need worklets (supersaw, and `.shape`). */
const workletSong = (gain: number) =>
  'setcps(0.5)\n' +
  `$: arrange([256, note("<c3 e3 g3 b3>*8").s("supersaw").gain(${gain})])\n` +
  `$: arrange([256, note("<g2 b2 d3>*4").s("sawtooth").shape(0.4).gain(${gain})])`

test('a song whose sounds need worklets keeps no render in memory (#1758)', async ({ page }) => {
  test.skip(process.platform !== 'darwin', 'measured with macOS `footprint`; RSS cannot see compressed pages')
  test.setTimeout(300_000)
  await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
  const cdp = await page.context().newCDPSession(page)
  const frames = () => page.evaluate(() => document.querySelectorAll('iframe[data-stave-audio-frame]').length)

  await redrawn(page, workletSong(0.3), 'd1:fresh d2:fresh')
  const first = await rendererFootprintMB(page, cdp)
  const after: number[] = []
  for (const gain of [0.31, 0.32, 0.33, 0.34]) {
    await redrawn(page, workletSong(gain), 'd1:fresh d2:fresh')
    after.push(await rendererFootprintMB(page, cdp))
  }
  await bounce(page)
  await expect.poll(() => rendering(page), { timeout: 10_000 }).toBe('')
  after.push(await rendererFootprintMB(page, cdp))
  const left = await frames()
  console.log(
    `[#1758 worklets] renderer footprint after pass 1: ${Math.round(first)} MB; passes 2-5 then a bounce: ` +
      `${after.map(Math.round).join(' ')} MB; frames left ${left}`,
  )
  // Before the fix every pass kept ~200 MB (two tracks at 24 kHz): 4 more passes
  // and a bounce would add ~900 MB. Flat means well under one pass's worth.
  expect(Math.max(...after) - first).toBeLessThan(100)
  expect(left).toBe(0)
})

type Bounced = { ok: boolean; error?: string; wav?: string }

/** Loudness per 50 ms of a 16-bit PCM WAV (base64), both channels. */
function loudness(b64: string): number[] {
  const buf = Buffer.from(b64, 'base64')
  const channels = buf.readUInt16LE(22)
  const rate = buf.readUInt32LE(24)
  let off = 12
  while (off + 8 <= buf.length && buf.toString('ascii', off, off + 4) !== 'data') off += 8 + buf.readUInt32LE(off + 4)
  const start = off + 8
  const samples = Math.floor(buf.readUInt32LE(off + 4) / 2)
  const win = Math.round(rate * 0.05) * channels
  const out: number[] = []
  for (let i = 0; i + win <= samples; i += win) {
    let sq = 0
    for (let j = i; j < i + win; j++) sq += (buf.readInt16LE(start + j * 2) / 32768) ** 2
    out.push(Math.sqrt(sq / win))
  }
  return out
}

/** Summed difference of two loudness curves over the first one's total. */
function curveDifference(a: number[], b: number[]): number {
  let diff = 0
  let total = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    diff += Math.abs(a[i] - b[i])
    total += a[i]
  }
  return total === 0 ? NaN : diff / total
}

test('a render built in a frame keeps its modulation, reverb, vowel and delay (#1758)', async ({ page }) => {
  test.setTimeout(180_000)
  await watchUncaught(page)
  await bootApp(page, { e2eHooks: true })
  await page.waitForFunction(() => Boolean((window as unknown as { __staveBounceProbe?: unknown }).__staveBounceProbe), undefined, {
    timeout: 60_000,
  })
  const bounceOf = async (code: string): Promise<string> => {
    const out = (await page.evaluate(
      ([c]) =>
        (window as unknown as { __staveBounceProbe: { offlineAfterEvaluate(code: string, secs: number): Promise<Bounced> } })
          .__staveBounceProbe.offlineAfterEvaluate(c, 8),
      [code] as const,
    )) as Bounced
    if (!out.ok || !out.wav) throw new Error(`bounce failed: ${out.error}`)
    return out.wav
  }
  // First, on a fresh page: drums whose samples have never been decoded, in a
  // render that needs worklets (`.shape`). The frame's decodes go to the live
  // context (a decode left on a removed frame never settles), and the decoded
  // buffers then play inside the frame's render.
  const drums = loudness(await bounceOf('setcps(0.5)\ns("bd*4, hh*8, sd*2").shape(0.4).gain(0.5)'))
  const lfo = loudness(await bounceOf('setcps(0.5)\nnote("c2*8").s("supersaw").lpf(400).lfo({ c: "lpf", r: 1, depth: 4 }).gain(0.4)'))
  const still = loudness(await bounceOf('setcps(0.5)\nnote("c2*8").s("supersaw").lpf(400).gain(0.4)'))
  const effects: Record<string, number[]> = {
    room: loudness(await bounceOf('setcps(0.5)\nnote("<c3 e3>*2").s("supersaw").room(0.6).gain(0.3)')),
    vowel: loudness(await bounceOf('setcps(0.5)\nnote("<c3 e3>*4").s("sawtooth").shape(0.3).vowel("<a o>").gain(0.3)')),
    delay: loudness(await bounceOf('setcps(0.5)\nnote("<c3 g3>*2").s("supersaw").delay(0.5).delaytime(0.25).gain(0.3)')),
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  const lfoEffect = curveDifference(lfo, still)
  console.log(
    `[#1758 sound] lfo vs no lfo ${lfoEffect.toFixed(3)} · mean loudness drums ${mean(drums).toFixed(4)} room ${mean(effects.room).toFixed(4)} ` +
      `vowel ${mean(effects.vowel).toFixed(4)} delay ${mean(effects.delay).toFixed(4)}`,
  )
  // Dropped modulation made the LFO bounce the same as the one without it.
  expect(lfoEffect).toBeGreaterThan(0.05)
  for (const curve of [drums, ...Object.values(effects)]) expect(mean(curve)).toBeGreaterThan(0.005)
  await expectNoUncaught(page)
})
