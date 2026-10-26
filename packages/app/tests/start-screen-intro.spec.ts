/**
 * #2229 — the intro film on the start screen plays in place.
 *
 * Stave's page is cross-origin isolated, so it may only frame YouTube's player
 * if the frame is credentialless: the player is not isolated itself (it sends
 * COEP report-only). Passed as a JSX prop, `credentialless=""` was dropped by
 * Next's React, which lists it as a boolean attribute, and the frame was
 * blocked: "www.youtube-nocookie.com refused to connect".
 *
 * The embed is served by a stub with YouTube's relevant property, no COEP, so
 * the frame is blocked exactly when it isn't credentialless, with no network.
 */
import { test, expect } from '@playwright/test'
import { bootApp } from './_appBoot'

const EMBED = 'https://www.youtube-nocookie.com/embed/'

test('Watch the intro plays the film in the start screen, credentialless', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__STAVE_START_SCREEN__ = true }) // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.route(`${EMBED}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p id="film">stub film</p>' }))
  const blocked: string[] = []
  page.on('requestfailed', (r) => { if (r.url().startsWith(EMBED)) blocked.push(r.failure()?.errorText ?? '?') })

  await bootApp(page)
  // the case this guards: an isolated page in a browser that can frame without credentials
  expect(await page.evaluate(() => [window.crossOriginIsolated, 'credentialless' in HTMLIFrameElement.prototype])).toEqual([true, true])

  await page.locator('[data-start-screen="play"]').click()
  const film = page.locator('[data-start-screen="film"]')
  await expect(film).toHaveAttribute('credentialless', '')
  await expect(film).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/LoVfu-FCTAg/)
  await expect(page.frameLocator('[data-start-screen="film"]').locator('#film')).toHaveText('stub film', { timeout: 10_000 })
  expect(blocked).toEqual([])
})
