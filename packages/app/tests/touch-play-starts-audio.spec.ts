/**
 * A tap on Play asks the browser to start audio, inside the tap (#1987, pinned by #2014).
 *
 * A phone browser starts a suspended audio context only when the page asks while the
 * tap is still being handled. The app asks in two places: Play itself does, first thing
 * and before it waits on anything; and, for a Play pressed before the engine had a
 * context, a listener asks on every touch until the context runs.
 *
 * ⚠ HEADLESS CHROMIUM CANNOT SHOW THIS UNAIDED. Its contexts are born `running` (observed
 * 2026-10-12, with and without `--autoplay-policy=document-user-activation-required`),
 * so the app sees nothing to start and never calls `resume()` — a spec that only looked
 * at the context's state would pass with both askers deleted. So each context is made to
 * READ as suspended, the way a phone's does, until it is asked during a click; and every
 * `resume()` is written down with the event being handled at that moment. The context
 * underneath is the real one and really is resumed.
 *
 * What this cannot say: that a real phone then makes sound, or that the browser counted
 * the moment as a gesture — a page driven by automation is granted that whatever it does
 * (`navigator.userActivation.isActive` read true for an event nobody made, observed
 * 2026-10-12), so it is not recorded. Both are real-device checks.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp } from './_appBoot'

interface ResumeCall {
  /** the event being handled when `resume()` was called, or null outside any */
  readonly during: string | null
  /** what the context said its state was */
  readonly state: string
}

async function recordResumeCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __resumeCalls: Array<{ during: string | null; state: string }>
      __contextsMade: number
      __realStates: () => string[]
      AudioContext: typeof AudioContext
    }
    w.__resumeCalls = []
    w.__contextsMade = 0
    const Real = w.AudioContext
    const started = new WeakSet<AudioContext>()
    const made: AudioContext[] = []
    const realState = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state')
    w.__realStates = () => made.map((c) => String(realState?.get?.call(c)))
    w.AudioContext = new Proxy(Real, {
      construct(target, args) {
        const ctx = new target(...(args as ConstructorParameters<typeof AudioContext>))
        w.__contextsMade += 1
        made.push(ctx)
        Object.defineProperty(ctx, 'state', {
          configurable: true,
          get: () => (started.has(ctx) ? realState?.get?.call(ctx) : 'suspended'),
        })
        return ctx
      },
    })
    const resume = Real.prototype.resume
    Real.prototype.resume = function (this: AudioContext) {
      const during = window.event ? window.event.type : null
      w.__resumeCalls.push({ during, state: this.state })
      if (during === 'click') started.add(this)
      return resume.call(this)
    }
  })
}

const resumeCalls = (page: Page): Promise<ResumeCall[]> =>
  page.evaluate(() => (window as unknown as { __resumeCalls: ResumeCall[] }).__resumeCalls)

/** Tap `whichPlay` on a freshly booted page and check who asked for audio, and when. */
async function tapPlayAndCheck(page: Page, whichPlay: (page: Page) => Locator): Promise<void> {
  await recordResumeCalls(page)
  await bootApp(page)
  const play = whichPlay(page)
  await expect(play).toBeVisible()

  // Nothing has been touched yet, so nothing has asked.
  expect(await resumeCalls(page)).toEqual([])

  // The engine takes hold of its context part-way through booting, and puts its touch
  // listener on in the same breath; a Play tapped before that has no context to ask
  // (the listener is what covers that case, on the next touch). So wait until the
  // listener answers: a key event with no key in it does nothing in the app, and is
  // one of the gestures the listener hears.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => document.dispatchEvent(new Event('keydown')))
        return (await resumeCalls(page)).length
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
  const before = (await resumeCalls(page)).length
  expect((await resumeCalls(page)).every((c) => c.during === 'keydown')).toBe(true)

  await play.tap()

  await expect.poll(async () => (await resumeCalls(page)).some((c) => c.during === 'click'), { timeout: 10_000 }).toBe(true)
  const calls = (await resumeCalls(page)).slice(before)

  // Play's own ask: during the click, of a context that was not running
  const fromPlay = calls.filter((c) => c.during === 'click')
  expect(fromPlay.length).toBeGreaterThan(0)
  expect(fromPlay[0]).toEqual({ during: 'click', state: 'suspended' })

  // the listener's ask: on the touch itself, which comes before the click
  const fromTouch = calls.filter((c) => c.during === 'pointerdown' || c.during === 'pointerup' || c.during === 'touchend')
  expect(fromTouch.length).toBeGreaterThan(0)
  expect(calls.indexOf(fromTouch[0])).toBeLessThan(calls.indexOf(fromPlay[0]))

  // and the real context under the stand-in is running, so the ask was not refused
  const states = await page.evaluate(() => (window as unknown as { __realStates: () => string[] }).__realStates())
  expect(states.length).toBeGreaterThan(0)
  expect(states.every((s) => s === 'running')).toBe(true)
}

test.describe('a tap on Play asks for audio inside the tap (#1987)', () => {
  test('Play asks while its own click is being handled, and the touch listener asks before it', async ({ page }) => {
    // the editor's Play: the only one there is, on a phone as on a tablet (#2035)
    const play = (p: Page): Locator => p.locator('[data-testid="strudel-chrome-transport"]')
    await tapPlayAndCheck(page, play)
    // and it really played: the same button now offers Stop
    await expect(play(page)).toHaveText(/Stop/, { timeout: 15_000 })
  })
})
