/**
 * Regression: a Play that lands while the engine is still initialising must
 * still produce a running transport (#815 / #1185 / #1171).
 *
 * THE DEFECT. `StrudelEngine.init()` had no in-flight guard, so overlapping
 * callers each ran the whole init body — and the body assigns `this.repl` near
 * its end. Opening the app with the Song view mounted fans out five concurrent
 * inits; if one of them finishes AFTER `play()` has started the scheduler, it
 * replaces the playing repl with a fresh one nobody started. The old repl keeps
 * making sound while every position reader sees `scheduler.started === false`,
 * `pattern` unset and `now === 0` — so the playhead is correctly withheld and
 * the LCD prints its no-position placeholder.
 *
 * ⚠ THIS SPEC IS ITS OWN TRAP: EVERY MILLISECOND BEFORE PLAY HEALS IT.
 * The failure only exists while init is still in flight. Roughly 2.8s of
 * pre-Play work — a settle wait, a sampling loop, a `waitFor` on something the
 * app publishes late — is enough for the mount path to finish, and then the
 * defect cannot occur at all. A version of this spec that boots, waits, then
 * plays passes with the bug fully present, which is worse than having no spec:
 * it reports coverage it does not have.
 *
 * So the boot below is the MINIMUM that lets a real user gesture land — the
 * panel exists, an editor exists — and Play follows immediately. Do not add
 * waits, retries, sampling, or readiness polls between `bootShell` and `play`.
 * Everything after the keypress is free: by then the race is already decided.
 *
 * MEASURED FAILURE RATE BEFORE THE FIX: 5/5 in one batch, 2/3 in another —
 * written and watched failing against the unfixed engine, because a race test
 * that has never failed is not a regression test. The rate is not 100%: the
 * engine log showed the passing runs were the ones where `play()` happened to
 * start the LAST repl init built, so nothing was left to overwrite it. That
 * residual is the defect's own coin-flip and it is gone once init runs once —
 * after the fix this spec is deterministic, so a flake here is a real signal,
 * not this test being moody.
 *
 * WHY IT ASSERTS MOVEMENT, NOT JUST PRESENCE. A playhead pinned at cycle 0 is
 * indistinguishable from a live one in a single sample, and the whole defect is
 * a transport that exists but does not advance. The position readout must
 * CHANGE, or a frozen clock would pass.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

const STORAGE_KEYS = {
  height: 'stave:bottomPanel.height',
  open: 'stave:bottomPanel.open',
  activeTabId: 'stave:bottomPanel.activeTabId',
} as const

/** Mount the Song view at load — this is the arm that fans out the extra inits. */
async function preOpenDrawer(page: Page): Promise<void> {
  await page.addInitScript(
    ([heightKey, openKey, activeKey]: readonly string[]) => {
      try {
        window.localStorage.setItem(heightKey, '320')
        window.localStorage.setItem(openKey, 'true')
        window.localStorage.setItem(activeKey, 'musical-timeline')
      } catch {
        /* ignore */
      }
    },
    [STORAGE_KEYS.height, STORAGE_KEYS.open, STORAGE_KEYS.activeTabId],
  )
}

/** The minimum that makes a real gesture possible. Nothing more — see the header. */
async function bootShell(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
        .monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 20_000 },
  )
}

/**
 * Play the way a user does. A programmatic `editor.focus()` carries no user
 * gesture and the shortcut silently does nothing (#885), so the click is load
 * bearing, not ceremony.
 */
async function play(page: Page): Promise<void> {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+Enter`)
}

test('a Play racing engine init still leaves the transport running and the playhead drawn', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await preOpenDrawer(page)
  await bootShell(page)
  await play(page) // <- immediately. Any delay here and the race cannot occur.

  // The Song view is mounted from the start; this only confirms the arm is the
  // one we think it is, so a failure below can never be "the view wasn't there".
  await expect(page.locator('[data-full-song="root"]')).toBeVisible({ timeout: 15_000 })

  // The symptom, stated positively: a playhead exists. Unfixed, the position
  // chain bottoms out in an orphaned repl and this element is never rendered.
  await expect(page.locator('[data-full-song="playhead"]')).toHaveCount(1, { timeout: 15_000 })

  // ...and the transport is genuinely advancing, not parked at zero. Read the
  // menubar position twice; it is a different ref chain from the playhead, so
  // agreement between them is worth something.
  const lcd = page.locator('[data-stave-lcd-pos]')
  await expect(lcd).toBeVisible({ timeout: 10_000 })
  // #2256 — Play loads the first cycles' sounds before the clock starts (at most
  // 2.5 s), so the position can still read "—" for that long after the playhead
  // appears. What this guards is a clock that never starts, so it waits past that.
  await expect
    .poll(async () => (await lcd.textContent())?.trim() ?? '', { timeout: 10_000 })
    .not.toContain('—')
  const first = (await lcd.textContent())?.trim() ?? ''
  expect(first, 'transport reports no position — the clock is dead').not.toContain('—')

  await expect
    .poll(async () => (await lcd.textContent())?.trim() ?? '', {
      timeout: 10_000,
      message: 'transport position never changed — the playhead exists but is frozen',
    })
    .not.toBe(first)

  expect(errors, `page errors during the raced play:\n${errors.join('\n')}`).toEqual([])
})
