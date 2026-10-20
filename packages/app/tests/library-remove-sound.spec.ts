import { expect, test, type Page } from '@playwright/test'

import { formatBytes } from '../src/assetLibrary/freeSpaceMessages'
import { bootApp, waitForEditorLoaded } from './_appBoot'

/**
 * #1786 (part of #1780): remove one of your sounds in the Library, and see how
 * big each one is.
 *
 * Before, "Your audio" rows had no remove and no size: with storage full a user
 * could neither see what took the room nor free any of it. Everything here goes
 * through the real gestures: the sound arrives through the Library's Add audio
 * input, and leaves through the row's remove button and the confirmation. The
 * page's asset probe only READS state.
 *
 * ONE assertion per test: a second `expect` never runs once the first fails.
 */

interface Probe {
  list(): Promise<Array<{ hash: string; size: number }>>
  docList(): Promise<Array<{ id: string; name: string; blobHash: string }>>
  inSoundMap(name: string): boolean
}
type ProbeWindow = { __staveAssetProbe?: Probe }

/** A short stereo wav with noise in it, so it decodes and has a real size. */
function wav(seconds: number, seed = 0): Buffer {
  const rate = 44100
  const n = Math.floor(seconds * rate)
  const data = Buffer.alloc(n * 4)
  let x = seed + 1
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    const v = Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 8000 + ((x % 2000) - 1000))
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
  await bootApp(page, { e2eHooks: true })
  await page.waitForFunction(() => Boolean((window as unknown as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
}

async function openLibrary(page: Page): Promise<void> {
  if (await page.locator('[data-asset-library]').count()) return
  await page.getByRole('button', { name: /library/i }).first().click()
  await page.locator('[data-asset-library]').waitFor({ timeout: 15_000 })
}

/** Add a file through the Library's Add audio input; resolves once it is in the project. */
async function addAudio(page: Page, filename: string, bytes: Buffer): Promise<void> {
  await openLibrary(page)
  const before = await page.evaluate(async () => (await (window as unknown as ProbeWindow).__staveAssetProbe!.docList()).length)
  await page.locator('[data-add-audio-input]').setInputFiles({ name: filename, mimeType: 'audio/wav', buffer: bytes })
  await expect
    .poll(() => page.evaluate(async () => (await (window as unknown as ProbeWindow).__staveAssetProbe!.docList()).length), {
      timeout: 20_000,
    })
    .toBe(before + 1)
}

async function records(page: Page): Promise<Array<{ id: string; name: string; blobHash: string }>> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__staveAssetProbe!.docList())
}

async function blobs(page: Page): Promise<Array<{ hash: string; size: number }>> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__staveAssetProbe!.list())
}

/** The Library row for one of your sounds, found by searching its name. */
async function row(page: Page, name: string) {
  await openLibrary(page)
  // #2062 — your own audio is under Sounds → User.
  const sounds = page.locator('[data-filter="asset-type-filter"] [data-chip="sound"]')
  if ((await sounds.getAttribute('aria-pressed')) !== 'true') await sounds.click()
  const user = page.locator('[data-filter="asset-source-filter"] [data-chip="user"]')
  if ((await user.getAttribute('aria-pressed')) !== 'true') await user.click()
  await page.locator('[data-asset-search]').fill(name)
  const r = page.locator('[data-asset-row^="sound:"]', { hasText: name }).first()
  await r.waitFor({ timeout: 10_000 })
  return r
}

/** Hover the row, click its remove button, and answer the confirmation. */
async function removeFromLibrary(page: Page, name: string, answer: 'Remove' | 'Cancel'): Promise<void> {
  const r = await row(page, name)
  await r.hover()
  await r.locator('[data-asset-remove]').click()
  await page.getByRole('button', { name: answer, exact: true }).click()
}

/** The toast that follows a confirmed removal. */
async function removalToast(page: Page, name: string): Promise<string> {
  const toast = page.locator('[data-testid="toast-stack"]', { hasText: `Removed "${name}"` })
  await toast.waitFor({ timeout: 15_000 })
  return toast.innerText()
}

test.describe('#1786 — remove one of your sounds, and see its size', () => {
  test('each of your sounds shows the size its bytes take', async ({ page }) => {
    await boot(page)
    await addAudio(page, 'sized.wav', wav(2, 1))
    const [rec] = await records(page)
    const stored = (await blobs(page)).find((b) => b.hash === rec!.blobHash)!
    const r = await row(page, rec!.name)
    expect(await r.locator('[data-asset-size]').innerText()).toBe(formatBytes(stored.size))
  })

  test('a removed sound is gone from the project, and stays gone after a reload', async ({ page }) => {
    await boot(page)
    await addAudio(page, 'gone.wav', wav(1, 2))
    const [rec] = await records(page)
    await removeFromLibrary(page, rec!.name, 'Remove')
    await removalToast(page, rec!.name)
    // Give y-indexeddb's unawaited write time to land before reloading.
    await page.waitForTimeout(1000)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForEditorLoaded(page)
    await page.waitForFunction(() => Boolean((window as unknown as ProbeWindow).__staveAssetProbe), { timeout: 30_000 })
    expect((await records(page)).map((r) => r.name)).not.toContain(rec!.name)
  })

  test('a removed sound goes silent at once: its name no longer plays', async ({ page }) => {
    await boot(page)
    await addAudio(page, 'silent.wav', wav(1, 3))
    const [rec] = await records(page)
    // Registered first: "not playable after" means nothing if it never was.
    await expect
      .poll(() => page.evaluate((n) => (window as unknown as ProbeWindow).__staveAssetProbe!.inSoundMap(n), rec!.name), {
        timeout: 15_000,
      })
      .toBe(true)
    await removeFromLibrary(page, rec!.name, 'Remove')
    await removalToast(page, rec!.name)
    const stillPlays = await page.evaluate(
      (n) => (window as unknown as ProbeWindow).__staveAssetProbe!.inSoundMap(n),
      rec!.name,
    )
    expect(stillPlays).toBe(false)
  })

  test('removing the only sound that uses its audio frees the bytes, and says so', async ({ page }) => {
    await boot(page)
    await addAudio(page, 'freed.wav', wav(1, 4))
    const [rec] = await records(page)
    await removeFromLibrary(page, rec!.name, 'Remove')
    const text = await removalToast(page, rec!.name)
    const left = (await blobs(page)).map((b) => b.hash)
    expect({ said: /and freed \d/.test(text), bytesGone: !left.includes(rec!.blobHash) }).toEqual({
      said: true,
      bytesGone: true,
    })
  })

  test('audio another sound still uses is kept, and the toast says no space was freed', async ({ page }) => {
    await boot(page)
    const same = wav(1, 5)
    await addAudio(page, 'twin.wav', same)
    await addAudio(page, 'twin.wav', same)
    const [first, second] = await records(page)
    await removeFromLibrary(page, first!.name, 'Remove')
    const text = await removalToast(page, first!.name)
    const kept = (await blobs(page)).some((b) => b.hash === second!.blobHash)
    const otherPlays = await page.evaluate(
      (n) => (window as unknown as ProbeWindow).__staveAssetProbe!.inSoundMap(n),
      second!.name,
    )
    expect({ same: first!.blobHash === second!.blobHash, said: /no space was freed/.test(text), kept, otherPlays }).toEqual({
      same: true,
      said: true,
      kept: true,
      otherPlays: true,
    })
  })

  test('cancelling the confirmation removes nothing', async ({ page }) => {
    await boot(page)
    await addAudio(page, 'kept.wav', wav(1, 6))
    const [rec] = await records(page)
    await removeFromLibrary(page, rec!.name, 'Cancel')
    await page.waitForTimeout(500)
    const state = {
      record: (await records(page)).some((r) => r.id === rec!.id),
      bytes: (await blobs(page)).some((b) => b.hash === rec!.blobHash),
    }
    expect(state).toEqual({ record: true, bytes: true })
  })
})
