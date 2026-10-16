import { test, expect, type Page } from '@playwright/test'
import { chooseDisplay, shownDisplay } from './_laneType'

import { bootApp, seedCode } from './_appBoot'
import { readInk, firstMark, allMarks, markVariation, alternatingWav } from './_waveformInk'

/**
 * The instrument for #1506 — a take draws its waveform on the Song timeline.
 *
 * Every other test of this feature runs against a recording mock context, which
 * reports that a fill was REQUESTED. That is a different question from whether
 * anything reached a screen, and the difference is not academic here: the first
 * version of this feature drew the whole waveform invisibly, in the bar's own
 * colour at the bar's own opacity, and eleven green geometry arms said nothing.
 * So this spec reads pixels back off the real canvas.
 *
 * ## What is measured, and what it does not isolate
 *
 * The fixture is a one-second take that is LOUD for its first half and SILENT
 * for its second. The measurement is a RATIO of two readings inside a single
 * canvas snapshot — the height of saturated lane ink in the loud quarter of the
 * mark against the same reading in the silent quarter. Never an absolute pixel
 * count: a canvas is a device, and a stroke does not cover the columns you asked
 * for.
 *
 * The ratio establishes that what is drawn TRACKS THE AUDIO'S AMPLITUDE, in the
 * right place, at the right scale. It does not establish that the shape is the
 * correct waveform of that sample — a rendering that drew any loud-then-quiet
 * envelope would satisfy it. That is deliberate: the exact envelope is the pure
 * `computePeaks` arithmetic, tested exhaustively where it can be tested exactly.
 *
 * ## Why it reloads
 *
 * The warm-up that makes a take visible before it is played hangs off project
 * load. Importing and then reloading is the real path, not a shortcut around it.
 */

interface AssetRecord {
  id: string
  name: string
  blobHash: string
  mime: string
  duration?: number
}

interface PageProbe {
  reset(): Promise<void>
  import(
    base64: string,
    mime: string,
    filename: string,
    existing?: AssetRecord[],
  ): Promise<{ record: AssetRecord; isFirstReference: boolean; written: boolean }>
  docAdd(record: AssetRecord): Promise<void>
  docList(): Promise<AssetRecord[]>
  inSoundMap(name: string): boolean
}

/**
 * Reached by cast rather than by a `declare global`. Three specs already declare
 * this window property with their own local `PageProbe`, and each additional
 * declaration is another duplicate-identifier error in the type-check; the cast
 * keeps this file from adding a fourth.
 */
type ProbeWindow = Window & { __staveAssetProbe?: PageProbe }

const SAMPLE_RATE = 44100
/** One second: long enough to occupy a readable share of a mark at any tempo. */
const TOTAL_FRAMES = SAMPLE_RATE

/**
 * A mono 16-bit WAV whose first half is a full-scale tone and whose second half
 * is digital silence.
 *
 * The asymmetry IS the instrument. A uniform tone would draw the same block a
 * plain bar draws, and the reading could not tell the feature from its absence.
 */
function loudThenSilentWav(): string {
  const data = Buffer.alloc(TOTAL_FRAMES * 2)
  const half = TOTAL_FRAMES / 2
  for (let i = 0; i < half; i++) {
    // 220 Hz at 0.9 full scale — loud, and periodic enough that every drawn
    // column of the loud half contains both a peak and a trough.
    const v = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * 0.9
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  // The remaining frames stay zero.

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data]).toString('base64')
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * How much of ONE lit mark's interior the overlay COVERS.
 *
 * ⚠ Reads `[data-full-song-overlay]` — the SECOND surface. The base canvas keeps
 * the waveform intact under either behaviour, so measuring it answers a
 * different question than this one; that mistake is what made the first attempt
 * at this measurement read as reassuring (#1508).
 *
 * Isolates the FIRST contiguous run of painted columns rather than bounding the
 * whole overlay. Two marks lighting at once would put the empty gap between them
 * inside a global bounding box, and an interior that is mostly gap reads as
 * "uncovered" no matter which way the mark is drawn — the arm would pass for a
 * reason that has nothing to do with the fix.
 */
async function litMarkCoverage(
  page: Page,
): Promise<{ painted: number; cols: number; interior: number; covered: number }> {
  return page.evaluate(() => {
    const NONE = { painted: 0, cols: 0, interior: 0, covered: 0 }
    const c = document.querySelector('[data-full-song-overlay]') as HTMLCanvasElement | null
    if (!c) return NONE
    const ctx = c.getContext('2d')
    if (!ctx || c.width === 0) return NONE
    const { width, height } = c
    const d = ctx.getImageData(0, 0, width, height).data
    const alphaAt = (x: number, y: number) => d[(y * width + x) * 4 + 3]

    let painted = 0
    const colPainted: number[] = []
    for (let x = 0; x < width; x++) {
      let n = 0
      for (let y = 0; y < height; y++) if (alphaAt(x, y) > 10) n++
      colPainted.push(n)
      painted += n
    }
    // First contiguous run of inked columns = one mark.
    let x0 = -1
    let x1 = -1
    for (let x = 0; x < width; x++) {
      if (colPainted[x] > 0) {
        if (x0 < 0) x0 = x
        x1 = x
      } else if (x0 >= 0) break
    }
    if (x0 < 0) return { painted, cols: 0, interior: 0, covered: 0 }

    let y0 = height
    let y1 = -1
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < height; y++) {
        if (alphaAt(x, y) > 10) {
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    // Inset by the GLOW PAD alone, so the region measured is the mark's own rows
    // right out to its edge. The pad is 2 CSS px and the core ring lies inside
    // that same band, so the painted bounding box is set by the glow alone —
    // insetting by more than 2 skips the mark's outermost row, which is exactly
    // where ink that covers a full-scale peak would sit. Two earlier versions of
    // this inset (4, then 3) each read a clean 0 while the outer row was being
    // painted. Backing-store px, since the canvas is DPR-scaled.
    const dpr = Math.max(1, Math.round(width / Math.max(1, c.clientWidth)))
    const pad = 2 * dpr
    const ix0 = x0 + pad
    const ix1 = x1 - pad
    const iy0 = y0 + pad
    const iy1 = y1 - pad
    if (ix1 <= ix0 || iy1 <= iy0) return { painted, cols: x1 - x0 + 1, interior: 0, covered: 0 }
    let interior = 0
    let covered = 0
    for (let y = iy0; y <= iy1; y++) {
      for (let x = ix0; x <= ix1; x++) {
        interior++
        if (alphaAt(x, y) > 178) covered++ // 0.7 x 255 — the lit CORE's own floor
      }
    }
    return { painted, cols: x1 - x0 + 1, interior, covered }
  })
}

/**
 * One cycle — one slot — in canvas (backing-store) pixels, off the ruler's own
 * ticks, the `loop-locators` reading. Never off the ink being judged: a claim
 * about where sound sits inside its slot needs the slot measured independently.
 */
async function cyclePx(page: Page): Promise<number> {
  const { ticks, dpr } = await page.evaluate(() => ({
    ticks: Array.from(document.querySelectorAll('[data-full-song-tick]')).map((t) => ({
      label: (t.textContent ?? '').trim(),
      left: parseFloat((t as HTMLElement).style.left) || 0,
    })),
    dpr: window.devicePixelRatio || 1,
  }))
  const at = (label: string) => ticks.find((t) => t.label === label)?.left ?? 0
  return (at('1') - at('0')) * dpr
}

async function bootWithTimeline(page: Page): Promise<void> {
  await bootApp(page, { e2eHooks: true, drawer: { tabId: 'musical-timeline' } })
  await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
}

test.describe('a take is visible on the Song timeline', () => {
  test('its drawn shape follows the take’s own loud and silent halves', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await bootWithTimeline(page)
    await page.evaluate(() => (window as ProbeWindow).__staveAssetProbe!.reset())

    // Import the take and record it in the project, exactly as saving one does.
    const wav = loudThenSilentWav()
    const record = await page.evaluate(async (base64) => {
      const p = (window as ProbeWindow).__staveAssetProbe!
      const res = await p.import(base64, 'audio/wav', 'take_1.wav', await p.docList())
      await p.docAdd(res.record)
      return res.record
    }, wav)
    expect(record.name).toBe('take_1')

    // The code that plays it, then a reload — which is what registers the
    // project's assets AND warms them, the path a real session takes.
    await seedCode(page, '$: s("take_1")')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
    await page.waitForFunction(() => (window as ProbeWindow).__staveAssetProbe!.inSoundMap('take_1'), undefined, {
      timeout: 30_000,
    })
    await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })
    // #2079 — a 1 s take is shorter than a bar, so its lane defaults to Bars; save Waveform.
    await chooseDisplay(page, 'd1', 'waveform')

    // A tall row so the shape has amplitude to spend. The DEFAULT row height is
    // covered by a unit arm; here the point is the pixels, and a 30px mark makes
    // the reading unambiguous rather than marginal.
    await page.evaluate(() => {
      try {
        localStorage.setItem('stave:musicalTimeline.subRowHeight', '48')
      } catch {
        /* ignore */
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })
    await page.waitForFunction(() => (window as ProbeWindow).__staveAssetProbe!.inSoundMap('take_1'), undefined, {
      timeout: 30_000,
    })

    // Wait for ink to actually arrive — the warm-up is async, and its whole job
    // is to make the canvas repaint once the decode lands.
    await expect
      .poll(async () => (await readInk(page)).columns.filter((n) => n > 0).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(20)

    const profile = await readInk(page)
    const mark = firstMark(profile)
    expect(mark.length).toBeGreaterThan(20)

    // The claim, as a ratio of two readings inside ONE snapshot: the mark's own
    // full height against the quietest column drawn inside it. A bar-only
    // rendering is flat, so every column is the full height and the ratio is 1.
    // A waveform of a take that is loud and then silent must reach both.
    const tallest = Math.max(...mark)
    const quietest = Math.min(...mark.filter((n) => n > 0))

    // eslint-disable-next-line no-console
    console.log(`[#1506] tallest=${tallest} quietest=${quietest} ratio=${(tallest / quietest).toFixed(2)}`)
    expect(tallest / quietest).toBeGreaterThan(3)

    // …and the quiet columns are where this take's silence actually is — not
    // merely somewhere convenient. The take is 1s, loud then silent, in a 2s
    // slot, so its silence begins a quarter of the way into the SLOT. Measured
    // against the slot off the ruler (#1730): the mark's own ink no longer runs
    // to the slot's end, because the part of a clip past its audio is body.
    const slot = await cyclePx(page)
    expect(slot, 'the ruler must show cycle ticks').toBeGreaterThan(10)
    const quietestIndex = mark.indexOf(quietest)
    expect(quietestIndex).toBeGreaterThan(slot * 0.2)
    expect(quietestIndex).toBeLessThan(slot / 2)

    expect(errors).toEqual([])
  })

  test('EXPANDING its lane keeps the shape — it does not flatten to a bar (#1713)', async ({ page }) => {
    // Expanding a lane is how you ask to see MORE of a track. For a take it used
    // to show less: the expanded band drew every mark as a 4px pitch sliver, too
    // short for a waveform, so the shape above became one flat line. Same
    // reading as the first arm — tallest over quietest inside one mark — taken
    // with the lane expanded by its real caret.
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await bootWithTimeline(page)
    await page.evaluate(() => (window as ProbeWindow).__staveAssetProbe!.reset())

    const wav = loudThenSilentWav()
    await page.evaluate(async (base64) => {
      const p = (window as ProbeWindow).__staveAssetProbe!
      const res = await p.import(base64, 'audio/wav', 'take_1.wav', await p.docList())
      await p.docAdd(res.record)
    }, wav)

    await seedCode(page, '$: s("take_1")')
    await page.evaluate(() => {
      try {
        localStorage.setItem('stave:musicalTimeline.subRowHeight', '48')
      } catch {
        /* ignore */
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
    await page.waitForFunction(() => (window as ProbeWindow).__staveAssetProbe!.inSoundMap('take_1'), undefined, {
      timeout: 30_000,
    })
    await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })
    // #2079 — a 1 s take is shorter than a bar, so its lane defaults to Bars; save Waveform.
    await chooseDisplay(page, 'd1', 'waveform')

    // PRECONDITION: collapsed, the shape is there. Without it an expanded reading
    // of 1 could mean "the take never drew", not "expanding flattened it".
    await expect
      .poll(async () => {
        const m = firstMark(await readInk(page))
        return m.length > 20 ? Math.max(...m) / Math.min(...m.filter((n) => n > 0)) : 0
      }, { timeout: 30_000 })
      .toBeGreaterThan(3)

    const caret = page.locator('[data-full-song-lane-expand]').first()
    const laneKey = await caret.getAttribute('data-full-song-lane-expand')
    await caret.click({ timeout: 3000 })
    await expect(page.locator(`[data-full-song-lane="${laneKey}"]`)).toHaveAttribute('data-expanded', 'true')

    await expect
      .poll(async () => firstMark(await readInk(page)).length, { timeout: 20_000 })
      .toBeGreaterThan(20)
    const mark = firstMark(await readInk(page))
    const tallest = Math.max(...mark)
    const quietest = Math.min(...mark.filter((n) => n > 0))
    // eslint-disable-next-line no-console
    console.log(`[#1713] expanded tallest=${tallest} quietest=${quietest} ratio=${(tallest / quietest).toFixed(2)}`)
    expect(tallest / quietest).toBeGreaterThan(3)
    expect(mark.indexOf(quietest)).toBeLessThan(mark.length / 2)

    expect(errors).toEqual([])
  })

  test('at the DEFAULT row height a collapsed take fills its row, where a synth track beside it stays a thin bar (#1730)', async ({ page }) => {
    // The two arms above make the row 48px tall so the shape has room. At the
    // default 25px a collapsed mark was 7px, the band less the 12px kept for
    // pitch, so a take looked like every other bar until its lane was expanded.
    // A lane whose every sound is a file now gives its marks the whole row.
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await bootWithTimeline(page)
    await page.evaluate(() => (window as ProbeWindow).__staveAssetProbe!.reset())
    await page.evaluate(() => {
      try {
        localStorage.removeItem('stave:musicalTimeline.subRowHeight')
      } catch {
        /* ignore */
      }
    })

    const wav = loudThenSilentWav()
    await page.evaluate(async (base64) => {
      const p = (window as ProbeWindow).__staveAssetProbe!
      const res = await p.import(base64, 'audio/wav', 'take_1.wav', await p.docList())
      await p.docAdd(res.record)
    }, wav)

    // The take alone first, so its ink is the only lane ink on the canvas.
    await seedCode(page, 'vox: s("take_1")')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
    await page.waitForFunction(() => (window as ProbeWindow).__staveAssetProbe!.inSoundMap('take_1'), undefined, {
      timeout: 30_000,
    })
    await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })
    // #2079 — a 1 s take is shorter than a bar, so its lane defaults to Bars; save Waveform.
    await chooseDisplay(page, 'vox', 'waveform')

    const lane = page.locator('[data-full-song-lane]').first()
    await expect(lane).toHaveAttribute('data-expanded', 'false')
    const rowCss = await lane.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height)
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1)
    const rowPx = rowCss * dpr

    // Ink RUNS, with where each starts. A slot here is one cycle; the 1s take
    // fills half of it, loud then silent, and the rest of the slot is clip body.
    // So a drawn shape's first run is the loud half alone.
    const runs = async () => {
      const { columns } = await readInk(page)
      const out: { start: number; len: number }[] = []
      columns.forEach((n, x) => {
        const last = out[out.length - 1]
        if (n > 0) {
          if (last && last.start + last.len === x) last.len++
          else out.push({ start: x, len: 1 })
        }
      })
      return out
    }
    const slot = await cyclePx(page)
    expect(slot, 'the ruler must show cycle ticks').toBeGreaterThan(10)
    // The claim that it is the take's SHAPE, not a taller bar: a mark with no
    // shape is ink across its whole slot (at full weight, or as a body with
    // nothing brighter on the canvas), so its first run is at least a cycle
    // long. The loud half of a 1s take in a 2s slot is a quarter of the slot.
    // Bounded below too: with no shape on the canvas the brightest ink left is
    // a 1px accent line at the lane's edge, and a run that short is not a
    // waveform either. Polled, because it only becomes true once the decode lands.
    const loudShare = async () => {
      const r = await runs()
      return r.length > 0 ? r[0].len / slot : 1
    }
    await expect.poll(loudShare, { timeout: 30_000 }).toBeLessThan(0.4)
    expect(await loudShare()).toBeGreaterThan(0.1)
    const r = await runs()
    const tallest = Math.max(...firstMark(await readInk(page)))
    // eslint-disable-next-line no-console
    console.log(`[#1730] row=${rowPx}px tallest=${tallest}px fill=${(tallest / rowPx).toFixed(2)} runs=${r.map((x) => x.len).join(',')} cycle=${slot}px`)
    // The waveform reaches most of the row — a 7px mark in a 25px row is 0.28.
    expect(tallest / rowPx).toBeGreaterThan(0.6)

    // CONTROL: a synth track has no file, so its lane keeps the thin bar.
    await seedCode(page, 'lead: note("c4 e4").s("sawtooth")')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })
    await expect
      .poll(async () => firstMark(await readInk(page)).length, { timeout: 30_000 })
      .toBeGreaterThan(20)
    const synth = firstMark(await readInk(page))
    // eslint-disable-next-line no-console
    console.log(`[#1730] synth tallest=${Math.max(...synth)}px of row ${rowPx}px`)
    expect(Math.max(...synth) / rowPx).toBeLessThan(0.45)

    expect(errors).toEqual([])
  })

  test('while it sounds, the lit mark outlines the shape instead of covering it', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await bootWithTimeline(page)
    await page.evaluate(() => (window as ProbeWindow).__staveAssetProbe!.reset())

    const wav = loudThenSilentWav()
    await page.evaluate(async (base64) => {
      const p = (window as ProbeWindow).__staveAssetProbe!
      const res = await p.import(base64, 'audio/wav', 'take_1.wav', await p.docList())
      await p.docAdd(res.record)
    }, wav)

    await seedCode(page, '$: s("take_1")')
    await page.evaluate(() => {
      try {
        localStorage.setItem('stave:musicalTimeline.subRowHeight', '48')
      } catch {
        /* ignore */
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
    await page.waitForFunction(() => (window as ProbeWindow).__staveAssetProbe!.inSoundMap('take_1'), undefined, {
      timeout: 30_000,
    })
    await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })
    // #2079 — a 1 s take is shorter than a bar, so its lane defaults to Bars; save Waveform.
    await chooseDisplay(page, 'd1', 'waveform')

    // PRECONDITION, asserted rather than assumed: the base canvas really is
    // drawing a shape here. Without this the coverage reading below would be
    // measuring a lit mark that has no waveform to hide, and would pass.
    await expect
      .poll(async () => firstMark(await readInk(page)).length, { timeout: 30_000 })
      .toBeGreaterThan(20)

    // Play. A CLICK first — a programmatic focus carries no user gesture and the
    // transport then reports no position, so nothing ever lights (#885).
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press(`${MOD}+Enter`)
    await page.locator('[data-full-song-overlay]').waitFor({ timeout: 20_000 })

    // Wait until a mark is actually lit AND is wide enough to have an interior.
    await expect
      .poll(async () => (await litMarkCoverage(page)).cols, {
        timeout: 20_000,
        message: 'the overlay never lit a mark wide enough to measure',
      })
      .toBeGreaterThan(20)

    const lit = await litMarkCoverage(page)
    // eslint-disable-next-line no-console
    console.log(
      `[#1508] painted=${lit.painted} cols=${lit.cols} interior=${lit.interior} covered=${lit.covered} ` +
        `coverage=${(lit.covered / Math.max(1, lit.interior)).toFixed(3)}`,
    )

    // The light is still THERE — this is the half that fails if the fix simply
    // stopped drawing, which would "pass" a coverage test perfectly.
    expect(lit.painted).toBeGreaterThan(0)
    expect(lit.interior).toBeGreaterThan(0)
    // …and it covers NOTHING. Zero rather than a ratio, because the three cases
    // were measured and a ratio cannot separate them: over this 229x30 mark the
    // covered count reads 0 with the rings outside, 448 with a 1px border drawn
    // ON the mark, and 6750 when the mark is filled. As a fraction of the
    // interior that middle case is 0.066 — under any threshold loose enough to
    // be safe, and it is a real defect. The count is what discriminates.
    expect(lit.covered).toBe(0)

    await page.screenshot({ path: 'test-results/take-waveform-lit-outline.png' })
    expect(errors).toEqual([])
  })

  test('two marks of ONE file differ when they play different halves of it', async ({ page }) => {
    // The #1512 claim, in pixels: a mark draws the slice it PLAYS.
    //
    // ## Why both halves live in one document
    //
    // The two readings compared below come from a SINGLE canvas snapshot. Two
    // page loads would be two device states, and a difference between them could
    // be a difference in the device — which is exactly the confusion an absolute
    // pixel count invites. `cat` puts the two spellings on one lane as
    // consecutive marks, so one frame holds the whole comparison.
    //
    // ## Why the QUIETEST column and not the tallest
    //
    // A mark is inked across its full width: the waveform covers only the part
    // of the mark its audio is worth, and the plain bar fills the rest at full
    // height. So the TALLEST column of any mark is the bar, whatever the
    // waveform does, and it discriminates nothing. The quietest column is inside
    // the waveform, and it is what tells a flat slice from a full-scale one.
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await bootWithTimeline(page)
    await page.evaluate(() => (window as ProbeWindow).__staveAssetProbe!.reset())

    // The take is loud for its first half and silent for its second.
    const wav = loudThenSilentWav()
    await page.evaluate(async (base64) => {
      const p = (window as ProbeWindow).__staveAssetProbe!
      const res = await p.import(base64, 'audio/wav', 'take_1.wav', await p.docList())
      await p.docAdd(res.record)
    }, wav)

    // Mark 1 plays the file's LOUD half, mark 2 its SILENT half. Same file, same
    // width, same lane, same frame — the region is the only difference.
    //
    // ⚠ THE SILENT CYCLE BETWEEN THEM IS LOAD-BEARING. `cat` puts consecutive
    // arms edge to edge, and a mark is inked across its whole width, so two
    // adjacent marks share a lit boundary column and read as ONE run. Without
    // the rest this arm found a single mark of double width and could not
    // compare anything — which the poll below caught rather than passing.
    await seedCode(page, '$: cat(s("take_1").end(0.5), silence, s("take_1").begin(0.5))')
    await page.evaluate(() => {
      try {
        localStorage.setItem('stave:musicalTimeline.subRowHeight', '48')
      } catch {
        /* ignore */
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
    await page.waitForFunction(() => (window as ProbeWindow).__staveAssetProbe!.inSoundMap('take_1'), undefined, {
      timeout: 30_000,
    })
    await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })
    // #2079 — a 1 s take is shorter than a bar, so its lane defaults to Bars; save Waveform.
    await chooseDisplay(page, 'd1', 'waveform')

    // Wait for the decode to land and BOTH marks to be drawn.
    await expect
      .poll(async () => allMarks(await readInk(page)).filter((m) => m.length > 20).length, {
        timeout: 30_000,
        message: 'the two marks never both reached a readable width',
      })
      .toBeGreaterThanOrEqual(2)

    const marks = allMarks(await readInk(page)).filter((m) => m.length > 20)
    // Printed whether or not the assertions below hold: a claim about how two
    // marks differ is worth nothing without knowing how many marks were found
    // and how wide each is, and that is exactly what a bare pass hides.
    // eslint-disable-next-line no-console
    console.log(`[#1512] runs=${JSON.stringify(marks.map((m) => m.length))}`)
    const [loudHalf, silentHalf] = marks
    const quietestIn = (m: number[]) => Math.min(...m.filter((n) => n > 0))
    const tallestIn = (m: number[]) => Math.max(...m)

    const loudFloor = quietestIn(loudHalf)
    const silentFloor = quietestIn(silentHalf)
    // eslint-disable-next-line no-console
    console.log(
      `[#1512] marks=${marks.length} loudHalf(floor=${loudFloor} peak=${tallestIn(loudHalf)}) ` +
        `silentHalf(floor=${silentFloor} peak=${tallestIn(silentHalf)}) ratio=${(loudFloor / silentFloor).toFixed(2)}`,
    )

    // The claim. Drawing the whole file in both marks makes these two floors
    // EQUAL — each mark would contain the same silence — so the ratio is the
    // difference between the fix and its absence.
    expect(loudFloor / silentFloor).toBeGreaterThan(3)

    // …and the half that is loud is loud all the way through, so the reading
    // above is a full-scale slice rather than a mark that merely drew less.
    expect(loudFloor).toBeGreaterThan(tallestIn(loudHalf) * 0.5)

    expect(errors).toEqual([])
  })


  test('with no type saved, a long take draws its waveform and a short one draws a bar (#2079)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await bootWithTimeline(page)
    await page.evaluate(() => (window as ProbeWindow).__staveAssetProbe!.reset())

    // A 4 s take, loud and silent by turns each half second: longer than a bar
    // (2 s at the starting tempo), so a recording, like a vocal.
    const importTake = (base64: string, name: string) =>
      page.evaluate(
        async ([b, n]) => {
          const p = (window as ProbeWindow).__staveAssetProbe!
          const res = await p.import(b, 'audio/wav', n, await p.docList())
          await p.docAdd(res.record)
          return res.record.name
        },
        [base64, name] as const,
      )
    expect(await importTake(alternatingWav(48000, 4, 0.5).toString('base64'), 'take_long.wav')).toBe('take_long')
    expect(await importTake(loudThenSilentWav(), 'take_short.wav')).toBe('take_short')

    const open = async (code: string, sound: string) => {
      await seedCode(page, code)
      await page.evaluate(() => {
        try {
          localStorage.setItem('stave:musicalTimeline.subRowHeight', '48')
        } catch {
          /* ignore */
        }
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean((window as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
      await page.waitForFunction((n) => (window as ProbeWindow).__staveAssetProbe!.inSoundMap(n), sound, { timeout: 30_000 })
      await page.locator('[data-full-song-canvas]').waitFor({ timeout: 20_000 })
    }

    // Nothing is saved for either lane: only the file's length decides.
    await open('$: s("take_long")', 'take_long')
    await expect
      .poll(async () => markVariation(firstMark(await readInk(page))), { timeout: 30_000 })
      .toBeGreaterThan(3)
    expect(await shownDisplay(page, 'd1')).toBe('waveform')

    // CONTROL — the same code on a 1 s take is a bar, and its menu says Bars.
    await open('$: s("take_short")', 'take_short')
    await expect.poll(async () => firstMark(await readInk(page)).length, { timeout: 30_000 }).toBeGreaterThan(20)
    expect(await shownDisplay(page, 'd1')).toBe('bars')
    expect(markVariation(firstMark(await readInk(page)))).toBeLessThan(1.5)
    expect(errors).toEqual([])
  })
})
