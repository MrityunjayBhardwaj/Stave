/**
 * The resolver opens a real grid in the real app (#1240) — Playwright observation.
 *
 * Every other gate for this change asks a MODEL a question: does `chunkDetect`
 * name a span, does `routeSurface` pick a surface, does the coverage harness
 * score it. All of them run against `editor/src`. The browser runs
 * `editor/dist`, mounts `PatternPanel`, and is the only place that can answer
 * "does the musician actually get a grid" — which is the entire claim of the
 * issue and the one thing no vitest arm reaches, because nothing mounts the
 * panel.
 *
 * THE FIXTURE IS THE POINT. `s(drums)` carries no string literal of its own:
 * pre-#1240 the first-literal walk found nothing, `patternKind` returned null,
 * and the Pattern tab showed its standby hint. The content lives two statements
 * up, so this also exercises the cross-statement span whose freshness guard is
 * the riskiest part of the change.
 *
 * The CONTROL arm is what makes the win attributable: an identical document
 * whose head owns its literal inline was already editable before this change,
 * so it must be editable now too. A run where both arms fail is a broken
 * harness, not a broken feature — and one where only the control passes is the
 * pre-#1240 tree.
 *
 * ── TWO MECHANISMS, TWO KINDS OF ARM (#1249) ──────────────────────────────
 * #1240 is two decisions in sequence, and the first three arms reach only the
 * first of them:
 *
 *   1. WHICH SPAN does this unit own?   `chunkDetect.resolveMini`
 *   2. WHICH SURFACE does that span open?  `codeView/surface/surfaceRoute.chunkSurface`
 *
 * `patternKind.isStepChunk` returns `step` the moment `miniString !== null &&
 * headFn === 's'`, so every fixture with a CONTENT head routes at
 * `chunkSurface`'s first line and the resolver branch below it is never
 * reached. Unwiring mechanism 2 therefore leaves the three arms above GREEN —
 * which reads as "these arms are decoration" and is the opposite of the truth.
 *
 * The last two arms carry a SILENT head (`seq`), so the head decides nothing
 * and the content is asked. They come in a pair on purpose: drums must reach
 * the grid and notes must reach the roll, so the pair pins the DISCRIMINATION
 * rather than merely that a view opened. Either one alone would pass against a
 * router that always answered the same surface.
 *
 * ⚠ The fixture has to be a BOUND reference, not an inline string. A literal on
 * a silent head (`seq("bd sd hh cp")`) is `miniVia: 'literal'`, which
 * `chunkSurface` deliberately excludes — that shape has always landed in
 * standby and moving it is a separate decision with its own measurement.
 *
 * BREAK SIGNATURES, sorted for containment rather than assumed disjoint:
 *   unwire `chunkSurface`'s resolver branch -> the last two arms only
 *   unwire `resolveMini`                    -> four of five (all but CONTROL)
 * The break must reach `packages/editor/dist`, not just `src`, or the browser
 * stays green for a reason that has nothing to do with coverage.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '320')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'pattern')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 20_000 },
  )
}

/** set the document, evaluate it, then put the cursor on `caret` */
async function typeAndPoint(page: Page, code: string, caret: string): Promise<void> {
  await page.evaluate(
    ({ c, needle }) => {
      const monaco = (window as unknown as {
        monaco?: { editor?: { getEditors?: () => unknown[] } }
      }).monaco
      const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
        getModel: () => {
          getLanguageId?: () => string
          setValue: (s: string) => void
          getPositionAt: (o: number) => unknown
        } | null
        setPosition: (p: unknown) => void
        focus: () => void
      }>
      const target =
        editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
      const model = target?.getModel()
      model?.setValue(c)
      target?.focus()
      const at = c.indexOf(needle)
      if (model && at >= 0) target.setPosition(model.getPositionAt(at + 1))
    },
    { c: code, needle: caret },
  )
  await page.waitForTimeout(150)
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(250)
  // The panel binds to the cursor, and ⌘↵ can move focus — re-assert it.
  await page.evaluate(
    ({ c, needle }) => {
      const monaco = (window as unknown as {
        monaco?: { editor?: { getEditors?: () => unknown[] } }
      }).monaco
      const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
        getModel: () => { getLanguageId?: () => string; getPositionAt: (o: number) => unknown } | null
        setPosition: (p: unknown) => void
        focus: () => void
      }>
      const target =
        editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
      const model = target?.getModel()
      target?.focus()
      const at = c.indexOf(needle)
      if (model && at >= 0) target.setPosition(model.getPositionAt(at + 1))
    },
    { c: code, needle: caret },
  )
}

const grid = '[data-bottom-panel-tab="pattern"]'

test.describe('#1240 — a resolver-named span opens a grid in the real app', () => {
  test('CONTROL: an inline literal still opens the step grid', async ({ page }) => {
    await boot(page)
    await typeAndPoint(page, '$: s("bd sd hh cp").lpf(400)', '.lpf')
    await expect(page.locator(`${grid} [data-seq-cell]`).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('a BOUND reference opens the step grid, where it used to show standby', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
    })

    await boot(page)
    // No literal on the head call. The span lives in the declaration above.
    await typeAndPoint(page, 'const drums = "bd sd hh cp"\n$: s(drums).lpf(400)', '.lpf')

    const cells = page.locator(`${grid} [data-seq-cell]`)
    await expect(cells.first()).toBeVisible({ timeout: 15_000 })
    // Four steps × four lanes — the content of the DECLARATION, not of the
    // statement the cursor is in.
    expect(await cells.count()).toBeGreaterThanOrEqual(16)

    expect(errors).toEqual([])
  })

  test('a bound MELODY opens the piano roll, not the grid', async ({ page }) => {
    await boot(page)
    await typeAndPoint(page, 'const mel = "c3 e3 g3"\n$: note(mel).room(2)', '.room')
    await expect(page.locator(`${grid} [data-roll-cell]`).first()).toBeVisible({
      timeout: 15_000,
    })
    // The two surfaces are exclusive: seeing roll cells must mean no grid cells.
    expect(await page.locator(`${grid} [data-seq-cell]`).count()).toBe(0)
  })

  // ── the SURFACE half (#1249) ────────────────────────────────────────────
  // `seq` is not a content head, so `patternKind` answers null and the routing
  // falls through to `routeSurface`, which asks the content. These are the only
  // two arms in this file that execute that branch.

  test('a SILENT head with drum words opens the step grid', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
    })

    await boot(page)
    // No content head anywhere: `seq` says nothing about drums vs notes, and
    // the reference carries no literal. Only the CONTENT can decide this.
    await typeAndPoint(page, 'const drums = "bd sd hh cp"\n$: seq(drums).lpf(400)', '.lpf')

    const cells = page.locator(`${grid} [data-seq-cell]`)
    await expect(cells.first()).toBeVisible({ timeout: 15_000 })
    expect(await cells.count()).toBeGreaterThanOrEqual(16)
    // Exclusive, same as the head-routed pair — a router that opened both would
    // satisfy the visibility assertion above and mean nothing.
    expect(await page.locator(`${grid} [data-roll-cell]`).count()).toBe(0)

    expect(errors).toEqual([])
  })

  test('a SILENT head with note names opens the piano roll', async ({ page }) => {
    await boot(page)
    // Identical shape, different content. This is the arm that makes the pair a
    // test of DISCRIMINATION: a router hard-wired to `step` passes the previous
    // arm and fails this one.
    await typeAndPoint(page, 'const mel = "c3 e3 g3"\n$: seq(mel).room(2)', '.room')

    await expect(page.locator(`${grid} [data-roll-cell]`).first()).toBeVisible({
      timeout: 15_000,
    })
    expect(await page.locator(`${grid} [data-seq-cell]`).count()).toBe(0)
  })
})
