/**
 * vizPresetBridge — unit tests (Phase 10.2 Task 06).
 *
 * The bridge has two halves:
 *
 *   - `seedFromPreset(preset)` — pure synchronous data move. Fully
 *     testable without IndexedDB.
 *   - `flushToPreset(fileId, presetId)` + `seedFromPresetId(id)` — both
 *     touch `VizPresetStore`, which is IndexedDB-backed. jsdom has no
 *     IndexedDB, so we mock the store to assert the bridge calls the
 *     right store method with the right preset shape.
 *
 * Round-trip coverage: seed → edit content → flush → re-read preset
 * lands the edited content. This is the single most important
 * invariant the bridge upholds per CONTEXT S6.
 *
 * ## Mock strategy
 *
 * `vi.mock('../../../visualizers/vizPreset', ...)` replaces the module's
 * `VizPresetStore` export with a plain in-memory Map. The pure functions
 * (`sanitizePresetName`, etc.) are re-exported unchanged because the
 * bridge imports only the store and the type. This keeps the real
 * module's side effects (IndexedDB open) out of the test path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VizPreset } from '../../../visualizers/vizPreset'

// In-memory fake store. Populated per test via `fakeStore.set(...)`;
// asserted on via `fakeStore.get(...)`.
const fakeStore = new Map<string, VizPreset>()

vi.mock('../../../visualizers/vizPreset', async () => {
  const actual = await vi.importActual<
    typeof import('../../../visualizers/vizPreset')
  >('../../../visualizers/vizPreset')
  return {
    ...actual,
    VizPresetStore: {
      async getAll() {
        return Array.from(fakeStore.values())
      },
      async get(id: string) {
        return fakeStore.get(id)
      },
      async put(preset: VizPreset) {
        fakeStore.set(preset.id, { ...preset })
      },
      async delete(id: string) {
        fakeStore.delete(id)
      },
    },
  }
})

import {
  seedFromPreset,
  seedFromPresetId,
  flushToPreset,
  workspaceFileIdForPreset,
  languageForPresetRenderer,
  getPresetIdForFile,
} from '../vizPresetBridge'
import {
  getFile,
  setContent,
  renameWorkspaceFile,
  __resetWorkspaceFilesForTests,
} from '../../WorkspaceFile'

function makePreset(overrides: Partial<VizPreset> = {}): VizPreset {
  return {
    id: 'test_hydra_v1',
    name: 'Test',
    renderer: 'hydra',
    code: 's.osc().out()',
    requires: [],
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

describe('workspaceFileIdForPreset', () => {
  it('prefixes with viz: for namespacing', () => {
    expect(workspaceFileIdForPreset('foo')).toBe('viz:foo')
  })

  it('passes through bundled preset ids', () => {
    expect(workspaceFileIdForPreset('__bundled_piano_roll_hydra__')).toBe(
      'viz:__bundled_piano_roll_hydra__',
    )
  })
})

describe('languageForPresetRenderer', () => {
  it('hydra → hydra', () => {
    expect(languageForPresetRenderer('hydra')).toBe('hydra')
  })

  it('p5 → p5js (Monaco language id quirk)', () => {
    expect(languageForPresetRenderer('p5')).toBe('p5js')
  })

  it('glsl → glsl (#287)', () => {
    expect(languageForPresetRenderer('glsl')).toBe('glsl')
  })
})

describe('seedFromPreset', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    fakeStore.clear()
  })

  it('creates a workspace file with the preset code and derived id', () => {
    const preset = makePreset({
      id: 'a1',
      code: 'content-A',
      name: 'Alpha',
      renderer: 'hydra',
    })
    const fileId = seedFromPreset(preset)
    expect(fileId).toBe('viz:a1')

    const file = getFile(fileId)
    expect(file).toBeDefined()
    expect(file?.content).toBe('content-A')
    expect(file?.path).toBe('Alpha.hydra')
    expect(file?.language).toBe('hydra')
    expect(file?.meta?.presetId).toBe('a1')
  })

  it('maps p5 preset renderer to p5js language', () => {
    const preset = makePreset({
      id: 'p1',
      renderer: 'p5',
      code: 'background(0)',
      name: 'Pentagon',
    })
    seedFromPreset(preset)

    const file = getFile('viz:p1')
    expect(file?.language).toBe('p5js')
    expect(file?.path).toBe('Pentagon.p5')
  })

  it('re-seeding the same preset overwrites the existing workspace file', () => {
    const preset = makePreset({ id: 'r1', code: 'first' })
    seedFromPreset(preset)
    expect(getFile('viz:r1')?.content).toBe('first')

    seedFromPreset({ ...preset, code: 'second' })
    expect(getFile('viz:r1')?.content).toBe('second')
  })
})

describe('getPresetIdForFile', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    fakeStore.clear()
  })

  it('returns the back-reference set by seedFromPreset', () => {
    const preset = makePreset({ id: 'back1' })
    seedFromPreset(preset)
    const file = getFile('viz:back1')!
    expect(getPresetIdForFile(file)).toBe('back1')
  })

  it('returns undefined when meta has no presetId', () => {
    const file = {
      id: 'loose',
      path: 'loose.hydra',
      content: '',
      language: 'hydra' as const,
    }
    expect(getPresetIdForFile(file)).toBeUndefined()
  })
})

describe('seedFromPresetId (async)', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    fakeStore.clear()
  })

  it('reads the preset from the store and delegates to seedFromPreset', async () => {
    fakeStore.set('k1', makePreset({ id: 'k1', code: 'from-store' }))
    const fileId = await seedFromPresetId('k1')
    expect(fileId).toBe('viz:k1')
    expect(getFile('viz:k1')?.content).toBe('from-store')
  })

  it('returns undefined when the preset does not exist in the store', async () => {
    const fileId = await seedFromPresetId('nope')
    expect(fileId).toBeUndefined()
    expect(getFile('viz:nope')).toBeUndefined()
  })
})

describe('flushToPreset', () => {
  beforeEach(() => {
    __resetWorkspaceFilesForTests()
    fakeStore.clear()
  })

  it('writes the current workspace file content back to the preset store', async () => {
    const preset = makePreset({ id: 'flush1', code: 'original' })
    fakeStore.set(preset.id, preset)
    const fileId = seedFromPreset(preset)

    setContent(fileId, 'edited')
    await flushToPreset(fileId, preset.id)

    const stored = fakeStore.get(preset.id)
    expect(stored?.code).toBe('edited')
  })

  it('preserves createdAt and bumps updatedAt', async () => {
    const preset = makePreset({
      id: 'time1',
      createdAt: 555,
      updatedAt: 1000,
    })
    fakeStore.set(preset.id, preset)
    const fileId = seedFromPreset(preset)

    setContent(fileId, 'new content')
    const before = Date.now()
    await flushToPreset(fileId, preset.id)
    const after = Date.now()

    const stored = fakeStore.get(preset.id)!
    expect(stored.createdAt).toBe(555)
    expect(stored.updatedAt).toBeGreaterThanOrEqual(before)
    expect(stored.updatedAt).toBeLessThanOrEqual(after)
  })

  it("records the file it was saved from, so a visual used by name reports errors against it (#2209, #2210)", async () => {
    const preset = makePreset({ id: 'path1', name: 'Prism', renderer: 'glsl' })
    fakeStore.set(preset.id, preset)
    const fileId = seedFromPreset(preset)
    await flushToPreset(fileId, preset.id)
    expect(fakeStore.get(preset.id)?.filePath).toBe(getFile(fileId)?.path)
    expect(fakeStore.get(preset.id)?.name).toBe('Prism')
    // after a rename, the next flush records the new path
    renameWorkspaceFile(fileId, 'viz_lib/Prism/Prism.glsl')
    await flushToPreset(fileId, preset.id)
    expect(fakeStore.get(preset.id)?.filePath).toBe('viz_lib/Prism/Prism.glsl')
  })

  it('is a no-op when the workspace file does not exist', async () => {
    // No seed → no file → flush should resolve without writing anything.
    await flushToPreset('viz:phantom', 'phantom')
    expect(fakeStore.get('phantom')).toBeUndefined()
  })

  it('creates a fresh preset entry when none exists (first-save path)', async () => {
    // Seed via a preset object but DO NOT put it in the fake store,
    // simulating a brand-new file that hasn't been persisted yet.
    const preset = makePreset({ id: 'new1', code: 'draft', renderer: 'p5' })
    seedFromPreset(preset)
    setContent('viz:new1', 'first persisted draft')

    await flushToPreset('viz:new1', 'new1')

    const stored = fakeStore.get('new1')
    expect(stored).toBeDefined()
    expect(stored?.code).toBe('first persisted draft')
    expect(stored?.renderer).toBe('p5')
  })

  it('round-trip: seed → edit → flush → re-read matches edited content', async () => {
    const preset = makePreset({
      id: 'round1',
      code: 'initial',
      name: 'Round',
      renderer: 'hydra',
    })
    fakeStore.set(preset.id, preset)

    // 1. Seed into the workspace.
    const fileId = seedFromPreset(preset)
    expect(getFile(fileId)?.content).toBe('initial')

    // 2. User edits the file.
    setContent(fileId, 'user-edited code')

    // 3. Ctrl+S → flushToPreset.
    await flushToPreset(fileId, preset.id)

    // 4. Simulate re-opening the preset store (e.g., tomorrow).
    const reRead = fakeStore.get(preset.id)
    expect(reRead?.code).toBe('user-edited code')
    expect(reRead?.name).toBe('Round') // preserved from existing
    expect(reRead?.renderer).toBe('hydra') // preserved from existing
    expect(reRead?.createdAt).toBe(1000) // preserved from existing
  })
})
