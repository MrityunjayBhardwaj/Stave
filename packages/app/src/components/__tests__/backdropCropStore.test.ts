/**
 * #1435 — the backdrop crop is per viz FILE, not per project.
 *
 * The defect these arms replace was observable: pin Piano Roll, crop it, swap
 * the backdrop to `scope`, and `scope` rendered with Piano Roll's rectangle —
 * `matrix(0.7331, 0, 0, 0.5, 0, 0)` on both — because the crop was stored
 * against the project and keyed to nothing. So the load-bearing arm here is
 * ISOLATION: a second file must not see the first file's crop.
 *
 * The parse arms are not defensive decoration. A crop flows straight into the
 * backdrop's transform math, where a `NaN` or a zero-width rect blanks the
 * backdrop with no error and no console line — a failure that looks like the
 * viz being broken, not like storage being wrong.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { CropRegion } from '@stave/editor'
import {
  backdropCropsKey,
  loadBackdropCrops,
  saveBackdropCrops,
  withBackdropCrop,
} from '../backdropCropStore'

const P = 'project-a'
const OTHER = 'project-b'
const PIANO = 'viz:__bundled_piano_roll_p5__'
const SCOPE = 'viz:__bundled_scope_p5__'

const cropA: CropRegion = { x: 0.1, y: 0, w: 0.68, h: 1 }
const cropB: CropRegion = { x: 0, y: 0.25, w: 1, h: 0.5 }

/**
 * Every test already gets fresh in-memory storage from `vitest.setup.ts` (#2126).
 * Before that, the storage a test got depended on the Node version and could be
 * non-functional (`clear is not a function`), so this suite installs its own —
 * same idiom as `timelineCameraPersistence.test.ts`.
 */
function installStorage(): void {
  const map = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
  }
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
}

let originalStorage: PropertyDescriptor | undefined

beforeEach(() => {
  originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
  installStorage()
})

afterEach(() => {
  if (originalStorage) {
    Object.defineProperty(window, 'localStorage', originalStorage)
  }
})

describe('#1435 — per-file backdrop crops', () => {
  it('round-trips one file’s crop', () => {
    saveBackdropCrops(P, new Map([[PIANO, cropA]]))
    expect(loadBackdropCrops(P).get(PIANO)).toEqual(cropA)
  })

  it('KEEPS TWO FILES APART — the defect itself', () => {
    let crops = withBackdropCrop(P, new Map(), PIANO, cropA)
    crops = withBackdropCrop(P, crops, SCOPE, cropB)

    const reloaded = loadBackdropCrops(P)
    expect(reloaded.get(PIANO)).toEqual(cropA)
    expect(reloaded.get(SCOPE)).toEqual(cropB)
    // The specific regression: scope must never be handed Piano Roll's rect.
    expect(reloaded.get(SCOPE)).not.toEqual(cropA)
  })

  it('a file with no crop of its own reads back as full-rect, not as its neighbour’s', () => {
    withBackdropCrop(P, new Map(), PIANO, cropA)
    expect(loadBackdropCrops(P).get(SCOPE)).toBeUndefined()
  })

  it('clearing one file leaves the others untouched', () => {
    let crops = withBackdropCrop(P, new Map(), PIANO, cropA)
    crops = withBackdropCrop(P, crops, SCOPE, cropB)
    crops = withBackdropCrop(P, crops, PIANO, null)

    expect(crops.has(PIANO)).toBe(false)
    const reloaded = loadBackdropCrops(P)
    expect(reloaded.has(PIANO)).toBe(false)
    expect(reloaded.get(SCOPE)).toEqual(cropB)
  })

  it('clearing the last crop removes the key rather than leaving an empty object', () => {
    const crops = withBackdropCrop(P, new Map(), PIANO, cropA)
    withBackdropCrop(P, crops, PIANO, null)
    expect(window.localStorage.getItem(backdropCropsKey(P))).toBeNull()
  })

  it('does not mutate the map it was given', () => {
    const before = new Map([[PIANO, cropA]])
    const after = withBackdropCrop(P, before, SCOPE, cropB)
    expect(before.size).toBe(1)
    expect(after.size).toBe(2)
    expect(after).not.toBe(before)
  })

  it('scopes by project — two projects do not collide', () => {
    withBackdropCrop(P, new Map(), PIANO, cropA)
    withBackdropCrop(OTHER, new Map(), PIANO, cropB)
    expect(loadBackdropCrops(P).get(PIANO)).toEqual(cropA)
    expect(loadBackdropCrops(OTHER).get(PIANO)).toEqual(cropB)
  })

  it('an absent key reads as no crops', () => {
    expect(loadBackdropCrops('never-saved').size).toBe(0)
  })

  it('corrupt JSON reads as no crops rather than throwing on the render path', () => {
    window.localStorage.setItem(backdropCropsKey(P), '{not json')
    expect(() => loadBackdropCrops(P)).not.toThrow()
    expect(loadBackdropCrops(P).size).toBe(0)
  })

  it('drops entries that would put NaN or a zero-area rect into the transform', () => {
    window.localStorage.setItem(
      backdropCropsKey(P),
      JSON.stringify({
        nan: { x: 0, y: 0, w: Number.NaN, h: 1 },
        missing: { x: 0, y: 0, w: 1 },
        zeroWidth: { x: 0, y: 0, w: 0, h: 1 },
        negative: { x: 0, y: 0, w: 1, h: -0.5 },
        notAnObject: 'nope',
        good: cropA,
      }),
    )
    const loaded = loadBackdropCrops(P)
    expect([...loaded.keys()]).toEqual(['good'])
    expect(loaded.get('good')).toEqual(cropA)
  })
})
