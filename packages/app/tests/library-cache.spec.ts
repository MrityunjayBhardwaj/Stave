import { test, expect, chromium, firefox, webkit, type Browser, type BrowserType, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'

/**
 * #2640 — the library cache, in real IndexedDB, in Chromium, Firefox and WebKit, on
 * the main thread AND in a dedicated module worker (where sketches run).
 *
 * The cache's own source (`packages/editor/src/visualizers/libraries/libraryCache.ts`,
 * plus `graphHash.ts` and the `idb.ts` helper it uses) is transpiled here and served on the
 * dev server's origin through `context.route`, so the code under test is the source, not a copy, and
 * nothing in the app has to be wired to reach it. Firefox and WebKit are launched by
 * the spec itself (as `storage-full-firefox.spec.ts` does), and skipped where they
 * aren't installed.
 */

const EDITOR_SRC = path.resolve(__dirname, '../../editor/src')
const PREFIX = '/__libcache/'
const TEST_DB = 'stave-library-cache-test'

/**
 * The cache and what it imports, as ONE module text with no imports left in it.
 *
 * One text rather than separate modules because Playwright's Firefox does not route a
 * module worker's own imports (measured: the worker script is routed, its
 * \`import "./m.js"\` never reaches the route and the worker fails to load). Each
 * file is transpiled and wrapped in a function that returns its exports; its
 * imports become reads of the files before it.
 */
const BUNDLE_FILES = ['storageStatus', 'idb', 'visualizers/libraries/graphHash', 'visualizers/libraries/libraryCache']

function bundle(): string {
  const parts: string[] = ['const __m = {};']
  for (const rel of BUNDLE_FILES) {
    const src = fs.readFileSync(path.join(EDITOR_SRC, rel + '.ts'), 'utf8')
    let js = ts.transpileModule(src, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText
    js = js.replace(/^import \{([^}]*)\} from '([^']+)';$/gm, (_all, names: string, spec: string) => {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec))
      if (!BUNDLE_FILES.includes(target)) throw new Error(`library-cache bundle: ${rel} imports ${spec}, not in BUNDLE_FILES`)
      return `const {${names}} = __m[${JSON.stringify(target)}];`
    })
    if (/^import /m.test(js)) throw new Error(`library-cache bundle: an import in ${rel} was not inlined`)
    const names: string[] = []
    js = js.replace(/^export (async function|function|const|class) ([A-Za-z_$][\w$]*)/gm, (_all, kind: string, name: string) => {
      names.push(name)
      return `${kind} ${name}`
    })
    if (/^export /m.test(js)) throw new Error(`library-cache bundle: an export form in ${rel} is not handled`)
    parts.push(`__m[${JSON.stringify(rel)}] = (() => {\n${js}\nreturn { ${names.join(', ')} };\n})();`)
  }
  return parts.join('\n')
}

/**
 * Runs in the page AND in the worker. Each op builds its own cache instance (with
 * its own warnings list) so the counts it returns belong to that op alone.
 */
const HARNESS = `
const { createLibraryCache } = __m['visualizers/libraries/libraryCache']
const { libraryGraphHash } = __m['visualizers/libraries/graphHash']
const DB = ${JSON.stringify(TEST_DB)}

// Exactly \`chars\` characters over two modules. \`noise\` fills with pseudo-random text
// so the browser cannot compress it below its size (both engines compress values).
function graphOf(seed, chars, noise = false) {
  const a = 'https://cdn.test/' + seed + '/entry.mjs'
  const b = 'https://cdn.test/' + seed + '/chunk.mjs'
  const headA = 'import "./chunk.mjs"; export const seed = ' + JSON.stringify(seed) + ';/*'
  const headB = 'export const chunk = 1;/*'
  const room = Math.max(2, chars - headA.length - headB.length - 4)
  let x = 2166136261
  const fill = (n, ch) => {
    if (!noise) return ch.repeat(n)
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-'
    let out = ''
    for (let i = 0; i < n; i++) { x = (Math.imul(x ^ (x >>> 15), 2246822507) + i) >>> 0; out += abc[x & 63] }
    return out
  }
  const half = Math.floor(room / 2)
  return { entry: a, modules: {
    [a]: headA + fill(half, 'a') + '*/',
    [b]: headB + fill(room - half, 'é') + '*/',
  } }
}
function rawOpen() {
  return new Promise((res, rej) => { const r = indexedDB.open(DB); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}
async function rawPut(store, value, key) {
  const db = await rawOpen()
  await new Promise((res, rej) => { const t = db.transaction(store, 'readwrite'); key === undefined ? t.objectStore(store).put(value) : t.objectStore(store).put(value, key); t.oncomplete = res; t.onerror = () => rej(t.error) })
  db.close()
}
async function rawKeys() {
  const db = await rawOpen()
  const get = (s) => new Promise((res, rej) => { const q = db.transaction(s).objectStore(s).getAllKeys(); q.onsuccess = () => res(q.result.slice().sort()); q.onerror = () => rej(q.error) })
  const out = { graphs: await get('graphs'), meta: await get('meta') }
  db.close()
  return out
}
function reset() {
  return new Promise((res, rej) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = res })
}
function cache(extra) {
  const warnings = []
  return { warnings, c: createLibraryCache({ dbName: DB, warn: (m) => warnings.push(m), ...extra }) }
}

export async function op(name, arg) {
  if (name === 'roundtrip') {
    await reset()
    const g = graphOf('spark-sized', arg.chars, Boolean(arg.noise))
    const sha = await libraryGraphHash(g)
    const w = cache()
    const t0 = performance.now(); await w.c.putGraph(sha, g); const putMs = performance.now() - t0
    // A NEW instance: nothing remembered in memory, only what is on disk.
    const r = cache()
    const t1 = performance.now(); const back = await r.c.getGraph(sha); const getMs = performance.now() - t1
    const missBefore = await cache().c.getGraph('not-a-real-hash')
    return {
      chars: Object.values(g.modules).reduce((n, t) => n + t.length, 0),
      hit: back !== null,
      identical: back !== null && back.entry === g.entry && JSON.stringify(back.modules) === JSON.stringify(g.modules),
      hashOfReadBack: back ? await libraryGraphHash(back) : null,
      sha, missForUnknown: missBefore === null,
      putMs: Math.round(putMs), getMs: Math.round(getMs),
      warnings: [...w.warnings, ...r.warnings], keys: await rawKeys(),
    }
  }
  if (name === 'full') {
    await reset()
    // Two refused writes through ONE cache: the notice is said once, not per write.
    const w = cache()
    const g1 = graphOf('full-1', arg.chars, true); const s1 = await libraryGraphHash(g1)
    const g2 = graphOf('full-2', arg.chars, true); const s2 = await libraryGraphHash(g2)
    await w.c.putGraph(s1, g1)
    await w.c.putGraph(s2, g2)
    const hits = [await w.c.getGraph(s1), await w.c.getGraph(s2)].filter(Boolean).length
    return { hits, warnings: w.warnings, keys: await rawKeys() }
  }
  if (name === 'tampered') {
    await reset()
    const g = graphOf('t', 1000); const sha = await libraryGraphHash(g)
    await cache().c.putGraph(sha, g)
    const before = await rawKeys()
    // One character changed on disk, under the same key.
    const bad = { entry: g.entry, modules: { ...g.modules, [g.entry]: g.modules[g.entry].replace('seed', 'seeD') } }
    await rawPut('graphs', bad, sha)
    const r = cache(); const got = await r.c.getGraph(sha)
    return { before, served: got !== null, after: await rawKeys(), warnings: r.warnings }
  }
  if (name === 'misshapen') {
    await reset()
    const g = graphOf('m', 10); const sha = await libraryGraphHash(g)
    await cache().c.putGraph(sha, g)
    await rawPut('graphs', 'not a graph at all', sha)
    const r = cache(); const got = await r.c.getGraph(sha)
    return { served: got !== null, after: await rawKeys(), warnings: r.warnings }
  }
  if (name === 'wrong-hash-put') {
    await reset()
    const g = graphOf('w', 10); const other = await libraryGraphHash(graphOf('other', 10))
    const w = cache(); await w.c.putGraph(other, g)
    const got = await cache().c.getGraph(other)
    return { served: got !== null, after: await rawKeys(), warnings: w.warnings }
  }
  if (name === 'evict') {
    await reset()
    let t = 1_000_000
    const day = 86_400_000
    const now = () => t
    const graphs = ['a', 'b', 'c'].map((s) => graphOf(s, 400))
    const shas = await Promise.all(graphs.map(libraryGraphHash))
    const sizes = graphs.map((g) => new TextEncoder().encode(Object.keys(g.modules).sort().map((u) => u + '\\n' + g.modules[u].length + '\\n' + g.modules[u] + '\\n').join('')).byteLength)
    // Room for two of the three.
    const { c } = cache({ now, maxBytes: sizes[0] + sizes[1] + 10, maxAgeMs: 60 * day })
    await c.putGraph(shas[0], graphs[0]); t += 1000
    await c.putGraph(shas[1], graphs[1]); t += 1000
    await c.getGraph(shas[0]); t += 1000          // a used again: b is now the oldest
    await c.putGraph(shas[2], graphs[2]); t += 1000
    const afterSize = await rawKeys()
    // Ninety days on, storing one more drops everything not used in sixty.
    t += 90 * day
    const d = graphOf('d', 10); const dsha = await libraryGraphHash(d)
    await c.putGraph(dsha, d)
    const afterAge = await rawKeys()
    return { shas, dsha, sizes, afterSize, afterAge }
  }
  throw new Error('unknown op ' + name)
}
`

const WORKER = `
onmessage = async (e) => {
  try { postMessage({ ok: true, value: await op(e.data.name, e.data.arg) }) }
  catch (err) { postMessage({ ok: false, error: String(err && err.stack || err) }) }
}
`

/** A sandboxed frame has an opaque origin: IndexedDB refuses it for real. */
const SANDBOXED = `<!doctype html><script type="module">
import { createLibraryCache } from './bundle.js'
const warnings = []
const c = createLibraryCache({ warn: (m) => warnings.push(m) })
const out = { threw: null }
try {
  const g = { entry: 'u', modules: { u: 'export {}' } }
  out.get1 = await c.getGraph('x')
  out.put = await c.putGraph('x', g)
  out.get2 = await c.getGraph('x')
} catch (err) { out.threw = String(err) }
let direct
try { indexedDB.open('probe'); direct = 'opened' } catch (err) { direct = err.name }
parent.postMessage({ ...out, warnings, direct, origin: self.origin }, '*')
</script>`

async function serve(page: Page): Promise<void> {
  // On the CONTEXT, not the page: Firefox sends a dedicated worker's requests past page routes.
  await page.context().route(`**${PREFIX}**`, async (route) => {
    const url = new URL(route.request().url())
    const rel = url.pathname.slice(PREFIX.length)
    const headers = { 'Access-Control-Allow-Origin': '*' }
    const js = (body: string) => route.fulfill({ status: 200, contentType: 'text/javascript', headers, body })
    if (rel === 'index.html') return route.fulfill({ status: 200, contentType: 'text/html', headers, body: '<!doctype html><p>cache</p>' })
    if (rel === 'sandboxed.html') return route.fulfill({ status: 200, contentType: 'text/html', headers, body: SANDBOXED })
    const code = bundle()
    if (rel === 'bundle.js') return js(code + "\nexport const { createLibraryCache } = __m['visualizers/libraries/libraryCache'];")
    if (rel === 'harness.js') return js(code + HARNESS)
    if (rel === 'worker.js') return js(code + HARNESS.replace('export async function op', 'async function op') + WORKER)
    return route.fulfill({ status: 404, headers, body: 'not found: ' + rel })
  })
}

type Where = 'main' | 'worker'

async function runOp(page: Page, where: Where, name: string, arg: unknown = {}): Promise<any> {
  if (where === 'main') {
    return page.evaluate(async ([n, a]) => {
      const m = await import('/__libcache/harness.js' as string)
      return m.op(n, a)
    }, [name, arg] as const)
  }
  const res = await page.evaluate(([n, a]) => new Promise<any>((resolve) => {
    const w = new Worker('/__libcache/worker.js', { type: 'module' })
    w.onmessage = (e) => { resolve(e.data); w.terminate() }
    w.onerror = (e) => { resolve({ ok: false, error: 'worker error: ' + (e.message || 'no message') }); w.terminate() }
    w.postMessage({ name: n, arg: a })
  }), [name, arg] as const)
  if (!res.ok) throw new Error(res.error)
  return res.value
}

// Spark 2.4.0 from esm.sh is 2,804,136 characters over 2 modules (bench, 2026-11-23).
const SPARK_CHARS = 2_804_136

const ENGINES: Array<[string, BrowserType]> = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]

for (const [engine, type] of ENGINES) {
  test.describe(`library cache — ${engine}`, () => {
    test.skip(() => !fs.existsSync(type.executablePath()), `${engine} is not installed for Playwright`)
    let browser: Browser
    let page: Page
    test.beforeAll(async () => {
      browser = await type.launch()
    })
    test.afterAll(async () => {
      await browser?.close()
    })
    test.beforeEach(async ({ baseURL }) => {
      page = await browser.newPage({ baseURL })
      await serve(page)
      await page.goto(`${PREFIX}index.html`)
    })
    test.afterEach(async () => {
      await page?.close()
    })

    for (const where of ['main', 'worker'] as const) {
      test(`${where}: a Spark-sized graph read back by a fresh cache is identical and hashes to its key`, async () => {
        const r = await runOp(page, where, 'roundtrip', { chars: SPARK_CHARS })
        console.log(`[library-cache] ${engine} ${where} roundtrip`, JSON.stringify({ ...r, keys: undefined, sha: r.sha.slice(0, 12) }))
        expect({ chars: r.chars, hit: r.hit, identical: r.identical, hashMatches: r.hashOfReadBack === r.sha, missForUnknown: r.missForUnknown, warnings: r.warnings, keys: r.keys }).toEqual({
          chars: SPARK_CHARS, hit: true, identical: true, hashMatches: true, missForUnknown: true, warnings: [], keys: { graphs: [r.sha], meta: [r.sha] },
        })
      })

      test(`${where}: an entry changed on disk is never served, and is deleted`, async () => {
        const r = await runOp(page, where, 'tampered')
        console.log(`[library-cache] ${engine} ${where} tampered`, JSON.stringify(r))
        expect({ beforeCount: r.before.graphs.length, served: r.served, after: r.after, warned: r.warnings.length === 1 && /didn't match its hash/.test(r.warnings[0]) })
          .toEqual({ beforeCount: 1, served: false, after: { graphs: [], meta: [] }, warned: true })
      })

      test(`${where}: a misshapen entry is never served, and is deleted`, async () => {
        const r = await runOp(page, where, 'misshapen')
        expect({ served: r.served, after: r.after, warnings: r.warnings.length }).toEqual({ served: false, after: { graphs: [], meta: [] }, warnings: 1 })
      })

      test(`${where}: a graph is not kept under a hash it does not have`, async () => {
        const r = await runOp(page, where, 'wrong-hash-put')
        expect({ served: r.served, after: r.after, warned: r.warnings.length === 1 && /hashes to/.test(r.warnings[0]) })
          .toEqual({ served: false, after: { graphs: [], meta: [] }, warned: true })
      })

      test(`${where}: past the size cap the least recently used goes; past the age limit, the unused go`, async () => {
        const r = await runOp(page, where, 'evict')
        const [a, , c] = r.shas
        expect({ afterSize: r.afterSize.graphs, metaMatches: JSON.stringify(r.afterSize.meta) === JSON.stringify(r.afterSize.graphs), afterAge: r.afterAge.graphs })
          .toEqual({ afterSize: [a, c].sort(), metaMatches: true, afterAge: [r.dsha] })
      })
    }

    test('no IndexedDB (opaque origin): every lookup misses, nothing throws, one console notice', async () => {
      const got = page.evaluate(() => new Promise<any>((resolve) => {
        addEventListener('message', (e) => resolve(e.data), { once: true })
        const f = document.createElement('iframe')
        f.sandbox.add('allow-scripts')
        f.src = '/__libcache/sandboxed.html'
        document.body.appendChild(f)
      }))
      const r = await got
      console.log(`[library-cache] ${engine} opaque origin`, JSON.stringify(r))
      expect({ origin: r.origin, directOpenRefused: r.direct !== 'opened', threw: r.threw, get1: r.get1, get2: r.get2, notices: r.warnings.length, said: /can't be kept on this device/.test(r.warnings[0] ?? '') })
        .toEqual({ origin: 'null', directOpenRefused: true, threw: null, get1: null, get2: null, notices: 1, said: true })
    })
  })
}

/**
 * Storage full, for real: Firefox with a fixed origin limit (its pref, as in
 * `storage-full-firefox.spec.ts`), Chromium with a quota override through DevTools.
 * WebKit has no switch for this, so it is not covered here.
 */
test.describe('library cache — storage full', () => {
  async function full(page: Page, where: Where): Promise<any> {
    return runOp(page, where, 'full', { chars: 4_000_000 })
  }

  for (const where of ['main', 'worker'] as const) {
    test(`firefox ${where}: a refused write is said once, never thrown, and leaves a miss`, async ({ baseURL }) => {
      test.skip(!fs.existsSync(firefox.executablePath()), 'Firefox is not installed for Playwright')
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stave-libcache-ff-'))
      const ctx = await firefox.launchPersistentContext(dir, {
        headless: true,
        baseURL,
        firefoxUserPrefs: { 'dom.quotaManager.temporaryStorage.fixedLimit': 1024 },
      })
      try {
        const page = ctx.pages()[0] ?? (await ctx.newPage())
        await serve(page)
        await page.goto(`${PREFIX}index.html`)
        const r = await full(page, where)
        console.log(`[library-cache] firefox ${where} full`, JSON.stringify(r))
        expect({ hits: r.hits, warnings: r.warnings, keys: r.keys }).toEqual({
          hits: 0,
          warnings: ["[stave] This device's storage is full, so a library wasn't kept; it will load from the network."],
          keys: { graphs: [], meta: [] },
        })
      } finally {
        await ctx.close()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    test(`chromium ${where}: a refused write is said once, never thrown, and leaves a miss`, async ({ baseURL }) => {
      const browser = await chromium.launch()
      try {
        const ctx = await browser.newContext({ baseURL })
        const page = await ctx.newPage()
        await serve(page)
        await page.goto(`${PREFIX}index.html`)
        const cdp = await ctx.newCDPSession(page)
        await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(baseURL!).origin, quotaSize: 1024 * 1024 })
        const r = await full(page, where)
        console.log(`[library-cache] chromium ${where} full`, JSON.stringify(r))
        expect({ hits: r.hits, warnings: r.warnings, keys: r.keys }).toEqual({
          hits: 0,
          warnings: ["[stave] This device's storage is full, so a library wasn't kept; it will load from the network."],
          keys: { graphs: [], meta: [] },
        })
      } finally {
        await browser.close()
      }
    })
  }
})
