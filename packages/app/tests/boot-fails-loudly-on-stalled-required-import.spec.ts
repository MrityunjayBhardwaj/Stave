/**
 * boot-fails-loudly-on-stalled-required-import.spec.ts — REGRESSION GUARD for #1215.
 *
 * THE SIBLING OF #1214, AND THE HALF ITS FIX DID NOT COVER. #1214 bounded the
 * sample manifests, which are optional content — a stall there costs some banks
 * and boot carries on. The awaits ABOVE them are not optional: `initInternal`
 * loads nine Strudel modules with `import()`, and there is no engine without
 * them. Those were still unbounded, so the three properties that made #1214
 * fatal were all still in place for a different request:
 *
 *   1. the await is unbounded — a chunk request that never answers never settles;
 *   2. `init()` memoises its in-flight promise, so later callers join it;
 *   3. it never rejects, so no catch anywhere can see it.
 *
 * ⚠⚠ WHAT THIS FIX DOES AND DOES NOT BUY — MEASURED, because the first draft of
 * this very spec asserted something the fix cannot deliver.
 *
 * It removes properties 1 and 3: the step now gives up on a deadline and says
 * loudly which step failed. It also clears `init()`'s memo, so a later
 * evaluation really does start a fresh attempt — observable as a second
 * "tierFlags read at init".
 *
 * It does NOT make a stalled module import recoverable, and no deadline of ours
 * could. The retry was measured re-entering init and then failing at the same
 * step in the same 3s, having issued NO second network request: the module
 * registry memoises the dead in-flight import one layer BELOW this code,
 * exactly as `init()` memoised it one layer above. Only a reload clears that.
 * So the honest claim is "bounded and diagnosable", not "self-healing", and
 * this spec asserts only the former. Recovery-without-reload is #1218,
 * filed rather than quietly assumed here.
 *
 * On the unfixed build none of this happens: the await hangs, nothing is
 * reported, and there is no second init attempt to observe.
 */
import { test, expect, type Page } from '@playwright/test'

/**
 * One REQUIRED module chunk, held open. The transpiler is the cleanest target:
 * it is a single `await import()` on its own line rather than one of eight
 * inside a `Promise.all`, so a stall here is unambiguous about which await is
 * hanging.
 *
 * The chunk is found by what it DEFINES, not by its name. This spec used to
 * match `*strudel_transpiler*`, and Next 16.3 renamed dev chunks to hashes
 * (`node_modules__pnpm_12cirh3._.js`), so the glob matched nothing and the
 * spec failed its own non-vacuity check (#2132). A chunk that defines the
 * transpiler module is the target under either naming.
 *
 * Two chunks define it: its own, and the larger one `@strudel/mondo` loads in
 * the "strudel modules" step. Holding that one would stall the wrong step, so a
 * chunk that also defines mondo is let through. Measured on Next 16.2.1 and
 * 16.3.8: exactly one chunk passes this test on each.
 */
const CHUNK_GLOB = '**/_next/static/chunks/*.js'
const definesModule = (body: string, path: string) =>
  body.includes(`${path} [app-client] (ecmascript)", ((`)
const isTranspilerChunk = (body: string) =>
  definesModule(body, '@strudel/transpiler/dist/index.mjs') &&
  !definesModule(body, '@strudel/mondo/dist/mondough.mjs')

const SONG = 'arrange([2, s("bd")], [2, s("hh")])'

async function bootWithTimelineOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '340')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
    } catch {
      /* private-mode storage refusal is not this test's subject */
    }
  })
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
        .monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 20_000 },
  )
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 20_000 })
}

async function evaluateSong(page: Page): Promise<void> {
  await page.evaluate((code) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
      .monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
      focus: () => void
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    target?.getModel()?.setValue(code)
    target?.focus()
  }, SONG)
  await page.waitForTimeout(150)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
}

test.describe('engine boot fails loudly on a stalled REQUIRED module import (#1215)', () => {
  test('the stalled step gives up on a deadline, names itself, and init re-attempts', async ({
    page,
  }) => {
    test.setTimeout(120_000)

    let stallHits = 0
    // Every other chunk passes through untouched; the transpiler's is held
    // open: never fulfilled, never aborted.
    await page.route(CHUNK_GLOB, async (route) => {
      const response = await route.fetch()
      const body = await response.text()
      if (!isTranspilerChunk(body)) return route.fulfill({ response, body })
      stallHits += 1
      /* deliberately never settled — this IS the defect's trigger */
    })

    const bootFailures: string[] = []
    const initAttempts: string[] = []
    page.on('console', (msg) => {
      const t = msg.text()
      if (t.includes('boot step') && t.includes('@strudel/transpiler')) bootFailures.push(t)
      if (t.includes('tierFlags read at init')) initAttempts.push(t)
    })

    await bootWithTimelineOpen(page)
    await evaluateSong(page)

    // Non-vacuity FIRST: if the glob never matched, everything below is a
    // healthy boot wearing the costume of a survived outage.
    await expect
      .poll(() => stallHits, { timeout: 20_000, message: 'the required chunk was never intercepted' })
      .toBeGreaterThan(0)

    // THE ASSERTION THAT MATTERS. On the unfixed build this never arrives —
    // the await simply never settles and silence is the whole symptom.
    await expect
      .poll(() => bootFailures.length, {
        timeout: 20_000,
        message: 'the stalled boot step never reported itself — silence is the #1214 signature',
      })
      .toBeGreaterThan(0)
    expect(
      bootFailures.some((t) => /did not answer within \d+ms/.test(t)),
      'the failure should say it timed out, and after how long',
    ).toBe(true)

    // And the failure must not be remembered: a later evaluation has to be able
    // to START again, even though a stalled chunk cannot finish (see the header).
    const attemptsBefore = initAttempts.length
    await evaluateSong(page)
    await expect
      .poll(() => initAttempts.length, {
        timeout: 20_000,
        message: 'init did not re-attempt — a remembered failure is as dead as a hang',
      })
      .toBeGreaterThan(attemptsBefore)
  })
})
