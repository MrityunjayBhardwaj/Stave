/**
 * One owner for what a mute marker is (#1679) — a census of the SOURCE, not of
 * behaviour. Modelled on `knobScaleOwner.test.ts` (#1581).
 *
 * Strudel mutes a track whose label starts OR ends with `_`. Before #1679 that
 * one fact was read in seven places: the engine's capture hook knew both sides,
 * and six others knew only the prefix, so a silent `drums_:` was named `drums_`
 * and shown unmuted, and two `$_:` lines shared one id. `splitMuteMarker` in
 * `trackId.ts` is now the reading; everything else calls it.
 *
 * ⚠ NO BEHAVIOURAL TEST CAN SEE A SECOND READING THAT AGREES. A new
 * `label.startsWith('_')` somewhere is green on every arm until the day the
 * marker's spelling changes again — which is exactly how #1679 happened. So this
 * file reads text.
 *
 * ⚠ AND THE SHAPE `startsWith('_')` HAS HONEST OTHER USES. Sound maps hide
 * internal entries behind a leading `_`, and the inline-viz method family is
 * spelled `_pianoroll`. Those are different facts that share a character. They
 * are listed below BY FILE AND BY COUNT, each with its reason: a new use in one
 * of those files still changes a count and fails here, so the list is not a
 * place for a second reading to hide.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** packages/editor/src/codeView/ir/__tests__ → the repo root. */
const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..')
const OWNER = 'packages/editor/src/codeView/ir/trackId.ts'

/** A test for a leading or trailing `_`, in the two spellings the tree uses. */
const MARKER_TESTS = [
  /\.(startsWith|endsWith)\(\s*['"]_['"]\s*\)/g,
  /\.replace\(\s*\/\^_\//g,
]

/** Uses of the same shape for a DIFFERENT fact, pinned by count. */
const OTHER_FACTS: Record<string, { count: number; why: string }> = {
  'packages/editor/src/workspace/soundRegistry.ts': {
    count: 2,
    why: 'sound-map keys: a leading `_` hides an internal entry, not a track',
  },
  'packages/app/src/assetLibrary/soundsProvider.ts': {
    count: 1,
    why: 'sound names, same convention as soundRegistry',
  },
  'packages/editor/src/engine/StrudelEngine.ts': {
    count: 3,
    why:
      'one sound-name filter, plus the `.p()` capture wrapper — a mirror of ' +
      "Strudel's own repl (`@strudel/core` repl.mjs:172), kept in upstream's " +
      'spelling on purpose so the two can be compared line for line',
  },
  'packages/editor/src/codeView/ir/parameterRoutes.ts': {
    count: 1,
    why: 'the inline-viz method family is spelled `_pianoroll`; not a label',
  },
}

function countIn(text: string): number {
  let n = 0
  for (const re of MARKER_TESTS) n += text.match(re)?.length ?? 0
  return n
}

/** Every non-test source file in the two packages, repo-relative. */
function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue
        walk(full)
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        out.push(path.relative(ROOT, full).split(path.sep).join('/'))
      }
    }
  }
  for (const pkg of ['app', 'editor']) walk(path.join(ROOT, 'packages', pkg, 'src'))
  return out.sort()
}

describe('a mute marker has ONE reading (#1679)', () => {
  const files = sourceFiles()
  const counts = new Map(files.map((f) => [f, countIn(readFileSync(path.join(ROOT, f), 'utf8'))]))

  it('walked a whole tree, not an empty one', () => {
    // 432 non-test source files when this was written; the floor is what makes
    // "no second reading" mean anything.
    expect(files.length).toBeGreaterThan(400)
    expect(files).toContain(OWNER)
  })

  it('the owner really does test both sides (the positive control)', () => {
    const text = readFileSync(path.join(ROOT, OWNER), 'utf8')
    expect(text).toMatch(/\.startsWith\(\s*['"]_['"]\s*\)/)
    expect(text).toMatch(/\.endsWith\(\s*['"]_['"]\s*\)/)
  })

  it('every other use of the shape is a different fact, at its pinned count', () => {
    const found: Record<string, number> = {}
    for (const [f, n] of counts) if (f !== OWNER && n > 0) found[f] = n
    const expected = Object.fromEntries(Object.entries(OTHER_FACTS).map(([f, v]) => [f, v.count]))
    // Read the diff, don't just count it: a new entry here that reads a TRACK
    // label belongs in `splitMuteMarker`, called from wherever it is needed.
    expect(found, `examined ${files.length} source files`).toEqual(expected)
  })
})
