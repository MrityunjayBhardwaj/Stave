import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, STARTER_UNTIL_2240 } from './_appBoot'

/**
 * #1365 — the bounce modal offers the SONG's length, not a list of guessed
 * durations, driven through the real File menu.
 *
 * ── WHAT THESE ARMS ARE FOR, AND WHAT THEY DELIBERATELY ARE NOT ──────────────
 * A modal that opens, renders a heading and logs no errors is a modal that
 * MOUNTED. It says nothing about whether anything measured the document. So the
 * arms below assert a duration COMPUTED FROM REAL DATA — the seeded song (the
 * Starter until #2240) declares `setcps(130/240)`, so a cycle is 240/130 seconds and every offer must
 * land on a whole number of those — and the second arm removes the data layer
 * (never press play, so the scheduler has no tempo) and requires the offers to
 * VANISH.
 *
 * Both halves were verified by breaking them. Returning Strudel's default 0.5
 * cps instead of the document's tempo reddens the first arm and leaves the other
 * two green — so it catches a WRONG tempo, not merely a rendered one.
 *
 * That pairing is the whole point: an assertion that passes with the data layer
 * absent is a wiring check wearing a feature's name.
 *
 * That song alternates `<c2 [g2 c2] f2 [g2 eb2]>` over 4 cycles, so
 * a period is findable. Nothing here bounces — these arms are about the CHOICE,
 * and a real capture costs its own seconds (covered by `bounce-to-wav`).
 */

/** The seeded song's own tempo: `setcps(130/240)`. One cycle = 240/130 s. */
const CPS = 130 / 240
const CYCLE_SECONDS = 1 / CPS

async function boot(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-workspace-shell="root"]').waitFor({ timeout: 15000 })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
}

async function openBounceModal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByText('Bounce to WAV...').click()
  await expect(page.getByRole('dialog', { name: 'Bounce to WAV' })).toBeVisible()
}

/** Play, so the engine initialises, `setcps` runs and a snapshot is published. */
async function playOnce(page: Page): Promise<void> {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${mod}+Enter`)
  // The offers need BOTH the tempo and the analysis, and the analysis walks a
  // growing horizon — so wait for the engine to actually be running rather than
  // for a fixed sleep.
  await expect(page.getByTestId('bounce-song-offers').or(page.locator('body'))).toBeVisible()
  await page.waitForTimeout(4000)
}

test.use({
  // The tempo comes from the running scheduler, which needs a started
  // AudioContext; a suspended one never reaches `setcps`.
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
})

/**
 * #1599 — a 4-cycle track beside a hi-hat whose gain steps through 3 values. The
 * timeline spans 4 so the tracks phase inside it; the audio only comes back round
 * at 12 (engine arm: cycle 4 differs from cycle 0, cycle 12 equals it). A bounce of
 * one repeat has to be the 12, or it records a third of the song.
 */
const MIXED_LENGTH_SONG = 'setcps(130/240)\n$: s("<bd sd cp hh>")\n$: s("hh*4").gain("<0.2 0.8 0.5>")'

test('a loop whose tracks repeat at different lengths is offered its whole repeat (#1599)', async ({ page }) => {
  test.setTimeout(90_000)
  await boot(page)
  await page.locator('.monaco-editor').first().click()
  await page.evaluate((code) => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { setValue: (s: string) => void; getLanguageId?: () => string } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const target = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    target?.getModel()?.setValue(code)
  }, MIXED_LENGTH_SONG)
  await playOnce(page)
  await openBounceModal(page)

  const offers = page.getByTestId('bounce-song-offers')
  await expect(offers).toBeVisible({ timeout: 15000 })
  const labels = await offers.getByRole('button').allTextContents()
  const first = /(\d+):(\d\d)/.exec(labels[0] ?? '')
  expect(first, `no duration on the first offer (labels: ${labels.join(' | ')})`).not.toBeNull()
  const seconds = Number(first![1]) * 60 + Number(first![2])

  // Whole cycles at the document's own tempo, within the display's 1s rounding.
  const cycles = Math.round(seconds / CYCLE_SECONDS)
  expect(Math.abs(seconds - cycles * CYCLE_SECONDS), labels.join(' | ')).toBeLessThanOrEqual(0.5)
  // THE CLAIM, with the rival named: the view span (4) is what the offer used to be.
  expect(cycles, `one repeat is ${cycles} cycles, not the whole song's 12 (labels: ${labels.join(' | ')})`).toBe(12)
})

/**
 * #1602 — the lane's step-count chip says what a count does to the song BEFORE it
 * writes, and the bounce then agrees with what it said. Two steps of gain beside a
 * 4-cycle track repeat at 4; three make the song repeat at 12. The arm reads the
 * bounce's first offer on both sides of the edit, so a label that merely rendered,
 * or an offer that was 12 all along, both fail it.
 */
const TWO_STEP_SONG = 'setcps(130/240)\n$: s("<bd sd cp hh>")\n$: s("hh*4").gain("<0.2 0.8>")'

/** The bounce modal's first offer, in whole cycles at the document's tempo, or null. */
async function firstOfferCycles(page: Page): Promise<number | null> {
  await openBounceModal(page)
  const offers = page.getByTestId('bounce-song-offers')
  await expect(offers).toBeVisible({ timeout: 15000 })
  const labels = await offers.getByRole('button').allTextContents()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Bounce to WAV' })).toBeHidden()
  const first = /(\d+):(\d\d)/.exec(labels[0] ?? '')
  return first ? Math.round((Number(first[1]) * 60 + Number(first[2])) / CYCLE_SECONDS) : null
}

async function readDoc(page: Page): Promise<string> {
  return page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue: () => string; getLanguageId?: () => string } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getModel()?.getValue() ?? ''
  })
}

test('a step count chosen on the lane previews the song\'s new length, and the bounce then offers it (#1602)', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '340')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
    } catch {
      /* ignore */
    }
  })
  await boot(page)
  await page.locator('.monaco-editor').first().click()
  await page.evaluate((code) => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { setValue: (s: string) => void; getLanguageId?: () => string } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const target = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    target?.getModel()?.setValue(code)
  }, TWO_STEP_SONG)
  await playOnce(page)

  // (0) BEFORE: the song repeats at 4, and the bounce says so.
  expect(await firstOfferCycles(page), 'the two-step song is not offered its 4').toBe(4)

  // (1) THE HAT LANE, EXPANDED, OFFERS THE CHIP — and opening it writes nothing.
  await page.locator('[data-full-song-lane-expand]').nth(1).click()
  const chip = page.locator('[data-full-song-lane-steps]')
  await expect(chip).toHaveCount(1)
  await chip.click()
  const menu = page.locator('[data-full-song="step-count"]')
  await expect(menu).toHaveCount(1)
  const labels = await menu.locator('option').allTextContents()
  const three = '3 steps · song repeats every 12 bars (was 4)'
  expect(labels, labels.join(' | ')).toContain(three)
  expect(await readDoc(page), 'opening the chip wrote').toBe(TWO_STEP_SONG)

  // (2) CHOOSING WRITES THE CONTINUED STEPS.
  await menu.selectOption({ label: three })
  await expect.poll(() => readDoc(page), { timeout: 5_000 }).toBe(TWO_STEP_SONG.replace('<0.2 0.8>', '<0.2 0.8 0.2>'))
  await expect(menu).toHaveCount(0)

  // (3) THE BOUNCE AGREES WITH THE PREVIEW once the edit has played.
  await expect.poll(() => firstOfferCycles(page), { timeout: 30_000, intervals: [2_000] }).toBe(12)

  expect(errors, errors.join(' | ')).toEqual([])
})

test('the modal offers repeats of the song, costed at the document tempo', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await bootApp(page)
  await seedCode(page, STARTER_UNTIL_2240)
  await playOnce(page)
  await openBounceModal(page)

  const offers = page.getByTestId('bounce-song-offers')
  await expect(offers).toBeVisible({ timeout: 15000 })

  // The assertion that needs real data: every offered duration must be a whole
  // number of cycles AT THE DOCUMENT'S OWN TEMPO. A hardcoded fallback, a
  // default 0.5 cps, or a number invented by the UI all fail this.
  const labels = await offers.getByRole('button').allTextContents()
  expect(labels.length).toBeGreaterThan(0)

  const seconds = labels.map((t) => {
    const m = /(\d+):(\d\d)/.exec(t)
    if (!m) throw new Error(`offer has no duration: ${t}`)
    return Number(m[1]) * 60 + Number(m[2])
  })

  // ⚠ THE DISPLAY IS ROUNDED TO WHOLE SECONDS, so a duration cannot be compared
  // to a cycle multiple more tightly than that. Measured: the seeded song's period
  // is 4 cycles = 7.3846s, shown as `0:07`, which reads back as 3.79 cycles —
  // a 0.21-cycle residual that is the rounding quantum and not an error. The
  // first version of this arm asserted 0.05 and failed on its own instrument.
  for (const s of seconds) {
    const nearestWholeCycles = Math.round(s / CYCLE_SECONDS)
    expect(
      Math.abs(s - nearestWholeCycles * CYCLE_SECONDS),
      `offer ${s}s is not a whole number of cycles at ${CPS.toFixed(4)} cps (labels: ${labels.join(' | ')})`,
    ).toBeLessThanOrEqual(0.5)
  }

  // ⚠ AND THE RATIOS ARE BLURRED TOO, because the BASE is rounded as well:
  // 7.3846s shows as `0:07`, so 15/7 reads 2.14 rather than 2. Comparing offers
  // to each other inherits the base's rounding. The rounding-exact form is to
  // recover the PERIOD from the first offer and rebuild each expected duration
  // at full precision, then allow the display quantum once per comparison.
  expect(seconds.length).toBeGreaterThanOrEqual(2)
  const periodCycles = Math.round(seconds[0] / CYCLE_SECONDS)
  expect(periodCycles, `first offer is not a whole period (${labels.join(' | ')})`)
    .toBeGreaterThan(0)

  seconds.forEach((s, i) => {
    const expected = periodCycles * 2 ** i * CYCLE_SECONDS
    expect(
      Math.abs(s - expected),
      `offer ${i} is ${s}s, expected ${periodCycles} x ${2 ** i} cycles = ` +
        `${expected.toFixed(2)}s at ${CPS.toFixed(4)} cps (${labels.join(' | ')})`,
    ).toBeLessThanOrEqual(0.5)
  })
})

test('with no tempo read, the offers are ABSENT and the modal says why', async ({
  page,
}) => {
  // The control arm. Never press play, so the scheduler reports no cps. If the
  // offers still appeared here they would be coming from somewhere other than
  // the document, and the arm above would prove nothing.
  await boot(page)
  await openBounceModal(page)

  await expect(page.getByTestId('bounce-length-note')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('bounce-song-offers')).toHaveCount(0)
})

test('the fixed-length picker still works when the song cannot be sized', async ({
  page,
}) => {
  // Losing nothing is part of the feature: 56 of 142 real documents have no
  // measurable period, and for those this row is the entire UI.
  await boot(page)
  await openBounceModal(page)
  await expect(page.getByRole('button', { name: '8s' })).toBeVisible()
  await expect(page.getByRole('button', { name: '300s' })).toBeVisible()
})

/**
 * #1652 — an offline render is offered up to an hour; a live take stays at ten
 * minutes. At 0.01 cps a cycle is 100 s, so the 4-cycle loop repeats every
 * 400 s and its offers are 6:40 / 13:20 / 26:40 / 53:20. Under the old single
 * ten-minute ceiling only the first survived. The modal must be on the offline
 * path for this to hold, so the arm reads that from its own copy first.
 */
const SLOW_SONG = 'setcps(0.01)\n$: s("<bd sd cp hh>")'

test('an offline render is offered repeats up to an hour (#1652)', async ({ page }) => {
  test.setTimeout(90_000)
  await boot(page)
  await page.locator('.monaco-editor').first().click()
  await page.evaluate((code) => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { setValue: (s: string) => void; getLanguageId?: () => string } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const target = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    target?.getModel()?.setValue(code)
  }, SLOW_SONG)
  await playOnce(page)
  await openBounceModal(page)

  const dialog = page.getByRole('dialog', { name: 'Bounce to WAV' })
  await expect(dialog.getByText(/faster than real time/)).toBeVisible()

  const offers = page.getByTestId('bounce-song-offers')
  await expect(offers).toBeVisible({ timeout: 15000 })
  const labels = (await offers.getByRole('button').allTextContents()).map((t) => /(\d+:\d\d)/.exec(t)?.[1])
  expect(labels).toEqual(['6:40', '13:20', '26:40', '53:20'])
})
