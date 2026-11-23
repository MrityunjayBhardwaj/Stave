/**
 * #2641 — a three.js sketch's own workers, blob URLs and intervals end when it
 * stops, so editing a sketch ten times leaves what one run of it left, not ten.
 *
 * The sketch starts two workers from blob URLs (the way a library such as Spark
 * starts its own), makes one more blob URL, and runs a `setInterval`. Each is
 * counted from OUTSIDE the sketch, because a worker the sketch forgot can't
 * report itself through the sketch:
 *   - every worker and every interval says it is alive on a BroadcastChannel
 *     several times a second; the page listens and counts who spoke lately;
 *   - every blob URL is announced once, and the page fetches each one: a revoked
 *     URL fails, a live one answers;
 *   - in Chromium, the browser's own list of worker targets (CDP) as a cross-check.
 *
 * Where a sketch runs decides what outlives it:
 *   - `main`   — the main-thread renderer (the fallback, and browsers that can't
 *                offload). The page outlives every sketch.
 *   - `pool`   — the viz worker kept warm and reused (opt-in, `stave.viz.pool`).
 *                The worker thread outlives the sketch.
 *   - `worker` — the default: each sketch gets a fresh worker and the old one is
 *                ended, which ends its children with it. The control.
 * In `pool`, half the workers are made through `globalThis.Worker`, the realm's
 * own constructor, which is what an imported library reaches.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, evalCode, seedCode, stopCode } from './_appBoot'

const PATTERN_TAB = '[data-workspace-tab="tab-pattern.strudel"]'
const CYCLES = 10
const WORKERS_PER_RUN = 2
const BLOBS_PER_RUN = 3

type Mode = 'worker' | 'main' | 'pool'

function sketch(edit: number, viaRealm: boolean): string {
  const second = viaRealm ? 'globalThis.Worker' : 'Worker'
  return [
    `import * as THREE from 'three'`,
    `const RUN = Math.random().toString(36).slice(2, 8)`,
    `const ch = new BroadcastChannel('teardown-2641')`,
    "const src = \"const c = new BroadcastChannel('teardown-2641'); const id = Math.random().toString(36).slice(2, 8); setInterval(() => c.postMessage({ k: 'w', id, run: '\" + RUN + \"' }), 150)\"",
    `const urls = [0, 1].map(() => URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))`,
    `new Worker(urls[0])`,
    `new ${second}(urls[1])`,
    `urls.push(URL.createObjectURL(new Blob(['x'.repeat(1000)])))`,
    `for (const url of urls) ch.postMessage({ k: 'blob', url, run: RUN })`,
    `setInterval(() => ch.postMessage({ k: 'tick', run: RUN }), 150)`,
    `const renderer = new THREE.WebGLRenderer()`,
    `renderer.setClearColor(0xff0000)`,
    `renderer.setAnimationLoop(() => renderer.clear())`,
    `// edit ${edit}`,
    ``,
  ].join('\n')
}

async function boot(page: Page, mode: Mode): Promise<void> {
  await page.addInitScript((m: Mode) => {
    try {
      localStorage.setItem('stave.viz.worker', m === 'main' ? '0' : '1')
      if (m === 'pool') localStorage.setItem('stave.viz.pool', '1')
    } catch {
      /* ignore */
    }
    const s = { workers: new Map<string, number>(), ticks: new Map<string, number>(), blobs: new Set<string>(), runs: new Set<string>() }
    ;(window as unknown as { __teardown2641: typeof s }).__teardown2641 = s
    new BroadcastChannel('teardown-2641').onmessage = (ev) => {
      const d = ev.data as { k: string; id?: string; run: string; url?: string }
      s.runs.add(d.run)
      if (d.k === 'w') s.workers.set(d.id!, performance.now())
      else if (d.k === 'tick') s.ticks.set(d.run, performance.now())
      else if (d.k === 'blob') s.blobs.add(d.url!)
    }
  }, mode)
  await bootApp(page, { e2eHooks: true })
}

/** Replace a viz file's content and fire the real save (what an edit does). */
async function saveThreeFile(page: Page, name: string, code: string): Promise<void> {
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
}

async function makeThreeFile(page: Page, name: string, code: string): Promise<void> {
  await page.locator('[data-sidebar]').hover()
  await page.locator('[data-sidebar] button[title="New file"]').click()
  await page.keyboard.type(`${name}.three`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await saveThreeFile(page, name, code)
  await page.locator(PATTERN_TAB).click()
  await page.waitForTimeout(300)
}

interface Count {
  runs: number
  liveWorkers: number
  tickingRuns: number
  blobsMade: number
  liveBlobs: number
  cdpWorkers: number | null
}

/** What is alive now: heard from within the last 700 ms (each speaks every 150). */
async function count(page: Page): Promise<Count> {
  await page.waitForTimeout(1200)
  const c = await page.evaluate(async () => {
    const s = (window as unknown as { __teardown2641: { workers: Map<string, number>; ticks: Map<string, number>; blobs: Set<string>; runs: Set<string> } }).__teardown2641
    const now = performance.now()
    const fresh = (m: Map<string, number>) => [...m.values()].filter((t) => now - t < 700).length
    let liveBlobs = 0
    for (const u of s.blobs) {
      try {
        if ((await fetch(u)).ok) liveBlobs++
      } catch {
        /* revoked */
      }
    }
    return { runs: s.runs.size, liveWorkers: fresh(s.workers), tickingRuns: fresh(s.ticks), blobsMade: s.blobs.size, liveBlobs }
  })
  let cdpWorkers: number | null = null
  const browser = page.context().browser()
  if (browser?.browserType().name() === 'chromium') {
    const cdp = await browser.newBrowserCDPSession()
    const { targetInfos } = (await cdp.send('Target.getTargets')) as { targetInfos: { type: string; url: string }[] }
    cdpWorkers = targetInfos.filter((t) => t.type === 'worker' && t.url.startsWith('blob:')).length
    await cdp.detach()
  }
  return { ...c, cdpWorkers }
}

/** A count once the page has settled: two reads in a row agree. A main-thread
 *  edit mounts the sketch twice, and a read taken between one run's teardown
 *  and the next one's start sees neither in full. Whatever really piles up
 *  still piles up in a settled read. */
async function settledCount(page: Page): Promise<Count> {
  let prev = await count(page)
  for (let i = 0; i < 10; i++) {
    const next = await count(page)
    if (JSON.stringify(next) === JSON.stringify(prev)) return next
    prev = next
  }
  return prev
}

async function waitForRuns(page: Page, n: number): Promise<void> {
  await page.waitForFunction(
    (k) => (window as unknown as { __teardown2641: { runs: Set<string> } }).__teardown2641.runs.size >= k,
    n,
    { timeout: 20000 },
  )
}

test.describe('#2641 a three.js sketch ends its workers, blob URLs and intervals when it stops', () => {
  test.describe.configure({ timeout: 180_000 })

  // Each mode with the gesture that, before #2641, left a run behind every time
  // (measured on main): an edit on the main thread (each edit there runs the
  // sketch twice, so that count is checked as at least one per edit), a
  // re-evaluate in a pooled worker (an edit there gets a fresh worker). The
  // default worker with an edit is the control: flat with or without the fix.
  const CASES = [
    { mode: 'main', gesture: 'edit' },
    { mode: 'main', gesture: 're-evaluate' },
    { mode: 'pool', gesture: 're-evaluate' },
    { mode: 'worker', gesture: 'edit' },
  ] as const
  for (const { mode, gesture } of CASES) {
    test(`${CYCLES} cycles of ${gesture} leave what one run leaves (${mode})`, async ({ page }) => {
      page.on('dialog', (d) => d.accept())
      const viaRealm = mode === 'pool'
      await boot(page, mode)
      await makeThreeFile(page, 'Teardown', sketch(0, viaRealm))
      await seedCode(page, `$: s("bd*4").viz("Teardown")`)
      await evalCode(page)
      await waitForRuns(page, 1)
      const one = await settledCount(page)

      for (let i = 1; i < CYCLES; i++) {
        if (gesture === 'edit') await saveThreeFile(page, 'Teardown', sketch(i, viaRealm))
        else await evalCode(page)
        await waitForRuns(page, i + 1)
        await page.waitForTimeout(500)
      }
      const ten = await settledCount(page)
      console.log(`[#2641] ${mode} ${gesture} after 1 ${JSON.stringify(one)} after ${CYCLES} ${JSON.stringify(ten)}`)

      // The instrument sees one run's worth after one run: it can see a worker,
      // an interval and a blob URL at all.
      expect(one.liveWorkers, 'one run: its workers are heard').toBe(WORKERS_PER_RUN)
      expect(one.tickingRuns, 'one run: its interval is heard').toBe(1)
      expect(one.liveBlobs, 'one run: its blob URLs answer').toBe(BLOBS_PER_RUN)
      // Every cycle really ran a new sketch.
      expect(ten.runs).toBeGreaterThanOrEqual(CYCLES)
      expect(ten.blobsMade).toBe(ten.runs * BLOBS_PER_RUN)

      expect(ten.liveWorkers, `after ${CYCLES} cycles: workers`).toBe(one.liveWorkers)
      expect(ten.tickingRuns, `after ${CYCLES} cycles: intervals`).toBe(one.tickingRuns)
      expect(ten.liveBlobs, `after ${CYCLES} cycles: blob URLs`).toBe(one.liveBlobs)
      if (one.cdpWorkers !== null) expect(ten.cdpWorkers, `after ${CYCLES} cycles: Chrome's worker targets`).toBe(one.cdpWorkers)
      await stopCode(page)
    })
  }
})
