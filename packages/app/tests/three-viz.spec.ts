/**
 * #2516 — a plain three.js sketch, pasted unchanged into a `.three` file, plays
 * with the music.
 *
 * The file is made the way a person makes one (the file tree's New file prompt),
 * then its content is replaced by the sketch from the issue, character for
 * character. Everything is read from what the page shows: canvas pixels through
 * the compositor (worker canvases can't be read back reliably any other way,
 * `_vizFrames.ts`), the Console's rows, and Chrome's own warning when WebGL
 * contexts pile up.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import { bootApp, evalCode, seedCode, stopCode } from './_appBoot'
import { vizPixelStats } from './_vizFrames'

/** The sketch from #2516's body, unchanged. */
const ISSUE_SKETCH = `import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100)
camera.position.set(0, 0, 6)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment()).texture

const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(1, 0.35, 256, 32),
  new THREE.MeshPhysicalMaterial({ color: '#2f6bff', clearcoat: 1, roughness: 0.2 }),
)
scene.add(knot)

renderer.setAnimationLoop(() => {
  knot.rotation.y += 0.01
  knot.scale.setScalar(1 + 0.4 * sig.bass)   // ← the one Stave line: the music
  renderer.render(scene, camera)
})
`

const ZONE = '[data-viz-zone] canvas'
const PATTERN_TAB = '[data-workspace-tab="tab-pattern.strudel"]'
const BG = '[data-workspace-background]'

/** Where a viz runs: the worker (the default) or the main thread (the fallback,
 *  and browsers that can't offload). */
type Mode = 'worker' | 'main'

async function boot(page: Page, mode: Mode = 'worker'): Promise<void> {
  await page.addInitScript((m: Mode) => {
    const w = window as unknown as Record<string, unknown>
    w.__STAVE_PERF__ = true
    try {
      localStorage.setItem('stave.viz.worker', m === 'main' ? '0' : '1')
    } catch {
      /* ignore */
    }
    // Count the page's live WebGL contexts directly: every one handed out, minus
    // those since lost. (A worker's contexts live in the worker, out of reach here.)
    const made: WebGLRenderingContext[] = []
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const ctx = (orig as (...a: unknown[]) => unknown).call(this, type, ...rest) as WebGLRenderingContext | null
      if (ctx && /webgl/.test(type) && !made.includes(ctx)) made.push(ctx)
      return ctx
    } as typeof orig
    w.__liveWebGL = () => made.filter((c) => !c.isContextLost()).length
  }, mode)
  await bootApp(page, { e2eHooks: true })
}

const liveWebGL = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __liveWebGL: () => number }).__liveWebGL())


/** Make `<name>.three` through the New file prompt, then paste `code` into it and save. */
async function makeThreeFile(page: Page, name: string, code: string): Promise<string> {
  await page.locator('[data-sidebar]').hover()
  await page.locator('[data-sidebar] button[title="New file"]').click()
  await page.keyboard.type(`${name}.three`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const id = await replaceThreeFile(page, name, code)
  await page.locator(PATTERN_TAB).click()
  await page.waitForTimeout(300)
  return id
}

/** Replace a viz file's content and fire the real save, with the pattern editor still mounted. */
async function replaceThreeFile(page: Page, name: string, code: string): Promise<string> {
  const id = await page.evaluate(
    ([n, c]) => {
      const w = window as unknown as {
        __staveOverrideVizFile: (n: string, c: string) => string | null
        __staveSaveVizFileById: (id: string) => boolean
      }
      const fid = w.__staveOverrideVizFile(n, c)
      if (fid) w.__staveSaveVizFileById(fid)
      return fid
    },
    [name, code] as const,
  )
  expect(id, `${name}.three exists`).not.toBeNull()
  return id!
}

interface Gauges {
  worker: number
  three: number
  glctx: number
}
async function gauges(page: Page): Promise<Gauges> {
  return page.evaluate(() => {
    const g = (window as unknown as { __stavePerf?: { snapshot(): { gauges: Record<string, number> } } }).__stavePerf
      ?.snapshot?.().gauges ?? {}
    return { worker: g['viz.worker'] ?? 0, three: g['viz.three'] ?? 0, glctx: g['viz.glctx'] ?? 0 }
  })
}

/** The fraction of the inline canvas the knot covers, sampled `n` times. */
async function coverage(page: Page, n: number, gapMs: number): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push((await vizPixelStats(page, ZONE, { anyChannelMin: 50 })).frac)
    await page.waitForTimeout(gapMs)
  }
  return out
}
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
/** Mean frame-to-frame change. The knot's slow turn moves its outline smoothly;
 *  a kick swells it within a frame or two, so pulsing shows up here and the turn
 *  mostly doesn't (a plain max−min spread is dominated by the turn). */
const jitter = (xs: number[]): number => mean(xs.slice(1).map((x, i) => Math.abs(x - xs[i])))

/** Wait until the inline canvas shows the sketch itself: three's black clear
 *  over most of it. Before its first frame the canvas is transparent and the
 *  compositor shows whatever is behind it (the project's background viz). */
async function waitForSketch(page: Page, sel = ZONE): Promise<void> {
  await page.locator(sel).first().waitFor({ timeout: 20000 })
  await expect
    .poll(async () => (await vizPixelStats(page, sel, { rMax: 12, gMax: 12, bMax: 12 })).frac, { timeout: 30000 })
    .toBeGreaterThan(0.3)
}

interface LogRow {
  level: string
  runtime: string
  source?: string
  message: string
  line?: number
}
async function threeRows(page: Page): Promise<LogRow[]> {
  return page.evaluate(() =>
    ((window as unknown as { __staveGetLog: () => LogRow[] }).__staveGetLog() ?? []).filter((r) => r.runtime === 'three'),
  )
}

test.describe('#2516 three.js: a plain sketch plays with the music', () => {
  test.describe.configure({ timeout: 120_000 })

  test('the pasted sketch draws inline and swells with a playing pattern; a silent one stays still', async ({ page }) => {
    await boot(page)
    await makeThreeFile(page, 'Knot', ISSUE_SKETCH)

    await seedCode(page, `$: s("bd*4").bank("RolandTR909").viz("Knot")`)
    await evalCode(page)
    await waitForSketch(page)

    const g = await gauges(page)
    expect(g.worker, 'it runs in the viz worker').toBeGreaterThan(0)
    expect(g.three, 'no main-thread fallback').toBe(0)
    expect(g.glctx, 'one live WebGL context').toBeGreaterThanOrEqual(1)

    const loud = await coverage(page, 24, 60)

    // The silent control: the same sketch, the same pattern, no sound.
    await stopCode(page)
    await seedCode(page, `$: s("bd*4").bank("RolandTR909").gain(0).viz("Knot")`)
    await evalCode(page)
    await waitForSketch(page)
    await page.waitForTimeout(1000)
    const quiet = await coverage(page, 24, 60)

    console.log(`[#2516] loud ${JSON.stringify(loud.map((x) => +x.toFixed(4)))}`)
    console.log(`[#2516] quiet ${JSON.stringify(quiet.map((x) => +x.toFixed(4)))}`)
    expect(mean(quiet), 'the silent knot still draws').toBeGreaterThan(0.01)
    console.log(`[#2516] jitter loud ${jitter(loud).toFixed(4)} quiet ${jitter(quiet).toFixed(4)}`)
    expect(mean(loud), 'the playing knot draws').toBeGreaterThan(0.01)
    // With the kick the knot swells up to 1.4×; silent, only its turn moves the outline.
    expect(jitter(loud), 'the knot pulses with the music').toBeGreaterThan(2.5 * jitter(quiet) + 0.002)
    await stopCode(page)
  })

  // By default each edit ends the viz worker, which frees its contexts whatever the
  // sketch did, so a leak can only show where a context outlives its mount: on the
  // main thread (the fallback, and browsers that can't offload), counted here
  // directly. (A pooled worker, opt-in, keeps its thread too; its contexts are out
  // of the page's reach, so its teardown is pinned by the unit test instead.)
  for (const mode of ['main'] as const) {
    test(`editing the file swaps the sketch, and twenty edits leave no WebGL contexts behind (${mode})`, async ({ page }) => {
      const tooMany: string[] = []
      const watch = (m: ConsoleMessage) => {
        if (/too many active webgl contexts/i.test(m.text())) tooMany.push(m.text())
      }
      page.on('console', watch)

      await boot(page, mode)
      await makeThreeFile(page, 'Swap', ISSUE_SKETCH)
      await seedCode(page, `$: s("bd*4").bank("RolandTR909").viz("Swap")`)
      await evalCode(page)
      await waitForSketch(page)
      const before = { ...(await gauges(page)), live: await liveWebGL(page) }
      if (mode === 'main') expect(before.three, 'the main-thread renderer is the one drawing').toBeGreaterThan(0)

      // Each edit is a different sketch: a flat red screen when even, the knot when odd.
      const RED = `import * as THREE from 'three'
const renderer = new THREE.WebGLRenderer()
renderer.setClearColor(0xff0000)
renderer.setAnimationLoop(() => renderer.clear())
// edit `
      for (let i = 0; i < 20; i++) {
        await replaceThreeFile(page, 'Swap', i % 2 === 0 ? `${RED}${i}\n` : `${ISSUE_SKETCH}// edit ${i}\n`)
        await page.waitForTimeout(700)
      }
      // the last edit (i = 19) is the knot; one more makes it red, which is easy to read
      await replaceThreeFile(page, 'Swap', `${RED}final\n`)
      await expect
        .poll(async () => (await vizPixelStats(page, ZONE, { rMin: 200, gMax: 40, bMax: 40 })).frac, { timeout: 15000 })
        .toBeGreaterThan(0.8)

      const after = { ...(await gauges(page)), live: await liveWebGL(page) }
      console.log(`[#2516] ${mode} before ${JSON.stringify(before)} after ${JSON.stringify(after)} warnings ${tooMany.length}`)
      expect(after.live, 'live WebGL contexts on the page are flat').toBeLessThanOrEqual(before.live)
      expect(tooMany, 'Chrome never ran out of WebGL contexts').toEqual([])
      await stopCode(page)
    })
  }

  // An inline zone renders at the inline resolution and is scaled to the column,
  // like every viz kind (#261, #1439); a panel that fills its box (the background,
  // the preview) is the one that resizes its renderer, so that is where this looks.
  test('a requestAnimationFrame sketch runs, and resizing the panel resizes its render', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await boot(page)
    // A red square, 200 × 200 render pixels, on black. Whatever scale the panel
    // renders at, it stays square only if the sketch's size follows the panel: a
    // stale render is stretched to the new box and the square is squeezed.
    const bandId = await makeThreeFile(
      page,
      'Square',
      `import * as THREE from 'three'
const renderer = new THREE.WebGLRenderer()
renderer.setSize(innerWidth, innerHeight)
window.addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight))
function frame() {
  renderer.setScissorTest(false)
  renderer.setClearColor(0x000000)
  renderer.clear()
  renderer.setScissorTest(true)
  renderer.setScissor(0, 0, 200, 200)
  renderer.setClearColor(0xff0000)
  renderer.clear()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
`,
    )
    await seedCode(page, `$: s("bd*4")\nall(x => x.viz("Square"))`)
    await evalCode(page)
    await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', bandId, { timeout: 10000 })
    const CANVAS = `${BG} canvas`
    await waitForSketch(page, CANVAS)
    /** On-screen width ÷ height of the red square (a solid rectangle: area ÷ rows). */
    const aspect = async () => {
      const st = await vizPixelStats(page, CANVAS, { rMin: 200, gMax: 40, bMax: 40 })
      const rows = st.maxY - st.minY + 1
      return { box: (await page.locator(CANVAS).first().boundingBox())!.width, aspect: st.count / rows / rows }
    }
    const wide = await aspect()
    await page.setViewportSize({ width: 900, height: 720 })
    await expect.poll(async () => (await page.locator(CANVAS).first().boundingBox())!.width, { timeout: 10000 }).toBeLessThan(wide.box - 100)
    await page.waitForTimeout(1500)
    const narrow = await aspect()
    console.log(`[#2516] square wide ${JSON.stringify(wide)} narrow ${JSON.stringify(narrow)}`)
    expect(wide.aspect, 'the square is square').toBeGreaterThan(0.85)
    expect(wide.aspect).toBeLessThan(1.18)
    expect(narrow.aspect, 'and still square after the panel narrows').toBeGreaterThan(0.85)
    expect(narrow.aspect).toBeLessThan(1.18)
    await stopCode(page)
  })

  test('.viz("name", { … }) options reach stave.options', async ({ page }) => {
    await boot(page)
    await makeThreeFile(
      page,
      'Tint',
      `import * as THREE from 'three'
const renderer = new THREE.WebGLRenderer()
renderer.setAnimationLoop(() => {
  renderer.setClearColor(stave.options.tint === 'red' ? 0xff0000 : 0x0000ff)
  renderer.clear()
})
`,
    )
    await seedCode(page, `$: s("bd*4").viz("Tint", { tint: 'red' })`)
    await evalCode(page)
    await expect
      .poll(async () => (await vizPixelStats(page, ZONE, { rMin: 200, gMax: 40, bMax: 40 })).frac, { timeout: 20000 })
      .toBeGreaterThan(0.8)
    await stopCode(page)
  })

  test('a runtime error, an unsupported import and pointer input each say so in the Console, on their line', async ({ page }) => {
    await boot(page)
    await makeThreeFile(page, 'Broken', `import * as THREE from 'three'\n\nconst x = 1\nnotDefined()\n`)
    await makeThreeFile(page, 'Gui', `import * as THREE from 'three'\nimport GUI from 'lil-gui'\n`)
    await makeThreeFile(
      page,
      'Mouse',
      `import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
`,
    )
    await makeThreeFile(
      page,
      'Pointer',
      `import * as THREE from 'three'
const renderer = new THREE.WebGLRenderer()
window.addEventListener('pointermove', () => {})
renderer.setAnimationLoop(() => renderer.clear())
`,
    )
    // Throws only after five good frames: the worker is already drawing, so it
    // reports this itself rather than falling back.
    await makeThreeFile(
      page,
      'Late',
      `import * as THREE from 'three'
const renderer = new THREE.WebGLRenderer()
let n = 0
renderer.setAnimationLoop(() => {
  renderer.clear()
  if (++n > 5) lateTypo()
})
`,
    )
    // Throws from its very first frame (#2524).
    await makeThreeFile(
      page,
      'First',
      `import * as THREE from 'three'
const renderer = new THREE.WebGLRenderer()
renderer.setAnimationLoop(() => {
  firstTypo()
})
`,
    )
    await seedCode(
      page,
      `$: s("rim").viz("First")\n$: s("rim").viz("Late")\n$: s("bd").viz("Broken")\n$: s("hh").viz("Gui")\n$: s("sd").viz("Mouse")\n$: s("cp").viz("Pointer")`,
    )
    await evalCode(page)
    await expect.poll(async () => (await threeRows(page)).length, { timeout: 20000 }).toBeGreaterThanOrEqual(6)
    const rows = await threeRows(page)
    console.log(`[#2516] rows ${JSON.stringify(rows)}`)
    const row = (file: string) => rows.find((r) => (r.source ?? '').endsWith(file))
    expect(row('Broken.three'), 'the runtime error').toMatchObject({ level: 'error', line: 4 })
    expect(row('Broken.three')!.message).toMatch(/notDefined/)
    expect(row('Gui.three'), 'the unsupported import').toMatchObject({ level: 'error', line: 2 })
    expect(row('Gui.three')!.message).toMatch(/'lil-gui' isn't available in Stave/)
    expect(row('Mouse.three'), 'OrbitControls').toMatchObject({ level: 'error', line: 2 })
    expect(row('Mouse.three')!.message).toMatch(/needs pointer input/)
    expect(row('Pointer.three'), 'a pointer listener').toMatchObject({ level: 'warn', line: 3 })
    expect(row('Late.three'), 'an error in the loop, after it started drawing').toMatchObject({ level: 'error', line: 6 })
    expect(row('Late.three')!.message).toMatch(/lateTypo/)
    expect(row('First.three'), 'an error in the loop from its first frame').toMatchObject({ level: 'error', line: 4 })
    expect(row('First.three')!.message).toMatch(/firstTypo/)
    await stopCode(page)
  })

  test('a three.js sketch can be the background, chosen in the background picker', async ({ page }) => {
    await boot(page)
    const greenId = await makeThreeFile(
      page,
      'Green',
      `import * as THREE from 'three'
const renderer = new THREE.WebGLRenderer()
renderer.setClearColor(0x00ff00)
renderer.setAnimationLoop(() => renderer.clear())
`,
    )
    await seedCode(page, `$: s("bd*4")`)
    await page.locator('[data-testid="strudel-chrome-bg-toggle"]').click()
    const picker = page.locator('[data-testid="backdrop-popover-picker"]')
    const green = await picker
      .locator('option')
      .evaluateAll((os) => os.map((o) => [o.getAttribute('value'), o.textContent ?? ''] as const).find(([, t]) => /green/i.test(t))?.[0] ?? null)
    expect(green, 'the .three file is offered as a background').not.toBeNull()
    await picker.selectOption(green!)
    await page.keyboard.press('Escape')
    await evalCode(page)
    await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', greenId, { timeout: 10000 })
    await expect
      .poll(async () => (await vizPixelStats(page, `${BG} canvas`, { gMin: 200, rMax: 40, bMax: 40 })).frac, { timeout: 20000 })
      .toBeGreaterThan(0.5)
    await stopCode(page)
  })
})
