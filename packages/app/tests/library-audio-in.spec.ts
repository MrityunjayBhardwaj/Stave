import { expect, test, type Page } from '@playwright/test'

import { bootApp, evalCode, seedCode, stopCode } from './_appBoot'

/**
 * Bringing your own audio in through the Library, end to end (#2057–#2061).
 *
 * Every step is the real gesture: the file arrives through the Library's Add audio
 * input, the row is hovered and its buttons clicked, Play and Stop are the
 * shortcuts. What is measured is what the speakers would get — buffer sources the
 * page starts, and the level at the context's output.
 *
 * Each sound has a length no built-in sample has (1.37 s, 2 s, 20 s), so a buffer
 * source of that length is that file and nothing else.
 *
 * ONE assertion per test: a second `expect` never runs once the first fails.
 */

interface Probe {
  docList(): Promise<Array<{ id: string; name: string; blobHash: string }>>
}
type W = {
  __staveAssetProbe?: Probe
  __starts: number[]
  __rms: () => number
  soundMap?: { get?: () => Record<string, unknown> }
}

/** A stereo sine wav of `seconds`. */
function wav(seconds: number, freq = 220): Buffer {
  const rate = 44100
  const n = Math.floor(seconds * rate)
  const data = Buffer.alloc(n * 4)
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000)
    data.writeInt16LE(v, i * 4)
    data.writeInt16LE(v, i * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(2, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 4, 28)
  h.writeUInt16LE(4, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

async function boot(page: Page): Promise<void> {
  // Before any page script: count every buffer source started (by its buffer's
  // length), and side-tap every node wired to the speakers to read their level.
  await page.addInitScript(() => {
    const w = window as unknown as W
    w.__starts = []
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...a: Parameters<typeof start>) {
      w.__starts.push(this.buffer ? Math.round(this.buffer.duration * 100) / 100 : -1)
      return start.apply(this, a)
    }
    const taps: AnalyserNode[] = []
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => unknown
    AudioNode.prototype.connect = function (this: AudioNode, target: unknown, ...rest: unknown[]) {
      const self = this as AudioNode & { __tapped?: boolean }
      if (target === this.context.destination && !self.__tapped) {
        self.__tapped = true
        const an = this.context.createAnalyser()
        an.fftSize = 2048
        connect.call(this, an)
        taps.push(an)
      }
      return connect.call(this, target, ...rest)
    } as typeof AudioNode.prototype.connect
    w.__rms = () => {
      let worst = 0
      for (const an of taps) {
        const b = new Float32Array(an.fftSize)
        an.getFloatTimeDomainData(b)
        let s = 0
        for (const v of b) s += v * v
        worst = Math.max(worst, Math.sqrt(s / b.length))
      }
      return worst
    }
  })
  await bootApp(page, { e2eHooks: true })
  await page.waitForFunction(() => Boolean((window as unknown as W).__staveAssetProbe), { timeout: 30_000 })
}

async function openLibrary(page: Page): Promise<void> {
  if (await page.locator('[data-asset-library]').count()) return
  await page.getByRole('button', { name: /library/i }).first().click()
  await page.locator('[data-asset-library]').waitFor({ timeout: 15_000 })
}

const records = (page: Page) => page.evaluate(() => (window as unknown as W).__staveAssetProbe!.docList())

/** Add one file through the Library's Add audio input; resolves with its sound name. */
async function addAudio(page: Page, filename: string, bytes: Buffer): Promise<string> {
  await openLibrary(page)
  const before = (await records(page)).length
  await page.locator('[data-add-audio-input]').setInputFiles({ name: filename, mimeType: 'audio/wav', buffer: bytes })
  await expect.poll(async () => (await records(page)).length, { timeout: 20_000 }).toBe(before + 1)
  await expect(page.locator('[data-add-audio]')).toBeEnabled()
  return (await records(page)).at(-1)!.name
}

/** The Library row for one of your sounds — found WITHOUT touching a filter. */
const row = (page: Page, name: string) => page.locator('[data-asset-row^="sound:"]', { hasText: name }).first()

/** Put the editor's cursor at the start of `line`. */
async function cursorAt(page: Page, line: number): Promise<void> {
  await page.evaluate((l) => {
    const eds = (window as unknown as { monaco: { editor: { getEditors: () => Array<{ setPosition: (p: object) => void; focus: () => void }> } } }).monaco.editor.getEditors()
    eds[0].setPosition({ lineNumber: l, column: 1 })
    eds[0].focus()
  }, line)
}

const startsOf = (page: Page, seconds: number) =>
  page.evaluate((s) => (window as unknown as W).__starts.filter((d) => Math.abs(d - s) < 0.02).length, seconds)

test.describe('your own audio, brought in through the Library', () => {
  test('a sound you just added is on screen, without touching a filter (#2060)', async ({ page }) => {
    await boot(page)
    const name = await addAudio(page, 'shown.wav', wav(1.37))
    await expect(row(page, name)).toBeVisible({ timeout: 5_000 })
  })

  test('your sound is under Sounds → User, chosen by hand (#2062)', async ({ page }) => {
    await boot(page)
    const name = await addAudio(page, 'mine.wav', wav(1.37))
    // away from what the import chose, then back by the two chips a person would press
    await page.locator('[data-filter="asset-type-filter"] [data-chip="all"]').click()
    await page.locator('[data-filter="asset-type-filter"] [data-chip="sound"]').click()
    await page.locator('[data-filter="asset-source-filter"] [data-chip="user"]').click()
    await page.locator('[data-asset-search]').fill(name)
    await expect(row(page, name)).toBeVisible({ timeout: 5_000 })
  })

  test("your sound is not listed among Stave's own sounds (#2062)", async ({ page }) => {
    await boot(page)
    const name = await addAudio(page, 'notbuiltin.wav', wav(1.37))
    await page.locator('[data-filter="asset-source-filter"] [data-chip="built-in"]').click()
    await page.locator('[data-asset-search]').fill(name)
    await page.waitForTimeout(500)
    expect(await page.locator('[data-asset-row]', { hasText: name }).count()).toBe(0)
  })

  test('Insert in a song of `$:` patterns writes a line that plays (#2057)', async ({ page }) => {
    await boot(page)
    await seedCode(page, '// my song\n$: s("hh*2")\n')
    const name = await addAudio(page, 'inserted.wav', wav(1.37))
    await cursorAt(page, 1)
    const r = row(page, name)
    await r.hover()
    await r.locator('[data-asset-insert]').click()
    await evalCode(page)
    await page.waitForTimeout(4_000)
    await stopCode(page)
    expect(await startsOf(page, 1.37), 'the inserted sound must be heard at least once in 4 s').toBeGreaterThan(0)
  })

  test('Insert in a song that plays a bare expression keeps it playing (#2066)', async ({ page }) => {
    await boot(page)
    const bare = await addAudio(page, 'bare.wav', wav(1.37))
    const inserted = await addAudio(page, 'inserted.wav', wav(2, 330))
    // the muted label registers nothing, so the song is its bare line
    await seedCode(page, `_$: s("hh*2")\ns("${bare}")\n`)
    await cursorAt(page, 2)
    const r = row(page, inserted)
    await r.hover()
    await r.locator('[data-asset-insert]').click()
    await evalCode(page)
    await page.waitForTimeout(4_000)
    await stopCode(page)
    // Before: the new `$:` line was heard and the song's own line went silent (0).
    expect(
      Math.min(await startsOf(page, 1.37), await startsOf(page, 2)),
      'starts in 4 s of the song line and the inserted line, whichever is fewer',
    ).toBeGreaterThan(0)
  })

  test('Insert of a clip longer than a cycle plays it through before it starts again', async ({ page }) => {
    await boot(page)
    await seedCode(page, '// my song\n')
    const name = await addAudio(page, 'take.wav', wav(20))
    await cursorAt(page, 1)
    const r = row(page, name)
    await r.hover()
    await r.locator('[data-asset-insert]').click()
    await evalCode(page)
    await page.waitForTimeout(5_000)
    await stopCode(page)
    // Before: a copy started every cycle, on top of the one still playing (3 in 5 s).
    expect(await startsOf(page, 20), 'starts of the 20 s clip in 5 s of play').toBe(1)
  })

  test('Stop silences a long sample that is still playing (#2058)', async ({ page }) => {
    await boot(page)
    const name = await addAudio(page, 'long.wav', wav(20))
    await seedCode(page, `$: s("${name}")\n`)
    await evalCode(page)
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__rms()), { timeout: 10_000 }).toBeGreaterThan(0.05)
    await page.waitForTimeout(1_500)
    await stopCode(page)
    await page.waitForTimeout(1_000)
    expect(await page.evaluate(() => (window as unknown as W).__rms()), 'the level a second after Stop').toBeLessThan(0.001)
  })

  test('previewing your own sound plays it once, start to end (#2059)', async ({ page }) => {
    await boot(page)
    const name = await addAudio(page, 'clip.wav', wav(2))
    const r = row(page, name)
    await r.hover()
    await r.locator('[data-asset-preview]').click()
    await page.waitForTimeout(3_000)
    expect(await startsOf(page, 2), 'starts of the 2 s clip in 3 s of preview').toBe(1)
  })

  test('previewing another clip lets the previous one go (#2063)', async ({ page }) => {
    // Every decode the page makes, by the decoded length — a clip decoded again
    // is one the preview did not keep.
    await page.addInitScript(() => {
      const w = window as unknown as { __decodes: number[] }
      w.__decodes = []
      const decode = BaseAudioContext.prototype.decodeAudioData
      BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: Parameters<typeof decode>) {
        return decode.apply(this, a).then((b) => {
          w.__decodes.push(Math.round(b.duration * 100) / 100)
          return b
        })
      } as typeof decode
    })
    await boot(page)
    const first = await addAudio(page, 'first.wav', wav(2))
    const second = await addAudio(page, 'second.wav', wav(3, 330))
    const preview = async (name: string, seconds: number) => {
      const before = await startsOf(page, seconds)
      const r = row(page, name)
      await r.hover()
      await r.locator('[data-asset-preview]').click()
      await expect.poll(() => startsOf(page, seconds), { timeout: 15_000 }).toBe(before + 1)
    }
    const decodesOfFirst = () =>
      page.evaluate(() => (window as unknown as { __decodes: number[] }).__decodes.filter((d) => Math.abs(d - 2) < 0.02).length)
    await preview(first, 2)
    await preview(second, 3)
    const before = await decodesOfFirst()
    await preview(first, 2)
    // Kept every clip: 0 more. Keeps only the last: the first was let go, so it decodes once more.
    expect((await decodesOfFirst()) - before, 'decodes of the first clip when previewed again after the second').toBe(1)
  })

  test("a file named like one of Stave's own sounds does not replace it (#2061)", async ({ page }) => {
    await boot(page)
    // the shipped sounds are loaded by the engine's warm-up; wait for `bd` to exist
    await page.waitForFunction(() => Boolean((window as unknown as W).soundMap?.get?.()?.bd), { timeout: 30_000 })
    const name = await addAudio(page, 'bd.wav', wav(1.37))
    expect(name).not.toBe('bd')
  })
})
