import { test, expect, type Page } from '@playwright/test'
import { vizPixelStats } from './_vizFrames'

// Strudel-official viz methods (#174). Pasted Strudel viz code must work
// out of the gate, mirroring Strudel's inline-vs-fullscreen semantic:
//   - `._name()` (underscore) → inline viz zone
//   - `.name()`  (non-underscore) → Stave backdrop ("set bg") + UI update
// and NEVER strudel's own fullscreen `#test-canvas` (which Stave doesn't load).
//
// PIXELS ARE READ THROUGH THE COMPOSITOR (`vizPixelStats`), never
// `canvas.getContext('2d')` (#875). The viz renders in a worker to a
// `transferControlToOffscreen()` canvas (the default since #245), and a
// transferred canvas THROWS InvalidStateError on getContext — so every
// pixel probe in this file was dead from that day until it was re-pointed,
// and the dead probes hid a real bug (viz OPTIONS never crossed the worker
// boundary, so `{background:'#cc1133'}` below silently did nothing).

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function setCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = (window as any).monaco?.editor?.getEditors?.()?.[0]
    if (!e) return false
    e.getModel()?.setValue(c)
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(150)
}

async function runCode(page: Page): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).monaco?.editor?.getEditors?.()?.[0]?.focus())
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(2500)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
})

test('non-underscore .scope() pins the backdrop and updates the "set bg" indicator', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))

  await setCode(page, `$: note("c e g").s("sawtooth").scope()`)
  await runCode(page)

  // #347 removed the menubar bg-indicator; the real signal that a code-driven
  // backdrop pinned is the rendered backdrop node + its resolved file id.
  const bg = page.locator('[data-workspace-background]')
  await expect(bg).toHaveCount(1, { timeout: 6000 })
  await expect(bg.first()).toHaveAttribute('data-background-file-id', /.+/)
  // strudel's own fullscreen canvas must NOT be injected
  expect(await page.locator('canvas#test-canvas').count()).toBe(0)
  expect(errors).toEqual([])
})

test('non-underscore .pianoroll() resolves to "Piano Roll.p5" via normalized basename', async ({ page }) => {
  await setCode(page, `$: note("c e g").s("sawtooth").pianoroll()`)
  await runCode(page)
  await expect(page.locator('[data-workspace-background]')).toHaveCount(1, { timeout: 6000 })
})

test('backdrop .pianoroll({ opts }) threads options to the backdrop sketch (#214)', async ({ page }) => {
  // Non-underscore .pianoroll(opts) pins a backdrop that renders through
  // compiledVizProvider (not viewZones). Its options live in
  // inlineViz.backdropRequest.options and must reach the renderer's component
  // bag → stave.options. A custom `background` only paints if they do —
  // frame-independent, like the inline #215 check.
  // #cc1133 → strongly red-dominant, low green/blue.
  const redFrac = async () =>
    (await vizPixelStats(page, '[data-workspace-background] canvas',
      { rMin: 121, gMax: 79, bMax: 89 })).frac

  await setCode(page, `$: note("c4 e4 g4 c5").s("sawtooth").pianoroll({ background: '#cc1133' })`)
  await runCode(page)
  await page.locator('[data-workspace-background] canvas').first().waitFor({ timeout: 8000 })
  await expect.poll(redFrac, { timeout: 6000 }).toBeGreaterThan(0.4)

  // Control: no option → the (transparent) default backdrop is not red.
  await setCode(page, `$: note("c4 e4 g4 c5").s("sawtooth").pianoroll()`)
  await runCode(page)
  await expect.poll(redFrac, { timeout: 6000 }).toBeLessThan(0.05)
})

test('removing the non-underscore method clears the backdrop (code is source of truth)', async ({ page }) => {
  await setCode(page, `$: note("c e g").s("sawtooth").scope()`)
  await runCode(page)
  await expect(page.locator('[data-workspace-background]')).toHaveCount(1, { timeout: 6000 })

  // Remove the .scope() call and re-evaluate. Ctrl+Enter evaluates while
  // playing (#180), so runCode() alone is a fresh eval — this used to need an
  // explicit stop+play only because the keybinding was wired as a toggle.
  await setCode(page, `$: note("c e g").s("sawtooth")`)
  await runCode(page)
  await expect(page.locator('[data-workspace-background]')).toHaveCount(0, { timeout: 6000 })
})

test('.viz("name", { backdrop: true }) pins the backdrop as a code-override (#364/350b)', async ({ page }) => {
  // The inline API with the backdrop flag promotes a NAMED viz to the
  // backdrop slot — a code-override source alongside the bare `.scope()`.
  // SYNTH (sawtooth), not drum samples: samples don't load headless, so an
  // eval-error would gate onCodeBackdropChange and the backdrop would never
  // pin (P146). Observe the real DOM: data-workspace-background +
  // data-background-file-id (the resolved backdrop), not inference.
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))

  await setCode(page, `$: note("c e g").s("sawtooth").viz("spectrum", { backdrop: true })`)
  await runCode(page)

  const bg = page.locator('[data-workspace-background]')
  await expect(bg).toHaveCount(1, { timeout: 6000 })
  // The resolved backdrop file id is exposed on the rendered backdrop node.
  await expect(bg.first()).toHaveAttribute('data-background-file-id', /.+/)
  // No inline viz-zone for the flagged viz — it lives in the backdrop, not under the line.
  await expect(page.locator('[data-viz-zone-track]')).toHaveCount(0)
  expect(await page.locator('canvas#test-canvas').count()).toBe(0)
  expect(errors).toEqual([])
})

test('.viz("name") with NO backdrop flag stays an inline zone — no backdrop pin (#364 control)', async ({ page }) => {
  await setCode(page, `$: note("c e g").s("sawtooth").viz("spectrum")`)
  await runCode(page)
  // Inline zone present; backdrop NOT pinned.
  await expect(page.locator('[data-viz-zone-track]').first()).toBeVisible({ timeout: 6000 })
  await expect(page.locator('[data-workspace-background]')).toHaveCount(0)
})

test('inline viz zone anchors ABOVE a master all(x=>…) line and stays put when its gain is rewritten (#797)', async ({ page }) => {
  // A `$:`-with-inline-viz block above a master `all()` line: the block-end scan
  // must end the block at `).viz(...)`, not absorb the `all()` line. Pre-fix the
  // zone anchored BELOW the all() line, and re-anchored (flickered) whenever the
  // mixer rewrote the gain literal. Synth (headless-safe); observe real geometry.
  // The `all(...)` line (line 5) is virtualized out of the DOM once the tall
  // viz zone pushes it below the viewport, so measure Monaco's COMPUTED layout
  // (getTopForLineNumber, virtualization-proof) against the zone's content-top.
  // If the zone anchors after line 4, its content-top is above line 5's top; if
  // it (wrongly) anchors after line 5, its top is below line 5's.
  const zoneVsLine5 = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ed = (window as any).monaco?.editor?.getEditors?.()?.[0]
      const zoneEl = document.querySelector('[data-viz-zone-track]')
      const linesContent = document.querySelector('.lines-content')
      if (!ed || !zoneEl || !linesContent) return null
      const zoneContentTop =
        zoneEl.getBoundingClientRect().top - linesContent.getBoundingClientRect().top
      return { zoneContentTop, line5Top: ed.getTopForLineNumber(5) }
    })

  await setCode(
    page,
    `$: stack(\n  note("c e g").s("sawtooth"),\n  note("e g b").s("sawtooth")\n).viz("spectrum")\nall(x => x.gain(0.5))`,
  )
  await runCode(page)
  await expect(page.locator('[data-viz-zone-track]').first()).toBeVisible({ timeout: 6000 })

  // The zone sits between `).viz("spectrum")` (line 4) and `all(...)` (line 5).
  const before = await zoneVsLine5()
  expect(before, 'editor + zone must be present').not.toBeNull()
  expect(before!.zoneContentTop).toBeLessThan(before!.line5Top)

  // Rewrite the master gain literal in place (what a mixer drag does). The zone
  // must NOT re-anchor below the all() line — no flicker; ordering is invariant.
  await setCode(
    page,
    `$: stack(\n  note("c e g").s("sawtooth"),\n  note("e g b").s("sawtooth")\n).viz("spectrum")\nall(x => x.gain(0.123))`,
  )
  await page.waitForTimeout(300)
  const after = await zoneVsLine5()
  expect(after!.zoneContentTop).toBeLessThan(after!.line5Top)
})

// Strudel registers four tempo setters as one (`repl.mjs`: `setCps`/`setcps`,
// `setCpm`/`setcpm`), so each one ends the block above it, exactly as `all()`
// does in #797. `setcps` is the control that already held; the other three used
// to be read as part of the block, and the zone anchored below them (#1927).
for (const setter of ['setcps(0.5)', 'setCps(0.5)', 'setcpm(30)', 'setCpm(30)']) {
  test(`inline viz zone anchors ABOVE a following ${setter} line (#1927)`, async ({ page }) => {
    await setCode(
      page,
      `$: stack(\n  note("c e g").s("sawtooth"),\n  note("e g b").s("sawtooth")\n).viz("spectrum")\n${setter}`,
    )
    await runCode(page)
    await expect(page.locator('[data-viz-zone-track]').first()).toBeVisible({ timeout: 6000 })
    // Computed layout, as in #797: line 5 may be virtualized out under a tall zone.
    const at = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ed = (window as any).monaco?.editor?.getEditors?.()?.[0]
      const zoneEl = document.querySelector('[data-viz-zone-track]')
      const linesContent = document.querySelector('.lines-content')
      if (!ed || !zoneEl || !linesContent) return null
      return {
        zoneContentTop: zoneEl.getBoundingClientRect().top - linesContent.getBoundingClientRect().top,
        line5Top: ed.getTopForLineNumber(5),
      }
    })
    expect(at, 'editor + zone must be present').not.toBeNull()
    expect(at!.zoneContentTop, `the zone sits above the ${setter} line`).toBeLessThan(at!.line5Top)
  })
}

test('underscore ._punchcard() and ._tscope() render inline with no error and no fullscreen canvas', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))

  await setCode(page, `$: note("c e g").s("sawtooth")._punchcard()\n$: s("hh*8")._tscope()`)
  await runCode(page)

  expect(await page.locator('canvas#test-canvas').count()).toBe(0)
  // underscore forms are inline only — they must NOT pin the backdrop
  await expect(page.locator('[data-workspace-background]')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('inline pianoroll mounts at a wide/short 6:1 native to match @strudel/draw (de-stretch, #214)', async ({ page }) => {
  // The bundled Piano Roll declares nativeSize 1200×200 (6:1). Block aspect =
  // (dur·lanes/CYCLES)·(W/H), so a SHORT value axis keeps fold lanes thin and
  // notes render as landscape bars (the strudel.cc look) rather than tall
  // blocks. Guards against regressing to the earlier (mis-diagnosed) 1.6:1,
  // and against the flushToPreset race that stripped nativeSize → fell to 2:1.
  await setCode(page, `$: note("c3 e3 g3 c4").s("sawtooth")._pianoroll()`)
  await runCode(page)
  const zone = page.locator('[data-viz-zone-track]').first()
  await expect(zone).toBeVisible({ timeout: 6000 })
  const aspect = await zone.evaluate((z) => {
    const r = z.getBoundingClientRect()
    return r.width / r.height
  })
  // 6:1 ≈ 6.0; the old (taller) values were 1.6 and 2.0. Assert clearly > 5.
  expect(aspect).toBeGreaterThan(5)
  expect(aspect).toBeLessThan(7)
})

test('preset p5 viz draws on a TRANSPARENT surface — a backdrop shows through the inline zone', async ({ page }) => {
  // Each bundled p5 sketch uses clear() instead of background(9,9,18) so the
  // inline viz blends into the editor (and any backdrop) rather than sitting in a
  // dark box.
  //
  // The old probe read canvas ALPHA (`data[i+3] === 0`). Two reasons that oracle
  // is gone: the canvas is worker-transferred (unreadable), and the compositor —
  // the only legal readback — is OPAQUE, so alpha is always 255. Worse, the
  // fallback "empty pixels == the editor background" cannot falsify ANYTHING
  // here: the editor background is rgb(9,9,18), the exact colour an opaque fill
  // would paint. Both hypotheses predict the same pixels.
  //
  // So observe the property the user actually cares about — the viz BLENDS —
  // by putting something unmistakable behind it: pin a RED backdrop and require
  // it to show through the inline zone's empty areas. An opaque background(9,9,18)
  // fill would hide it (red ≈ 0). Falsifiable, on the default (worker) path.
  await setCode(
    page,
    `$: note("c4 e4").s("sawtooth").pianoroll({ background: '#cc1133' })\n` +
      `$: note("c3 e3 g3").s("sawtooth")._pianoroll()`,
  )
  await runCode(page)
  const canvas = page.locator('[data-viz-zone-track] canvas').first()
  await expect(canvas).toBeVisible({ timeout: 6000 })
  await expect(page.locator('[data-workspace-background] canvas')).toHaveCount(1, { timeout: 8000 })
  await page.waitForTimeout(1200)

  const red = await vizPixelStats(page, '[data-viz-zone-track] canvas',
    { rMin: 121, gMax: 79, bMax: 89 })
  // Sparse notes over a transparent surface → most of the zone is backdrop red.
  expect(red.frac).toBeGreaterThan(0.2)
})

test('pitchwheel tracks pitch (reactive) — note-name haps decode, not freeze on c4 (#216)', async ({ page }) => {
  // Haps carry note as a NAME string with freq=null (freq is only a written
  // `.freq()`); pitchwheel must take the pitch from `h.midi` (#1929) or the
  // active-note indicator stays pinned to the root every frame. Reactive ⇒ the bright-blue indicator centroid x must vary over time.
  await setCode(page, `setcps(0.7)\n$: note("c4 e4 g4 b4 c5 e5 g5 b5").s("sawtooth").viz("pitchwheel")`)
  await runCode(page)
  const canvas = page.locator('[data-viz-zone-track] canvas').first()
  await expect(canvas).toBeVisible({ timeout: 6000 })
  // The BRIGHT blue active line/dot. The old probe separated it from the static
  // dots by alpha (they are drawn at alpha 64); the compositor has no alpha, but
  // those dots composite against the near-black editor bg to a DIM blue — so
  // brightness separates them just as cleanly.
  const sampleX = async () =>
    (await vizPixelStats(page, '[data-viz-zone-track] canvas', { bMin: 181 })).meanX
  const xs: number[] = []
  for (let k = 0; k < 7; k++) { xs.push(await sampleX()); await page.waitForTimeout(380) }
  const valid = xs.filter(x => x >= 0)
  expect(valid.length).toBeGreaterThan(2)
  // a frozen pitchwheel has range ~0; reactive sweeps tens of px.
  expect(Math.max(...valid) - Math.min(...valid)).toBeGreaterThan(15)
})

test('pitchwheel draws cs3, g and ef3 where Strudel plays them (#1929)', async ({ page }) => {
  // The built-in sketches used to parse note names with their own grammar, which
  // has no pitch for a sharp written `s`, a name with no octave, or a flat written
  // `f`: the pitchwheel skipped those notes. They now read the pitch the engine
  // computed with Strudel's grammar. One held note per run, so the active line is
  // still while it plays; the bright line's centroid says where it points.
  const lineAt = async (note: string) => {
    await setCode(page, `$: note("${note}").s("sawtooth").viz("pitchwheel")`)
    await runCode(page)
    await expect(page.locator('[data-viz-zone-track] canvas').first()).toBeVisible({ timeout: 6000 })
    const samples: number[] = []
    for (let k = 0; k < 3; k++) {
      samples.push((await vizPixelStats(page, '[data-viz-zone-track] canvas', { bMin: 181 })).meanX)
      await page.waitForTimeout(200)
    }
    return samples.sort((a, b) => a - b)[1] // median; -1 when no line was drawn
  }
  const sharp = await lineAt('c#3')
  expect(sharp, 'c#3 draws a line (control: the old grammar read it)').toBeGreaterThanOrEqual(0)
  // Control: the measure tracks pitch, so a semitone below lands elsewhere.
  expect(Math.abs((await lineAt('c3')) - sharp), 'c3 vs c#3').toBeGreaterThan(5)
  expect(Math.abs((await lineAt('cs3')) - sharp), 'cs3 lands where c#3 does').toBeLessThan(2)
  const g3 = await lineAt('g3')
  expect(Math.abs((await lineAt('g')) - g3), 'g lands where g3 does').toBeLessThan(2)
  const eb3 = await lineAt('eb3')
  expect(Math.abs((await lineAt('ef3')) - eb3), 'ef3 lands where eb3 does').toBeLessThan(2)
})

test('inline crop resolves the preset by name AND renderer — scope.p5 not scope.hydra (#217)', async ({ page }) => {
  // `scope` exists for both renderers; a name-only preset lookup pointed the
  // crop popup at the hydra preset. The action bar's data-preset-id (what the
  // crop popup loads) must be the p5 preset for an inline (p5) `.viz("scope")`.
  await setCode(page, `$: note("c4 e3 g4").s("sawtooth").viz("scope")`)
  await runCode(page)
  const zone = page.locator('[data-viz-zone-track]').first()
  await expect(zone).toBeVisible({ timeout: 6000 })
  // hover to populate the floating action bar, then poll until the async
  // preset lookup has set data-preset-id.
  const box = await zone.boundingBox()
  if (box) {
    await page.mouse.move(box.x + 20, box.y + 10)
    await page.mouse.move(box.x + box.width - 40, box.y + 12)
  }
  await expect
    .poll(() => page.locator('[data-viz-actions]').getAttribute('data-preset-id'), { timeout: 6000 })
    .toMatch(/scope_p5__$/)
})

test('.viz("name", { opts }) threads options to the sketch — not just ._pianoroll (#215)', async ({ page }) => {
  // The `.viz()` wrapper used to capture only the name and drop a 2nd options
  // arg. A custom `background` only paints if the options object actually
  // reaches the sketch (stave.options.background → parseHex → background()).
  // Frame-independent: the bg fill is constant, unlike the animated notes.
  await setCode(page, `$: note("c3 e3 g3 c4").s("sawtooth").viz("pianoroll", { background: '#cc1133' })`)
  await runCode(page)
  const canvas = page.locator('[data-viz-zone-track] canvas').first()
  await expect(canvas).toBeVisible({ timeout: 6000 })
  // background #cc1133 → strongly red-dominant, low green/blue. ≥30% of the zone.
  const red = await vizPixelStats(page, '[data-viz-zone-track] canvas',
    { rMin: 121, gMax: 79, bMax: 89 })
  expect(red.frac).toBeGreaterThan(0.3)
})

test('pianoroll folds drum patterns so sounds spread across lanes, not one (#214)', async ({ page }) => {
  // fold defaults ON (contiguous lanes, no gaps), so each distinct drum sound
  // gets its own lane → painted pixels must span the canvas vertically, not
  // cluster in a thin band. (Guards against a fold:0 default, which would dump
  // non-numeric sound names onto a single absolute-MIDI lane.)
  await setCode(page, `$: s("bd hh sd hh, ~ cp").bank("RolandTR909").viz("pianoroll")`)
  await runCode(page)
  const canvas = page.locator('[data-viz-zone-track] canvas').first()
  await expect(canvas).toBeVisible({ timeout: 6000 })
  // Vertical extent of the PAINTED pixels (any channel clearly above the ~#09090f
  // background), as a fraction of the zone height.
  const painted = await vizPixelStats(page, '[data-viz-zone-track] canvas', { anyChannelMin: 60 })
  expect(painted.count, 'the sketch painted something').toBeGreaterThan(0)
  const span = (painted.maxY - painted.minY) / painted.h
  // collapsed-to-one-lane would be a sliver (<0.2); multiple lanes span ≥0.4.
  expect(span).toBeGreaterThan(0.4)
})

test('inline ._pianoroll(options) — the options object REACHES the sketch (#214)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))

  // This test used to claim it "asserts the engine→bag→stave.options plumbing"
  // while only checking that a canvas existed and nothing threw. It therefore
  // could not fail when that plumbing was DEAD — and it duly stayed green for the
  // six weeks that worker-rendered sketches received `stave.options = {}` (#875).
  // An assertion that cannot fail is not coverage, it is a claim of coverage.
  //
  // So: prove the bag ARRIVED, with an option whose effect is visible. `background`
  // is the falsifiable one — it paints, frame-independently. This is the UNDERSCORE
  // inline form; the sibling tests cover `.viz(name, {…})` (#215) and the
  // `.pianoroll({…})` backdrop (#214), so all three option syntaxes are observed.
  await setCode(page, `$: note("c3 e3 g3 c4").s("sawtooth")._pianoroll({ background: '#cc1133' })`)
  await runCode(page)
  await expect(page.locator('[data-viz-zone-track] canvas').first()).toBeVisible({ timeout: 6000 })
  const red = await vizPixelStats(page, '[data-viz-zone-track] canvas',
    { rMin: 121, gMax: 79, bMax: 89 })
  expect(red.frac, 'the { background } option reached the sketch').toBeGreaterThan(0.3)
  await page.keyboard.press(`${MOD}+.`)
  await page.waitForTimeout(300)

  // The remaining shapes (labels / vertical / absolute-axis) must evaluate cleanly
  // and produce a zone — a weaker claim, but a real one, and now clearly labelled
  // as such rather than dressed up as option-plumbing coverage.
  for (const opts of ['{ labels: 1 }', '{ vertical: 1 }', '{ fold: 0, minMidi: 36, maxMidi: 84 }']) {
    await setCode(page, `$: note("c3 e3 g3 c4").s("sawtooth")._pianoroll(${opts})`)
    await runCode(page)
    await expect(page.locator('[data-viz-zone-track] canvas').first()).toBeVisible({ timeout: 6000 })
    // options on the inline form must not pin a backdrop
    await expect(page.locator('[data-workspace-background]')).toHaveCount(0)
    await page.keyboard.press(`${MOD}+.`)
    await page.waitForTimeout(300)
  }
  expect(errors).toEqual([])
})

// ─────────────────────────────────────────────────────────────────────────
// Phase 21 — Named Signal Bus, end-to-end OBSERVATION (T5).
//
// The signal-bus spine (pure SignalBus → per-renderer injection → PV64 backdrop
// threading) was unit-green but unobserved on the real surfaces. "Renders
// without error" is NOT proof of reactivity (P93 — a frozen `sig.kick` throws
// nothing). These four tests measure VARIANCE-OVER-TIME (reactivity) and
// PIXEL-PRESENCE (per-codeblock color), never an error count.
//
// The `__STAVE_E2E__` flag (set via addInitScript before navigation) unlocks
// two test-only window hooks in StaveApp / StrudelEditorClient:
//   - `__staveRegisterViz(preset)` — register a one-off named viz so a custom
//     p5/hydra sketch reading `sig.kick`/`sig.tracks` is reachable via `.viz("name")`
//     (inline, A/B). Calls the SAME `registerPresetAsNamedViz` the app uses for
//     bundled presets.
//   - `__staveOverrideVizFile(basename, code)` — replace an existing workspace
//     viz file's code (e.g. the bundled `spectrum.p5`) so a REAL non-underscore
//     method (`.spectrum()`) pins it through the production code-driven backdrop
//     path (C/D). This is the only path that wires the running audio source into
//     the backdrop PreviewView — a directly-pinned ad-hoc file gets a null
//     audioSource. Only the preset-authoring UI step is shortcut; the renderer →
//     SignalBus → scheduler path under test is the production one.
// ─────────────────────────────────────────────────────────────────────────
test.describe('Phase 21 — named signal bus (T5 end-to-end observation)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__STAVE_E2E__ = true
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
    await page.waitForTimeout(1200)
  })

  // Mean luminance of a locator's screenshot, decoded in-browser via an Image.
  // Used for the WebGL (hydra) canvas: a WebGL context with the default
  // preserveDrawingBuffer:false reads back BLACK via getImageData/drawImage, but
  // the browser compositor (what `screenshot()` captures) has the real pixels.
  async function screenshotLum(page: Page, sel: string): Promise<number> {
    const buf = await page.locator(sel).first().screenshot()
    const b64 = buf.toString('base64')
    return page.evaluate(async (data) => {
      const img = new Image()
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('img decode failed'))
        img.src = 'data:image/png;base64,' + data
      })
      const c = document.createElement('canvas')
      c.width = Math.min(img.width, 160)
      c.height = Math.min(img.height, 120)
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, c.width, c.height)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let s = 0
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]
      return s / (d.length / 4)
    }, b64)
  }

  test('T5-A — sig.kick is reactive in a p5 inline sketch (size varies over frames)', async ({ page }) => {
    // A `.viz()` p5 sketch draws a circle whose radius = sig.kick·(canvas span).
    // Over a `s("bd*4")` kick the bright-pixel count must VARY frame-to-frame —
    // a dead/stale `sig.kick` (the U2 const-capture trap) gives range ≈ 0.
    const sketch = `
function setup() { createCanvas(stave.width, stave.height); colorMode(RGB) }
function draw() {
  clear(); noStroke(); fill(255, 60, 60)
  circle(width / 2, height / 2, 4 + sig.kick * Math.min(width, height) * 0.9)
}`
    await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__staveRegisterViz({
        id: 'p21-ukick-p5', name: 'p21ukickp5', renderer: 'p5', code,
        requires: ['streaming'], nativeSize: { w: 400, h: 300 },
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    }, sketch)

    await setCode(page, `$: s("bd*4").viz("p21ukickp5")`)
    await runCode(page)
    const canvas = page.locator('[data-viz-zone-track] canvas').first()
    await canvas.waitFor({ timeout: 8000 })

    // Fraction of the zone covered by the red circle, per frame (compositor).
    const brightFrac = async () =>
      (await vizPixelStats(page, '[data-viz-zone-track] canvas',
        { rMin: 141, gMax: 109, bMax: 109 })).frac
    const samples: number[] = []
    for (let k = 0; k < 8; k++) { samples.push(await brightFrac()); await page.waitForTimeout(180) }

    const range = Math.max(...samples) - Math.min(...samples)
    // The kick swings the radius across most of the canvas; a frozen sig.kick is
    // a constant circle (range 0). 5% of the zone is far above measurement noise
    // and far below the observed swing (~30% of the zone).
    expect(range).toBeGreaterThan(0.05)
  })

  test('T5-B — sig.kick is reactive in a hydra inline sketch, with the analyser LIVE (FLAG-2)', async ({ page }) => {
    // `s.osc(() => stave.sig.kick()*N)` brightness varies over frames. Crucially,
    // we ALSO assert the AudioContext is running (a real analyser is published
    // in normal playback) — this exercises the real-FFT path where the bus
    // feed/tick MUST stay live (BLOCK-1). A no-analyser run would false-green
    // the mis-placed (analyser-gated) feed/tick this test guards against.
    const sketch =
      `s.osc(() => stave.sig.kick() * 90 + 1, 0.1, () => stave.sig.kick() * 3).out()`
    await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__staveRegisterViz({
        id: 'p21-ukick-hydra', name: 'p21ukickhydra', renderer: 'hydra', code,
        requires: ['audio'], nativeSize: { w: 400, h: 300 },
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    }, sketch)

    await setCode(page, `$: s("bd*4").viz("p21ukickhydra")`)
    await runCode(page)
    await page.locator('[data-viz-zone-track] canvas').first().waitFor({ timeout: 8000 })

    // FLAG-2: the real-FFT path is active (analyser present ⇒ AudioContext
    // running). If this is not 'running', the bus would be on the envelope
    // fallback and the test would not exercise BLOCK-1.
    const acState = await page.evaluate(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).getAudioContext?.()?.state ?? 'none'
      } catch { return 'error' }
    })
    expect(acState).toBe('running')

    const lums: number[] = []
    for (let k = 0; k < 9; k++) {
      lums.push(await screenshotLum(page, '[data-viz-zone-track] canvas'))
      await page.waitForTimeout(160)
    }
    const range = Math.max(...lums) - Math.min(...lums)
    // sig.kick swings osc frequency + saturation → brightness varies. A frozen
    // sig.kick renders a constant shader (range ≈ 0). 40 (of 765 max) clears
    // compositor noise; observed range ~350.
    expect(range).toBeGreaterThan(40)
  })

  test('T5-C — backdrop paints per-codeblock color from sig.tracks + .color() (the headline)', async ({ page }, testInfo) => {
    // Override the bundled `spectrum.p5` with a backdrop sketch that walks
    // `sig.tracks` and fills a vertical band per track in `sig.track(id).color`.
    // Two codeblocks, each `.color()`-tinted differently; the 2nd pins
    // `.spectrum()` as the backdrop. Both tints must appear in the BACKDROP
    // canvas — proving T4's compiledVizProvider trackSchedulers threading
    // reaches the bus on the full-screen surface (PV64/P95), not just inline.
    const sketch = `
function setup() { createCanvas(stave.width, stave.height); colorMode(RGB) }
function draw() {
  clear(); noStroke()
  const tracks = sig.tracks || []
  const n = tracks.length
  if (n === 0) { fill(40, 40, 40); rect(0, 0, 24, 24); return }
  for (let i = 0; i < n; i++) {
    const col = sig.track(tracks[i]).color
    if (col) fill(col); else fill(120, 120, 120)
    rect((i / n) * width, 0, width / n, height)
  }
}`
    const overridden = await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__staveOverrideVizFile('spectrum', code)
    }, sketch)
    expect(overridden).toBeTruthy() // the bundled spectrum.p5 file exists
    await page.waitForTimeout(400)

    await setCode(
      page,
      `$: s("bd*4").color('red')\n$: s("hh*8").color('cyan').spectrum()`,
    )
    await runCode(page)
    const bd = page.locator('[data-workspace-background] canvas').first()
    await bd.waitFor({ timeout: 8000 })
    await page.waitForTimeout(1500)

    const SEL = '[data-workspace-background] canvas'
    const counts = async () => ({
      red: (await vizPixelStats(page, SEL, { rMin: 141, gMax: 109, bMax: 109 })).frac,
      cyan: (await vizPixelStats(page, SEL, { rMax: 109, gMin: 111, bMin: 111 })).frac,
    })

    const { red, cyan } = await counts()
    // BOTH tints present — the two .color() codeblocks each paint their own
    // backdrop band. Each band is ~half the canvas; require a clear fraction
    // of each so neither tint is a stray antialias pixel.
    expect(red).toBeGreaterThan(0.2)
    expect(cyan).toBeGreaterThan(0.2)

    // P74 — capture a screenshot as a test artifact so the per-codeblock
    // colors can be eyeballed (a pixel count alone doesn't confirm the colors
    // are the ones the music code set).
    const shot = await page.locator('[data-workspace-background]').first().screenshot()
    await testInfo.attach('backdrop-per-codeblock-color', { body: shot, contentType: 'image/png' })

    // Control: no .color() on either block → neither tint is present.
    await setCode(page, `$: s("bd*4")\n$: s("hh*8").spectrum()`)
    await page.keyboard.press(`${MOD}+.`)
    await page.waitForTimeout(600)
    await runCode(page)
    await page.waitForTimeout(1500)
    const ctrl = await counts()
    expect(ctrl.red).toBeLessThan(0.05)
    expect(ctrl.cyan).toBeLessThan(0.05)
  })

  test('T5-D — backdrop sig.tracks refreshes on re-evaluate (adding a 2nd codeblock)', async ({ page }) => {
    // Run with one codeblock, then add a second and re-evaluate. The backdrop's
    // `sig.tracks` must grow from 1 → 2 (the new tint appears). Proves the
    // identity guard re-binds trackSchedulers on re-eval (T4 deliberately left
    // engineComponents OUT of the memo guard — this OBSERVES that the scheduler
    // re-publish refreshes the per-track map anyway).
    //
    // The old oracle had the sketch write `window.__p21bdTracks` for the spec to
    // read back. That channel does not exist off-main: in the worker `window` is
    // the DOM SHIM, so the assignment lands in the worker and the page reads
    // `undefined` forever (#875). Observe the BANDS the sketch paints instead —
    // one track paints red only; two paint red AND cyan. Same claim, and it holds
    // on whichever thread the sketch is running.
    const sketch = `
function setup() { createCanvas(stave.width, stave.height); colorMode(RGB) }
function draw() {
  clear(); noStroke()
  const tracks = sig.tracks || []
  const n = tracks.length || 1
  for (let i = 0; i < tracks.length; i++) {
    const col = sig.track(tracks[i]).color
    if (col) fill(col); else fill(120, 120, 120)
    rect((i / n) * width, 0, width / n, height)
  }
}`
    await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__staveOverrideVizFile('spectrum', code)
    }, sketch)
    await page.waitForTimeout(400)

    const SEL = '[data-workspace-background] canvas'
    const tints = async () => ({
      red: (await vizPixelStats(page, SEL, { rMin: 141, gMax: 109, bMax: 109 })).frac,
      cyan: (await vizPixelStats(page, SEL, { rMax: 109, gMin: 111, bMin: 111 })).frac,
    })

    await setCode(page, `$: s("bd*4").color('red').spectrum()`)
    await runCode(page)
    await page.locator(SEL).first().waitFor({ timeout: 8000 })
    await page.waitForTimeout(1800)
    const one = await tints()
    // ONE track → its red band fills the backdrop; no second tint exists yet.
    expect(one.red).toBeGreaterThan(0.2)
    expect(one.cyan).toBeLessThan(0.05)

    await setCode(
      page,
      `$: s("bd*4").color('red').spectrum()\n$: s("hh*8").color('cyan')`,
    )
    await page.keyboard.press(`${MOD}+.`)
    await page.waitForTimeout(600)
    await runCode(page)
    await page.waitForTimeout(1800)
    const two = await tints()
    // TWO tracks → the map refreshed, so the new track's band appears alongside.
    expect(two.red).toBeGreaterThan(0.2)
    expect(two.cyan).toBeGreaterThan(0.2)
  })

  // ───────────────────────────────────────────────────────────────────────
  // Slice 2 (T4) — REAL-AUDIO (DSP) reactivity, distinct from the IR envelope.
  //
  // Slice-1 (T5-A..D above) proved the SCHEDULER/IR feed reactive (`sig.kick`,
  // `.color`). These three prove the ANALYSER (DSP) feed: a sound's own-orbit
  // analyser drives `sig('bd').rms`/`.bass`/`.fft` and the master mix drives
  // `sig.rms`/`sig.fft`. The signal is the analyser's spectrum/time-domain, NOT the
  // envelope bump+decay — so the kick `s("bd*4")` produces a MOVING spectrum.
  //
  // Discipline:
  //   - P93: variance-over-time, never "renders without error" (a frozen rms
  //     throws nothing). Every assertion is a range/variance over ~7-9 frames.
  //   - P96/FLAG-2: assert the AudioContext is RUNNING at probe time — a dead
  //     audio context publishes a silent analyser and would false-green a
  //     "reactive" claim with a flat (but error-free) zero signal.
  //   - P74: attach a screenshot of the fft-bars sketch so the spectrum can be
  //     eyeballed (a bar-height variance number alone doesn't show the shape).
  //
  // These reuse the same `__staveRegisterViz` hook + `[data-viz-zone-track]`
  // inline probe as T5-A; the audio source wired into the inline renderer is the
  // production scheduler/analyser, only the preset-authoring step is shortcut.
  // ───────────────────────────────────────────────────────────────────────

  // Assert the running AudioContext (the analyser/FFT path is live, not a
  // false-green silent context — P96/FLAG-2). Shared by all three DSP probes.
  async function assertAudioLive(page: Page): Promise<void> {
    const acState = await page.evaluate(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).getAudioContext?.()?.state ?? 'none'
      } catch {
        return 'error'
      }
    })
    expect(acState).toBe('running')
  }

  test('T4-A — sig("bd").bass is reactive to REAL audio in a p5 inline sketch (size varies, analyser LIVE)', async ({ page }) => {
    // A `.viz()` p5 sketch sizes a circle by `sig('bd').bass` (a live NUMBER in
    // the p5 shape — the low-third of the resolved orbit's FFT). Over `s("bd*4")`
    // in its OWN orbit the kick's bass energy moves frame-to-frame, so the
    // bright-pixel count VARIES. This is the analyser feed (real FFT), NOT the
    // `.env` envelope Slice 1 proved — the assertion would still pass on a
    // frozen `.env`, so we ALSO assert the audio context is running (FLAG-2):
    // a dead context = silent analyser = flat bass = false-green.
    const sketch = `
function setup() { createCanvas(stave.width, stave.height); colorMode(RGB) }
function draw() {
  clear(); noStroke(); fill(60, 200, 255)
  const bass = sig('bd').bass
  circle(width / 2, height / 2, 4 + bass * Math.min(width, height) * 4)
}`
    await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__staveRegisterViz({
        id: 'p21-bdbass-p5', name: 'p21bdbassp5', renderer: 'p5', code,
        requires: ['audio'], nativeSize: { w: 400, h: 300 },
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    }, sketch)

    await setCode(page, `$: s("bd*4").viz("p21bdbassp5")`)
    await runCode(page)
    const canvas = page.locator('[data-viz-zone-track] canvas').first()
    await canvas.waitFor({ timeout: 8000 })

    // FLAG-2: the real-FFT path is active (a published analyser ⇒ a running
    // context). Without this the variance below could be measurement noise on a
    // silent signal.
    await assertAudioLive(page)

    // the cyan circle: blue-dominant, bright.
    const brightFrac = async () =>
      (await vizPixelStats(page, '[data-viz-zone-track] canvas',
        { bMin: 181, gMin: 121, rMax: 139 })).frac
    const samples: number[] = []
    for (let k = 0; k < 8; k++) { samples.push(await brightFrac()); await page.waitForTimeout(180) }

    const range = Math.max(...samples) - Math.min(...samples)
    // The kick's bass energy swings the circle radius; a frozen/silent analyser
    // is a constant circle (range ≈ 0). 1% of the zone clears measurement noise
    // and is far below the observed swing on a live kick.
    expect(range).toBeGreaterThan(0.01)
  })

  test('T4-B — sig("bd").fft renders as bars and the spectrum VARIES over frames (+ screenshot, P74)', async ({ page }, testInfo) => {
    // A sketch draws `sig('bd').fft` (a live ARRAY in the p5 shape) as vertical
    // bars. Over `s("bd*4")` the spectrum moves, so the per-frame total bar
    // energy (sum of bar heights, read as bright-pixel count) VARIES. A frozen
    // or empty fft → identical frames (range 0). We attach a screenshot so the
    // bar shape can be eyeballed (P74 — a variance number doesn't show the
    // spectrum is real).
    const sketch = `
function setup() { createCanvas(stave.width, stave.height); colorMode(RGB) }
function draw() {
  clear(); noStroke(); fill(120, 255, 120)
  const fft = sig('bd').fft
  const n = fft.length
  if (n === 0) { fill(80, 0, 0); rect(0, 0, 12, 12); return }
  const w = width / n
  for (let i = 0; i < n; i++) {
    const h = fft[i] * height
    rect(i * w, height - h, w * 0.9, h)
  }
}`
    await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__staveRegisterViz({
        id: 'p21-bdfft-p5', name: 'p21bdfftp5', renderer: 'p5', code,
        requires: ['audio'], nativeSize: { w: 400, h: 300 },
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    }, sketch)

    await setCode(page, `$: s("bd*4").viz("p21bdfftp5")`)
    await runCode(page)
    const canvas = page.locator('[data-viz-zone-track] canvas').first()
    await canvas.waitFor({ timeout: 8000 })

    await assertAudioLive(page)

    // total green energy = Σ bar heights; a moving spectrum makes this vary.
    const barEnergy = async () =>
      (await vizPixelStats(page, '[data-viz-zone-track] canvas',
        { gMin: 181, rMax: 159, bMax: 159 })).frac
    const samples: number[] = []
    for (let k = 0; k < 9; k++) { samples.push(await barEnergy()); await page.waitForTimeout(170) }

    // P74 — attach the fft-bars zone so the spectrum is eyeball-verifiable. The
    // COMPOSITOR shot (page.screenshot over the zone's box), not the element's —
    // an element screenshot of a worker canvas forces a drawing-buffer readback
    // and is exactly the artifact that ghost-bugged P121.
    const box = await canvas.boundingBox()
    if (box) {
      await testInfo.attach('fft-bars-sketch', {
        body: await page.screenshot({ clip: box }),
        contentType: 'image/png',
      })
    }

    const nonEmpty = samples.filter((s) => s > 0)
    // at least some frames painted bars (fft was non-empty — the array reached
    // the sketch, not a permanent []).
    expect(nonEmpty.length).toBeGreaterThan(2)
    const range = Math.max(...samples) - Math.min(...samples)
    // the spectrum moves → bar energy varies. A static/empty fft is flat
    // (range 0). 1% of the zone clears noise; observed swings are far larger.
    expect(range).toBeGreaterThan(0.01)
  })

  test('T4-C — master sig.rms / sig.fft are reactive to the overall mix (variance over frames)', async ({ page }) => {
    // A sketch reads the MASTER accessors `sig.rms` (a live getter NUMBER) and
    // `sig.fft` (a live getter ARRAY) — the combined-mix analyser, distinct from a
    // per-sound orbit. Two codeblocks feed the master; `sig.rms` drives a circle
    // and `sig.fft` energy tints it. Over the mix the size + tint VARY frame to
    // frame. Frozen master analyser → constant (range 0).
    const sketch = `
function setup() { createCanvas(stave.width, stave.height); colorMode(RGB) }
function draw() {
  clear(); noStroke(); fill(255, 90, 40)
  // master rms (time-domain) + total fft energy (frequency-domain) — BOTH the
  // master accessors. Either moving over the mix swings the radius; summing
  // them gives the master signal a robust dynamic range to observe.
  const rms = sig.rms
  const fft = sig.fft
  let e = 0; for (let i = 0; i < fft.length; i++) e += fft[i]
  const drive = rms + e / Math.max(1, fft.length)
  circle(width / 2, height / 2, 4 + drive * Math.min(width, height) * 2.2)
}`
    await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__staveRegisterViz({
        id: 'p21-master-p5', name: 'p21masterp5', renderer: 'p5', code,
        requires: ['audio'], nativeSize: { w: 400, h: 300 },
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    }, sketch)

    await setCode(page, `$: s("bd*4")\n$: s("hh*8").viz("p21masterp5")`)
    await runCode(page)
    const canvas = page.locator('[data-viz-zone-track] canvas').first()
    await canvas.waitFor({ timeout: 8000 })

    await assertAudioLive(page)

    // the orange/red circle: red-dominant.
    const brightFrac = async () =>
      (await vizPixelStats(page, '[data-viz-zone-track] canvas',
        { rMin: 181, bMax: 119 })).frac
    // Sample more frames (12) than the per-band probes: the master mix is the
    // sum of several sources, so its peak/trough phase relative to the probe
    // clock is less predictable — more samples reliably catch both extremes.
    const samples: number[] = []
    for (let k = 0; k < 12; k++) { samples.push(await brightFrac()); await page.waitForTimeout(150) }

    const range = Math.max(...samples) - Math.min(...samples)
    // the master mix (kick + hats) drives rms + fft energy; a frozen master
    // analyser is a constant circle (range 0). 1% of the zone clears measurement
    // noise and sits well below the observed swing once both signals drive it.
    expect(range).toBeGreaterThan(0.01)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Phase 21 (aliases) — CUSTOM signal aliases, end-to-end OBSERVATION (T4).
//
// T1-T3 shipped the spine: a user-defined alias map persists under the
// `stave:signalAliases` localStorage key (editorRegistry), the renderers MERGE
// it into the (pure) SignalBus at MOUNT — built-ins first, custom LAST so a
// user override WINS — and expose every custom name as a live bare GETTER on
// `sig` (p5, resolved through the inner `with (staveUniforms)`) and a
// `stave.sig.<name>()` thunk on the bag (hydra, which has no bare scope). These
// three tests OBSERVE that a custom alias drives a viz on the REAL inline
// surface — never "renders without error" (P93: a dead `sig.kick` is either a
// ReferenceError on the sketch error path OR a frozen 0 with range≈0 — both
// caught by variance-over-frames). assertAudioLive (P96/FLAG-2) guards the
// audio path so a silent context can't false-green a "reactive" claim.
//
// CRITICAL — the alias is read at MOUNT (`{ ...ALIAS_MAP, ...getSignalAliases() }`
// in P5VizRenderer/HydraVizRenderer mount()). So the custom map MUST be in
// localStorage BEFORE the renderer mounts. We seed it via `addInitScript`
// (runs before navigation, so it's present on first mount). Live-remount on
// alias change is DEFERRED — we do NOT rely on it.
// ─────────────────────────────────────────────────────────────────────────
test.describe('Phase 21 aliases — custom signal alias drives a viz (T4 observation)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__STAVE_E2E__ = true
      // Seed the custom alias map BEFORE navigation so it is present in
      // localStorage on the FIRST renderer mount (the renderer reads it via
      // getSignalAliases() at mount; live-remount is deferred). `kick` resolves
      // as MAX env over `bd` + `kick9`; `lead` is a single-sound alias.
      try {
        window.localStorage.setItem(
          'stave:signalAliases',
          JSON.stringify({ kick: ['bd', 'kick9'], lead: 'sawtooth' }),
        )
      } catch {
        /* private-mode / quota — the renderer falls back to {} and the test
           below would observe a frozen `kick` (range 0) → real failure. */
      }
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
    await page.waitForTimeout(1200)
  })

  // Assert the running AudioContext (the analyser/FFT path is live, not a
  // false-green silent context — P96/FLAG-2). Shared by the audio probes.
  async function assertAudioLive(page: Page): Promise<void> {
    const acState = await page.evaluate(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).getAudioContext?.()?.state ?? 'none'
      } catch {
        return 'error'
      }
    })
    expect(acState).toBe('running')
  }

  // Mean luminance of a locator's screenshot (decoded in-browser). Used for the
  // WebGL (hydra) canvas — a non-preserveDrawingBuffer GL context reads back
  // BLACK via getImageData, but the compositor (what screenshot() captures) has
  // the real pixels. Mirrors the T5 helper.
  async function screenshotLum(page: Page, sel: string): Promise<number> {
    const buf = await page.locator(sel).first().screenshot()
    const b64 = buf.toString('base64')
    return page.evaluate(async (data) => {
      const img = new Image()
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('img decode failed'))
        img.src = 'data:image/png;base64,' + data
      })
      const c = document.createElement('canvas')
      c.width = Math.min(img.width, 160)
      c.height = Math.min(img.height, 120)
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, c.width, c.height)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let s = 0
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]
      return s / (d.length / 4)
    }, b64)
  }

  test('T4-A — custom `sig.kick` (and sig("kick").env) sizes a p5 sketch reactively over the custom alias', async ({ page }) => {
    // The alias `kick → ['bd','kick9']` was seeded before mount. A p5 sketch
    // sizes a circle by `sig.kick` (resolved through the inner
    // `with (staveUniforms)` — proves the renderer injected a live getter for
    // the custom name) and tints it by `sig('kick').env` (the accessor form — the
    // SignalBus resolves the same alias). Over `s("bd*4 kick9*2")` BOTH samples
    // fire, so the bright-pixel count VARIES frame-to-frame. A dead `sig.kick`
    // is either a ReferenceError (surfaces on the sketch error path → no canvas,
    // test times out / errors) OR a frozen 0 (range ≈ 0) — both are REAL
    // failures meaning the T2 injection didn't reach this surface (P93).
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))

    const sketch = `
function setup() { createCanvas(stave.width, stave.height); colorMode(RGB) }
function draw() {
  clear(); noStroke()
  // tint by the ACCESSOR form of the same custom alias (sig('kick').env) — a
  // second, independent resolution path through the bus.
  const t = sig('kick').env
  fill(255, 60 + t * 180, 60)
  // size by the custom name on sig — resolved through with(staveUniforms).
  circle(width / 2, height / 2, 4 + sig.kick * Math.min(width, height) * 0.9)
}`
    await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__staveRegisterViz({
        id: 'p21a-kick-p5', name: 'p21akickp5', renderer: 'p5', code,
        requires: ['streaming'], nativeSize: { w: 400, h: 300 },
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    }, sketch)

    await setCode(page, `$: s("bd*4 kick9*2").viz("p21akickp5")`)
    await runCode(page)
    const canvas = page.locator('[data-viz-zone-track] canvas').first()
    await canvas.waitFor({ timeout: 8000 })

    // the warm circle: red-dominant.
    const brightFrac = async () =>
      (await vizPixelStats(page, '[data-viz-zone-track] canvas',
        { rMin: 181, bMax: 119 })).frac
    const samples: number[] = []
    for (let k = 0; k < 8; k++) { samples.push(await brightFrac()); await page.waitForTimeout(180) }

    // A ReferenceError on `sig.kick` would surface here (the sketch never
    // painted → all-zero samples AND a pageerror). Fail loud if so.
    expect(errors, `sketch errors (\`sig.kick\` may be undefined): ${errors.join(' | ')}`).toEqual([])

    const range = Math.max(...samples) - Math.min(...samples)
    // The custom `sig.kick` alias swings the radius across most of the canvas; a
    // frozen/unresolved alias is a constant circle (range 0). 5% of the zone
    // clears measurement noise (mirrors T5-A's threshold).
    expect(range).toBeGreaterThan(0.05)
  })

  test('T4-B — custom `stave.sig.kick()` thunk drives a hydra sketch reactively (analyser LIVE)', async ({ page }) => {
    // Same alias seeded before mount. A hydra sketch uses the custom
    // `stave.sig.kick()` thunk (injected on the bag at mount — hydra has no bare
    // scope) to drive osc frequency + brightness over `s("bd*4 kick9*2")`.
    // Brightness varies over frames. assertAudioLive (P96/FLAG-2) confirms a
    // real running context — a dead one would publish a silent analyser and
    // false-green a flat shader.
    //
    // `.brightness(() => stave.sig.kick() - 0.25)` swings the WHOLE-FRAME mean
    // luminance directly (negative at rest, positive on a kick) — a far larger
    // mean-lum delta than osc-frequency alone, which only moves the stripe
    // PHASE (similar mean across frames). This keeps the probe robustly above
    // the compositor-noise floor instead of skimming it (observed 34.6 once
    // with the frequency-only driver — a real but marginal signal).
    const sketch =
      `s.osc(() => stave.sig.kick() * 90 + 8, 0.1, 0.5).brightness(() => stave.sig.kick() * 1.2 - 0.25).out()`
    await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__staveRegisterViz({
        id: 'p21a-kick-hydra', name: 'p21akickhydra', renderer: 'hydra', code,
        requires: ['audio'], nativeSize: { w: 400, h: 300 },
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    }, sketch)

    await setCode(page, `$: s("bd*4 kick9*2").viz("p21akickhydra")`)
    await runCode(page)
    await page.locator('[data-viz-zone-track] canvas').first().waitFor({ timeout: 8000 })

    await assertAudioLive(page)

    // 14 frames (more than T5-B's 9): `bd*4 kick9*2` spreads energy across two
    // sounds, so the kick-driven brightness peak/trough phase relative to the
    // probe clock is less predictable — more samples reliably catch both
    // extremes (same rationale as the master probe T4-C's 12-frame loop).
    const lums: number[] = []
    for (let k = 0; k < 14; k++) {
      lums.push(await screenshotLum(page, '[data-viz-zone-track] canvas'))
      await page.waitForTimeout(150)
    }
    const range = Math.max(...lums) - Math.min(...lums)
    // The custom kick swings whole-frame brightness → mean luminance varies. A
    // frozen/unresolved alias renders a constant shader (range ≈ 0). 40 (of 765
    // max) clears compositor noise; the .brightness() driver lifts the observed
    // range well into the hundreds (vs ~35 for the frequency-only driver).
    expect(range).toBeGreaterThan(40)
  })

  test('T4-C — built-in `sig.kick` still reacts with a custom alias seeded (merge did not clobber built-ins)', async ({ page }) => {
    // Regression: the merge `{ ...ALIAS_MAP, ...getSignalAliases() }` must keep
    // the built-ins. With the custom `kick`/`lead` aliases seeded, a sketch
    // using the BUILT-IN `sig.kick` over `s("bd*4")` must STILL react — a
    // clobbered ALIAS_MAP would freeze `sig.kick` (range 0). Same variance probe
    // as T5-A, now run under a non-empty custom alias map.
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))

    const sketch = `
function setup() { createCanvas(stave.width, stave.height); colorMode(RGB) }
function draw() {
  clear(); noStroke(); fill(255, 60, 60)
  circle(width / 2, height / 2, 4 + sig.kick * Math.min(width, height) * 0.9)
}`
    await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__staveRegisterViz({
        id: 'p21a-ukick-builtin', name: 'p21aukickbuiltin', renderer: 'p5', code,
        requires: ['streaming'], nativeSize: { w: 400, h: 300 },
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    }, sketch)

    await setCode(page, `$: s("bd*4").viz("p21aukickbuiltin")`)
    await runCode(page)
    const canvas = page.locator('[data-viz-zone-track] canvas').first()
    await canvas.waitFor({ timeout: 8000 })

    const brightFrac = async () =>
      (await vizPixelStats(page, '[data-viz-zone-track] canvas',
        { rMin: 141, gMax: 109, bMax: 109 })).frac
    const samples: number[] = []
    for (let k = 0; k < 8; k++) { samples.push(await brightFrac()); await page.waitForTimeout(180) }

    expect(errors, `sketch errors with custom alias seeded: ${errors.join(' | ')}`).toEqual([])
    const range = Math.max(...samples) - Math.min(...samples)
    // Built-in sig.kick still swings the radius despite the custom map. A clobbered
    // built-in would freeze it (range 0). 5% of the zone mirrors T5-A.
    expect(range).toBeGreaterThan(0.05)
  })
})

test('inline ._pianoroll() renders under a NAMED track (drums:), not only $: (#725)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))

  // The reported pattern verbatim: a NAMED label (`drums:`) + pickRestart +
  // inline pianoroll. Pre-fix the zone never mounted because the engine's
  // line-scan (buildVizRequestsWithLines) filtered on `$:` and keyed `$N`,
  // while a named label is captured/keyed by its name.
  await setCode(page, [
    'drums: "<~@4 verse@8 chorus@8 verse@8 chorus@8 ~@4>".pickRestart({',
    '  verse: s("bd ~ sd ~ bd bd sd ~").bank("ajkpercusyn").gain(0.136).room(0.754).lpf(1790),',
    '  chorus: s("bd ~ [bd,sd] ~ bd ~ [bd,sd] ~").bank("RolandTR909"),',
    '})._pianoroll()',
  ].join('\n'))
  await runCode(page)

  const zone = page.locator('[data-viz-zone-track]').first()
  await expect(zone).toBeVisible({ timeout: 6000 })
  await expect(page.locator('[data-viz-zone-track] canvas').first()).toBeVisible({ timeout: 6000 })
  // underscore form is inline only — a named track must NOT pin the backdrop either
  await expect(page.locator('[data-workspace-background]')).toHaveCount(0)
  expect(errors, errors.join(' | ')).toEqual([])
})
