/**
 * #1667 — a track the user named `d2:` must not take the name the track below it
 * was going to be given.
 *
 * `d{N}` is the name a track gets when it has no label. It was decided one track
 * at a time, so it was unique among the OTHER positional names but not against a
 * label the user had written — and `d2:` is a legal label. The two tracks then
 * shared one identity, which is not a display blemish: the row source
 * de-duplicates by it, so the Song Timeline drew ONE lane for the two statements
 * and the second track vanished from the arrangement.
 *
 * AnviDev observe gate: the unit tests pin the assignment (trackId.test.ts) and
 * the strips (stripModel.test.ts). This drives the REAL app and looks at what the
 * user looks at — how many lanes are drawn, what they are called, and whether the
 * two tracks are told apart by colour in both views.
 *
 * Modelled on `full-song-track-labels.spec.ts`, deliberately: that spec is the
 * NON-colliding control for the same two surfaces, and it must keep reading the
 * names it always read.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function bootShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '360')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
}

async function typeSongAndEval(page: Page, code: string): Promise<void> {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type(code, { delay: 8 })
  await page.waitForTimeout(400)
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(2200)
}

/**
 * The label `d2:` claims the name the SECOND statement would otherwise be given.
 * The third is unlabelled too and must not land on a name either of the first two
 * took — so the expected reading is `d2` (the user's own label, which never
 * moves), then `d3`, then `d4`.
 */
const SONG = ['d2: s("bd*2")', '$: s("hh*4")', '$: s("cp*2")'].join('\n')
const EXPECTED_NAMES = ['d2', 'd3', 'd4']
// What each SHOWS (#2151): the user's own `d2:` label, then `Track N` for the unnamed two.
const EXPECTED_SHOWN = ['d2', 'Track 3', 'Track 4']

test('a d2: label does not swallow the unlabelled tracks under it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(page, SONG)

  const timeline = await page.locator('[data-full-song-lane]').evaluateAll((els) =>
    els.map((e) => ({
      key: e.getAttribute('data-full-song-lane'),
      name: (e.querySelector('span:last-child') as HTMLElement | null)?.textContent ?? '',
      dot: ((): string => {
        const d = e.querySelector('[data-full-song-lane-dot]') as HTMLElement | null
        return d ? getComputedStyle(d).backgroundColor : ''
      })(),
    })),
  )

  // THE ROW COUNT IS THE POINT. Three statements, three lanes — the collision
  // used to leave two, which reads as "you wrote two tracks" for a three-track
  // song. Asserted before the names, because a wrong name is visible and a
  // missing row is not.
  expect(timeline).toHaveLength(3)
  expect(timeline.map((l) => l.key)).toEqual(EXPECTED_NAMES)
  expect(timeline.map((l) => l.name)).toEqual(EXPECTED_SHOWN)

  // ── Mixer console: the same three tracks, the same three names.
  const root = page.locator('[data-bottom-panel="root"]')
  await root.locator('[data-bottom-panel="toggle"]').click()
  await root.locator('role=tab[name="Mixer"]').click()
  const mixerPanel = root.locator('[data-bottom-panel-tab="mixer-console"]')
  await mixerPanel.locator('[data-mixer-strip-name]').first().waitFor({ timeout: 10_000 })

  const mixer = await mixerPanel.locator('[data-mixer-strip-id]').evaluateAll((els) =>
    els.map((e) => ({
      name: (e.querySelector('[data-mixer-strip-name]') as HTMLElement | null)?.textContent ?? '',
      dot: ((): string => {
        const d = e.querySelector('[data-mixer-strip-dot]') as HTMLElement | null
        return d ? getComputedStyle(d).backgroundColor : ''
      })(),
    })),
  )

  expect(mixer.map((m) => m.name)).toEqual(EXPECTED_SHOWN)

  // Distinct names are only half of it — the name is also the colour seed, so a
  // collision painted two different tracks the same colour in BOTH views.
  expect(new Set(mixer.map((m) => m.dot)).size).toBe(3)
  for (let i = 0; i < EXPECTED_NAMES.length; i++) {
    expect(timeline[i].dot, `lane ${EXPECTED_NAMES[i]} dot colour`).toBe(mixer[i].dot)
    expect(timeline[i].dot).toMatch(/^rgb/)
  }

  expect(errors, errors.join('\n')).toEqual([])
})

/**
 * #1673 — a `//`-commented copy of a named track sitting ABOVE the live one.
 *
 * A commented track keeps a row of its own (silent), so the numbering holds
 * still when a line is toggled. But it took the name verbatim, the row source
 * kept the FIRST track with a given name, and so the row called `p1` was the
 * COMMENT: two rows for three statements, and the statement the user was
 * editing had none. Every duplicate name in the 558-document archive was this
 * shape.
 *
 * The third track is NAMED on purpose: an unnamed track under a commented one is
 * numbered differently by the mixer (#1678), and this spec is about which track
 * owns `p1`, not about that.
 */
const COMMENTED_SONG = ['//p1: s("bd*2")', 'p1: s("hh*4")', 'p2: s("cp*2")'].join('\n')

test('a commented-out copy does not take the live track\'s name', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(page, COMMENTED_SONG)

  const timeline = await page.locator('[data-full-song-lane]').evaluateAll((els) =>
    els.map((e) => ({
      key: e.getAttribute('data-full-song-lane'),
      dot: ((): string => {
        const d = e.querySelector('[data-full-song-lane-dot]') as HTMLElement | null
        return d ? getComputedStyle(d).backgroundColor : ''
      })(),
    })),
  )

  // Three statements, three rows — the commented one silent under a number of
  // its own, the live `p1:` under its own name.
  expect(timeline.map((l) => l.key)).toEqual(['d1', 'p1', 'p2'])

  // The mixer has a strip only for what plays, so it lists the two live tracks.
  // The live `p1` is the SAME track in both views: same name, same colour.
  const root = page.locator('[data-bottom-panel="root"]')
  await root.locator('[data-bottom-panel="toggle"]').click()
  await root.locator('role=tab[name="Mixer"]').click()
  const mixerPanel = root.locator('[data-bottom-panel-tab="mixer-console"]')
  await mixerPanel.locator('[data-mixer-strip-name]').first().waitFor({ timeout: 10_000 })
  const mixer = await mixerPanel.locator('[data-mixer-strip-id]').evaluateAll((els) =>
    els.map((e) => ({
      name: (e.querySelector('[data-mixer-strip-name]') as HTMLElement | null)?.textContent ?? '',
      dot: ((): string => {
        const d = e.querySelector('[data-mixer-strip-dot]') as HTMLElement | null
        return d ? getComputedStyle(d).backgroundColor : ''
      })(),
    })),
  )
  expect(mixer.map((m) => m.name)).toEqual(['p1', 'p2'])
  expect(timeline[1].dot).toMatch(/^rgb/)
  expect(timeline[1].dot).toBe(mixer[0].dot)
  expect(timeline[2].dot).toBe(mixer[1].dot)

  expect(errors, errors.join('\n')).toEqual([])
})

/**
 * #1679 — a TRAILING `_` mutes a track too (`drums_:`, `$_:`).
 *
 * Strudel mutes an id that starts OR ends with `_`, and the engine's capture hook
 * already skipped both, so these tracks were silent. Everything else read only
 * the prefix: the timeline and mixer called them `drums_` and `$_`, showed them
 * unmuted, and the two `$_:` lines shared one name — so one of them lost its row.
 */
const SUFFIX_SONG = ['drums_: s("bd*2")', '$_: s("hh*4")', '$_: s("cp*2")', 'bass: s("sd*2")'].join('\n')

test('a trailing `_` reads as muted, and unmuting removes it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(page, SUFFIX_SONG)

  // Four statements, four rows; the three muted ones drawn as silenced.
  const lanes = await page.locator('[data-full-song-lane]').evaluateAll((els) =>
    els.map((e) => ({
      key: e.getAttribute('data-full-song-lane'),
      silenced: e.hasAttribute('data-full-song-lane-silenced'),
    })),
  )
  expect(lanes.map((l) => l.key)).toEqual(['drums', 'd2', 'd3', 'bass'])
  expect(lanes.map((l) => l.silenced)).toEqual([true, true, true, false])

  const root = page.locator('[data-bottom-panel="root"]')
  await root.locator('[data-bottom-panel="toggle"]').click()
  await root.locator('role=tab[name="Mixer"]').click()
  const mixerPanel = root.locator('[data-bottom-panel-tab="mixer-console"]')
  await mixerPanel.locator('[data-mixer-strip-name]').first().waitFor({ timeout: 10_000 })
  const strips = await mixerPanel.locator('[data-mixer-strip-id]').evaluateAll((els) =>
    els.map((e) => ({
      name: (e.querySelector('[data-mixer-strip-name]') as HTMLElement | null)?.textContent ?? '',
      muted: e.hasAttribute('data-mixer-strip-muted'),
    })),
  )
  expect(strips.map((s) => s.name)).toEqual(['drums', 'Track 2', 'Track 3', 'bass']) // #2151
  expect(strips.map((s) => s.muted)).toEqual([true, true, true, false])

  // The real gesture: Unmute on the strip removes the marker the label HAS.
  const mute = mixerPanel.locator('[data-mixer-strip-id="drums"] [data-mixer-strip-mute]')
  await expect(mute).toHaveAttribute('aria-label', 'Unmute drums')
  await mute.click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const eds = (window as unknown as { monaco: { editor: { getEditors: () => Array<{ getModel: () => { getValue: () => string } }> } } }).monaco.editor.getEditors()
        return eds[0].getModel().getValue().split('\n')[0]
      }),
    )
    .toBe('drums: s("bd*2")')

  expect(errors, errors.join('\n')).toEqual([])
})

/**
 * #1678 — a commented-out track above an unnamed one.
 *
 * The timeline keeps a (silent) row for the commented line, so numbers hold still
 * when a line is toggled; the Mixer has no strip for it. The Mixer used to number
 * only its own strips, so the `bd` track below read `d1` there and `d2` on the
 * timeline — two names, and two colours, for one track. Strips now take the
 * timeline's name for their statement.
 */
const COMMENTED_ANON_SONG = ['//$: s("hh*4")', '$: s("bd*2")', 'kick: s("cp*2")'].join('\n')

test('an unnamed track under a commented one has one name in both views', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(page, COMMENTED_ANON_SONG)

  const timeline = await page.locator('[data-full-song-lane]').evaluateAll((els) =>
    els.map((e) => ({
      key: e.getAttribute('data-full-song-lane'),
      dot: ((): string => {
        const d = e.querySelector('[data-full-song-lane-dot]') as HTMLElement | null
        return d ? getComputedStyle(d).backgroundColor : ''
      })(),
    })),
  )
  expect(timeline.map((l) => l.key)).toEqual(['d1', 'd2', 'kick'])

  const root = page.locator('[data-bottom-panel="root"]')
  await root.locator('[data-bottom-panel="toggle"]').click()
  await root.locator('role=tab[name="Mixer"]').click()
  const mixerPanel = root.locator('[data-bottom-panel-tab="mixer-console"]')
  await mixerPanel.locator('[data-mixer-strip-name]').first().waitFor({ timeout: 10_000 })
  const mixer = await mixerPanel.locator('[data-mixer-strip-id]').evaluateAll((els) =>
    els.map((e) => ({
      name: (e.querySelector('[data-mixer-strip-name]') as HTMLElement | null)?.textContent ?? '',
      dot: ((): string => {
        const d = e.querySelector('[data-mixer-strip-dot]') as HTMLElement | null
        return d ? getComputedStyle(d).backgroundColor : ''
      })(),
    })),
  )
  // no strip for the commented line; the `bd` track reads `d2`, as on the timeline
  expect(mixer.map((m) => m.name)).toEqual(['Track 2', 'kick']) // #2151: the id is d2
  expect(timeline[1].dot).toMatch(/^rgb/)
  expect(mixer[0].dot).toBe(timeline[1].dot)
  expect(mixer[1].dot).toBe(timeline[2].dot)

  expect(errors, errors.join('\n')).toEqual([])
})

/**
 * #1682 — statements that never play get no strip.
 *
 * Beside a `$:` or named track, Strudel plays only what registered and throws
 * away every other statement's value, so an assignment or a bare pattern above
 * the tracks is silent. The Mixer used to give each a strip — a fader over
 * nothing — under a name no timeline row has.
 */
const NEVER_PLAYS_SONG = ['window.stave1682 = 1', 's("cp*2")', '$: s("bd*2")', 'hats: s("hh*4")'].join('\n')

test('a statement that never plays has no Mixer strip', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await typeSongAndEval(page, NEVER_PLAYS_SONG)

  const timeline = await page.locator('[data-full-song-lane]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-full-song-lane')),
  )
  expect(timeline).toEqual(['d1', 'hats'])

  const root = page.locator('[data-bottom-panel="root"]')
  await root.locator('[data-bottom-panel="toggle"]').click()
  await root.locator('role=tab[name="Mixer"]').click()
  const mixerPanel = root.locator('[data-bottom-panel-tab="mixer-console"]')
  await mixerPanel.locator('[data-mixer-strip-name]').first().waitFor({ timeout: 10_000 })
  const mixer = await mixerPanel.locator('[data-mixer-strip-name]').allTextContents()
  // one strip per track that plays, named as on the timeline
  expect(mixer).toEqual(['Track 1', 'hats']) // #2151: the id is d1

  expect(errors, errors.join('\n')).toEqual([])
})
