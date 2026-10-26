/**
 * Phone screens with notches and browser bars: nothing hidden behind them (#2007).
 *
 * A phone cuts into its screen — a notch or camera island, rounded corners, a home
 * indicator bar — and tells the page how much through `env(safe-area-inset-*)`. Those
 * read as zero unless the page asks to be laid out under the cut-outs in the first
 * place (`viewport-fit=cover`), which Stave did not. So this asks for three things:
 *
 *   - the page says `viewport-fit=cover`, and keeps pinch-zoom;
 *   - every control stays inside the safe area, upright and sideways;
 *   - on a phone the page itself cannot scroll or bounce, and a double tap does not
 *     zoom it.
 *
 * Chromium can be TOLD what the insets are (`Emulation.setSafeAreaInsetsOverride`),
 * so the second is measured here with a notch's numbers. That is a stand-in: what a
 * real notch, a real home indicator and a browser bar sliding away do is a device
 * check. WebKit has no such switch, so on the iPhone project only the first and the
 * third run.
 *
 * A tablet is not a phone: the last test says the page rules are not applied there.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp } from './_appBoot'

const PHONES = ['phone', 'phone-sideways', 'iphone']

/** an iPhone 14's cut-outs: upright, and turned with the notch on the left */
const UPRIGHT = { top: 47, left: 0, bottom: 34, right: 0 }
const SIDEWAYS = { top: 0, left: 47, bottom: 21, right: 47 }

interface Insets {
  readonly top: number
  readonly left: number
  readonly bottom: number
  readonly right: number
}

/** tell the browser its screen has these cut-outs; false where it cannot be told */
async function setInsets(page: Page, insets: Insets): Promise<boolean> {
  try {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets } as never)
  } catch {
    return false
  }
  // the override is only worth anything if the page can read it
  return page.evaluate((want) => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left)'
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    const got = { top: parseFloat(cs.paddingTop), bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft) }
    probe.remove()
    return got.top === want.top && got.bottom === want.bottom && got.left === want.left
  }, insets)
}

/** every visible control on the page that pokes outside the safe area */
function controlsOutside(page: Page, insets: Insets): Promise<{ total: number; outside: string[] }> {
  return page.evaluate((i) => {
    const safe = { top: i.top, left: i.left, right: window.innerWidth - i.right, bottom: window.innerHeight - i.bottom }
    // the part of a control that is drawn: its box cut by every ancestor that clips
    // its overflow. A control scrolled part-way out of a panel is drawn only up to
    // the panel's edge (the Mixer's strips, past the third, #2240); a panel that
    // itself runs under a cut-out still shows its controls there.
    const drawn = (el: Element) => {
      const b = el.getBoundingClientRect()
      let r = { top: b.top, left: b.left, right: b.right, bottom: b.bottom }
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a)
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
        const c = a.getBoundingClientRect()
        if (cs.overflowX !== 'visible') r = { ...r, left: Math.max(r.left, c.left), right: Math.min(r.right, c.right) }
        if (cs.overflowY !== 'visible') r = { ...r, top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) }
      }
      return { ...r, width: r.right - r.left, height: r.bottom - r.top }
    }
    const controls = [...document.querySelectorAll('button, [role="button"], [role="tab"], a[href], select, input')].filter((el) => {
      const r = drawn(el)
      if (r.width <= 0 || r.height <= 0) return false
      // on screen at all: a control scrolled out of a panel is that panel's business
      if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) return false
      const cs = getComputedStyle(el)
      return cs.visibility !== 'hidden' && cs.display !== 'none'
    })
    const outside = controls.filter((el) => {
      const r = drawn(el)
      // the middle of the control is what a finger aims at
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      return cx < safe.left || cx > safe.right || cy < safe.top || cy > safe.bottom || r.top < safe.top - 0.5 || r.bottom > safe.bottom + 0.5 || r.left < safe.left - 0.5 || r.right > safe.right + 0.5
    })
    const name = (el: Element): string => {
      const r = el.getBoundingClientRect()
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 24)
      return `${label} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`
    }
    return { total: controls.length, outside: outside.map(name) }
  }, insets)
}

test.describe('the page and the cut-outs of a phone screen (#2007)', () => {
  test('the page asks to be laid out under the cut-outs, and keeps pinch-zoom', async ({ page }) => {
    await bootApp(page)
    const content = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '')
    expect(content).toContain('viewport-fit=cover')
    expect(content).toContain('width=device-width')
    // zooming the whole page is an accessibility need: nothing here may forbid it
    expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/)
    expect(content).not.toMatch(/maximum-scale/)
  })

  test('every control is inside the safe area, with the bottom panel closed and open', async ({ page }, testInfo) => {
    test.skip(!['phone', 'phone-sideways'].includes(testInfo.project.name), 'only Chromium can be told the insets; the tablet has none to tell')
    const insets = testInfo.project.name === 'phone-sideways' ? SIDEWAYS : UPRIGHT
    await bootApp(page)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    expect(await setInsets(page, insets), 'the browser took the insets and the page can read them').toBe(true)

    const closed = await controlsOutside(page, insets)
    expect(closed.total, 'there are controls to measure').toBeGreaterThan(3)
    expect(closed.outside, 'bottom panel closed').toEqual([])

    // open a panel: upright it is the sheet's Mixer tab, sideways the view switch in the top bar
    await page.locator('[data-phone-top-bar] button, [data-bottom-panel="header"] [role="tab"]').filter({ hasText: 'Mixer' }).first().click()
    await expect(page.locator('[data-bottom-panel-tab="mixer-console"]')).toBeVisible()
    const open = await controlsOutside(page, insets)
    expect(open.total).toBeGreaterThan(closed.total - 1)
    expect(open.outside, 'bottom panel open').toEqual([])

    // and the drawer, which lies over everything
    await page.locator('[data-phone-top="drawer"]').click()
    await expect(page.locator('[data-phone-drawer-layer]')).toBeVisible()
    const drawer = await controlsOutside(page, insets)
    expect(drawer.outside, 'drawer open').toEqual([])
  })

  test('on a phone the page itself does not scroll or bounce, and a double tap does not zoom it', async ({ page }, testInfo) => {
    test.skip(!PHONES.includes(testInfo.project.name), 'the tablet is the next test')
    await bootApp(page)
    const rules = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement)
      const body = getComputedStyle(document.body)
      window.scrollTo(0, 200)
      return {
        htmlOverflow: html.overflowY,
        bodyOverflow: body.overflowY,
        htmlOverscroll: html.overscrollBehaviorY,
        bodyOverscroll: body.overscrollBehaviorY,
        touchAction: html.touchAction,
        scrolled: window.scrollY,
        taller: document.documentElement.scrollHeight - window.innerHeight,
      }
    })
    expect(rules.scrolled).toBe(0)
    expect(rules.taller).toBeLessThanOrEqual(0)
    expect(rules.htmlOverflow).toBe('hidden')
    expect(rules.bodyOverflow).toBe('hidden')
    expect(rules.htmlOverscroll).toBe('none')
    expect(rules.bodyOverscroll).toBe('none')
    // `manipulation` allows panning and pinch-zoom and nothing else: no double-tap zoom
    expect(rules.touchAction).toBe('manipulation')
  })

  test('a tablet is not a phone: the page rules are not applied there', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'tablet only')
    await bootApp(page)
    const rules = await page.evaluate(() => ({
      touchAction: getComputedStyle(document.documentElement).touchAction,
      overscroll: getComputedStyle(document.body).overscrollBehaviorY,
      phone: document.documentElement.hasAttribute('data-stave-phone'),
    }))
    expect(rules.phone).toBe(false)
    expect(rules.touchAction).toBe('auto')
    expect(rules.overscroll).toBe('auto')
  })
})
