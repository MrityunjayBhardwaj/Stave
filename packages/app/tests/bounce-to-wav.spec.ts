import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expectNoUncaught, watchUncaught } from './_uncaught'
import { seedCode, waitForEditorLoaded, STARTER_UNTIL_2240 } from './_appBoot'

/**
 * #1346 — Bounce to WAV, driven through the real File menu.
 *
 * The point of these arms is the one thing a unit test cannot check: that the
 * bytes are AUDIO. `LiveRecorder` taps the master analyser, so a bounce with
 * the transport stopped resolves with a perfectly valid WAV of pure silence and
 * no error — the same silent-failure shape the offline renderer has (#1353).
 * "A download arrived" and "a WAV parsed" are therefore both false cleans here;
 * only a non-zero sample count means the feature works.
 *
 * #1631 — a Strudel file's bounce renders offline now, so these arms no longer
 * spend the song's length in wall clock; one of them pins exactly that.
 */

const BOUNCE_SECONDS = 8
/** #1631 — a sound that does not exist, beside one that does. */
const MISSING_SOUND = 'nosuchsound'
const SKIPPED_DOC = `$: stack(s("bd*4"), s("${MISSING_SOUND}*4"))`

test.beforeEach(async ({ page }) => {
  // Before the navigation: the listeners must be in the page from its first line (#1647).
  await watchUncaught(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-workspace-shell="root"]').waitFor({ timeout: 15000 })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
})

/**
 * RMS over a 16-bit stereo WAV's whole PCM payload.
 *
 * Deliberately RMS and not PEAK. `stop()` halts Strudel's scheduler but does
 * not cancel Web Audio nodes already scheduled in the lookahead window, so a
 * bounce taken over a STOPPED transport still catches a fraction of a second of
 * residual tail — which clears any sane peak threshold. Measured: a peak-based
 * arm passed under a break that removed playback entirely. RMS averages that
 * tail down across the take, so it separates "recorded the music" from
 * "recorded the ring-out".
 */
function rmsOf(path: string): number {
  const buf = readFileSync(path)
  // Second half only. A scheduling tail DECAYS; music does not. Measuring the
  // back half is what turns a ~3x separation into a decisive one.
  const start = 44 + Math.floor((buf.length - 44) / 2 / 4) * 4
  let sum = 0
  let n = 0
  for (let i = start; i + 1 < buf.length; i += 2) {
    const v = buf.readInt16LE(i) / 32768
    sum += v * v
    n++
  }
  return n === 0 ? 0 : Math.sqrt(sum / n)
}

/** Sample frames in a 16-bit stereo WAV. */
function framesOf(path: string): number {
  return (readFileSync(path).length - 44) / 4
}

async function openBounceModal(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByText('Bounce to WAV...').click()
  await expect(page.getByRole('dialog', { name: 'Bounce to WAV' })).toBeVisible()
}

test('the File menu offers Bounce to WAV', async ({ page }) => {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await expect(page.getByText('Bounce to WAV...')).toBeVisible()
})

test('a bounce downloads a WAV whose audio is NOT silent', async ({ page }) => {
  test.setTimeout(90_000)
  await openBounceModal(page)
  await page.getByRole('button', { name: `${BOUNCE_SECONDS}s` }).click()

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  const download = await downloadPromise
  const path = await download.path()

  // The assertion that matters, and the threshold is MEASURED, not guessed.
  // Second-half RMS with playback guaranteed: 0.15890. With the playback
  // guarantee removed (engine still initialised, transport stopped): exactly 0,
  // because the scheduling tail has fully decayed by the halfway mark. 0.02 is
  // eight times below the live figure and above any noise floor.
  //
  // An earlier version of this arm measured PEAK over the whole take and passed
  // under that same break — the residual tail alone cleared it. Peak could not
  // tell "recorded the music" from "recorded the ring-out".
  expect(rmsOf(path!)).toBeGreaterThan(0.02)
})

test('the bounce is named .wav', async ({ page }) => {
  test.setTimeout(90_000)
  await openBounceModal(page)
  await page.getByRole('button', { name: `${BOUNCE_SECONDS}s` }).click()

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/\.wav$/)
})

/**
 * #1631 — these two arms replace "stopping early keeps what was recorded" and
 * "a stopped-early bounce is shorter". Those pinned the LIVE capture, which a
 * Strudel file no longer reaches from the File menu: the bounce renders offline
 * now, and a render cannot stop halfway. `LiveRecorder`'s keep-what-was-captured
 * behaviour is still pinned by its own unit tests, and is still what the live
 * fallback does.
 */
test('a bounce renders faster than the song plays, at full length (#1631)', async ({ page }) => {
  test.setTimeout(120_000)
  await openBounceModal(page)
  await page.getByRole('button', { name: '60s' }).click()

  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
  const startedAt = Date.now()
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  const download = await downloadPromise
  const wallSeconds = (Date.now() - startedAt) / 1000
  const frames = framesOf((await download.path())!)
  console.log(`[#1631 speed] a 60s bounce took ${wallSeconds.toFixed(1)}s of wall clock, ${frames} frames`)

  // A live capture cannot deliver 60 seconds of audio in under 30, so this goes
  // red if the bounce falls back to recording — and a short file cannot pass it.
  expect({ fullLength: frames >= 60 * 40_000, fasterThanPlaying: wallSeconds < 30 }).toEqual({
    fullLength: true,
    fasterThanPlaying: true,
  })
})

/**
 * A song with no worklet sound, for the held renders: one with a worklet sound
 * (`supersaw`, as in the Starter since #2240) renders in a frame of its own
 * (#1758), whose `OfflineAudioContext` the hold below never sees.
 */
const NO_WORKLET_SONG = STARTER_UNTIL_2240

/**
 * #1655 — hold a bounce-sized render at its `n`th pause (0-based) until the test
 * releases it with `__renderHold.release()`. Shorter offline renders pass.
 * The render has reported progress for every pause BEFORE the held one (#1650):
 * a pause reports when its handler runs, and the held pause's has not.
 */
async function holdRenderAtPause(page: import('@playwright/test').Page, n: number) {
  await page.addInitScript((holdAt: number) => {
    const w = window as unknown as { __renderHold: { reached: boolean; release: (() => void) | null } }
    w.__renderHold = { reached: false, release: null }
    const proto = OfflineAudioContext.prototype
    const realSuspend = proto.suspend
    const seen = new WeakMap<OfflineAudioContext, number>()
    proto.suspend = function (this: OfflineAudioContext, at: number) {
      const paused = realSuspend.call(this, at)
      if (this.length < this.sampleRate * 100) return paused
      const index = seen.get(this) ?? 0
      seen.set(this, index + 1)
      if (index !== holdAt) return paused
      return paused.then(
        () =>
          new Promise<void>((resolve) => {
            w.__renderHold.reached = true
            w.__renderHold.release = resolve
          }),
      )
    }
  }, n)
}

async function renderHeld(page: import('@playwright/test').Page) {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __renderHold: { reached: boolean } }).__renderHold.reached), {
      timeout: 30_000,
    })
    .toBe(true)
}

/**
 * #1631 / #1655 / #1649 — Cancel pressed while a render is running.
 *
 * ⚠ THE RENDER IS HELD, NOT RACED. This arm used to pick the longest length and
 * hope the render was still running when the click landed, then wait for the
 * render to end. That made it depend on the machine's speed in both directions:
 * under load the render outlasted the wait, and alone the click often landed
 * before rendering began, so the arm passed on a different path from the one it
 * names. Now the render pauses between windows of notes (#1658), and this arm
 * holds it at its first pause until the click has landed. So the cancel is
 * always mid-render, and the state the user sees while it winds down (#1649)
 * can be read while the render is still stopped.
 */
test('cancelling a render saves nothing and says so (#1631)', async ({ page }) => {
  test.setTimeout(120_000)
  await holdRenderAtPause(page, 0)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForEditorLoaded(page)
  await seedCode(page, NO_WORKLET_SONG)
  await openBounceModal(page)
  await page.getByRole('button', { name: '300s' }).click()

  let downloaded = false
  page.on('download', () => {
    downloaded = true
  })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  const dialog = page.getByRole('dialog', { name: 'Bounce to WAV' })
  // The render has started and is stopped at its first pause.
  await renderHeld(page)
  await expect(dialog.getByText(/^Rendering/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // #1649 — acknowledged while the render is still held, so it cannot be the
  // render ending that shows it.
  await expect(dialog.getByText('Cancelling…')).toBeVisible({ timeout: 2_000 })
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()

  const releasedAt = Date.now()
  await page.evaluate(() => (window as unknown as { __renderHold: { release: () => void } }).__renderHold.release())
  await expect(
    page.locator('[data-testid="toast"]').filter({ hasText: 'Bounce cancelled' }),
  ).toBeVisible({ timeout: 60_000 })
  console.log(`[#1655 cancel] toast ${((Date.now() - releasedAt) / 1000).toFixed(1)}s after the render was released`)
  expect(downloaded, 'a cancelled render must not save a file').toBe(false)
  await expect(dialog).toBeHidden({ timeout: 10_000 })
})

/**
 * #1650 — a render shows how far it has got. Held at its third pause, it has
 * reported two, so the bar reads 8 of 300 seconds while nothing moves; released,
 * it runs to the end and saves the whole file.
 */
test('a render shows how far it has got, and still saves the whole song (#1650)', async ({ page }) => {
  test.setTimeout(120_000)
  await holdRenderAtPause(page, 2)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForEditorLoaded(page)
  await seedCode(page, NO_WORKLET_SONG)
  await openBounceModal(page)
  await page.getByRole('button', { name: '300s' }).click()

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  const dialog = page.getByRole('dialog', { name: 'Bounce to WAV' })
  await renderHeld(page)

  const bar = dialog.getByRole('progressbar')
  await expect(bar).toBeVisible()
  await expect(bar).toHaveAttribute('aria-valuemax', '300')
  await expect(bar).toHaveAttribute('aria-valuenow', '8')

  await page.evaluate(() => (window as unknown as { __renderHold: { release: () => void } }).__renderHold.release())
  const download = await downloadPromise
  expect(framesOf((await download.path())!)).toBeGreaterThanOrEqual(300 * 40_000)
})

/**
 * #1631 — a render that could not play some sounds still saves the file, and
 * the toast names what was left out. Before this, the app's live bounce had no
 * such report, and the offline render's `skipped` list went nowhere.
 *
 * ⚠ BOTH HALVES. The file must carry the sound that DID play (a bounce refused
 * as silent would also produce an error toast), and the toast must be the
 * skipped-sounds one and name the missing sound (not the generic failure).
 */
test('a bounce that could not play some sounds still saves, and names them (#1631)', async ({ page }) => {
  test.setTimeout(120_000)
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    return true
  }, SKIPPED_DOC)
  expect(ok).toBe(true)
  await page.waitForTimeout(400)

  await openBounceModal(page)
  await page.getByRole('button', { name: `${BOUNCE_SECONDS}s` }).click()
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  const download = await downloadPromise

  const toast = page
    .locator('[data-testid="toast"][data-level="error"]')
    .filter({ hasText: 'could not play' })
  await expect(toast).toBeVisible({ timeout: 10_000 })
  await expect(toast).toContainText(MISSING_SOUND)
  const rms = rmsOf((await download.path())!)
  console.log(`[#1631 skipped] rms=${rms.toFixed(4)} toast=${(await toast.textContent())?.trim()}`)
  expect(rms, 'the sound that could play must be in the file').toBeGreaterThan(0.005)
})

test('the modal closes once the bounce has been saved', async ({ page }) => {
  test.setTimeout(90_000)
  await openBounceModal(page)
  await page.getByRole('button', { name: `${BOUNCE_SECONDS}s` }).click()

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  await downloadPromise

  await expect(page.getByRole('dialog', { name: 'Bounce to WAV' })).toBeHidden({ timeout: 10_000 })
})

/** RMS over the first `ms` of a 16-bit stereo WAV. */
function headRmsOf(path: string, ms: number): number {
  const buf = readFileSync(path)
  const end = Math.min(buf.length, 44 + Math.floor((48000 * ms) / 1000) * 4)
  let sum = 0
  let n = 0
  for (let i = 44; i + 1 < end; i += 2) {
    const v = buf.readInt16LE(i) / 32768
    sum += v * v
    n++
  }
  return n === 0 ? 0 : Math.sqrt(sum / n)
}

/**
 * #1356 — the product path, which is the only one that can answer this.
 *
 * Stopping halts Strudel's scheduler but does not cancel Web Audio nodes
 * already scheduled, so the graph keeps sounding for ~1.25s after the transport
 * reads stopped. A bounce started inside that window SUMS the previous take
 * under the opening of the new file: louder, doubled, no error.
 *
 * Measured on the engine path with zero delay the head ran 24% hot. This arm
 * asks the question through the menu, where the user's own clicks are part of
 * the timing — the only version of it that describes the shipped product.
 */
/**
 * ⚠ THIS ARM ASSERTS A RATIO, NOT A LEVEL, AND THAT IS THE WHOLE POINT (#1357).
 *
 * It used to assert `headRms < 0.155` against figures measured once:
 *
 *     clean, no prior playback        0.1400
 *     after a stop, NO settle         0.1623   (+15.8%)
 *     after a stop, WITH the settle   0.1499   (+7.0%)
 *
 * That threshold went red without any code change, and the cause was not Stave.
 * Re-measured on a different audio-device state the SAME actions on the SAME
 * commit read roughly DOUBLE — 0.30621 clean, 0.31262 after a stop — and the
 * doubling reproduced against a pre-fix `dist`, which rules out the code. An
 * absolute level here measures the sound card as much as the defect, and at
 * 0.155 the old arm failed a CLEAN bounce as surely as a contaminated one.
 *
 * ⚠ Same trap as #1401, one day apart: a threshold calibrated against one
 * hardware property. There a 32s take divided evenly into 4096-frame blocks at
 * 48kHz and not at 44.1kHz; here the level itself scales with the device. When
 * an audio assertion goes red with no plausible code change, suspect the
 * measurement's dependence on hardware BEFORE suspecting whatever shipped last.
 *
 * So both readings are taken in ONE run, on ONE device state, and compared to
 * each other. The ratio band is chosen to preserve exactly the discriminating
 * power the level had: 0.155/0.1400 = 1.107 sat between the with-settle (+7.0%)
 * and no-settle (+15.8%) cases, so it passed with the settle and failed without
 * it. That is what this arm exists to catch — the RINGING TAIL regression of
 * #1356 — and 1.107 catches it identically while surviving a device change.
 *
 * ⚠ It deliberately does NOT catch #1357's residual, which is smaller than the
 * band and always was. Do not tighten this to absorb that; tightening it past
 * the residual makes the arm red for a defect it was never the detector for.
 * Measured residual on the current device state: 0.30621 -> 0.31262, +2.1%.
 *
 * ⚠ The first bounce is itself a play/stop, so the second has TWO behind it.
 * That is fine and deliberate: the elevation saturates after the first — 1, 2
 * and 4 prior cycles all read 0.31262, identical to five decimals — which is
 * also the measurement that ruled out state ACCUMULATING across evaluates.
 */
test('a bounce started right after a stop is not thickened by the previous take', async ({ page }) => {
  test.setTimeout(180_000)

  // Reading 1: a clean bounce, before this page has played anything.
  await openBounceModal(page)
  await page.getByRole('button', { name: `${BOUNCE_SECONDS}s` }).click()
  const cleanDl = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  const cleanRms = headRmsOf((await (await cleanDl).path())!, 1500)

  // Give the graph a real take to ring from.
  await page.locator('[data-testid="strudel-chrome-transport"]').click()
  await expect(page.locator('[data-stave-transport-lcd]')).toContainText('PLAY', { timeout: 15_000 })
  await page.waitForTimeout(2500)
  await page.locator('[data-testid="strudel-chrome-transport"]').click()
  await expect(page.locator('[data-stave-transport-lcd]')).toContainText('STOP', { timeout: 10_000 })

  // Reading 2: no settling pause on purpose — straight into the bounce.
  await openBounceModal(page)
  await page.getByRole('button', { name: `${BOUNCE_SECONDS}s` }).click()
  const afterDl = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  const afterRms = headRmsOf((await (await afterDl).path())!, 1500)

  const ratio = afterRms / cleanRms
  console.log(
    `[#1357] clean=${cleanRms.toFixed(5)} afterStop=${afterRms.toFixed(5)} ratio=${ratio.toFixed(4)}`,
  )

  // A clean bounce must be audible, or the ratio is a division by noise and
  // would pass for the wrong reason.
  expect(cleanRms, 'the clean reference bounce was silent').toBeGreaterThan(0.05)
  expect(ratio, 'the bounce is thickened by the previous take').toBeLessThan(1.107)
  // #1647 — a render over live audio must not leave an uncaught error behind (#1639).
  await expectNoUncaught(page)
})

test('a bounce from a quiet graph reads at the reference level', async ({ page }) => {
  test.setTimeout(120_000)
  await openBounceModal(page)
  await page.getByRole('button', { name: `${BOUNCE_SECONDS}s` }).click()
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  const download = await downloadPromise
  // The reference the arm above is measured against. Pinned as a band so a
  // gain or pattern change moves this arm first, rather than silently
  // invalidating the +15.8% / +7.0% figures that depend on it.
  expect(headRmsOf((await download.path())!, 1500)).toBeGreaterThan(0.130)
})

/**
 * #1356 item 2 — the menu and the palette must agree about availability.
 *
 * `stave.audio.bounce` has always been gated (`when: canBounce()`), so the
 * palette hides it on a tab with no recordable runtime. The menu item was not:
 * it opened the modal and let the user pick a length before admitting, via a
 * toast, that it could not bounce. Only strudel and sonicpi are wired to a
 * runtime, so a hydra tab is the case.
 */
test('the Bounce menu item is disabled on a tab with no audio runtime', async ({ page }) => {
  const hydra = page.locator('[data-file-tree-item*="hydra"]').first()
  await expect(hydra).toHaveCount(1)
  await hydra.dblclick()
  await page.waitForTimeout(800)

  await page.getByRole('button', { name: 'File', exact: true }).click()
  await expect(page.getByText('Bounce to WAV...')).toBeDisabled()
})

/**
 * #1651 — the LIVE capture path, driven through the real dialog.
 *
 * Since #1631 a Strudel file always renders offline from the File menu, so no
 * browser arm reached the live capture any more: the arms that pinned "stopping
 * early keeps what was recorded" were re-pointed at the render above, and the
 * path kept only unit coverage (`BounceModal`'s readout, `LiveRecorder`'s
 * keep-what-was-captured). It is still what runs for any engine that cannot
 * render its loaded document, so it is shipped code with no end-to-end test.
 *
 * `__staveForceLiveBounce` makes the bounce handle report no offline support —
 * the same shape as `__staveForceBrokenVizWorker`, which forces the viz
 * fallback so a test can observe the real path rather than the trigger logic.
 * The app below it is untouched: the dialog, the recorder, the transport and
 * the save are exactly what a non-rendering engine gets.
 *
 * ⚠ EVERY ARM HERE PASSES ON THE OFFLINE PATH TOO if the force does not take —
 * a download still arrives, still full length, still not silent. So each one
 * asserts something only a live take can produce (the wall clock, the Recording
 * phase, a short take from Stop), and the first arm pins the force itself.
 */
async function forceLiveBounce(page: import('@playwright/test').Page) {
  // Every `__stave*` hook is gated on `__STAVE_E2E__`, which has to be in the
  // page before its first line — so this is an init script and a reload, the
  // same preamble the render-hold arms above use. The file's other arms need
  // no hook at all, which is why the flag is not set for the whole suite.
  await page.addInitScript(() => {
    ;(window as unknown as { __STAVE_E2E__: boolean }).__STAVE_E2E__ = true
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
  const forced = await page.evaluate(
    () => (window as unknown as { __staveForceLiveBounce?: () => boolean }).__staveForceLiveBounce?.() ?? false,
  )
  expect(forced, '__staveForceLiveBounce hook present').toBe(true)
}

/**
 * A WAV's own length in seconds, read from its header rather than assumed.
 *
 * ⚠ Deliberately NOT frames against a guessed rate (#1401). The same take is
 * 352,800 frames on a 44.1kHz device and 384,000 on a 48kHz one, so a frame
 * threshold measures the sound card as much as the bounce. The header carries
 * the rate at byte 24; dividing by it makes these arms say what they mean.
 */
function secondsOf(path: string): number {
  return framesOf(path) / readFileSync(path).readUInt32LE(24)
}

test.describe('the live capture path (#1651)', () => {
  test('the dialog says a live bounce costs what it plays', async ({ page }) => {
    await forceLiveBounce(page)
    await openBounceModal(page)
    const dialog = page.getByRole('dialog', { name: 'Bounce to WAV' })

    // The live sentence, which the offline copy ("faster than real time")
    // cannot produce — so this is also the proof the force reached the handle.
    await expect(dialog.getByText(/records the live output/)).toBeVisible()
    // Stems render offline only, so the choice must be gone with it.
    await expect(dialog.getByTestId('bounce-export-kind')).toHaveCount(0)
  })

  test('a live bounce takes as long as it plays and saves the full length', async ({ page }) => {
    test.setTimeout(120_000)
    await forceLiveBounce(page)
    await openBounceModal(page)
    await page.getByRole('button', { name: `${BOUNCE_SECONDS}s` }).click()

    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
    const startedAt = Date.now()
    await page.getByRole('button', { name: 'Start Bounce' }).click()
    const download = await downloadPromise
    const wallSeconds = (Date.now() - startedAt) / 1000
    const path = (await download.path())!
    const seconds = secondsOf(path)
    const rms = rmsOf(path)
    console.log(`[#1651 live] ${seconds.toFixed(3)}s of audio in ${wallSeconds.toFixed(1)}s of wall clock, rms=${rms.toFixed(4)}`)

    expect(
      {
        // Real time is the path's defining cost: a render of 8s lands in about
        // a second, so this cannot pass on the offline path.
        realTime: wallSeconds >= BOUNCE_SECONDS - 1,
        // The recorder counts FRAMES, not the clock (#1401), so the take is the
        // length that was asked for — within a single 4096-frame block.
        fullLength: Math.abs(seconds - BOUNCE_SECONDS) < 0.1,
        audible: rms > 0.02,
      },
      `${seconds.toFixed(3)}s in ${wallSeconds.toFixed(1)}s, rms ${rms.toFixed(4)}`,
    ).toEqual({ realTime: true, fullLength: true, audible: true })
    // #1647 — the live path holds the transport for the whole take (#1639).
    await expectNoUncaught(page)
  })

  test('the recording readout moves while the take runs', async ({ page }) => {
    test.setTimeout(120_000)
    await forceLiveBounce(page)
    await openBounceModal(page)
    await page.getByRole('button', { name: '30s' }).click()

    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
    await page.getByRole('button', { name: 'Start Bounce' }).click()
    const dialog = page.getByRole('dialog', { name: 'Bounce to WAV' })

    // The phase itself: an offline render shows "Rendering…" and never this.
    await expect(dialog.getByText(/^Recording — /)).toBeVisible({ timeout: 30_000 })
    const bar = dialog.getByRole('progressbar')
    await expect(bar).toHaveAttribute('aria-valuemax', '30')
    // Near zero when the bar appears — so what the poll below sees is the
    // readout MOVING, not a bar that was already part-filled when it arrived.
    // (It is too coarse to be the detector for #1356's settle, which is about a
    // second: `LiveRecorder`'s own unit tests own that.)
    expect(Number(await bar.getAttribute('aria-valuenow'))).toBeLessThan(3)
    // ...and then moves, which is the readout this arm exists for.
    await expect
      .poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(4)
    await expect(dialog.getByText(/of 0:30/)).toBeVisible()

    // Leave nothing running behind the arm: Stop resolves the take at once.
    await dialog.getByRole('button', { name: 'Stop' }).click()
    await downloadPromise
  })

  /**
   * The behaviour #1631 removed the arm for: Stop is not Cancel on this path.
   * `LiveRecorder` resolves with what it captured, so the file is shorter —
   * and it must still be AUDIBLE, because the encoder lets an aborted take be
   * silent (`allowSilence: aborted`), which is exactly how "kept a shorter
   * take" could pass while keeping nothing.
   */
  test('stopping early keeps a shorter take, and it is not silent', async ({ page }) => {
    test.setTimeout(120_000)
    await forceLiveBounce(page)
    await openBounceModal(page)
    await page.getByRole('button', { name: '300s' }).click()

    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
    await page.getByRole('button', { name: 'Start Bounce' }).click()
    const dialog = page.getByRole('dialog', { name: 'Bounce to WAV' })
    const bar = dialog.getByRole('progressbar')
    await expect(bar).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(4)

    await dialog.getByRole('button', { name: 'Stop' }).click()
    const download = await downloadPromise
    const path = (await download.path())!
    const seconds = secondsOf(path)
    const rms = rmsOf(path)
    console.log(`[#1651 stop] kept ${seconds.toFixed(3)}s of a 300s take, rms=${rms.toFixed(4)}`)

    expect(
      { shorter: seconds < 60, keptWhatPlayed: seconds > 3, audible: rms > 0.02 },
      `${seconds.toFixed(3)}s, rms ${rms.toFixed(4)}`,
    ).toEqual({ shorter: true, keptWhatPlayed: true, audible: true })
    await expect(
      page.locator('[data-testid="toast"]').filter({ hasText: 'stopped early' }),
    ).toBeVisible({ timeout: 10_000 })
  })
})
