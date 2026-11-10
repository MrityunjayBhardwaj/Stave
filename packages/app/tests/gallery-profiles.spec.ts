/**
 * #2314 artist profiles and #2315 collections, in the gallery overlay.
 *
 * The profile and collection routes are answered here with `page.route()`, so the
 * spec needs no store. Every request the overlay makes is recorded, so the tests
 * read exactly what was sent: the method, the author key header, the body.
 *
 * ─── THE SIGNAL FOR "THE BIO RAN NOTHING" ───────────────────────────────────────
 * The fixture bio carries three attempts to run code — a `<script>`, an
 * `<img onerror>` and a `javascript:` link — and each would set `window.__bioRan`.
 * The flag staying unset after the profile has rendered (and the link was clicked)
 * is the harm itself not happening, not a proxy for it.
 */
import { test, expect, devices, type Page, type Route } from '@playwright/test'
import { bootApp } from './_appBoot'

const SHOTS = process.env.GALLERY_SHOTS
const NOW = Date.UTC(2026, 10, 1)
const ADA = 'adaAuthor01'
const KEY = 'key-ada-123'

const ENTRIES = [
  { id: 'adaEnt1AAAA', title: 'Night Drive', kind: 'project', tags: ['synthwave'], authorName: 'Ada', authorId: ADA, publishedAt: NOW, fileCount: 2, hasThumbnail: true },
  { id: 'adaEnt2BBBB', title: 'Rain on Glass', kind: 'music', tags: ['ambient'], authorName: 'Ada', authorId: ADA, publishedAt: NOW - 86_400_000, fileCount: 1, hasThumbnail: false },
  { id: 'adaEnt3CCCC', title: 'Neon Bloom', kind: 'viz', tags: ['hydra'], authorName: 'Ada', authorId: ADA, publishedAt: NOW - 2 * 86_400_000, fileCount: 1, hasThumbnail: true },
  // published before profiles: no author id, so the name is not a link
  { id: 'bobEnt1DDDD', title: 'Old Loop', kind: 'project', tags: [], authorName: 'Bob', publishedAt: NOW - 3 * 86_400_000, fileCount: 1, hasThumbnail: false },
]

const BIO = [
  '# Hi, I’m Ada 👋',
  '',
  'I make **slow electronic music** and the visuals that go with it, live, in the browser.',
  '',
  '![banner](https://raw.githubusercontent.com/ada/ada/main/banner.svg)',
  '',
  '## What I’m working on',
  '',
  '- a dub techno EP, one pattern per track',
  '- Hydra feedback loops that follow the kick',
  '- [x] learning Strudel’s `jux`',
  '',
  '```js',
  'note("c2 [eb2 g2]").s("sawtooth").lpf(400)',
  '```',
  '',
  '| Set | Length | Tempo |',
  '|-----|-------:|------:|',
  '| Night Drive | 6:40 | 118 |',
  '| Rain on Glass | 9:12 | 72 |',
  '',
  '> Most of these started as a two-line loop.',
  '',
  'Find me at [my site](https://ada.example.com) or <mailto:ada@example.com>.',
  '',
  '<script>window.__bioRan = 1</script>',
  '',
  '<img src="x" onerror="window.__bioRan = 2">',
  '',
  '[a trap](javascript:window.__bioRan=3)',
].join('\n')

const BANNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#2b1055"/><stop offset="1" stop-color="#d53369"/></linearGradient></defs><rect width="900" height="200" fill="url(#g)"/><text x="40" y="118" font-family="sans-serif" font-size="56" fill="#fff">ada · live sets</text></svg>`
const THUMB_SVG = (hue: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="hsl(${hue} 60% 35%)"/><circle cx="160" cy="100" r="60" fill="hsl(${(hue + 120) % 360} 70% 60%)"/></svg>`

interface Seen {
  method: string
  path: string
  key: string | null
  body: unknown
}

interface Store {
  seen: Seen[]
  author: { authorId: string; name: string; bio: string; createdAt: number; updatedAt: number }
  collections: Map<string, { id: string; authorId: string; title: string; description: string; entryIds: string[]; createdAt: number; updatedAt: number }>
}

async function routeProfiles(page: Page, opts: { seedCollection?: boolean } = {}): Promise<Store> {
  const store: Store = {
    seen: [],
    author: { authorId: ADA, name: 'Ada', bio: BIO, createdAt: Date.UTC(2026, 8, 1), updatedAt: NOW },
    collections: new Map(),
  }
  if (opts.seedCollection) {
    store.collections.set('colSeed0001', {
      id: 'colSeed0001',
      authorId: ADA,
      title: 'Late Night Set',
      description: 'Three pieces that run into each other.',
      entryIds: ['adaEnt2BBBB', 'adaEnt1AAAA', 'adaEnt3CCCC'],
      createdAt: NOW,
      updatedAt: NOW,
    })
  }
  const byId = new Map(ENTRIES.map((e) => [e.id, e]))
  let n = 0

  await page.route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: BANNER_SVG }),
  )
  await page.route(/\/api\/gallery(\/.*)?$/, async (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    const method = req.method()
    const key = (await req.headerValue('x-stave-author-key')) ?? null
    let body: unknown = null
    try {
      body = req.postData() ? JSON.parse(req.postData()!) : null
    } catch {
      body = req.postData()
    }
    store.seen.push({ method, path, key, body })

    if (path === '/api/gallery' && method === 'GET') return route.fulfill({ json: { entries: ENTRIES } })

    const author = path.match(/^\/api\/gallery\/authors\/([^/]+)$/)
    if (author) {
      if (author[1] !== ADA) return route.fulfill({ status: 404, json: { error: 'not found' } })
      if (method === 'PUT') {
        if (key !== KEY) return route.fulfill({ status: 403, json: { error: 'forbidden' } })
        const b = body as { name: string; bio: string }
        store.author = { ...store.author, name: b.name, bio: b.bio, updatedAt: Date.now() }
        return route.fulfill({ json: { author: store.author } })
      }
      const own = [...store.collections.values()].filter((c) => c.authorId === ADA).reverse()
      return route.fulfill({
        json: { author: store.author, entries: ENTRIES.filter((e) => e.authorId === ADA), collections: own },
      })
    }

    if (path === '/api/gallery/collections' && method === 'POST') {
      if (key !== KEY) return route.fulfill({ status: 403, json: { error: 'forbidden' } })
      const b = body as { title: string; description: string; entryIds: string[] }
      const id = `colNew${String(++n).padStart(5, '0')}`
      const c = { id, authorId: ADA, ...b, createdAt: Date.now(), updatedAt: Date.now() }
      store.collections.set(id, c)
      return route.fulfill({ status: 201, json: { collection: c } })
    }
    const col = path.match(/^\/api\/gallery\/collections\/([^/]+)$/)
    if (col) {
      const c = store.collections.get(col[1])
      if (!c) return route.fulfill({ status: 404, json: { error: 'not found' } })
      if (method === 'DELETE') {
        if (key !== KEY) return route.fulfill({ status: 403, json: { error: 'forbidden' } })
        store.collections.delete(c.id)
        return route.fulfill({ status: 204 })
      }
      if (method === 'PUT') {
        if (key !== KEY) return route.fulfill({ status: 403, json: { error: 'forbidden' } })
        const b = body as { title: string; description: string; entryIds: string[] }
        const next = { ...c, ...b, updatedAt: Date.now() }
        store.collections.set(c.id, next)
        return route.fulfill({ json: { collection: next } })
      }
      return route.fulfill({
        json: {
          collection: c,
          author: { authorId: ADA, name: store.author.name },
          entries: c.entryIds.map((id) => byId.get(id)).filter(Boolean),
        },
      })
    }

    const thumb = path.match(/^\/api\/gallery\/([^/]+)\/thumbnail$/)
    if (thumb) {
      const hue = thumb[1] === 'adaEnt1AAAA' ? 280 : 190
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: THUMB_SVG(hue) })
    }
    const one = path.match(/^\/api\/gallery\/([^/]+)$/)
    if (one && method === 'GET') {
      const e = byId.get(one[1])
      if (!e) return route.fulfill({ status: 404, json: { error: 'not found' } })
      return route.fulfill({
        json: {
          entry: e,
          manifest: {
            schemaVersion: 1,
            project: { name: e.title, sharedAt: e.publishedAt },
            files: [{ id: 'f1', path: 'main.strudel', language: 'strudel', content: 's("bd sd")' }],
            fileOrder: {},
            subfolderOrder: {},
          },
        },
      })
    }
    return route.fulfill({ status: 404 })
  })
  return store
}

/** This browser's remembered gallery identity (localShares.ts). */
async function rememberAuthor(page: Page, author: Record<string, string>): Promise<void> {
  await page.addInitScript((a) => {
    localStorage.setItem('stave.gallery.author', JSON.stringify(a))
  }, author)
}

async function openGalleryFromMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByText('Community Gallery...', { exact: true }).click()
  // #2473 — on a desktop the gallery opens as a workspace tab
  await expect(page.locator('[data-gallery="tab"]')).toBeVisible()
}

const bioRan = (page: Page) => page.evaluate(() => (window as unknown as { __bioRan?: number }).__bioRan ?? null)

test.describe('gallery profiles and collections (#2314, #2315)', () => {
  test('an author name opens the profile; the bio renders as markdown and runs nothing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const store = await routeProfiles(page, { seedCollection: true })
    await bootApp(page)
    await openGalleryFromMenu(page)

    // an entry without an author id: plain text, not a link
    await expect(page.locator('[data-gallery-card="bobEnt1DDDD"] [data-gallery-author-link]')).toHaveCount(0)
    await expect(page.locator('[data-gallery-card="bobEnt1DDDD"] [data-gallery-author-plain]')).toHaveText('Bob')

    await page.locator(`[data-gallery-card="adaEnt1AAAA"] [data-gallery-author-link="${ADA}"]`).click()
    const profile = page.locator(`[data-gallery-profile="${ADA}"]`)
    await expect(profile).toBeVisible()
    // the click opened the profile, not the entry
    expect(store.seen.some((s) => s.path === '/api/gallery/adaEnt1AAAA')).toBe(false)

    const md = profile.locator('[data-gallery-markdown]')
    // First, before anything else can fail: the bio has rendered (its banner has
    // loaded, so a broken <img> beside it has had its error too) and nothing in it ran.
    const banner = md.locator('img[src="https://raw.githubusercontent.com/ada/ada/main/banner.svg"]')
    await expect.poll(() => banner.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0)
    await page.waitForTimeout(300)
    expect(await bioRan(page), 'code in the bio ran').toBeNull()

    await expect(md.locator('h1')).toHaveText('Hi, I’m Ada 👋')
    await expect(md.locator('h2')).toHaveText('What I’m working on')
    await expect(md.locator('ul > li')).toHaveCount(3)
    await expect(md.locator('pre code')).toContainText('note("c2 [eb2 g2]")')
    await expect(md.locator('table td').first()).toHaveText('Night Drive')
    await expect(md.locator('blockquote')).toBeVisible()
    await expect(md.locator('img')).toHaveCount(1)
    const site = md.getByRole('link', { name: 'my site' })
    await expect(site).toHaveAttribute('target', '_blank')
    await expect(site).toHaveAttribute('rel', 'noopener noreferrer nofollow')

    if (SHOTS) await page.screenshot({ path: `${SHOTS}/profile-readme.png` })

    // the three attempts are text, or a link with no target — and none ran
    await expect(md.locator('script, iframe')).toHaveCount(0)
    await expect(md).toContainText('<script>window.__bioRan = 1</script>')
    await expect(md).toContainText('onerror')
    const trap = md.getByText('a trap')
    await expect(trap).not.toHaveAttribute('href', /.*/)
    await trap.click()
    expect(await bioRan(page), 'code in the bio ran').toBeNull()

    // entries; #2494 — Ada has a collection (seeded), and the profile doesn't list it for now
    await expect(profile.locator('[data-gallery-card]')).toHaveCount(3)
    await expect(profile.locator('[data-gallery-collection-card]')).toHaveCount(0)
    await expect(profile.locator('[data-gallery-section="collections"]')).toHaveCount(0)
    // #2493 — the header: name, how many published, Copy profile link
    const head = profile.locator('[data-gallery-profile-head]')
    await expect(head.locator('h2')).toHaveText('Ada')
    await expect(head.locator('[data-gallery-published-count]')).toHaveText('3 published')
    await expect(head.getByRole('button', { name: 'Copy profile link' })).toBeVisible()
    // a visitor with no key here: no editing
    await expect(profile.locator('[data-gallery-edit-profile]')).toHaveCount(0)
    await expect(profile.locator('[data-gallery-new-collection]')).toHaveCount(0)

    await profile.evaluate((el) => el.scrollTo(0, el.scrollHeight))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/profile-readme-bottom.png` })

    // #2493 — the crumbs' Gallery returns to the grid
    await expect(page.locator('.sg-crumb-here')).toHaveText('Ada')
    await page.locator('[data-gallery-crumb="gallery"]').click()
    await expect(page.locator('[data-gallery-card="adaEnt1AAAA"]')).toBeVisible()
    expect(await bioRan(page)).toBeNull()
  })

  test('#2366 a profile asks no host the bio picked: refused images never reach the network', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const store = await routeProfiles(page)
    const REFUSED = [
      'https://tracker.example.test/plain.png',
      'https://github.com@tracker.example.test/username.png',
      'https://avatars.githubusercontent.com.tracker.example.test/prefix.png',
      '//tracker.example.test/no-scheme.png',
      'https://tracker.example.test/avatars.githubusercontent.com/path.png',
    ]
    // Short and at the top, so loading="lazy" can't be what keeps these off the network.
    store.author.bio = [
      '![mine](/api/gallery/adaEnt1AAAA/thumbnail)',
      ...REFUSED.map((src, i) => `![refused-${i}](${src})`),
      '![insecure](http://avatars.githubusercontent.com/u/1)',
      '![](https://tracker.example.test/no-alt.png)',
      '![me](https://avatars.githubusercontent.com/u/1?v=4)',
      '[a link stays a link](https://tracker.example.test/page)',
    ].join('\n\n')

    // Answered like real images, so a refused one would show if it were ever asked for.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    await page.route(/tracker\.example\.test|avatars\.githubusercontent\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: png }),
    )
    const asked: string[] = []
    page.on('request', (r) => asked.push(r.url()))

    await bootApp(page)
    await page.goto(`/#gallery-author=${ADA}`)
    const md = page.locator(`[data-gallery-profile="${ADA}"] [data-gallery-markdown]`)
    await expect(md).toBeVisible({ timeout: 30_000 })

    // The control: this log does see image requests, from both kinds of allowed host.
    const avatar = md.locator('img[alt="me"]')
    const mine = md.locator('img[alt="mine"]')
    await expect.poll(() => avatar.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0)
    await expect.poll(() => mine.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0)
    await page.waitForTimeout(500)
    expect(asked).toContain('https://avatars.githubusercontent.com/u/1?v=4')
    expect(asked.some((u) => u.endsWith('/api/gallery/adaEnt1AAAA/thumbnail'))).toBe(true)

    // The harm itself: nothing went to a host the bio picked.
    expect(asked.filter((u) => /tracker\.example\.test/.test(u))).toEqual([])
    expect(asked.filter((u) => u.startsWith('http://avatars.'))).toEqual([])

    await expect(md.locator('img')).toHaveCount(2)
    for (let i = 0; i < REFUSED.length; i++) await expect(md).toContainText(`refused-${i}`)
    await expect(md).toContainText('insecure')
    await expect(md.getByRole('link', { name: 'a link stays a link' })).toHaveAttribute('href', 'https://tracker.example.test/page')
  })

  test('#2366 the bio preview follows the same rule as it is typed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await routeProfiles(page)
    await rememberAuthor(page, { name: 'Ada', email: 'ada@example.com', authorId: ADA, authorKey: KEY })
    const asked: string[] = []
    page.on('request', (r) => asked.push(r.url()))
    await page.route(/tracker\.example\.test/, (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: BANNER_SVG }))
    await bootApp(page)
    await page.goto(`/#gallery-author=${ADA}`)
    await page.locator('[data-gallery-edit-profile]').click({ timeout: 30_000 })

    const editor = page.locator('[data-gallery-profile-editor]')
    await editor.getByLabel('Bio (markdown)').fill('![typed](https://tracker.example.test/typed.png)\n\n![ok](https://raw.githubusercontent.com/a/b/main/c.svg)')
    const preview = editor.locator('[data-gallery-bio-preview]')
    const ok = preview.locator('img[alt="ok"]')
    await expect.poll(() => ok.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0)
    await expect(preview).toContainText('typed')
    await expect(preview.locator('img')).toHaveCount(1)
    await expect(editor).toContainText('Images load from GitHub or Stave only')
    await page.waitForTimeout(300)
    expect(asked.filter((u) => /tracker\.example\.test/.test(u))).toEqual([])
  })

  test('the owner edits the profile: live preview, PUT with the author key', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const store = await routeProfiles(page)
    await rememberAuthor(page, { name: 'Ada', email: 'ada@example.com', authorId: ADA, authorKey: KEY })
    await bootApp(page)
    await openGalleryFromMenu(page)

    await page.locator('[data-gallery-tab="mine"]').click()
    await page.locator(`[data-gallery-my-profile="${ADA}"]`).click()
    await page.locator('[data-gallery-edit-profile]').click()

    const editor = page.locator('[data-gallery-profile-editor]')
    await editor.getByLabel('Display name').fill('Ada Lovelace')
    await editor.getByLabel('Bio (markdown)').fill('# Ada\n\nNew **bio** with a [link](https://ada.example.com).\n\n<script>window.__bioRan = 9</script>')
    const preview = editor.locator('[data-gallery-bio-preview]')
    await expect(preview.locator('h1')).toHaveText('Ada')
    await expect(preview.locator('strong')).toHaveText('bio')
    await expect(preview).toContainText('<script>')
    await expect(editor).toContainText('/ 10,000')
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/profile-edit-preview.png` })

    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator(`[data-gallery-profile="${ADA}"] [data-gallery-profile-head] h2`)).toHaveText('Ada Lovelace')
    const put = store.seen.find((s) => s.method === 'PUT' && s.path === `/api/gallery/authors/${ADA}`)
    expect(put, 'no PUT was sent').toBeTruthy()
    expect(put!.key).toBe(KEY)
    expect(put!.body).toEqual({
      name: 'Ada Lovelace',
      bio: '# Ada\n\nNew **bio** with a [link](https://ada.example.com).\n\n<script>window.__bioRan = 9</script>',
    })
    await expect(page.locator('[data-gallery-markdown] strong')).toHaveText('bio')
    expect(await bioRan(page)).toBeNull()
  })

  test('#2368 a profile already named Stave can still edit its bio, and the server\'s refusal shows in the editor', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const store = await routeProfiles(page)
    store.author.name = 'Stave' // named before the rule existed
    await rememberAuthor(page, { name: 'Stave', email: 'ada@example.com', authorId: ADA, authorKey: KEY })
    await bootApp(page)
    await openGalleryFromMenu(page)
    await page.locator('[data-gallery-tab="mine"]').click()
    await page.locator(`[data-gallery-my-profile="${ADA}"]`).click()
    await page.locator('[data-gallery-edit-profile]').click()

    const editor = page.locator('[data-gallery-profile-editor]')
    const errors = editor.locator('[data-gallery-form-errors]')
    const save = editor.getByRole('button', { name: 'Save' })

    // Any change to the name is checked, even to another spelling of the same one.
    await editor.getByLabel('Display name').fill('STAVE')
    await save.click()
    await expect(errors).toContainText('kept for the people who run Stave')
    const puts = () => store.seen.filter((s) => s.method === 'PUT').length
    expect(puts()).toBe(0)

    // The server can refuse a name the form let through (renamed in another tab, say).
    await page.route(`**/api/gallery/authors/${ADA}`, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 400, json: { error: 'that name is kept for the people who run Stave, so please choose a different one' } })
        : route.fallback(),
    )
    await editor.getByLabel('Display name').fill('Stave')
    await save.click()
    await expect(errors).toHaveText("Couldn't save — that name is kept for the people who run Stave, so please choose a different one.")
    await page.unroute(`**/api/gallery/authors/${ADA}`)

    // Unchanged, the form sends it and the bio saves.
    await editor.getByLabel('Bio (markdown)').fill('A new bio.')
    await save.click()
    await expect(editor).toHaveCount(0)
    expect(store.seen.filter((s) => s.method === 'PUT').at(-1)!.body).toEqual({ name: 'Stave', bio: 'A new bio.' })
  })

  test('someone else with their own identity sees the profile but no Edit', async ({ page }) => {
    await routeProfiles(page, { seedCollection: true })
    await rememberAuthor(page, { name: 'Eve', email: 'eve@example.com', authorId: 'eveAuthor01', authorKey: 'key-eve' })
    await bootApp(page)
    await page.goto(`/#gallery-author=${ADA}`)
    const profile = page.locator(`[data-gallery-profile="${ADA}"]`)
    await expect(profile).toBeVisible({ timeout: 30_000 })
    await expect(profile.locator('[data-gallery-markdown] h1')).toBeVisible()
    await expect(profile.locator('[data-gallery-edit-profile]')).toHaveCount(0)
    await expect(profile.locator('[data-gallery-new-collection]')).toHaveCount(0)
    // #2494 — a collection is reached by its link; someone else can't edit it
    await page.goto('/#gallery-collection=colSeed0001')
    await expect(page.locator('[data-gallery-collection="colSeed0001"]')).toBeVisible()
    await expect(page.locator('[data-gallery-edit-collection]')).toHaveCount(0)
  })

  test('#2494 the owner is offered no new collection, but edits and deletes one reached by its link; the entries stay', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const store = await routeProfiles(page, { seedCollection: true })
    await rememberAuthor(page, { name: 'Ada', email: 'ada@example.com', authorId: ADA, authorKey: KEY })
    await bootApp(page)
    await page.goto(`/#gallery-author=${ADA}`)
    const profile = page.locator(`[data-gallery-profile="${ADA}"]`)
    await expect(profile.locator('[data-gallery-edit-profile]')).toBeVisible({ timeout: 30_000 }) // the owner, so the control is real
    await expect(profile.locator('[data-gallery-new-collection]')).toHaveCount(0)
    await expect(profile.locator('[data-gallery-collection-card]')).toHaveCount(0)

    // the link someone was sent still opens the collection, entries in order
    await page.goto('/#gallery-collection=colSeed0001')
    const col = page.locator('[data-gallery-collection="colSeed0001"]')
    await expect(col).toBeVisible()
    expect(await col.locator('[data-gallery-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-gallery-card')))).toEqual([
      'adaEnt2BBBB',
      'adaEnt1AAAA',
      'adaEnt3CCCC',
    ])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/collection-page.png` })

    // reorder by keyboard: focus the second row's "up" and press Enter; take the third out
    await page.locator('[data-gallery-edit-collection]').click()
    const ed = page.locator('[data-gallery-collection-editor]')
    await ed.getByRole('button', { name: 'Move Night Drive up' }).focus()
    await page.keyboard.press('Enter')
    await ed.locator('[data-gallery-pick="adaEnt3CCCC"] input').uncheck()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/collection-edit.png` })
    await ed.getByRole('button', { name: 'Save', exact: true }).click()

    const put = store.seen.find((s) => s.method === 'PUT' && s.path === '/api/gallery/collections/colSeed0001')
    expect(put, 'no PUT was sent').toBeTruthy()
    expect(put!.key).toBe(KEY)
    expect((put!.body as { entryIds: string[] }).entryIds).toEqual(['adaEnt1AAAA', 'adaEnt2BBBB'])
    await expect
      .poll(() => col.locator('[data-gallery-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-gallery-card'))))
      .toEqual(['adaEnt1AAAA', 'adaEnt2BBBB'])

    // delete: the confirm says the entries stay
    await page.locator('[data-gallery-edit-collection]').click()
    await page.locator('[data-gallery-collection-editor]').getByRole('button', { name: 'Delete collection' }).click()
    await expect(page.getByText('The entries in it stay in the gallery')).toBeVisible()
    await page.getByRole('button', { name: 'Delete collection' }).last().click()
    const del = store.seen.find((s) => s.method === 'DELETE' && s.path === '/api/gallery/collections/colSeed0001')
    expect(del, 'no DELETE was sent').toBeTruthy()
    expect(del!.key).toBe(KEY)
    await expect(col).toHaveCount(0)
    expect(store.seen.some((s) => s.method === 'DELETE' && !s.path.includes('/collections/'))).toBe(false)
    // every entry is still on the profile
    await page.goto(`/#gallery-author=${ADA}`)
    await expect(profile.locator('[data-gallery-card]')).toHaveCount(3)
  })

  test('a #gallery-collection link opens the collection, then leaves the URL', async ({ page }) => {
    await routeProfiles(page, { seedCollection: true })
    await bootApp(page)
    await page.goto('/#gallery-collection=colSeed0001')
    const col = page.locator('[data-gallery-collection="colSeed0001"]')
    await expect(col).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('')
    await expect(col).toContainText('Late Night Set')
    await expect(col).toContainText('Three pieces that run into each other.')
    expect(await col.locator('[data-gallery-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-gallery-card')))).toEqual([
      'adaEnt2BBBB',
      'adaEnt1AAAA',
      'adaEnt3CCCC',
    ])
    await expect(col.locator('[data-gallery-copy-collection]')).toBeVisible()
    // its cards open the entry, and Back returns to the collection
    await col.locator('[data-gallery-card="adaEnt2BBBB"]').click()
    await expect(page.locator('[data-gallery-detail="adaEnt2BBBB"]')).toBeVisible()
    await page.getByRole('button', { name: '← Back' }).click()
    await expect(col).toBeVisible()
    // the author link on the collection page opens the profile
    await col.locator(`.sg-detail-head [data-gallery-author-link="${ADA}"]`).click()
    await expect(page.locator(`[data-gallery-profile="${ADA}"]`)).toBeVisible()
  })

  test('on a phone the profile fills the screen and reads', async ({ browser }) => {
    // #2473 — a real phone (touch, small screen): a narrow desktop window now
    // shows the gallery as a workspace tab, and only a phone gets the full screen.
    const ctx = await browser.newContext({ ...devices['Pixel 7'] })
    const page = await ctx.newPage()
    await routeProfiles(page, { seedCollection: true })
    await rememberAuthor(page, { name: 'Ada', email: 'ada@example.com', authorId: ADA, authorKey: KEY })
    await bootApp(page)
    await page.goto(`/#gallery-author=${ADA}`)
    const profile = page.locator(`[data-gallery-profile="${ADA}"]`)
    await expect(profile.locator('[data-gallery-markdown] h1')).toBeVisible({ timeout: 30_000 })
    const box = (await page.getByRole('dialog', { name: 'Community Gallery' }).boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual((page.viewportSize()?.width ?? 0) - 1)
    // nothing in the bio is wider than the screen (the table scrolls inside itself)
    const overflow = await profile.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-profile.png` })
    await page.locator('[data-gallery-edit-profile]').click()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-profile-edit.png` })
    await ctx.close()
  })
})
