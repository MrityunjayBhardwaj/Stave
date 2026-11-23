/**
 * #2643 — the list of tested libraries, and adding one entry to stave.libs.json
 * without losing what the file already holds.
 */
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { withLibraryDeclaration } from '../libsFileEdit'
import { LIBRARY_CATALOGUE, declarationFor } from '../catalogue'
import { isAllowedLibraryUrl, parseLibraryDeclarations } from '../declarations'
import { LibraryLoadError } from '../graph'

const SHA_A = 'A'.repeat(64)
const SHA_B = 'B'.repeat(64)
const SPARK = { url: 'https://esm.sh/@sparkjsdev/spark@2.4.0?external=three&target=es2022', sha384: SHA_A }

function edit(text: string | null, name = '@sparkjsdev/spark', decl: { url: string; sha384?: string } = SPARK): string {
  const r = withLibraryDeclaration(text, name, decl)
  if (!r.ok) throw new Error(r.message)
  return r.text
}

describe('withLibraryDeclaration (#2643)', () => {
  it('no file yet: writes plain two-space JSON with the one entry', () => {
    expect(edit(null)).toBe(`{\n  "@sparkjsdev/spark": {\n    "url": "${SPARK.url}",\n    "sha384": "${SHA_A}"\n  }\n}\n`)
    expect(edit('  \n')).toBe(edit(null))
  })

  it('adds after the existing entries and keeps them, their order and the file\'s own indentation', () => {
    const before = `{\n    "cannon-es": {\n        "url": "https://esm.sh/cannon-es@0.20.0",\n        "sha384": "${SHA_B}"\n    }\n}\n`
    expect(edit(before)).toBe(
      `{\n    "cannon-es": {\n        "url": "https://esm.sh/cannon-es@0.20.0",\n        "sha384": "${SHA_B}"\n    },\n    "@sparkjsdev/spark": {\n        "url": "${SPARK.url}",\n        "sha384": "${SHA_A}"\n    }\n}\n`,
    )
  })

  it('tabs stay tabs, and an entry written on one line stays on one line', () => {
    const before = `{\n\t"a": { "url": "https://x.test/a.js", "sha384": "${SHA_B}" }\n}`
    expect(edit(before)).toBe(`{\n\t"a": { "url": "https://x.test/a.js", "sha384": "${SHA_B}" },\n\t"@sparkjsdev/spark": {\n\t\t"url": "${SPARK.url}",\n\t\t"sha384": "${SHA_A}"\n\t}\n}`)
  })

  it('a one-line file gets a one-line entry', () => {
    const before = `{ "a": { "url": "https://x.test/a.js" } }`
    expect(edit(before)).toBe(`{ "a": { "url": "https://x.test/a.js" }, "@sparkjsdev/spark": { "url": "${SPARK.url}", "sha384": "${SHA_A}" } }`)
  })

  it('an empty object, on one line or several', () => {
    expect(edit('{}')).toBe(`{ "@sparkjsdev/spark": { "url": "${SPARK.url}", "sha384": "${SHA_A}" } }`)
    expect(edit('{\n}\n')).toBe(`{\n  "@sparkjsdev/spark": {\n    "url": "${SPARK.url}",\n    "sha384": "${SHA_A}"\n  }\n}\n`)
  })

  it('an existing entry for the same name is replaced where it is, the others untouched', () => {
    const before = `{\n  "a": { "url": "https://x.test/a.js" },\n  "@sparkjsdev/spark": { "url": "https://old.test/spark.js", "sha384": "${SHA_B}" },\n  "z": { "url": "https://x.test/z.js" }\n}\n`
    const after = edit(before)
    expect(after).toBe(
      `{\n  "a": { "url": "https://x.test/a.js" },\n  "@sparkjsdev/spark": {\n    "url": "${SPARK.url}",\n    "sha384": "${SHA_A}"\n  },\n  "z": { "url": "https://x.test/z.js" }\n}\n`,
    )
    expect(Object.keys(JSON.parse(after))).toEqual(['a', '@sparkjsdev/spark', 'z'])
  })

  it('strings holding brackets, commas and escaped quotes don\'t confuse the scan', () => {
    const before = `{\n  "we}ird,\\"name": { "url": "https://x.test/a.js?x={1,2}]" }\n}\n`
    const after = JSON.parse(edit(before))
    expect(after['we}ird,"name']).toEqual({ url: 'https://x.test/a.js?x={1,2}]' })
    expect(after['@sparkjsdev/spark']).toEqual(SPARK)
  })

  it('the result always parses to every old entry plus the new one', () => {
    const before = `{"a":{"url":"https://x.test/a.js","sha384":"${SHA_B}"},"b":{"url":"https://x.test/b.js"}}`
    const after = edit(before)
    expect(JSON.parse(after)).toEqual({ a: { url: 'https://x.test/a.js', sha384: SHA_B }, b: { url: 'https://x.test/b.js' }, '@sparkjsdev/spark': SPARK })
    expect(parseLibraryDeclarations(after)).toEqual({ ok: true, libs: JSON.parse(after) })
  })

  it('a file that isn\'t JSON, or isn\'t an object, is refused and not rewritten', () => {
    const bad = withLibraryDeclaration('{ "a": ', '@sparkjsdev/spark', SPARK)
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.message).toMatch(/^stave\.libs\.json isn't valid JSON \(.+\), so it was left as it is\. Fix it, then add the library again\.$/)
    const arr = withLibraryDeclaration('[]', '@sparkjsdev/spark', SPARK)
    expect(arr).toEqual({ ok: false, message: 'stave.libs.json should hold one object, { "<import name>": { "url": "…", "sha384": "…" } }, so it was left as it is.' })
  })
})

describe('LIBRARY_CATALOGUE (#2643)', () => {
  it('starts with Spark', () => {
    expect(LIBRARY_CATALOGUE[0].name).toBe('@sparkjsdev/spark')
  })

  it('every entry is pinned: exact version in the URL, esm.sh build target fixed, URL allowed', () => {
    const names = new Set<string>()
    for (const e of LIBRARY_CATALOGUE) {
      expect(names.has(e.name), `${e.name} listed once`).toBe(false)
      names.add(e.name)
      expect(e.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(e.url.startsWith(`https://esm.sh/${e.name}@${e.version}?`), e.url).toBe(true)
      expect(new URL(e.url).searchParams.get('target'), `${e.name}: target fixed`).toBe('es2022')
      expect(isAllowedLibraryUrl(e.url)).toBe(true)
      expect(e.importLine).toContain(`from '${e.name}'`)
      expect(['MIT', 'Zlib', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC']).toContain(e.license)
    }
  })

  it('declarationFor hashes what the URL serves now (the same canonical form as libraryGraphHash)', async () => {
    const entry = LIBRARY_CATALOGUE[0]
    const files: Record<string, string> = {
      [entry.url]: `export * from "/@sparkjsdev/spark@2.4.0/es2022/spark.mjs";\n`,
      'https://esm.sh/@sparkjsdev/spark@2.4.0/es2022/spark.mjs': `import * as THREE from 'three';\nexport const SplatMesh = THREE.Mesh;\n`,
    }
    const decl = await declarationFor(entry, { fetchText: async (u) => files[u] })
    // Computed here independently, over the canonical bytes.
    const canonical = Object.keys(files).sort().map((u) => `${u}\n${files[u].length}\n${files[u]}\n`).join('')
    expect(decl).toEqual({ url: entry.url, sha384: createHash('sha384').update(canonical, 'utf8').digest('base64') })
  })

  it('declarationFor rejects with why when the URL can\'t be fetched', async () => {
    const entry = LIBRARY_CATALOGUE[0]
    await expect(declarationFor(entry, { fetchText: async (u) => { throw new LibraryLoadError(`fetching ${u} failed (HTTP 503)`) } })).rejects.toThrow(
      `fetching ${entry.url} failed (HTTP 503)`,
    )
  })
})
